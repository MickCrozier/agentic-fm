'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// ─── Project root detection ───────────────────────────────────────────────────

function findProjectRoot(uri) {
  let dir = uri ? path.dirname(uri.fsPath) : null;
  if (dir) {
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, 'agent', 'fmlint', '__main__.py'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const folders = vscode.workspace.workspaceFolders || [];
  for (const f of folders) {
    if (fs.existsSync(path.join(f.uri.fsPath, 'agent', 'fmlint', '__main__.py')))
      return f.uri.fsPath;
  }
  return null;
}

// ─── fmscript completions ─────────────────────────────────────────────────────

const CONTROL_STEPS = new Set([
  'If', 'Else If', 'Else', 'End If',
  'Loop', 'End Loop', 'While', 'End While',
  'Exit Loop If', 'Exit Script', 'Halt Script'
]);

function sigToSnippet(name, sig) {
  if (!sig) return name;
  if (name === '# (comment)') return '# ${1:comment}';
  let n = 1;
  let s = sig;
  const simpleEnum = s.match(/^\[\s*([A-Za-z][A-Za-z ]*(?:\|[A-Za-z][A-Za-z ]*)+)\s*\]$/);
  if (simpleEnum) {
    const choices = simpleEnum[1].split('|').map(c => c.trim()).join(',');
    return `${name} [ \${${n}|${choices}|} ]`;
  }
  s = s.replace(/(:\s*)(calc|name|n\b|type|option|text)\b/g, (m, colon, type) =>
    `${colon}\${${n++}:${type}}`);
  s = s.replace(/(\[\s*)(calc|name|n\b)(\s*\])/g, (m, open, type, close) =>
    `${open}\${${n++}:${type}}${close}`);
  return `${name} ${s}`;
}

function buildFmscriptCompletions(extPath) {
  const steps = JSON.parse(fs.readFileSync(path.join(extPath, 'completions.json'), 'utf8'));
  return steps.map(step => {
    const isControl = CONTROL_STEPS.has(step.name);
    const item = new vscode.CompletionItem(
      step.name,
      isControl ? vscode.CompletionItemKind.Keyword : vscode.CompletionItemKind.Function
    );
    item.insertText  = new vscode.SnippetString(sigToSnippet(step.name, step.sig));
    item.detail      = step.sig || '(no parameters)';
    item.filterText  = step.name;
    item.sortText    = (isControl ? '0_' : '1_') + step.name.toLowerCase();
    const docs = new vscode.MarkdownString();
    if (step.category) docs.appendMarkdown(`**Category:** ${step.category}\n\n`);
    if (step.sig)      docs.appendMarkdown(`\`${step.sig}\`\n\n`);
    if (step.helpUrl)  docs.appendMarkdown(`[FileMaker Help ↗](${step.helpUrl})`);
    item.documentation = docs;
    return item;
  });
}

// ─── fmcalc completions ───────────────────────────────────────────────────────

function buildFmcalcCompletions(extPath) {
  const fns = JSON.parse(fs.readFileSync(path.join(extPath, 'fm-functions.json'), 'utf8'));
  const items = [];
  const seen = new Set();

  for (const fn of fns) {
    const label = fn.name === 'Get' ? `Get ( ${fn.params} )` : fn.name;
    if (seen.has(label)) continue;
    seen.add(label);

    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Function);

    if (fn.name === 'Get') {
      item.insertText  = new vscode.SnippetString(`Get ( ${fn.params} )`);
      item.filterText  = `Get ${fn.params}`;
      item.sortText    = `get_${fn.params.toLowerCase()}`;
    } else {
      const paramCount = fn.params ? fn.params.split(';').length : 0;
      const snippetParams = fn.params
        ? fn.params.split(';').map((p, i) => `\${${i+1}:${p.trim()}}`).join(' ; ')
        : '';
      item.insertText  = new vscode.SnippetString(
        paramCount > 0 ? `${fn.name} ( ${snippetParams} )` : `${fn.name} ( $1 )`
      );
      item.sortText    = '1_' + fn.name.toLowerCase();
    }

    item.detail = fn.params ? `( ${fn.params} )` : '';
    const docs = new vscode.MarkdownString();
    if (fn.desc) docs.appendMarkdown(fn.desc);
    if (fn.category) docs.appendMarkdown(`\n\n**Category:** ${fn.category}`);
    item.documentation = docs;
    items.push(item);
  }

  return items;
}

