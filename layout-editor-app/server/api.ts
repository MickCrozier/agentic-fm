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
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'prompt-caching-2024-07-31' },
      payload: JSON.stringify({ model: model || 'claude-sonnet-4-6', max_tokens: 4096, temperature: 0.3,
        system: [{ type: 'text', text: systemMessage, cache_control: { type: 'ephemeral' } }],
        messages: conversation, stream: true }),
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

// ── Agent state sync ─────────────────────────────────────────────────────────
// Allows external agents to GET the current layout state and POST a modified
// version back. The client pushes its state on every change; incoming state
// from an agent is held here until the client polls and picks it up.

let currentState: unknown = null;
let incomingState: unknown = null;

export function apiMiddleware(): Plugin {
  return {
    name: 'layout-editor-api',
    configureServer(server) {
      // Layout XML comes from the FM clipboard via the plugin. The plugin cannot
      // switch to Layout Mode or copy objects itself, so the developer must select
      // all (Cmd+A) and copy (Cmd+C) in Layout Mode first.
      server.middlewares.use('/api/layout-xml', async (_req, res) => {
        const token = process.env.AGFM_PLUGIN_TOKEN;
        if (!token) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'AGFM_PLUGIN_TOKEN not set — cannot reach the plugin' }));
          return;
        }
        const pluginUrl = process.env.AGFM_PLUGIN_URL
          || `http://localhost:${process.env.AGFM_PLUGIN_PORT || 8766}`;

        try {
          const pluginRes = await fetch(`${pluginUrl}/api/clipboard`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!pluginRes.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Plugin returned ${pluginRes.status}` }));
            return;
          }
          const json = await pluginRes.json() as { xml?: string; class?: string };
          if (!json.xml || (json.class !== 'XML2' && json.class !== 'XMLO')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'No layout objects on the clipboard. In FileMaker: switch to Layout Mode, '
                + 'select all (Cmd+A), copy (Cmd+C), then retry.',
              found: json.class ?? 'nothing',
            }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
          res.end(json.xml);
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
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

      const makeInstructionsEndpoint = (route: string, fileName: string) => {
        server.middlewares.use(route, (req, res) => {
          const filePath = path.join(agentDir(), 'context', fileName);
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
      };

      makeInstructionsEndpoint('/api/custom-instructions', 'custom-instructions.txt');
      makeInstructionsEndpoint('/api/layout-instructions', 'layout-instructions.txt');

      // /api/clipboard — proxy to the agentic-fm plugin to avoid browser CORS restrictions
      server.middlewares.use('/api/clipboard', async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
        const token = process.env.AGFM_PLUGIN_TOKEN;
        if (!token) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'AGFM_PLUGIN_TOKEN not set — cannot reach the plugin' }));
          return;
        }
        const pluginUrl = process.env.AGFM_PLUGIN_URL
          || `http://localhost:${process.env.AGFM_PLUGIN_PORT || 8766}`;
        try {
          const body = await readBody(req);
          const pluginRes = await fetch(`${pluginUrl}/api/clipboard/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body,
          });
          const json = await pluginRes.json();
          res.writeHead(pluginRes.ok ? 200 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(json));
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: String(e) }));
        }
      });

      // /api/docs — layout-relevant knowledge files + theme class reference
      server.middlewares.use('/api/docs', (_req, res) => {
        const knowledgeDir = path.join(agentDir(), 'docs', 'knowledge');
        const LAYOUT_PATTERN = /^layout/i;
        let knowledge = '';
        try {
          const files = fs.readdirSync(knowledgeDir)
            .filter(f => f.endsWith('.md') && f !== 'MANIFEST.md' && LAYOUT_PATTERN.test(f))
            .sort();
          knowledge = files
            .map(f => {
              const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf-8');
              return `## ${f.replace('.md', '')}\n\n${content}`;
            })
            .join('\n\n---\n\n');
        } catch { /* not found */ }

        // Append theme class summary from the active solution's theme CSS
        try {
          const ctx = readContext();
          const solution = ctx?.solution as string | undefined;
          if (solution) {
            const themesDir = path.join(agentDir(), 'context', solution, 'themes');
            if (fs.existsSync(themesDir)) {
              const themeDirs = fs.readdirSync(themesDir, { withFileTypes: true })
                .filter(d => d.isDirectory());
              for (const td of themeDirs) {
                const cssPath = path.join(themesDir, td.name, 'theme-web.css');
                if (!fs.existsSync(cssPath)) continue;
                const css = fs.readFileSync(cssPath, 'utf-8');

                // Parse out className:normal .self { ... } blocks
                const blocks: Record<string, string> = {};
                const blockRe = /^([a-z][a-z0-9_-]*):normal \.self\s*\{([^}]*)\}/gm;
                let m: RegExpExecArray | null;
                while ((m = blockRe.exec(css)) !== null) {
                  const cls = m[1];
                  const props = m[2].trim()
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('/*'));
                  if (props.length > 0) blocks[cls] = props.join(' ');
                }

                // Collect all class names (including those with no :normal .self props)
                const allClasses = new Set<string>();
                const clsRe = /^([a-z][a-z0-9_-]*):(?:normal|hover|focus|pressed|checked)/gm;
                while ((m = clsRe.exec(css)) !== null) allClasses.add(m[1]);

                const lines: string[] = [];
                for (const cls of [...allClasses].sort()) {
                  const props = blocks[cls];
                  lines.push(props ? `- \`${cls}\` — ${props}` : `- \`${cls}\``);
                }

                if (lines.length > 0) {
                  const section = `## Theme Classes (${td.name})\n\nUse these class names as \`themeClass\` when adding or styling objects.\n\n${lines.join('\n')}`;
                  knowledge = knowledge ? `${knowledge}\n\n---\n\n${section}` : section;
                }
                break; // use first theme found
              }
            }
          }
        } catch { /* theme parsing optional */ }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ knowledge }));
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

      // Serve fields from fields.index for the current solution.
      // Only returns the base TO and TOs directly related to it via relationships.index.
      server.middlewares.use('/api/fields', (_req, res) => {
        const ctx = readContext();
        const solution = ctx?.solution as string | undefined;
        const baseTo = (ctx?.current_layout as { base_to?: string } | undefined)?.base_to;
        if (!solution || !baseTo) { res.writeHead(404); res.end('[]'); return; }
        const contextDir = path.join(agentDir(), 'context', solution);

        // Find related TOs from relationships.index
        const relPath = path.join(contextDir, 'relationships.index');
        const relatedTOs = new Set<string>([baseTo]);
        if (fs.existsSync(relPath)) {
          for (const line of fs.readFileSync(relPath, 'utf-8').split('\n')) {
            if (!line || line.startsWith('#')) continue;
            const [leftTO, , rightTO] = line.split('|');
            if (leftTO === baseTo) relatedTOs.add(rightTO);
            if (rightTO === baseTo) relatedTOs.add(leftTO);
          }
        }

        const indexPath = path.join(contextDir, 'fields.index');
        if (!fs.existsSync(indexPath)) { res.writeHead(404); res.end('[]'); return; }
        const fields: { table: string; name: string; id: number; type: string }[] = [];
        for (const line of fs.readFileSync(indexPath, 'utf-8').split('\n')) {
          if (!line || line.startsWith('#')) continue;
          const parts = line.split('|');
          if (parts.length < 5) continue;
          const [tableName, , fieldName, fieldId, dataType] = parts;
          if (!relatedTOs.has(tableName)) continue;
          fields.push({ table: tableName, name: fieldName, id: parseInt(fieldId) || 0, type: dataType });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fields));
      });

      // Serve the current solution's default theme CSS.
      // Looks in context/{solution}/themes/{ThemeName}/theme-web.css (first theme found).
      server.middlewares.use('/api/theme.css', (_req, res) => {
        const ctx = readContext();
        const solution = ctx?.solution as string | undefined;
        if (solution) {
          const themesSubDir = path.join(agentDir(), 'context', solution, 'themes');
          if (fs.existsSync(themesSubDir)) {
            const themeDirs = fs.readdirSync(themesSubDir, { withFileTypes: true })
              .filter(e => e.isDirectory());
            for (const td of themeDirs) {
              const cssPath = path.join(themesSubDir, td.name, 'theme-web.css');
              if (fs.existsSync(cssPath)) {
                res.writeHead(200, { 'Content-Type': 'text/css' });
                res.end(fs.readFileSync(cssPath, 'utf-8'));
                return;
              }
            }
          }
        }
        res.writeHead(404);
        res.end('');
      });

      // Serve extracted theme images: /api/theme-image/{themeName}/{filename}
      server.middlewares.use('/api/theme-image', (req, res) => {
        if (!req.url) { res.writeHead(404); res.end(''); return; }
        const parts = req.url.replace(/^\//, '').split('/');
        if (parts.length < 2) { res.writeHead(404); res.end(''); return; }
        const [themeName, fileName] = parts.map(decodeURIComponent);
        if (themeName.includes('..') || fileName.includes('..')) { res.writeHead(400); res.end(''); return; }
        const ctx = readContext();
        const solution = ctx?.solution as string | undefined;
        if (!solution) { res.writeHead(404); res.end(''); return; }
        const imgPath = path.join(agentDir(), 'context', solution, 'themes', themeName, fileName);
        if (!fs.existsSync(imgPath)) { res.writeHead(404); res.end(''); return; }
        const ext = path.extname(fileName).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=86400' });
        res.end(fs.readFileSync(imgPath));
      });

      // List / serve themes for the current context solution only.
      server.middlewares.use('/api/themes', (req, res) => {
        const ctx = readContext();
        const solution = ctx?.solution as string | undefined;

        // Build a map of theme name → { source, cssPath }
        const themeMap = new Map<string, { source: string; cssPath: string; internalName?: string }>();

        // Themes from the current context solution: context/{solution}/themes/{ThemeName}/
        if (solution) {
          const themesSubDir = path.join(agentDir(), 'context', solution, 'themes');
          if (fs.existsSync(themesSubDir)) {
            for (const themeDir of fs.readdirSync(themesSubDir, { withFileTypes: true })) {
              if (!themeDir.isDirectory()) continue;
              const manifestPath = path.join(themesSubDir, themeDir.name, 'theme-manifest.json');
              const cssPath      = path.join(themesSubDir, themeDir.name, 'theme-web.css');
              if (!fs.existsSync(cssPath)) continue;
              try {
                const manifest = fs.existsSync(manifestPath)
                  ? JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
                  : null;
                const name: string = manifest?.theme?.name ?? themeDir.name;
                const internalName: string | undefined = manifest?.theme?.internalName;
                themeMap.set(name, { source: 'context', cssPath, internalName });
              } catch { /* malformed manifest — use folder name */ }
            }
          }
        }

        // Serve a single theme by name — extract embedded images to files and rewrite CSS
        if (req.url && req.url !== '/' && req.url !== '') {
          const rawName = decodeURIComponent(req.url.replace(/^\//, '').replace(/\.css$/, ''));
          if (!rawName || rawName.includes('..')) { res.writeHead(400); res.end(''); return; }
          const entry = themeMap.get(rawName);
          if (!entry) { res.writeHead(404); res.end(''); return; }
          const themeDir = path.dirname(entry.cssPath);
          let css = fs.readFileSync(entry.cssPath, 'utf-8');
          // Extract -fm-image-data(...) blobs to PNG files and replace with file URL
          css = css.replace(/-fm-image-data\(([^;]+);(data:image\/[^;]+;base64,([^)]+))\)/g,
            (_match, filename, _dataUrl, b64) => {
              const imgPath = path.join(themeDir, filename);
              if (!fs.existsSync(imgPath)) {
                fs.writeFileSync(imgPath, Buffer.from(b64, 'base64'));
              }
              const encodedTheme = encodeURIComponent(rawName);
              const encodedFile  = encodeURIComponent(filename);
              return `url("/api/theme-image/${encodedTheme}/${encodedFile}")`;
            });
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end(css);
          return;
        }

        // List all themes
        const themes = [...themeMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, { source, internalName }]) => ({ name, source, internalName }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(themes));
      });

      // Agent state sync — GET/POST /api/state and /api/state/incoming
      server.middlewares.use('/api/state/incoming', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'POST') {
          try {
            incomingState = JSON.parse(await readBody(req));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }
        // GET — return pending state and clear it
        if (incomingState !== null) {
          const payload = incomingState;
          incomingState = null;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: payload }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ state: null }));
        }
      });

      server.middlewares.use('/api/state', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'POST') {
          try {
            currentState = JSON.parse(await readBody(req));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e) }));
          }
          return;
        }
        // GET — return current state as seen by the client
        if (currentState !== null) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(currentState));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No state received from client yet' }));
        }
      });

      // List theme class names for a given theme, optionally filtered by FM base type.
      // GET /api/theme-classes/{ThemeName}?fmType=button
      // Returns { classes: string[] }
      server.middlewares.use('/api/theme-classes', (req, res) => {
        const ctx = readContext();
        const solution = ctx?.solution as string | undefined;
        if (!solution || !req.url || req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ classes: [] }));
          return;
        }

        const urlObj = new URL(req.url, 'http://localhost');
        const rawName = decodeURIComponent(urlObj.pathname.replace(/^\//, ''));
        const fmTypeFilter = urlObj.searchParams.get('fmType') ?? null;

        const cssPath = path.join(agentDir(), 'context', solution, 'themes', rawName, 'theme-web.css');
        if (!fs.existsSync(cssPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ classes: [] }));
          return;
        }

        const css = fs.readFileSync(cssPath, 'utf-8');
        // Parse selectors: baseType.namedClass:state .sub
        const clsRe = /^([\w-]+)\.([\w-]+):(normal|hover|focus|pressed|checked)\s+\.[\w-]+\s*$/gm;
        const seen = new Map<string, Set<string>>(); // fmType → set of class names
        let m: RegExpExecArray | null;
        while ((m = clsRe.exec(css)) !== null) {
          const [, fmType, cls] = m;
          if (!seen.has(fmType)) seen.set(fmType, new Set());
          seen.get(fmType)!.add(cls);
        }

        let classes: string[];
        if (fmTypeFilter) {
          classes = [...(seen.get(fmTypeFilter) ?? [])].sort();
        } else {
          const all = new Set<string>();
          for (const s of seen.values()) s.forEach(c => all.add(c));
          classes = [...all].sort();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ classes }));
      });

    },
  };
}
