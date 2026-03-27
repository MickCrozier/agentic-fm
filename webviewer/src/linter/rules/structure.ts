import type { Diagnostic } from '../types';
import type { LintConfig } from '../config';
import type { LintRule } from '../engine';
import { registerRule } from '../engine';
import { isRuleEnabled, getRuleSeverity } from '../config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BlockEntry {
  type: string;
  line: number;
}

/** Block pairs: opener -> closer */
const BLOCK_PAIRS: Record<string, string> = {
  'If': 'End If',
  'Loop': 'End Loop',
  'Open Transaction': 'Commit Transaction',
};

/** Reverse map: closer -> opener */
const CLOSER_TO_OPENER: Record<string, string> = {};
for (const [opener, closer] of Object.entries(BLOCK_PAIRS)) {
  CLOSER_TO_OPENER[closer] = opener;
}

/** Middle steps and which opener they belong to */
const MIDDLE_STEPS: Record<string, string> = {
  'Else': 'If',
  'Else If': 'If',
  'Exit Loop If': 'Loop',
  'Revert Transaction': 'Open Transaction',
};

/**
 * Pre-process lines: merge multiline statements (unclosed brackets)
 * and return an array of { text, lineNumber } for each logical step.
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

    // At depth 0, comments and empty lines pass through
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

    // Track bracket depth
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

/**
 * Extract the step name from a merged HR line.
 * Handles disabled steps (// prefix).
 */
function extractStepName(line: string): string {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return '';

  // Strip disabled prefix
  if (trimmed.startsWith('//')) {
    trimmed = trimmed.substring(2).trim();
  }

  const bracketIdx = findTopLevelBracket(trimmed);
  return (bracketIdx >= 0 ? trimmed.substring(0, bracketIdx) : trimmed).trim();
}

/** Find first `[` not inside quotes */
function findTopLevelBracket(text: string): number {
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') inQuote = !inQuote;
    if (!inQuote && text[i] === '[') return i;
  }
  return -1;
}

function isSkippable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//');
}

// ---------------------------------------------------------------------------
// S005 — Paired blocks (If/End If, Loop/End Loop, Open Transaction/Commit Transaction)
// Also covers S006 (Else ordering) and S007 (inner step context).
// ---------------------------------------------------------------------------