// ─── Custom function completions from CONTEXT.json ────────────────────────────

function loadCustomFunctionCompletions(root) {
  if (!root) return [];
  const ctxPath = path.join(root, 'agent', 'CONTEXT.json');
  if (!fs.existsSync(ctxPath)) return [];
  try {
    const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
    const cfs = ctx.custom_functions || {};
    return Object.entries(cfs).map(([name, info]) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      item.detail = '(custom function)';
      item.sortText = '0_' + name.toLowerCase();
      const docs = new vscode.MarkdownString();
      docs.appendMarkdown(`**Custom function** — ${ctx.solution || 'this solution'}`);
      if (info.params) docs.appendMarkdown(`\n\nParams: \`${info.params}\``);
      item.documentation = docs;
      return item;
    });
  } catch { return []; }
}

// ─── Linting ──────────────────────────────────────────────────────────────────

const debounceTimers = new Map();

function runLint(document, collection) {
  if (!['fmscript', 'fmcalc'].includes(document.languageId)) return;
  const root = findProjectRoot(document.uri);
  if (!root) return;

  execFile(
    'python3', ['-m', 'agent.fmlint', '--format', 'json', document.uri.fsPath],
    { cwd: root },
    (err, stdout) => {
      if (!stdout) return;
      let result;
      try { result = JSON.parse(stdout); } catch { return; }
      const diags = [];
      for (const file of result.files || []) {
        for (const d of file.diagnostics || []) {
          const line   = Math.max(0, (d.line || 1) - 1);
          const col    = d.column || 0;
          const endLine = d.end_line > 0 ? Math.max(0, d.end_line - 1) : line;
          const endCol  = d.end_column > 0 ? d.end_column : Number.MAX_SAFE_INTEGER;
          const sev = d.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;
          const diag = new vscode.Diagnostic(new vscode.Range(line, col, endLine, endCol), d.message, sev);
          diag.code   = d.rule_id;
          diag.source = 'fmlint';
          diags.push(diag);
        }
      }
      collection.set(document.uri, diags);
    }
  );
}

function scheduleLint(document, collection, delay = 800) {
  const key = document.uri.toString();
  clearTimeout(debounceTimers.get(key));
  debounceTimers.set(key, setTimeout(() => runLint(document, collection), delay));
}

// ─── Context sync ─────────────────────────────────────────────────────────────

function syncContext(root, statusBar) {
  if (!root) {
    vscode.window.showErrorMessage('Agentic FM: no agentic-fm workspace found.');
    return;
  }
  statusBar.text = '$(sync~spin) FM Context…';
  statusBar.tooltip = 'Syncing FileMaker context…';

  execFile(
    'python3', ['agent/scripts/agfm_bridge.py', 'context', '--refresh'],
    { cwd: root },
    (err, stdout, stderr) => {
      const out = (stdout || '').trim();
      if (err && !out) {
        statusBar.text = '$(warning) FM Context';
        statusBar.tooltip = stderr || String(err);
        vscode.window.showErrorMessage(`FM Context sync failed: ${stderr || err}`);
        return;
      }
      const match = out.match(/solution:\s*([^,]+),\s*layout:\s*(.+)/);
      if (match) {
        const [, solution, layout] = match;
        statusBar.text = `$(database) ${solution.trim()}`;
        statusBar.tooltip = `Layout: ${layout.trim()}\nClick to refresh`;
        vscode.window.showInformationMessage(`FM Context: ${out}`);
      } else {
        statusBar.text = '$(database) FM Context';
        statusBar.tooltip = out || 'Context synced';
      }
    }
  );
}

// ─── Script file helpers ──────────────────────────────────────────────────────

function readEnvLocal(root) {
  if (!root) return {};
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=][^=]*)=(.*)/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

