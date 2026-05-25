'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// ─── Completion helpers ───────────────────────────────────────────────────────

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

  // "[ On|Off ]" simple enum → choice snippet
  const simpleEnum = s.match(/^\[\s*([A-Za-z][A-Za-z ]*(?:\|[A-Za-z][A-Za-z ]*)+)\s*\]$/);
  if (simpleEnum) {
    const choices = simpleEnum[1].split('|').map(c => c.trim()).join(',');
    return `${name} [ \${${n}|${choices}|} ]`;
  }

  // "key: calc|name|n|type|option|text" → labelled placeholder
  s = s.replace(/(:\s*)(calc|name|n\b|type|option|text)\b/g, (m, colon, type) => {
    return `${colon}\${${n++}:${type}}`;
  });

  // Bare top-level "[ calc ]" or "[ name ]"
  s = s.replace(/(\[\s*)(calc|name|n\b)(\s*\])/g, (m, open, type, close) => {
    return `${open}\${${n++}:${type}}${close}`;
  });

  return `${name} ${s}`;
}

// ─── Linting helpers ──────────────────────────────────────────────────────────

const debounceTimers = new Map();

function findProjectRoot(documentUri) {
  // Walk up from the document looking for agent/fmlint
  let dir = path.dirname(documentUri.fsPath);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'agent', 'fmlint', '__main__.py'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to workspace folder
  const ws = vscode.workspace.getWorkspaceFolder(documentUri);
  return ws ? ws.uri.fsPath : null;
}

function runLint(document, collection) {
  if (document.languageId !== 'fmscript') return;

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
          const line    = Math.max(0, (d.line || 1) - 1);
          const col     = d.column || 0;
          const endLine = d.end_line > 0 ? Math.max(0, d.end_line - 1) : line;
          const endCol  = d.end_column > 0 ? d.end_column : Number.MAX_SAFE_INTEGER;

          const severity = d.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;

          const diag = new vscode.Diagnostic(
            new vscode.Range(line, col, endLine, endCol),
            d.message,
            severity
          );
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

// ─── Activation ───────────────────────────────────────────────────────────────

function activate(context) {
  // ── Completions ──
  const completionsPath = path.join(context.extensionPath, 'completions.json');
  const steps = JSON.parse(fs.readFileSync(completionsPath, 'utf8'));

  const completionItems = steps.map(step => {
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

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'fmscript' },
      {
        provideCompletionItems(document, position) {
          const prefix = document.lineAt(position).text.substring(0, position.character);
          if (!/^\s*[A-Za-z#]*$/.test(prefix)) return undefined;
          return completionItems;
        }
      }
    )
  );

  // ── Diagnostics ──
  const collection = vscode.languages.createDiagnosticCollection('fmlint');
  context.subscriptions.push(collection);

  // Lint already-open documents
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
}

function deactivate() {
  debounceTimers.forEach(t => clearTimeout(t));
  debounceTimers.clear();
}

module.exports = { activate, deactivate };
