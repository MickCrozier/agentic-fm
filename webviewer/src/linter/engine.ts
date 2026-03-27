import type { Severity, Diagnostic, LintResult } from './types';
import type { LintConfig } from './config';
import { createDefaultConfig, isRuleEnabled, getRuleSeverity } from './config';

export interface LintRule {
  ruleId: string;
  name: string;
  severity: Severity;
  check(lines: string[], catalog: Set<string>, config: LintConfig): Diagnostic[];
}

const registry: LintRule[] = [];

export function registerRule(rule: LintRule): void {
  registry.push(rule);
}

export function getRegisteredRules(): readonly LintRule[] {
  return registry;
}

export function runLinter(
  lines: string[],
  catalog: Set<string>,
  config?: LintConfig,
): LintResult {
  const cfg = config ?? createDefaultConfig();
  const diagnostics: Diagnostic[] = [];

  for (const rule of registry) {
    if (!isRuleEnabled(rule.ruleId, cfg)) continue;

    const ruleDiags = rule.check(lines, catalog, cfg);

    // Apply severity from config
    const effectiveSev = getRuleSeverity(rule.ruleId, rule.severity, cfg);
    for (const d of ruleDiags) {
      d.severity = effectiveSev;
      diagnostics.push(d);
    }
  }

  // Sort by line, then column
  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

  let errorCount = 0;
  let warningCount = 0;
  for (const d of diagnostics) {
    if (d.severity === 'error') errorCount++;
    else if (d.severity === 'warning') warningCount++;
  }

  return {
    source: lines.join('\n'),
    diagnostics,
    ok: errorCount === 0,
    errorCount,
    warningCount,
  };
}
