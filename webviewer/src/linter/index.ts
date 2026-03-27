import type { LintResult } from './types';
import type { LintConfig } from './config';
import { createDefaultConfig, createConfigFromJson } from './config';
import { runLinter } from './engine';

// Import rules to trigger registration via side effects
import './rules/structure';
import './rules/naming';
import './rules/calculations';
import './rules/documentation';

// Re-export public types
export type { Severity, Diagnostic, LintResult } from './types';
export type { LintConfig, RuleConfig } from './config';
export { createConfig, createDefaultConfig, createConfigFromJson, isRuleEnabled, getRuleSeverity, getRuleConfig } from './config';
export type { LintRule } from './engine';
export { registerRule, getRegisteredRules } from './engine';

/**
 * Create a linter instance from a step catalog.
 *
 * @param catalog - Array of objects with at least a `name` property
 * @param config  - Optional lint configuration (from fmlint.config.json or overrides)
 * @returns Object with a `lint(text)` method that returns a LintResult
 */
export function createLinter(
  catalog: { name: string }[],
  config?: LintConfig,
) {
  const catalogSet = new Set(catalog.map(entry => entry.name));
  const cfg = config ?? createDefaultConfig();

  return {
    lint(text: string): LintResult {
      const lines = text.split('\n');
      return runLinter(lines, catalogSet, cfg);
    },
  };
}

/**
 * Fetch the merged lint config from the webviewer API server.
 * Falls back to an empty default config on failure.
 */
export async function fetchLintConfig(): Promise<LintConfig> {
  try {
    const resp = await fetch('/api/lint-config');
    if (!resp.ok) return createDefaultConfig();
    const json = await resp.json();
    return createConfigFromJson(json);
  } catch {
    return createDefaultConfig();
  }
}
