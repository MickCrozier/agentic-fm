import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

function agentDir(): string {
  return path.resolve(process.cwd(), '..', 'agent');
}

// ── AI settings ──────────────────────────────────────────────────────────────
// Stored in layout-editor-app/.env.local (gitignored)

const ENV_FILE = path.resolve(process.cwd(), '.env.local');

function readEnv() {
  const s = { provider: 'claude-code', model: '', keys: {} as Record<string, string>, promptMarker: 'prompt' };
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
      if (k === 'AI_PROVIDER') s.provider = v;
      else if (k === 'AI_MODEL') s.model = v;
      else if (k === 'AI_PROMPT_MARKER') s.promptMarker = v;
      else if (k.startsWith('AI_KEY_')) s.keys[k.slice(7).toLowerCase()] = v;
    }
  } catch { /* file not yet created */ }
  return s;
}

function writeEnv(s: ReturnType<typeof readEnv>) {
  const keep: string[] = [];
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
      const t = line.trim();
      if (t.startsWith('#') || (!t.startsWith('AI_') && t)) keep.push(line);
    }
  } catch { /* ok */ }
  const ai = [
    `AI_PROVIDER=${s.provider}`, `AI_MODEL=${s.model}`, `AI_PROMPT_MARKER=${s.promptMarker}`,
    ...Object.entries(s.keys).filter(([, v]) => v).map(([k, v]) => `AI_KEY_${k.toUpperCase()}=${v}`),
  ];
  fs.writeFileSync(ENV_FILE, [...keep, ...ai].join('\n') + '\n', 'utf-8');
}

function getSettings() {
  const s = readEnv();
  return {
    provider: s.provider, model: s.model, promptMarker: s.promptMarker,
    configuredProviders: [...Object.entries(s.keys).filter(([, v]) => v).map(([k]) => k), 'claude-code'],
  };
}

// ── AI chat streaming ─────────────────────────────────────────────────────────

function sseWrite(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function proxyStream(opts: {
  hostname: string; path: string;
  headers: Record<string, string>; payload: string;
  res: ServerResponse;
  extractText: (e: Record<string, unknown>) => string | null;
}): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: opts.hostname, path: opts.path, method: 'POST',
        headers: { ...opts.headers, 'Content-Length': Buffer.byteLength(opts.payload) } },
      (upstream) => {
        if ((upstream.statusCode ?? 0) >= 400) {
          let body = '';
          upstream.on('data', (c: Buffer) => { body += c.toString(); });
          upstream.on('end', () => {
            sseWrite(opts.res, { type: 'error', error: `API error ${upstream.statusCode}: ${body}` });
            sseWrite(opts.res, { type: 'done' });
            opts.res.end(); resolve();
          });
          return;
        }
        let buf = '';
        upstream.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n'); buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const text = opts.extractText(JSON.parse(data));
              if (text) sseWrite(opts.res, { type: 'text', text });
            } catch { /* skip */ }
          }
        });
        upstream.on('end', () => { sseWrite(opts.res, { type: 'done' }); opts.res.end(); resolve(); });
        upstream.on('error', (err: Error) => { sseWrite(opts.res, { type: 'error', error: String(err) }); opts.res.end(); resolve(); });
      },
    );
    req.on('error', (err: Error) => { sseWrite(opts.res, { type: 'error', error: String(err) }); opts.res.end(); resolve(); });
    opts.res.on('close', () => req.destroy());
    req.write(opts.payload); req.end();
  });
}

function streamClaudeCode(
  messages: { role: string; content: string }[],
  model: string,
  res: ServerResponse,
): Promise<void> {
  return new Promise((resolve) => {
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
    const conversation = messages.filter(m => m.role !== 'system');
    // Build a single prompt string: system context then conversation turns
    const parts: string[] = [];
    if (systemMsg) parts.push(systemMsg);
    for (const m of conversation) {
      parts.push(`${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`);
    }
    const promptText = parts.join('\n\n');

    const args = ['--output-format', 'stream-json', '--verbose',
      ...(model ? ['--model', model] : [])];

    const proc = spawn('claude', args, { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });

    // Write prompt via stdin to avoid shell arg-length limits
    proc.stdin.write(promptText);
    proc.stdin.end();

    let sentLen = 0;
    let buf = '';

    const parseLine = (line: string) => {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
          for (const block of ev.message.content) {
            if (block.type === 'text') {
              const delta = (block.text as string).slice(sentLen);
              sentLen = (block.text as string).length;
              if (delta) sseWrite(res, { type: 'text', text: delta });
            }
          }
        }
      } catch { /* skip */ }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n'); buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) parseLine(line);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      console.error('[claude-cli]', chunk.toString().trim());
    });
    proc.on('close', () => {
      sseWrite(res, { type: 'done' });
      res.end();
      resolve();
    });
    proc.on('error', (err: Error) => {
      sseWrite(res, { type: 'error', error: `Failed to start claude CLI: ${err.message}` });
      sseWrite(res, { type: 'done' });
      res.end();
      resolve();
    });
    res.on('close', () => proc.kill());
  });
}

