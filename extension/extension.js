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

function resolvePluginUrl(env) {
  if (env['AGFM_PLUGIN_URL']) return env['AGFM_PLUGIN_URL'];
  const port = env['AGFM_PLUGIN_PORT'] || '8766';
  return `http://localhost:${port}`;
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

function activateVSCode() {
  execFile('osascript', ['-e', `tell application "${vscode.env.appName}" to activate`]);
}

async function navigateAndFetchScript(pluginUrl, token, scriptName) {
  try { await httpPost(`${pluginUrl}/api/ui/script/navigate`, token, { scriptName }); } catch {}
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400));
    try {
      const result = await httpGet(`${pluginUrl}/api/ui/script`, token);
      if (result.status === 200 && result.body && Array.isArray(result.body.steps)) return result;
    } catch {}
  }
  return null;
}

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
  ].filter(Boolean);

  for (const dir of dirs) {
    const found = findFileRecursive(dir, filename);
    if (found) return found;
  }
  return null;
}


async function formatAndSave(doc) {
  try {
    const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', doc.uri, {});
    if (edits && edits.length) {
      const edit = new vscode.WorkspaceEdit();
      edit.set(doc.uri, edits);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
  } catch {
    // Formatting is a nicety, not a correctness requirement — never block on failure.
  }
}

async function openScriptFile(root, solution, scriptName) {
  const targetDir = path.join(root, 'agent', 'sandbox', solution || 'Unknown');
  const targetPath = path.join(targetDir, scriptName + '.fmscript');

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching "${scriptName}"…`, cancellable: false },
    () => new Promise(resolve => {
      execFile(
        'python3', ['agent/scripts/agfm_bridge.py', 'fetch-script', scriptName, '--out', targetPath],
        { cwd: root },
        async (err, stdout, stderr) => {
          resolve();
          if (err) {
            vscode.window.showErrorMessage(`Fetch failed: ${(stderr || err.message).trim()}`);
            return;
          }
          try {
            const res = JSON.parse(stdout.trim());
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(res.path || targetPath));
            await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
            await formatAndSave(doc);
            activateVSCode();
            vscode.window.showInformationMessage(`Fetched "${res.scriptName || scriptName}" (${res.stepCount} steps)`);
          } catch {
            vscode.window.showErrorMessage('Unexpected response from fetch-script');
          }
        }
      );
    })
  );
}

// ─── Context sidebar view ─────────────────────────────────────────────────────

function registerContextView(root, context, extPath) {
  const stepsData = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(extPath, 'completions.json'), 'utf8')); }
    catch { return []; }
  })();
  const fnsData = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(extPath, 'fm-functions.json'), 'utf8')); }
    catch { return []; }
  })();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'agenticfm.contextView',
      {
        resolveWebviewView(webviewView) {
          webviewView.webview.options = { enableScripts: true };

          let currentCtx = null;

          function refresh() {
            if (!root) { webviewView.webview.html = buildWebviewHtml(null, stepsData, fnsData); return; }
            const ctxPath = path.join(root, 'agent', 'CONTEXT.json');
            if (!fs.existsSync(ctxPath)) { webviewView.webview.html = buildWebviewHtml(null, stepsData, fnsData); return; }
            try {
              currentCtx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
              webviewView.webview.html = buildWebviewHtml(currentCtx, stepsData, fnsData);
            } catch (e) {
              webviewView.webview.html = `<body style="padding:20px;font-family:sans-serif">Error: ${e.message}</body>`;
            }
          }

          if (root) {
            const w = vscode.workspace.createFileSystemWatcher(
              new vscode.RelativePattern(path.join(root, 'agent'), 'CONTEXT.json')
            );
            w.onDidChange(() => refresh());
            w.onDidCreate(() => refresh());
            webviewView.onDidDispose(() => w.dispose());
          }

          refresh();

          // Push current script name into the webview whenever the active editor changes
          let currentScriptPath = null;
          function pushActiveScript(editor) {
            if (editor?.document.languageId === 'fmscript') {
              currentScriptPath = editor.document.uri.fsPath;
              webviewView.webview.postMessage({ command: 'setCurrentScript', name: path.basename(currentScriptPath, '.fmscript') });
            } else {
              currentScriptPath = null;
              webviewView.webview.postMessage({ command: 'setCurrentScript', name: null });
            }
          }
          pushActiveScript(vscode.window.activeTextEditor);
          const editorWatcher = vscode.window.onDidChangeActiveTextEditor(pushActiveScript);
          webviewView.onDidDispose(() => editorWatcher.dispose());

          webviewView.webview.onDidReceiveMessage(async msg => {
            switch (msg.command) {
              case 'refresh':
                execFile(
                  'python3', ['agent/scripts/agfm_bridge.py', 'context', '--refresh'],
                  { cwd: root },
                  (err, stdout, stderr) => {
                    if (err) {
                      vscode.window.showErrorMessage(`Context refresh failed: ${(stderr || err.message || String(err)).trim()}`);
                    }
                    refresh();
                  }
                );
                break;
              case 'openScript':
                await openScriptFile(root, currentCtx?.solution, msg.name);
                break;
              case 'deploy':
                if (currentScriptPath) await deployCurrentScript(vscode.Uri.file(currentScriptPath));
                break;
              case 'fetch':
                if (currentScriptPath) await fetchCurrentScript(vscode.Uri.file(currentScriptPath));
                break;
              case 'insertStep': {
                const ed = vscode.window.activeTextEditor;
                if (!ed) { vscode.window.showWarningMessage('No active editor'); break; }
                const snippet = sigToSnippet(msg.name, msg.sig);
                await ed.insertSnippet(new vscode.SnippetString(snippet));
                break;
              }
              case 'insertFunction': {
                const ed = vscode.window.activeTextEditor;
                if (!ed) { vscode.window.showWarningMessage('No active editor'); break; }
                const params = msg.params ? msg.params.split(';').map((p, i) => `\${${i+1}:${p.trim()}}`).join(' ; ') : '$1';
                const snippet = msg.params ? `${msg.name} ( ${params} )` : `${msg.name} ( $1 )`;
                await ed.insertSnippet(new vscode.SnippetString(snippet));
                break;
              }
            }
          });
        }
      },
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
}

function buildWebviewHtml(ctx, stepsData = [], fnsData = []) {
  const safeCtx   = ctx        ? JSON.stringify(ctx).replace(/<\/script>/gi, '<\\/script>')       : 'null';
  const safeSteps = stepsData  ? JSON.stringify(stepsData).replace(/<\/script>/gi, '<\\/script>') : '[]';
  const safeFns   = fnsData    ? JSON.stringify(fnsData).replace(/<\/script>/gi, '<\\/script>')   : '[]';

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

/* ── Active script strip ── */
.active-script {
  display: none;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-widget-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
  flex-shrink: 0;
}
.active-script.visible { display: flex; }
.active-script-name {
  flex: 1; min-width: 0;
  font-size: 12px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.btn-icon {
  padding: 3px 6px;
  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
  border: none; border-radius: 3px; cursor: pointer; font-size: 13px; line-height: 1;
}
.btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }

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
details[open] > summary .arrow { transform: rotate(90deg); }
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

/* ── Section-local search ── */
.section-search {
  display: block;
  width: calc(100% - 28px);
  margin: 6px 14px 4px;
  padding: 3px 7px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
  border-radius: 3px;
  font: inherit;
  font-size: 12px;
  outline: none;
}
.section-search:focus { border-color: var(--vscode-focusBorder); }
.section-search::placeholder { opacity: 0.5; }
.item-sig { font-size: 11px; opacity: 0.45; flex-shrink: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>

<div class="header" id="hdr">
  <h1>FM Context</h1>
  <div class="meta">No context — click Refresh to sync from plugin.</div>
</div>

<div class="active-script" id="active-script">
  <span class="active-script-name" id="active-script-name"></span>
  <button class="btn-icon" onclick="vscode.postMessage({command:'deploy'})" title="Deploy to FileMaker">&#8593;</button>
  <button class="btn-icon" onclick="vscode.postMessage({command:'fetch'})"  title="Fetch from FileMaker">&#8595;</button>
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
const CTX   = ${safeCtx};
const STEPS = ${safeSteps};
const FNS   = ${safeFns};

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
  const sections = document.getElementById('sections');

  if (!CTX) {
    sections.appendChild(buildStepsSection());
    sections.appendChild(buildFnsSection());
    return;
  }

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

  sections.appendChild(buildStepsSection());
  sections.appendChild(buildFnsSection());
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
  const currentBaseTo = CTX.current_layout?.base_to || '';
  const relatedTOs = new Set(CTX._relatedTOs || []);

  const entries = Object.entries(tables).sort((a, b) => {
    const rank = name => name === currentBaseTo ? 2 : relatedTOs.has(name) ? 1 : 0;
    const diff = rank(b[0]) - rank(a[0]);
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });
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

function buildStepsSection() {
  const { det, body } = makeSection('steps', 'Script Steps', STEPS.length);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'section-search';
  search.placeholder = 'Search steps…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.oninput = () => onSectionSearch('steps', search.value);
  body.insertBefore(search, body.firstChild);

  for (const step of STEPS) {
    const btn = document.createElement('button');
    btn.className = 'item clickable';
    btn.dataset.search = step.name.toLowerCase();
    btn.title = step.sig || step.name;
    btn.appendChild(txt('span', 'item-name', step.name));
    if (step.category) btn.appendChild(txt('span', 'item-sig', step.category));
    btn.onclick = () => vscode.postMessage({ command: 'insertStep', name: step.name, sig: step.sig || null });
    body.appendChild(btn);
  }

  return det;
}

function buildFnsSection() {
  // Deduplicate by name (Get functions are listed multiple times)
  const seen = new Set();
  const unique = FNS.filter(f => { const k = f.name === 'Get' ? f.name + '.' + f.params : f.name; if (seen.has(k)) return false; seen.add(k); return true; });
  const { det, body } = makeSection('fns', 'Calc Functions', unique.length);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'section-search';
  search.placeholder = 'Search functions…';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.oninput = () => onSectionSearch('fns', search.value);
  body.insertBefore(search, body.firstChild);

  for (const fn of unique) {
    const label = fn.name === 'Get' ? 'Get ( ' + fn.params + ' )' : fn.name;
    const btn = document.createElement('button');
    btn.className = 'item clickable';
    btn.dataset.search = label.toLowerCase();
    btn.title = fn.params ? fn.name + ' ( ' + fn.params + ' )' : fn.name;
    btn.appendChild(txt('span', 'item-name', label));
    btn.onclick = () => vscode.postMessage({ command: 'insertFunction', name: fn.name === 'Get' ? 'Get ( ' + fn.params + ' )' : fn.name, params: fn.name === 'Get' ? null : fn.params });
    body.appendChild(btn);
  }

  return det;
}

function onSectionSearch(sectionId, q) {
  q = q.toLowerCase().trim();
  const section = document.querySelector('[data-section="' + sectionId + '"]');
  if (!section) return;
  let visible = 0;
  section.querySelectorAll('.item[data-search]').forEach(item => {
    const match = !q || item.dataset.search.includes(q);
    item.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  const noRes = section.querySelector('[data-noresults]');
  if (noRes) noRes.classList.toggle('visible', visible === 0 && q.length > 0);
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

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.command === 'setCurrentScript') {
    const strip = document.getElementById('active-script');
    if (msg.name) {
      document.getElementById('active-script-name').textContent = msg.name;
      strip.classList.add('visible');
    } else {
      strip.classList.remove('visible');
    }
  }
});
</script>
</body>
</html>`;
}

// ─── fmscript formatter ───────────────────────────────────────────────────────

const BLOCK_OPEN     = new Set(['If', 'Else If', 'Else', 'Loop', 'While']);
const BLOCK_OPEN_INC = new Set(['If', 'Loop', 'While']); // pure openers — indent increases for following lines
const BLOCK_CLOSE    = new Set(['End If', 'End Loop', 'End While']);
const BLOCK_MIDDLE   = new Set(['Else If', 'Else']);
const STEP_INDENT    = '  '; // 2 spaces per nesting level, per CODING_CONVENTIONS.md

function stepKeyword(trimmed) {
  if (!trimmed) return null;
  if (trimmed.startsWith('#')) return '#';
  // Check known control keywords first (longest first to avoid 'Else' shadowing 'Else If')
  const controls = ['End If', 'End Loop', 'End While', 'Else If', 'Else', 'If', 'Loop', 'While'];
  for (const kw of controls) {
    if (trimmed === kw || trimmed.startsWith(kw + ' [')) return kw;
  }
  // General step: capital-letter word(s) followed by ' [' or end of line.
  // Words may contain internal '/' or '-' (e.g. "Go to Record/Request/Page", "Set Multi-User").
  if (/^[A-Z][A-Za-z/-]*(?:\s[A-Za-z][A-Za-z/-]*)*\s*(?:\[|$)/.test(trimmed)) return trimmed.split(' [')[0].trimEnd();
  return null;
}

// ─── fmcalc formatter ─────────────────────────────────────────────────────────

function tokenizeFmcalc(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c <= ' ') { i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      toks.push({ t: 'comment', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j === -1) j = n;
      toks.push({ t: 'comment', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; } // backslash-escaped char (e.g. \") — not a string terminator
        if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } j++; break; }
        j++;
      }
      toks.push({ t: 'str', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === ':' && src[i + 1] === ':') { toks.push({ t: '::' }); i += 2; continue; }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ';') {
      toks.push({ t: c }); i++; continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '<>') {
      toks.push({ t: 'op', v: two }); i += 2; continue;
    }
    if (c === '≠' || c === '≥' || c === '≤') { toks.push({ t: 'op', v: c }); i++; continue; }
    if ('=<>&+-*/^'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    const nm = src.slice(i).match(/^\d+(?:\.\d+)?/);
    if (nm) { toks.push({ t: 'num', v: nm[0] }); i += nm[0].length; continue; }
    const im = src.slice(i).match(/^(?:\$\$?|~)?[A-Za-z_][A-Za-z0-9_.~]*/);
    if (im) { toks.push({ t: 'id', v: im[0] }); i += im[0].length; continue; }
    toks.push({ t: 'other', v: c }); i++;
  }
  return toks;
}

function formatFmcalc(text, topLevelArgs = false) {
  const src = text.trim();
  if (!src) return text;

  const toks = tokenizeFmcalc(src);
  const TAB = '    ';
  let pos = 0;

  const PRINT_WIDTH = 100; // matches CODING_CONVENTIONS.md: single-line where it fits, one-arg-per-line otherwise

  function peek(off) { return toks[pos + (off || 0)] || { t: 'eof' }; }
  function eat() { return toks[pos++] || { t: 'eof' }; }

  // Format ';'-separated argument list. Stops before ')' or ']' without consuming it.
  function fmtArgList(depth) {
    const args = [];
    while (pos < toks.length) {
      const t = peek();
      if (t.t === ')' || t.t === ']' || t.t === 'eof') break;
      if (t.t === ';') { eat(); continue; }
      args.push(fmtExpr(depth, true));
    }
    return args;
  }

  // Format a single expression. Stops before ';' when stopAtSemi, or at closing bracket.
  function fmtExpr(depth, stopAtSemi) {
    const parts = [];
    while (pos < toks.length) {
      const t = peek();
      if (t.t === ')' || t.t === ']' || t.t === 'eof') break;
      if (stopAtSemi && t.t === ';') break;
      eat();

      if (t.t === 'comment') {
        parts.push(t.v + '\n' + TAB.repeat(depth));
      } else if (t.t === 'str' || t.t === 'num' || t.t === 'op' || t.t === 'other') {
        parts.push(t.v);
      } else if (t.t === 'id') {
        if (peek().t === '::') {
          eat();
          const fld = eat();
          parts.push(`${t.v}::${fld.v || ''}`);
        } else if (peek().t === '(') {
          eat(); // (
          const snapshot = pos;
          const inlineArgs = fmtArgList(depth);
          if (inlineArgs.length === 0) {
            if (peek().t === ')') eat();
            parts.push(`${t.v} ()`);
          } else {
            const singleLine = `${t.v} ( ${inlineArgs.join(' ; ')} )`;
            if (!singleLine.includes('\n') && singleLine.length + depth * TAB.length <= PRINT_WIDTH) {
              if (peek().t === ')') eat();
              parts.push(singleLine);
            } else {
              pos = snapshot; // reparse args at one deeper indent for the exploded layout
              const args = fmtArgList(depth + 1);
              if (peek().t === ')') eat();
              const ind = TAB.repeat(depth + 1);
              const close = TAB.repeat(depth);
              parts.push(`${t.v} (\n${ind}${args.join(` ;\n${ind}`)}\n${close})`);
            }
          }
        } else {
          parts.push(t.v);
        }
      } else if (t.t === '[') {
        // Label/value/type triples stay on a single line regardless of length (per CODING_CONVENTIONS.md),
        // unless a nested construct was already forced onto multiple lines.
        const args = fmtArgList(depth + 1);
        if (peek().t === ']') eat();
        const single = `[ ${args.join(' ; ')} ]`;
        if (!single.includes('\n')) {
          parts.push(single);
        } else {
          const ind = TAB.repeat(depth + 1);
          const close = TAB.repeat(depth);
          parts.push(`[\n${ind}${args.join(` ;\n${ind}`)}\n${close}]`);
        }
      } else if (t.t === '(') {
        const inner = fmtExpr(depth, false);
        if (peek().t === ')') eat();
        parts.push(`( ${inner} )`);
      }
    }
    let joined = '';
    for (const p of parts) {
      if (!joined) { joined = p; continue; }
      const noSpc = /\n\s*$/.test(joined) || p === ':';
      joined += (noSpc ? '' : ' ') + p;
    }
    return joined;
  }

  // topLevelArgs: treat content as ';'-separated arg list (for fmscript bracket content)
  const result = topLevelArgs
    ? (() => { const a = fmtArgList(0); return a.length <= 1 ? (a[0] || '').trim() : a.join(' ;\n'); })()
    : fmtExpr(0, false).trim();
  return result + (text.endsWith('\n') ? '\n' : '');
}

// ─── fmscript formatter ───────────────────────────────────────────────────────

function formatFmscript(text) {
  // Known step-parameter labels that precede an FM calculation expression.
  // Ordered longest-first to prevent prefix collisions.
  const CALC_LABELS = [
    'Verify SSL Certificates:', 'cURL options:', 'Text Result:',
    'With dialog:', 'Parameter:', 'Condition:', 'Target:', 'Select:', 'Value:',
  ];

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  function firstBracket(s) {
    let inStr = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '"') { inStr = !inStr; continue; }
      if (!inStr && c === '[') return k;
    }
    return -1;
  }

  function depthChange(s) {
    let d = 0, inStr = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '"') { if (inStr && s[k + 1] === '"') { k++; continue; } inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[') d++;
      else if (c === ']') d--;
    }
    return d;
  }

  function findClose(s, openIdx) {
    let depth = 0, inStr = false;
    for (let k = openIdx; k < s.length; k++) {
      const c = s[k];
      if (c === '"') { if (inStr && s[k + 1] === '"') { k++; continue; } inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) return k; }
    }
    return -1;
  }

  // Find the index immediately after the last known calc label (including trailing space).
  // Returns 0 when no label found — treat entire content as the expression.
  function findCalcStart(content) {
    let best = -1;
    for (const label of CALC_LABELS) {
      let pos = 0;
      while (true) {
        const idx = content.indexOf(label, pos);
        if (idx === -1) break;
        // Only accept labels at top level (no unbalanced parens/brackets before them)
        const before = content.slice(0, idx);
        let d = 0, inS = false;
        for (const c of before) {
          if (c === '"') inS = !inS;
          if (!inS) { if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; }
        }
        if (d === 0) {
          let end = idx + label.length;
          while (content[end] === ' ') end++; // include trailing space in preCalc
          if (end > best) best = end;
        }
        pos = idx + 1;
      }
    }
    return best === -1 ? 0 : best;
  }

  // Returns true if s has a ';' at the top level (not inside parens/brackets/strings).
  function hasTopLevelSemi(s) {
    let d = 0, inS = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '"') { if (inS && s[k + 1] === '"') { k++; continue; } inS = !inS; continue; }
      if (inS) continue;
      if (c === '(' || c === '[') d++;
      else if (c === ')' || c === ']') d--;
      else if (c === ';' && d === 0) return true;
    }
    return false;
  }

  let blockDepth = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) { out.push(''); i++; continue; }

    // Reindent this step's first line to match its control-flow nesting depth.
    const kw = stepKeyword(trimmed);
    let lineDepth = blockDepth;
    if (kw && BLOCK_CLOSE.has(kw)) { blockDepth = Math.max(0, blockDepth - 1); lineDepth = blockDepth; }
    else if (kw && BLOCK_MIDDLE.has(kw)) { lineDepth = Math.max(0, blockDepth - 1); }
    if (kw && BLOCK_OPEN_INC.has(kw)) blockDepth++;

    const indent = STEP_INDENT.repeat(lineDepth);
    const line = indent + trimmed;

    if (trimmed.startsWith('#')) { out.push(line); i++; continue; }

    const bIdx = firstBracket(line);
    if (bIdx === -1) { out.push(line); i++; continue; }

    // Accumulate continuation lines until the top-level bracket closes
    const leadingTab = indent;
    let raw = line;
    let depth = depthChange(line);
    i++;
    while (depth > 0 && i < lines.length) {
      raw += '\n' + lines[i];
      depth += depthChange(lines[i]);
      i++;
    }

    const closeIdx = findClose(raw, bIdx);
    if (closeIdx === -1) { out.push(raw); continue; }

    const prefix  = raw.slice(0, bIdx);
    const content = raw.slice(bIdx + 1, closeIdx).trim();
    const tail    = raw.slice(closeIdx + 1);

    const calcStart = findCalcStart(content);
    const preCalc   = content.slice(0, calcStart);          // e.g. "$var ; Value: "
    const calcExpr  = content.slice(calcStart).trim();

    // Skip formatting if the expression itself has top-level ';' (more step params follow)
    if (!calcExpr || hasTopLevelSemi(calcExpr)) { out.push(raw); continue; }

    const formatted = formatFmcalc(calcExpr, false);
    const oneLiner  = `${prefix}[ ${preCalc}${formatted} ]${tail}`;

    if (!formatted.includes('\n') && oneLiner.length <= 120) {
      out.push(oneLiner);
    } else if (formatted.includes('\n')) {
      const ind = leadingTab + '    ';
      const indented = formatted.split('\n').map((l, j) => j === 0 ? l : ind + l).join('\n');
      out.push(`${prefix}[ ${preCalc}${indented}\n${leadingTab}]${tail}`);
    } else {
      // Single-line calc but total too long — put ] on its own line
      out.push(`${prefix}[ ${preCalc}${formatted}\n${leadingTab}]${tail}`);
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

// ─── Editor title commands (deploy / fetch) ───────────────────────────────────

async function deployCurrentScript(uri) {
  const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!filePath || !filePath.endsWith('.fmscript')) return;
  const scriptName = path.basename(filePath, '.fmscript');
  const root = findProjectRoot(vscode.Uri.file(filePath));
  if (!root) { vscode.window.showErrorMessage('No agentic-fm workspace found'); return; }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deploying "${scriptName}"…`, cancellable: false },
    () => new Promise(resolve => {
      execFile(
        'python3', ['agent/scripts/agfm_bridge.py', 'deploy', filePath, scriptName],
        { cwd: root },
        (err, _stdout, stderr) => {
          resolve();
          if (err) vscode.window.showErrorMessage(`Deploy failed: ${(stderr || err.message).trim()}`);
          else     vscode.window.showInformationMessage(`Deployed "${scriptName}" ✓`);
        }
      );
    })
  );
}

async function fetchCurrentScript(uri) {
  const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!filePath || !filePath.endsWith('.fmscript')) return;
  const scriptName = path.basename(filePath, '.fmscript');
  const root = findProjectRoot(vscode.Uri.file(filePath));
  if (!root) { vscode.window.showErrorMessage('No agentic-fm workspace found'); return; }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching "${scriptName}"…`, cancellable: false },
    () => new Promise(resolve => {
      execFile(
        'python3', ['agent/scripts/agfm_bridge.py', 'fetch-script', scriptName, '--out', filePath],
        { cwd: root },
        async (err, _stdout, stderr) => {
          resolve();
          if (err) { vscode.window.showErrorMessage(`Fetch failed: ${(stderr || err.message).trim()}`); return; }
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
          await formatAndSave(doc);
          activateVSCode();
          vscode.window.showInformationMessage(`Fetched "${scriptName}" ✓`);
        }
      );
    })
  );
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

  // ── fmcalc formatter ──
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      { language: 'fmcalc' },
      {
        provideDocumentFormattingEdits(document) {
          const text = document.getText();
          const formatted = formatFmcalc(text);
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

  // ── Context sidebar view ──
  registerContextView(root, context, extPath);

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
    vscode.commands.registerCommand('agenticfm.deployScript', uri => deployCurrentScript(uri)),
    vscode.commands.registerCommand('agenticfm.fetchScript',  uri => fetchCurrentScript(uri))
  );
}

function deactivate() {
  debounceTimers.forEach(t => clearTimeout(t));
  debounceTimers.clear();
}

module.exports = { activate, deactivate };
