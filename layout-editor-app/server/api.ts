import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function agentDir(): string {
  return path.resolve(process.cwd(), '..', 'agent');
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

    // Match by ID first
    const byId = entries.find(
      e => e.isFile() && e.name.endsWith('.xml') && e.name.includes(`ID ${layoutId}`)
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
