import type { Diagnostic } from '../types';
import type { LintConfig } from '../config';
import type { LintRule } from '../engine';
import { registerRule } from '../engine';
import { isRuleEnabled, getRuleSeverity } from '../config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip quoted strings from text so we don't flag operators inside literals.
 */
function stripQuotedStrings(text: string): string {
  return text.replace(/"[^"]*"/g, match => ' '.repeat(match.length));
}

/**
 * Extract the bracket content from a line (everything between the first [ and last ]).
 */
function extractBracketContent(line: string): { content: string; startCol: number } | null {
  const openIdx = line.indexOf('[');
  const closeIdx = line.lastIndexOf(']');
  if (openIdx < 0 || closeIdx <= openIdx) return null;
  return {
    content: line.substring(openIdx + 1, closeIdx),
    startCol: openIdx + 2,
  };
}

// ---------------------------------------------------------------------------
// N001 — Unicode operators
// ---------------------------------------------------------------------------

const OPERATOR_REPLACEMENTS: Array<{ pattern: RegExp; ascii: string; unicode: string }> = [
  { pattern: /<>/g, ascii: '<>', unicode: '\u2260' },
  { pattern: /<=/g, ascii: '<=', unicode: '\u2264' },
  { pattern: />=/g, ascii: '>=', unicode: '\u2265' },
];

const n001Rule: LintRule = {
  ruleId: 'N001',
  name: 'Unicode operators',
  severity: 'info',

  check(lines: string[], _catalog: Set<string>, config: LintConfig): Diagnostic[] {
    if (!isRuleEnabled('N001', config)) return [];
    const sev = getRuleSeverity('N001', 'info', config);
    const diagnostics: Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bracket = extractBracketContent(line);
      if (!bracket) continue;

      const stripped = stripQuotedStrings(bracket.content);

      for (const op of OPERATOR_REPLACEMENTS) {
        let match: RegExpExecArray | null;
        op.pattern.lastIndex = 0;
        while ((match = op.pattern.exec(stripped)) !== null) {
          const col = bracket.startCol + match.index;
          diagnostics.push({
            ruleId: 'N001',
            severity: sev,
            message: `Use Unicode operator "${op.unicode}" instead of "${op.ascii}"`,
            line: i + 1,
            column: col,
            endLine: i + 1,
            endColumn: col + op.ascii.length,
            fixHint: `Replace "${op.ascii}" with "${op.unicode}"`,
          });
        }
      }
    }

    return diagnostics;
  },
};

registerRule(n001Rule);