function _httpRequest(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const parsed = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = mod.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpGet(url, token)        { return _httpRequest('GET',  url, token, null); }
function httpPost(url, token, body) { return _httpRequest('POST', url, token, body); }

function findFileRecursive(dir, filename, depth = 4) {
  if (depth === 0 || !fs.existsSync(dir)) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === filename.toLowerCase()) {
      return path.join(dir, e.name);
    }
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFileRecursive(path.join(dir, e.name), filename, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function findScriptFile(root, solution, scriptName) {
  if (!root) return null;
  const filename = scriptName + '.fmscript';
  const dirs = [
    solution ? path.join(root, 'agent', 'sandbox', solution) : null,
    path.join(root, 'agent', 'sandbox'),
    solution ? path.join(root, 'agent', 'xml_parsed', 'scripts_sanitized', solution) : null,
    path.join(root, 'agent', 'xml_parsed', 'scripts_sanitized'),
  ].filter(Boolean);

  for (const dir of dirs) {
    const found = findFileRecursive(dir, filename);
    if (found) return found;
  }
  return null;
}


async function openScriptFile(root, solution, scriptName) {
  const localPath = findScriptFile(root, solution, scriptName);
  if (localPath) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    `"${scriptName}" not found locally. Fetch from plugin?`,
    'Fetch from Plugin',
    'Cancel'
  );
  if (choice !== 'Fetch from Plugin') return;

  const env = readEnvLocal(root);
  const pluginUrl = env['AGFM_PLUGIN_URL'];
  const token = env['AGFM_PLUGIN_TOKEN'];
  if (!pluginUrl || !token) {
    vscode.window.showErrorMessage('AGFM_PLUGIN_URL / AGFM_PLUGIN_TOKEN not found in .env.local');
    return;
  }

  try {
    await httpPost(`${pluginUrl}/api/ui/script/navigate`, token, { scriptName });
  } catch { /* best-effort */ }

  let result;
  try {
    result = await httpGet(`${pluginUrl}/api/ui/script`, token);
  } catch (e) {
    vscode.window.showErrorMessage(`Plugin request failed: ${e.message}`);
    return;
  }

  const body = result.body;
  if (result.status !== 200 || !body || !Array.isArray(body.steps)) {
    vscode.window.showErrorMessage('Plugin returned no script — is the script open in Script Workspace?');
    return;
  }

  const fetchedName = body.scriptName || scriptName;
  if (fetchedName.toLowerCase() !== scriptName.toLowerCase()) {
    const proceed = await vscode.window.showWarningMessage(
      `Plugin has "${fetchedName}" open, but you clicked "${scriptName}". Save as "${fetchedName}"?`,
      'Save', 'Cancel'
    );
    if (proceed !== 'Save') return;
  }

  const saveName = fetchedName || scriptName;
  const targetDir = path.join(root, 'agent', 'sandbox', solution || 'Unknown');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, saveName + '.fmscript');
  fs.writeFileSync(targetPath, body.steps.join('\n'), 'utf8');

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
  vscode.window.showInformationMessage(`Saved: ${path.relative(root, targetPath)}`);
}

// ─── Context webview ──────────────────────────────────────────────────────────

function showContextWebview(root, context) {
  const panel = vscode.window.createWebviewPanel(
    'agenticfmContext',
    'FM Context',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  let currentCtx = null;

  function refresh() {
    if (!root) { panel.webview.html = buildWebviewHtml(null); return; }
    const ctxPath = path.join(root, 'agent', 'CONTEXT.json');
    if (!fs.existsSync(ctxPath)) { panel.webview.html = buildWebviewHtml(null); return; }
    try {
      currentCtx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
      panel.webview.html = buildWebviewHtml(currentCtx);
    } catch (e) {
      panel.webview.html = `<body style="padding:20px;font-family:sans-serif">Error reading CONTEXT.json: ${e.message}</body>`;
    }
  }

  if (root) {
    const w = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.join(root, 'agent'), 'CONTEXT.json')
    );
    w.onDidChange(() => refresh());
    w.onDidCreate(() => refresh());
    context.subscriptions.push(w);
  }

  refresh();

  panel.webview.onDidReceiveMessage(async msg => {
    switch (msg.command) {
      case 'refresh':
        execFile(
          'python3', ['agent/scripts/agfm_bridge.py', 'context', '--refresh'],
          { cwd: root },
          () => refresh()
        );
        break;
      case 'openScript':
        await openScriptFile(root, currentCtx?.solution, msg.name);
        break;
    }
  }, undefined, context.subscriptions);
}