async function handleChat(body: { messages: { role: string; content: string }[]; sessionId?: string }, res: ServerResponse) {
  const env = readEnv();
  const provider = env.provider;
  const model = env.model;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (provider === 'claude-code') {
    await streamClaudeCode(body.messages, model, res);
    return;
  }

  const apiKey = env.keys[provider] ?? '';
  if (!apiKey) {
    sseWrite(res, { type: 'error', error: `No API key configured for "${provider}". Open Settings (⚙) to add one.` });
    sseWrite(res, { type: 'done' });
    res.end(); return;
  }

  const systemMessage = body.messages.find(m => m.role === 'system')?.content ?? '';
  const conversation = body.messages.filter(m => m.role !== 'system');

  if (provider === 'anthropic') {
    await proxyStream({
      hostname: 'api.anthropic.com', path: '/v1/messages',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 4096, temperature: 0.3,
        system: systemMessage, messages: conversation, stream: true }),
      res,
      extractText(e) {
        if (e.type === 'content_block_delta') {
          const d = e.delta as Record<string, unknown> | undefined;
          return (d?.text as string) ?? null;
        }
        return null;
      },
    });
  } else if (provider === 'openai') {
    await proxyStream({
      hostname: 'api.openai.com', path: '/v1/chat/completions',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      payload: JSON.stringify({ model: model || 'gpt-4o', max_tokens: 4096, temperature: 0.3,
        messages: body.messages, stream: true }),
      res,
      extractText(e) {
        const choices = e.choices as { delta?: { content?: string } }[] | undefined;
        return choices?.[0]?.delta?.content ?? null;
      },
    });
  } else {
    sseWrite(res, { type: 'error', error: `Unknown provider: ${provider}` });
    sseWrite(res, { type: 'done' });
    res.end();
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

function readContext(): Record<string, unknown> | null {
  try {
    const p = path.join(agentDir(), 'CONTEXT.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Recursively find a layout XML file matching the given ID (or name fallback). */
function findLayoutXML(layoutName: string, layoutId: number, solution?: string): string | null {
  const agent = agentDir();
  const xmlParsed = path.join(agent, 'xml_parsed', 'layouts');
  if (!fs.existsSync(xmlParsed)) return null;

  const rootDirs: string[] = solution
    ? [path.join(xmlParsed, solution)]
    : fs.readdirSync(xmlParsed, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => path.join(xmlParsed, e.name));

  function search(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Match by ID — use word boundary so ID 7 doesn't match ID 77
    const idPattern = new RegExp(`\\bID ${layoutId}\\b`);
    const byId = entries.find(
      e => e.isFile() && e.name.endsWith('.xml') && idPattern.test(e.name)
    );
    if (byId) return path.join(dir, byId.name);

    // Recurse into subdirectories
    for (const entry of entries.filter(e => e.isDirectory())) {
      const found = search(path.join(dir, entry.name));
      if (found) return found;
    }

    // Name fallback (after recursion so ID match in subdirs wins)
    const byName = entries.find(
      e => e.isFile() && e.name.toLowerCase().startsWith(layoutName.toLowerCase())
    );
    if (byName) return path.join(dir, byName.name);

    return null;
  }

  for (const dir of rootDirs) {
    const found = search(dir);
    if (found) return found;
  }
  return null;
}

export function apiMiddleware(): Plugin {
  return {
    name: 'layout-editor-api',
    configureServer(server) {
      server.middlewares.use('/api/layout-xml', (_req, res) => {
        const ctx = readContext();
        if (!ctx) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'CONTEXT.json not found' }));
          return;
        }

        const layout = ctx.current_layout as { name: string; id: number } | undefined;
        if (!layout) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No current_layout in CONTEXT.json' }));
          return;
        }

        const solution = ctx.solution as string | undefined;
        const xmlPath = findLayoutXML(layout.name, layout.id, solution);
        if (!xmlPath) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Layout XML not found for: ${layout.name} (ID ${layout.id})` }));
          return;
        }

        try {
          const xml = fs.readFileSync(xmlPath, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(xml);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      server.middlewares.use('/api/context', (_req, res) => {
        const ctx = readContext();
        if (!ctx) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'CONTEXT.json not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ctx));
      });

      server.middlewares.use('/api/custom-instructions', (req, res) => {
        const filePath = path.join(agentDir(), 'context', 'custom-instructions.txt');
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            try {
              const { content } = JSON.parse(body);
              fs.mkdirSync(path.dirname(filePath), { recursive: true });
              fs.writeFileSync(filePath, content ?? '', 'utf-8');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content }));
      });

      // AI settings
      server.middlewares.use('/api/settings', async (req, res) => {
        if (req.method === 'POST') {
          try {
            const update = JSON.parse(await readBody(req));
            const s = readEnv();
            if (update.provider) s.provider = update.provider;
            if (update.model !== undefined) s.model = update.model;
            if (update.promptMarker !== undefined) s.promptMarker = update.promptMarker;
            if (update.apiKey !== undefined && update.apiKeyProvider) s.keys[update.apiKeyProvider] = update.apiKey;
            writeEnv(s);
          } catch { /* bad JSON */ }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getSettings()));
      });

      // AI chat (SSE streaming)
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        try {
          const body = JSON.parse(await readBody(req));
          await handleChat(body, res);
        } catch (e) {
          if (!res.headersSent) { res.writeHead(500); }
          res.end(JSON.stringify({ error: String(e) }));
        }
      });

      server.middlewares.use('/api/theme.css', (_req, res) => {
        const ctx = readContext();
        const solution = ctx?.solution as string | undefined;
        if (solution) {
          const cssPath = path.join(agentDir(), 'context', solution, 'theme-web.css');
          if (fs.existsSync(cssPath)) {
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(fs.readFileSync(cssPath, 'utf-8'));
            return;
          }
        }
        res.writeHead(404);
        res.end('');
      });
    },
  };
}
