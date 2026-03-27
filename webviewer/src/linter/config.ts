import type { Severity } from './types';

export interface RuleConfig {
  enabled?: boolean;
  severity?: Severity;
  [key: string]: unknown;  // rule-specific parameters
}

export interface LintConfig {
  /** Per-rule configuration from fmlint.config.json */
  rules: Map<string, RuleConfig>;
  /** Rule IDs to disable entirely (CLI-level override) */
  disabled: Set<string>;
  /** Override severity for specific rule IDs (CLI-level override) */
  severityOverrides: Map<string, Severity>;
}

export function createDefaultConfig(): LintConfig {
  return {
    rules: new Map(),
    disabled: new Set(),
    severityOverrides: new Map(),
  };
}

/**
 * Create a config from the JSON shape returned by /api/lint-config.
 * Merges with optional CLI-level overrides.
 */
export function createConfigFromJson(
  json: { rules?: Record<string, RuleConfig> },
  overrides?: { disabled?: string[]; severityOverrides?: Record<string, Severity> },
): LintConfig {
  const config = createDefaultConfig();

  if (json.rules) {
    for (const [id, rc] of Object.entries(json.rules)) {
      config.rules.set(id, rc);
    }
  }

  if (overrides?.disabled) {
    for (const id of overrides.disabled) {
      config.disabled.add(id);
    }
  }
  if (overrides?.severityOverrides) {
    for (const [id, sev] of Object.entries(overrides.severityOverrides)) {
      config.severityOverrides.set(id, sev);
    }
  }

  return config;
}

/** Backward-compatible factory */
export function createConfig(options?: {
  disabled?: string[];
  severityOverrides?: Record<string, Severity>;
}): LintConfig {
  return createConfigFromJson({}, options);
}

/** Check if a rule is enabled given the config */
export function isRuleEnabled(ruleId: string, config: LintConfig): boolean {
  if (config.disabled.has(ruleId)) return false;
  const rc = config.rules.get(ruleId);
  if (rc && rc.enabled === false) return false;
  return true;
}

/** Get the effective severity for a rule */
export function getRuleSeverity(ruleId: string, defaultSev: Severity, config: LintConfig): Severity {
  const override = config.severityOverrides.get(ruleId);
  if (override) return override;
  const rc = config.rules.get(ruleId);
  if (rc?.severity) return rc.severity;
  return defaultSev;
}

/** Get rule-specific config parameters */
export function getRuleConfig(ruleId: string, config: LintConfig): RuleConfig {
  return config.rules.get(ruleId) ?? {};
}