function buildWebviewHtml(ctx) {
  const safeCtx = ctx
    ? JSON.stringify(ctx).replace(/<\/script>/gi, '<\\/script>')
    : 'null';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Header ── */
.header {
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--vscode-widget-border);
  flex-shrink: 0;
}
.header h1 { font-size: 14px; font-weight: 600; }
.meta { font-size: 12px; opacity: 0.65; margin-top: 2px; }
.task {
  margin-top: 8px;
  padding: 6px 10px;
  background: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-focusBorder);
  font-size: 12px;
  border-radius: 2px;
  line-height: 1.4;
}

/* ── Search + Refresh row ── */
.toolbar {
  display: flex;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--vscode-widget-border);
  flex-shrink: 0;
}
.search-input {
  flex: 1;
  padding: 4px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
  border-radius: 3px;
  font: inherit;
  outline: none;
}
.search-input:focus { border-color: var(--vscode-focusBorder); }
.search-input::placeholder { opacity: 0.5; }
.btn {
  padding: 4px 10px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}
.btn:hover { background: var(--vscode-button-hoverBackground); }

/* ── Scrollable body ── */
.sections { flex: 1; overflow-y: auto; }

/* ── Section (details/summary) ── */
details { border-bottom: 1px solid var(--vscode-widget-border); }
details[open] { }

summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  cursor: pointer;
  user-select: none;
  list-style: none;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.75;
}
summary:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
summary::-webkit-details-marker { display: none; }
.arrow { display: inline-block; font-size: 9px; transition: transform 0.15s; margin-right: 2px; }
details[open] .arrow { transform: rotate(90deg); }
.count { font-weight: 400; opacity: 0.6; font-size: 11px; }

.section-body { padding: 2px 0 6px; }

/* ── List items ── */
.item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 14px 3px 20px;
  font-size: 13px;
  border: none;
  background: none;
  color: inherit;
  width: 100%;
  text-align: left;
  cursor: default;
  line-height: 1.5;
}
.item.clickable { cursor: pointer; }
.item.clickable:hover { background: var(--vscode-list-hoverBackground); }
.item.clickable:active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.item.hidden { display: none !important; }

.item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-folder {
  font-size: 11px;
  opacity: 0.45;
  flex-shrink: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-results { padding: 4px 20px; font-size: 12px; opacity: 0.45; display: none; }
.no-results.visible { display: block; }

/* ── Table occurrences ── */
.to-block { border-bottom: none; }
.to-block > summary {
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  opacity: 1;
  padding: 3px 14px 3px 20px;
}
.to-block > summary:hover { background: var(--vscode-list-hoverBackground); }
.fields { padding: 2px 0 6px 36px; }
.field-row {
  display: flex;
  gap: 10px;
  padding: 1px 0;
  font-size: 12px;
  line-height: 1.5;
}
.field-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-type { font-size: 11px; opacity: 0.45; flex-shrink: 0; }
.to-block.hidden { display: none !important; }

/* ── No context state ── */
.empty-state { padding: 32px 20px; text-align: center; opacity: 0.6; }
.empty-state p { margin-top: 8px; font-size: 12px; }
</style>
</head>
<body>

<div class="header" id="hdr">
  <h1>FM Context</h1>
  <div class="meta">No context — click Refresh to sync from plugin.</div>
</div>

<div class="toolbar">
  <input class="search-input" id="search" type="text" placeholder="Filter scripts, layouts, tables…" oninput="onSearch(this.value)" autocomplete="off" spellcheck="false" />
  <button class="btn" onclick="doRefresh()" title="Sync from plugin">&#8635; Refresh</button>
</div>

<div class="sections" id="sections">
  <div class="empty-state" id="empty">
    <div>No context loaded.</div>
    <p>Click Refresh to fetch context from the agentic-fm plugin.</p>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const CTX = ${safeCtx};

// ── Utilities ────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function txt(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
  if (!CTX) return;

  // Header
  const hdr = document.getElementById('hdr');
  hdr.innerHTML = '';
  const h1 = txt('h1', null, CTX.solution || '(unknown)');
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = 'Layout: <b>' + esc(CTX.current_layout?.name || '(unknown)') + '</b>';
  hdr.appendChild(h1);
  hdr.appendChild(meta);
  if (CTX.task) {
    const taskEl = txt('div', 'task', CTX.task);
    hdr.appendChild(taskEl);
  }

  // Hide empty state
  document.getElementById('empty').style.display = 'none';

  const sections = document.getElementById('sections');
  sections.innerHTML = '';

  const scripts  = CTX.scripts  || {};
  const layouts  = CTX.layouts  || {};
  const tables   = CTX.tables   || {};
  const cfs      = CTX.custom_functions || {};

  sections.appendChild(buildScriptsSection(scripts));
  sections.appendChild(buildLayoutsSection(layouts));
  sections.appendChild(buildTablesSection(tables));
  if (Object.keys(cfs).length > 0) {
    sections.appendChild(buildSimpleSection('Custom Functions', cfs, 'cfs'));
  }
}

