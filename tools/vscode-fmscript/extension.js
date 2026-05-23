'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const CONTROL_STEPS = new Set([
  'If', 'Else If', 'Else', 'End If',
  'Loop', 'End Loop', 'While', 'End While',
  'Exit Loop If', 'Exit Script', 'Halt Script'
]);

// Convert hrSignature → VS Code SnippetString text
function sigToSnippet(name, sig) {
  if (!sig) return name;

  if (name === '# (comment)') return '# ${1:comment}';

  let n = 1;
  let s = sig;

  // Simple "[ On|Off ]" or "[ A|B|C ]" → choice snippet
  const simpleEnum = s.match(/^\[\s*([A-Za-z][A-Za-z ]*(?:\|[A-Za-z][A-Za-z ]*)+)\s*\]$/);
  if (simpleEnum) {
    const choices = simpleEnum[1].split('|').map(c => c.trim()).join(',');
    return `${name} [ \${${n}|${choices}|} ]`;
  }

  // "key: calc|name|n|type|option|text" → labelled placeholder
  s = s.replace(/(:\s*)(calc|name|n\b|type|option|text)\b/g, (m, colon, type) => {
    return `${colon}\${${n++}:${type}}`;
  });

  // Bare "calc" or "name" not after colon (top-level single param)
  s = s.replace(/(\[\s*)(calc|name|n\b)(\s*\])/g, (m, open, type, close) => {
    return `${open}\${${n++}:${type}}${close}`;
  });

  return `${name} ${s}`;
}

function activate(context) {
  const completionsPath = path.join(context.extensionPath, 'completions.json');
  const steps = JSON.parse(fs.readFileSync(completionsPath, 'utf8'));

  // Build completion items once at activation
  const items = steps.map(step => {
    const isControl = CONTROL_STEPS.has(step.name);
    const item = new vscode.CompletionItem(
      step.name,
      isControl ? vscode.CompletionItemKind.Keyword : vscode.CompletionItemKind.Function
    );

    const snippetText = sigToSnippet(step.name, step.sig);
    item.insertText = new vscode.SnippetString(snippetText);
    item.detail = step.sig || '(no parameters)';
    item.filterText = step.name;

    const docs = new vscode.MarkdownString();
    if (step.category) docs.appendMarkdown(`**Category:** ${step.category}\n\n`);
    if (step.sig) docs.appendMarkdown(`\`${step.sig}\`\n\n`);
    if (step.helpUrl) docs.appendMarkdown(`[FileMaker Help ↗](${step.helpUrl})`);
    item.documentation = docs;

    // Control steps sort first, then alphabetical
    item.sortText = (isControl ? '0_' : '1_') + step.name.toLowerCase();

    return item;
  });

  const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'fmscript' },
    {
      provideCompletionItems(document, position) {
        const line = document.lineAt(position);
        const prefix = line.text.substring(0, position.character);

        // Only fire at start of line (optional indent, then letters/# only)
        if (!/^\s*[A-Za-z#]*$/.test(prefix)) return undefined;

        return items;
      }
    }
  );

  context.subscriptions.push(provider);
}

function deactivate() {}

module.exports = { activate, deactivate };
