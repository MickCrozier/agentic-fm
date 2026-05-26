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

// ─── fmcalc completions from CONTEXT.json (custom functions) ─────────────────

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

// ─── Context webview ──────────────────────────────────────────────────────────

function showContextWebview(root, context) {
  const panel = vscode.window.createWebviewPanel(
    'agenticfmContext',
    'FileMaker Context',
    vscode.ViewColumn.Beside,
    { enableScripts: true }
  );

  function refresh() {
    if (!root) { panel.webview.html = '<body>No agentic-fm workspace found.</body>'; return; }
    const ctxPath = path.join(root, 'agent', 'CONTEXT.json');
    if (!fs.existsSync(ctxPath)) {
      panel.webview.html = buildWebviewHtml(null);
      return;
    }
    try {
      const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
      panel.webview.html = buildWebviewHtml(ctx);
    } catch (e) {
      panel.webview.html = `<body>Error reading CONTEXT.json: ${e}</body>`;
    }
  }

  // Watch CONTEXT.json for changes
  const watcher = ctxPath => {
    const p = root ? path.join(root, 'agent', 'CONTEXT.json') : null;
    if (p && fs.existsSync(p)) {
      const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.join(root, 'agent'), 'CONTEXT.json')
      );
      w.onDidChange(() => refresh());
      context.subscriptions.push(w);
    }
  };
  watcher();
  refresh();

  panel.webview.onDidReceiveMessage(msg => {
    if (msg.command === 'refresh') {
      const r = findProjectRoot(null);
      execFile('python3', ['agent/scripts/agfm_bridge.py', 'context', '--refresh'],
        { cwd: r || root }, () => refresh());
    }
  }, undefined, context.subscriptions);
}

function buildWebviewHtml(ctx) {
  if (!ctx) {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px">
      <h2>No CONTEXT.json</h2>
      <p>Click Sync to fetch context from the plugin.</p>
      <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})">⟳ Sync Context</button>
    </body></html>`;
  }

  const solution = ctx.solution || '(unknown)';
  const layout = ctx.current_layout?.name || '(unknown)';
  const task = ctx.task || '';
  const tables = ctx.tables || {};
  const scripts = ctx.scripts || {};
  const layouts = ctx.layouts || {};
  const cfs = ctx.custom_functions || {};

  const tableRows = Object.entries(tables).map(([to, info]) => {
    const fields = Object.keys(info.fields || {}).slice(0, 5).join(', ');
    const more = Object.keys(info.fields || {}).length > 5 ? ` +${Object.keys(info.fields).length - 5} more` : '';
    return `<tr><td><b>${to}</b></td><td style="color:#888">${fields}${more}</td></tr>`;
  }).join('');

  const scriptList = Object.keys(scripts).sort().slice(0, 30)
    .map(s => `<li>${s}</li>`).join('');

  const layoutList = Object.keys(layouts).sort().slice(0, 30)
    .map(l => `<li>${l}</li>`).join('');

  const cfList = Object.keys(cfs).length
    ? Object.keys(cfs).sort().map(cf => `<li>${cf}</li>`).join('')
    : '<li style="color:#888">(none in context)</li>';

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family); font-size: 13px; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 16px 0 6px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta { opacity: 0.6; margin-bottom: 12px; }
  .task { background: var(--vscode-editor-inactiveSelectionBackground); border-left: 3px solid var(--vscode-focusBorder); padding: 8px 12px; margin: 8px 0 16px; border-radius: 2px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 6px; border-bottom: 1px solid var(--vscode-widget-border); vertical-align: top; }
  ul { margin: 0; padding-left: 18px; columns: 2; }
  li { padding: 1px 0; }
  button { margin-top: 16px; padding: 6px 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h1>⊞ ${solution}</h1>
  <div class="meta">Layout: <b>${layout}</b></div>
  ${task ? `<div class="task"><b>Task:</b> ${task}</div>` : ''}

  <h2>Table Occurrences (${Object.keys(tables).length})</h2>
  <table>${tableRows}</table>

  <h2>Scripts (${Object.keys(scripts).length})</h2>
  <ul>${scriptList}${Object.keys(scripts).length > 30 ? `<li style="color:#888">…and ${Object.keys(scripts).length - 30} more</li>` : ''}</ul>

  <h2>Layouts (${Object.keys(layouts).length})</h2>
  <ul>${layoutList}${Object.keys(layouts).length > 30 ? `<li style="color:#888">…and ${Object.keys(layouts).length - 30} more</li>` : ''}</ul>

  <h2>Custom Functions (${Object.keys(cfs).length})</h2>
  <ul>${cfList}</ul>

  <button onclick="acquireVsCodeApi().postMessage({command:'refresh'})">⟳ Refresh Context</button>
  <script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
}

// ─── Activation ───────────────────────────────────────────────────────────────

function activate(context) {
  const extPath = context.extensionPath;
  const root = findProjectRoot(null);

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

  // ── fmcalc completions (built-in functions + custom functions from context) ──
  const fmcalcBuiltins = buildFmcalcCompletions(extPath);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'fmcalc' },
      {
        provideCompletionItems(document, position) {
          const line = document.lineAt(position).text;
          const prefix = line.substring(0, position.character);
          // Don't complete inside strings
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