// ── Section builders ─────────────────────────────────────────────────────────

function makeSection(id, title, count) {
  const det = document.createElement('details');
  det.dataset.section = id;

  const sum = document.createElement('summary');
  sum.innerHTML = '<span class="arrow">&#9654;</span>';
  sum.appendChild(txt('span', null, title));
  sum.appendChild(txt('span', 'count', ' (' + count + ')'));
  det.appendChild(sum);

  const body = el('div', 'section-body');
  const noRes = txt('div', 'no-results', 'No matches');
  noRes.dataset.noresults = '1';
  body.appendChild(noRes);
  det.appendChild(body);

  return { det, body };
}

function buildScriptsSection(scripts) {
  const entries = Object.entries(scripts).sort((a, b) => a[0].localeCompare(b[0]));
  const { det, body } = makeSection('scripts', 'Scripts', entries.length);

  for (const [name, info] of entries) {
    const btn = document.createElement('button');
    btn.className = 'item clickable';
    btn.dataset.search = name.toLowerCase();
    btn.title = 'Open ' + name;

    const nameEl = txt('span', 'item-name', name);
    btn.appendChild(nameEl);

    const folder = typeof info === 'object' ? (info?.folder || info?.path || '') : '';
    if (folder) {
      const folderEl = txt('span', 'item-folder', folder);
      btn.appendChild(folderEl);
    }

    btn.onclick = () => vscode.postMessage({ command: 'openScript', name });
    body.appendChild(btn);
  }

  return det;
}

function buildLayoutsSection(layouts) {
  const entries = Object.entries(layouts).sort((a, b) => a[0].localeCompare(b[0]));
  const { det, body } = makeSection('layouts', 'Layouts', entries.length);

  for (const [name, info] of entries) {
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.search = name.toLowerCase();

    const nameEl = txt('span', 'item-name', name);
    div.appendChild(nameEl);

    const baseTo = typeof info === 'object' ? (info?.base_to || info?.table || '') : '';
    if (baseTo) {
      const toEl = txt('span', 'item-folder', baseTo);
      div.appendChild(toEl);
    }

    body.appendChild(div);
  }

  return det;
}

function buildTablesSection(tables) {
  const entries = Object.entries(tables).sort((a, b) => a[0].localeCompare(b[0]));
  const { det, body } = makeSection('tables', 'Table Occurrences', entries.length);

  for (const [toName, info] of entries) {
    const wrapper = document.createElement('details');
    wrapper.className = 'to-block';
    wrapper.dataset.search = toName.toLowerCase();

    const sum = document.createElement('summary');
    sum.innerHTML = '<span class="arrow">&#9654;</span>';
    const fields = info?.fields || {};
    const fieldCount = Object.keys(fields).length;
    sum.appendChild(txt('span', null, toName));
    sum.appendChild(txt('span', 'count', '  ' + fieldCount + ' fields'));
    wrapper.appendChild(sum);

    const fieldList = el('div', 'fields');
    for (const [fname, finfo] of Object.entries(fields).sort((a,b) => a[0].localeCompare(b[0]))) {
      const row = el('div', 'field-row');
      row.appendChild(txt('span', 'field-name', fname));
      const ftype = typeof finfo === 'object' ? (finfo?.type || '') : '';
      if (ftype) row.appendChild(txt('span', 'field-type', ftype));
      fieldList.appendChild(row);
    }
    wrapper.appendChild(fieldList);
    body.appendChild(wrapper);
  }

  return det;
}