const s005Rule: LintRule = {
  ruleId: 'S005',
  name: 'Paired blocks',
  severity: 'error',

  check(lines: string[], _catalog: Set<string>, config: LintConfig): Diagnostic[] {
    if (!isRuleEnabled('S005', config)) return [];
    const sevS005 = getRuleSeverity('S005', 'error', config);
    const sevS006 = getRuleSeverity('S006', 'error', config);
    const sevS007 = getRuleSeverity('S007', 'error', config);

    const merged = mergeMultilineStatements(lines);
    const diagnostics: Diagnostic[] = [];
    const stack: BlockEntry[] = [];
    // Track whether an Else has been seen for each If block (keyed by stack line)
    const elseSeenForIf = new Map<number, boolean>();

    for (const { text, lineNumber: lineNum } of merged) {
      if (isSkippable(text)) continue;

      const stepName = extractStepName(text);
      if (!stepName) continue;
      const lineLen = text.trimEnd().length;

      // Opening block
      if (stepName in BLOCK_PAIRS) {
        stack.push({ type: stepName, line: lineNum });
        continue;
      }

      // Middle steps (Else, Else If, Exit Loop If, Revert Transaction)
      if (stepName in MIDDLE_STEPS) {
        const requiredOpener = MIDDLE_STEPS[stepName];
        const top = stack.length > 0 ? stack[stack.length - 1] : null;

        // S007 — inner step outside its block
        const enclosing = [...stack].reverse().find(e => e.type === requiredOpener);
        if (!enclosing) {
          if (isRuleEnabled('S007', config)) {
            diagnostics.push({
              ruleId: 'S007',
              severity: sevS007,
              message: `${stepName} outside of ${requiredOpener} block`,
              line: lineNum,
              column: 1,
              endLine: lineNum,
              endColumn: lineLen + 1,
            });
          }
          continue;
        }

        // S006 — Else ordering
        if (isRuleEnabled('S006', config)) {
          if (stepName === 'Else') {
            if (elseSeenForIf.get(enclosing.line)) {
              diagnostics.push({
                ruleId: 'S006',
                severity: sevS006,
                message: 'Duplicate Else in If block',
                line: lineNum,
                column: 1,
                endLine: lineNum,
                endColumn: lineLen + 1,
              });
            } else {
              elseSeenForIf.set(enclosing.line, true);
            }
          } else if (stepName === 'Else If') {
            if (elseSeenForIf.get(enclosing.line)) {
              diagnostics.push({
                ruleId: 'S006',
                severity: sevS006,
                message: 'Else If after Else',
                line: lineNum,
                column: 1,
                endLine: lineNum,
                endColumn: lineLen + 1,
              });
            }
          }
        }
        continue;
      }

      // Closing block
      if (stepName in CLOSER_TO_OPENER) {
        const expectedOpener = CLOSER_TO_OPENER[stepName];
        const top = stack.pop();

        if (!top) {
          diagnostics.push({
            ruleId: 'S005',
            severity: sevS005,
            message: `${stepName} without matching ${expectedOpener}`,
            line: lineNum,
            column: 1,
            endLine: lineNum,
            endColumn: lineLen + 1,
          });
        } else if (top.type !== expectedOpener) {
          diagnostics.push({
            ruleId: 'S005',
            severity: sevS005,
            message: `${stepName} found but innermost open block is ${top.type} (opened at line ${top.line})`,
            line: lineNum,
            column: 1,
            endLine: lineNum,
            endColumn: lineLen + 1,
          });
          stack.pop(); // Try to recover
        }

        if (top) elseSeenForIf.delete(top.line);
        continue;
      }
    }

    // Unclosed blocks
    for (const entry of stack) {
      const closer = BLOCK_PAIRS[entry.type];
      diagnostics.push({
        ruleId: 'S005',
        severity: sevS005,
        message: `${entry.type} opened at line ${entry.line} has no matching ${closer}`,
        line: entry.line,
        column: 1,
        endLine: entry.line,
        endColumn: lines[entry.line - 1]?.trimEnd().length + 1 || 1,
      });
    }

    return diagnostics;
  },
};

// ---------------------------------------------------------------------------
// S008 — Known step names
// ---------------------------------------------------------------------------

const s008Rule: LintRule = {
  ruleId: 'S008',
  name: 'Known step names',
  severity: 'warning',

  check(lines: string[], catalog: Set<string>, config: LintConfig): Diagnostic[] {
    if (!isRuleEnabled('S008', config)) return [];
    if (catalog.size === 0) return [];
    const sev = getRuleSeverity('S008', 'warning', config);

    const merged = mergeMultilineStatements(lines);
    const diagnostics: Diagnostic[] = [];

    for (const { text, lineNumber } of merged) {
      if (isSkippable(text)) continue;

      const stepName = extractStepName(text);
      if (!stepName) continue;

      // Only check lines that start with uppercase (likely step invocations)
      if (!/^[A-Z]/.test(stepName)) continue;

      // Skip Else / Else If — valid structural keywords handled by S005
      if (stepName === 'Else' || stepName === 'Else If') continue;

      if (!catalog.has(stepName)) {
        diagnostics.push({
          ruleId: 'S008',
          severity: sev,
          message: `Unknown step: "${stepName}"`,
          line: lineNumber,
          column: 1,
          endLine: lineNumber,
          endColumn: stepName.length + 1,
        });
      }
    }

    return diagnostics;
  },
};

// Register rules
registerRule(s005Rule);
registerRule(s008Rule);
