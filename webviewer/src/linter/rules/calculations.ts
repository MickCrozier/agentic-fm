import type { Diagnostic } from '../types';
import type { LintConfig } from '../config';
import type { LintRule } from '../engine';
import { registerRule } from '../engine';
import { isRuleEnabled, getRuleSeverity } from '../config';

// Steps where bracket content is literal text, not a FM calculation.
const NON_CALC_STEPS = new Set([
  'Insert Text', 'Insert File', 'Insert Picture', 'Insert Audio/Video',
  'Insert PDF', 'Insert From URL', 'Insert From Device',
  'Show Custom Dialog', 'Send Mail', 'Send Event',
  'Set Web Viewer', 'Export Field Contents',
  'Open URL', 'Open File', 'Dial Phone',
]);

/**
 * Merge multiline statements (unclosed brackets) into single logical lines.
 */
function mergeMultilineStatements(lines: string[]): { text: string; lineNumber: number }[] {
  const result: { text: string; lineNumber: number }[] = [];
  let accumulator = '';
  let startLine = 0;
  let bracketDepth = 0;
  let inQuote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (bracketDepth === 0 && (trimmed.startsWith('#') || trimmed === '')) {
      result.push({ text: line, lineNumber: i + 1 });
      continue;
    }

    if (bracketDepth === 0) {
      accumulator = line;
      startLine = i + 1;
    } else {
      accumulator += '\n' + line;
    }

    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (inQuote) continue;
      if (ch === '[') bracketDepth++;
      if (ch === ']') bracketDepth--;
    }

    if (bracketDepth <= 0) {
      result.push({ text: accumulator, lineNumber: startLine });
      accumulator = '';
      bracketDepth = 0;
      inQuote = false;
    }
  }

  if (accumulator) {
    result.push({ text: accumulator, lineNumber: startLine });
  }

  return result;
}

/** Extract step name from a merged line, stripping disabled prefix. */
function extractStepName(line: string): string {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return '';
  if (trimmed.startsWith('//')) trimmed = trimmed.substring(2).trim();

  // Find the first [ not inside quotes
  let inQuote = false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '"') inQuote = !inQuote;
    if (!inQuote && trimmed[i] === '[') return trimmed.substring(0, i).trim();
  }
  return trimmed;
}

/** Extract bracket content from a merged line, respecting quotes. */
function extractBracketContent(line: string): string | null {
  let inQuote = false;
  let openIdx = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    if (!inQuote && line[i] === '[') { openIdx = i; break; }
  }
  if (openIdx < 0) return null;

  // Find matching close bracket
  inQuote = false;
  let depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (line[i] === '[') depth++;
    if (line[i] === ']') {
      depth--;
      if (depth === 0) return line.substring(openIdx + 1, i);
    }
  }
  // Unclosed — return everything after [
  return line.substring(openIdx + 1);
}

// ---------------------------------------------------------------------------
// C001 — Unclosed string literals
// ---------------------------------------------------------------------------

const c001Rule: LintRule = {
  ruleId: 'C001',
  name: 'Unclosed string literals',
  severity: 'error',

  check(lines: string[], _catalog: Set<string>, config: LintConfig): Diagnostic[] {
    if (!isRuleEnabled('C001', config)) return [];
    const sev = getRuleSeverity('C001', 'error', config);
    const diagnostics: Diagnostic[] = [];

    const merged = mergeMultilineStatements(lines);

    for (const { text, lineNumber } of merged) {
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const stepName = extractStepName(text);
      if (NON_CALC_STEPS.has(stepName)) continue;

      const bracketContent = extractBracketContent(text);
      if (!bracketContent) continue;

      // Count quotes — odd count means unclosed string
      let quoteCount = 0;
      for (const ch of bracketContent) {
        if (ch === '"') quoteCount++;
      }

      if (quoteCount % 2 !== 0) {
        diagnostics.push({
          ruleId: 'C001',
          severity: sev,
          message: 'Unclosed string literal (odd number of quotes)',
          line: lineNumber,
          column: 1,
          endLine: lineNumber,
          endColumn: lines[lineNumber - 1]?.length + 1 || 1,
        });
      }
    }

    return diagnostics;
  },
};

registerRule(c001Rule);