function buildSimpleSection(title, items, id) {
  const keys = Object.keys(items).sort();
  const { det, body } = makeSection(id, title, keys.length);

  for (const name of keys) {
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.search = name.toLowerCase();
    div.appendChild(txt('span', 'item-name', name));
    body.appendChild(div);
  }

  return det;
}

// ── Search ───────────────────────────────────────────────────────────────────

function onSearch(q) {
  q = q.toLowerCase().trim();

  document.querySelectorAll('[data-section]').forEach(section => {
    let visible = 0;

    // Regular items
    section.querySelectorAll('.item[data-search]').forEach(item => {
      const match = !q || item.dataset.search.includes(q);
      item.classList.toggle('hidden', !match);
      if (match) visible++;
    });

    // TO blocks (tables section)
    section.querySelectorAll('.to-block[data-search]').forEach(block => {
      const match = !q || block.dataset.search.includes(q);
      block.classList.toggle('hidden', !match);
      if (match) visible++;
    });

    const noRes = section.querySelector('[data-noresults]');
    if (noRes) noRes.classList.toggle('visible', visible === 0 && q.length > 0);
  });
}

function doRefresh() {
  vscode.postMessage({ command: 'refresh' });
}

render();
</script>
</body>
</html>`;
}

// ─── fmscript formatter ───────────────────────────────────────────────────────

const BLOCK_OPEN   = new Set(['If', 'Else If', 'Else', 'Loop', 'While']);
const BLOCK_CLOSE  = new Set(['End If', 'End Loop', 'End While']);
const BLOCK_MIDDLE = new Set(['Else If', 'Else']);

function stepKeyword(trimmed) {
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return '#';
  // Check known control keywords first (longest first to avoid 'Else' shadowing 'Else If')
  const controls = ['End If', 'End Loop', 'End While', 'Else If', 'Else', 'If', 'Loop', 'While'];
  for (const kw of controls) {
    if (trimmed === kw || trimmed.startsWith(kw + ' [')) return kw;
  }
  // General step: capital-letter word(s) followed by ' [' or end of line
  if (/^[A-Z][A-Za-z]*(?:\s[A-Za-z]+)*\s*(?:\[|$)/.test(trimmed)) return trimmed.split(' [')[0].trimEnd();
  return null;
}

function formatFmscript(text) {
  const TAB = '\t';
  const lines = text.split('\n');
  let depth = 0;
  let lastStepDepth = 0;
  const out = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(''); continue; }

    const kw = stepKeyword(trimmed);
    if (kw !== null) {
      if (BLOCK_CLOSE.has(kw) || BLOCK_MIDDLE.has(kw)) depth = Math.max(0, depth - 1);
      out.push(TAB.repeat(depth) + trimmed);
      lastStepDepth = depth;
      if (BLOCK_OPEN.has(kw)) depth++;
    } else {
      // Continuation line (multi-line calc param) — one deeper than its step
      out.push(TAB.repeat(lastStepDepth + 1) + trimmed);
    }
  }

  return out.join('\n');
}

// ─── fmscript folding ranges ─────────────────────────────────────────────────

function buildFmscriptFoldingRanges(document) {
  const ranges = [];
  const lines = document.getText().split('\n');
  let stepLine = -1;
  let lastContLine = -1;

  function closeRange() {
    if (stepLine >= 0 && lastContLine > stepLine) {
      ranges.push(new vscode.FoldingRange(stepLine, lastContLine));
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (stepKeyword(trimmed) !== null) {
      closeRange();
      stepLine = i;
      lastContLine = i;
    } else if (!trimmed) {
      closeRange();
      stepLine = -1;
      lastContLine = -1;
    } else {
      if (stepLine >= 0) lastContLine = i;
    }
  }
  closeRange();
  return ranges;
}

// ─── fmscript step number decorations ────────────────────────────────────────

function buildStepDecorations(document) {
  const lines = document.getText().split('\n');
  const decorations = [];
  let stepNum = 0;
  const NBSP = '\u00A0'; // non-breaking space — regular spaces get stripped in decoration contentText
  const BLANK = NBSP.repeat(5);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { stepNum++; continue; }
    if (stepKeyword(trimmed) !== null) {
      stepNum++;
      const n = String(stepNum);
      decorations.push({
        range: new vscode.Range(i, 0, i, 0),
        renderOptions: { before: { contentText: n + NBSP.repeat(5 - n.length) } }
      });
    } else {
      decorations.push({
        range: new vscode.Range(i, 0, i, 0),
        renderOptions: { before: { contentText: BLANK } }
      });
    }
  }
  return decorations;
}

// ─── Activation ───────────────────────────────────────────────────────────────

function activate(context) {
  const extPath = context.extensionPath;
  const root = findProjectRoot(null);

  // ── fmscript formatter ──
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: 'fmscript' },
      {
        provideDocumentFormattingEdits(document) {
          const text = document.getText();
          const formatted = formatFmscript(text);
          if (formatted === text) return [];
          return [vscode.TextEdit.replace(
            new vscode.Range(document.positionAt(0), document.positionAt(text.length)),
            formatted
          )];
        }
      }
    )
  );

  // ── fmscript folding ──
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider(
      { language: 'fmscript' },
      { provideFoldingRanges: doc => buildFmscriptFoldingRanges(doc) }
    )
  );

  // ── fmscript step number decorations ──
  const stepDecType = vscode.window.createTextEditorDecorationType({
    before: { color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'normal' }
  });
  context.subscriptions.push(stepDecType);

  function applyStepDecorations(editor) {
    if (!editor) return;
    if (editor.document.languageId !== 'fmscript') {
      editor.setDecorations(stepDecType, []);
      return;
    }
    editor.setDecorations(stepDecType, buildStepDecorations(editor.document));
  }

  vscode.window.visibleTextEditors.forEach(applyStepDecorations);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(applyStepDecorations),
    vscode.workspace.onDidChangeTextDocument(e => {
      const ed = vscode.window.visibleTextEditors.find(ed => ed.document === e.document);
      if (ed) applyStepDecorations(ed);
    })
  );

  // ── fmscript completions ──
  const fmscriptItems = buildFmscriptCompletions(extPath);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'fmscript' },
      {
        provideCompletionItems(document, position) {
          const prefix = document.lineAt(position).text.substring(0, position.character);
          if (!/^\s*[A-Za-z#]*$/.test(prefix)) return undefined;
          return fmscriptItems;
        }
      }
    )
  );

  // ── fmcalc completions (built-in + custom functions from context) ──
  const fmcalcBuiltins = buildFmcalcCompletions(extPath);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'fmcalc' },
      {
        provideCompletionItems(document, position) {
          const line = document.lineAt(position).text;
          const prefix = line.substring(0, position.character);
          const quotesBefore = (prefix.match(/"/g) || []).length;
          if (quotesBefore % 2 !== 0) return undefined;
          const r = findProjectRoot(document.uri);
          const customItems = loadCustomFunctionCompletions(r || root);
          return [...customItems, ...fmcalcBuiltins];
        }
      }
    )
  );

  // ── Diagnostics ──
  const collection = vscode.languages.createDiagnosticCollection('fmlint');
  context.subscriptions.push(collection);
  vscode.workspace.textDocuments.forEach(doc => runLint(doc, collection));
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => runLint(doc, collection)),
    vscode.workspace.onDidSaveTextDocument(doc => runLint(doc, collection)),
    vscode.workspace.onDidChangeTextDocument(e => scheduleLint(e.document, collection)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      collection.delete(doc.uri);
      clearTimeout(debounceTimers.get(doc.uri.toString()));
      debounceTimers.delete(doc.uri.toString());
    })
  );

  // ── Status bar context button ──
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(database) FM Context';
  statusBar.tooltip = 'Click to sync FileMaker context from plugin';
  statusBar.command = 'agenticfm.syncContext';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── Commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand('agenticfm.syncContext', () => syncContext(root, statusBar)),
    vscode.commands.registerCommand('agenticfm.showContext', () => showContextWebview(root, context))
  );
}

function deactivate() {
  debounceTimers.forEach(t => clearTimeout(t));
  debounceTimers.clear();
}

module.exports = { activate, deactivate };
