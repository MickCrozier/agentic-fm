import type { Diagnostic } from '../types';
import type { LintConfig } from '../config';
import type { LintRule } from '../engine';
import { registerRule } from '../engine';
import { isRuleEnabled, getRuleSeverity, getRuleConfig } from '../config';

// ---------------------------------------------------------------------------
// D001 — Purpose comment
// ---------------------------------------------------------------------------

const d001Rule: LintRule = {
  ruleId: 'D001',
  name: 'Purpose comment',
  severity: 'warning',

  check(lines: string[], _catalog: Set<string>, config: LintConfig): Diagnostic[] {
    if (!isRuleEnabled('D001', config)) return [];
    const sev = getRuleSeverity('D001', 'warning', config);
    const rc = getRuleConfig('D001', config);
    const keyword = (rc.keyword as string) ?? 'PURPOSE:';
    const caseSensitive = (rc.case_sensitive as boolean) ?? false;

    // Find the first non-empty line
    let firstNonEmptyIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') {
        firstNonEmptyIdx = i;
        break;
      }
    }

    if (firstNonEmptyIdx < 0) return [];

    const firstLine = lines[firstNonEmptyIdx].trim();

    // Check that it's a comment containing the keyword
    if (firstLine.startsWith('#')) {
      const commentText = firstLine.substring(1);
      const hasKeyword = caseSensitive
        ? commentText.includes(keyword)
        : commentText.toUpperCase().includes(keyword.toUpperCase());
      if (hasKeyword) return [];
    }

    return [
      {
        ruleId: 'D001',
        severity: sev,
        message: `Script should begin with a comment containing "${keyword}"`,
        line: firstNonEmptyIdx + 1,
        column: 1,
        endLine: firstNonEmptyIdx + 1,
        endColumn: firstLine.length + 1,
        fixHint: `Add a comment line starting with "# ${keyword}" before the first step`,
      },
    ];
  },
};

registerRule(d001Rule);
