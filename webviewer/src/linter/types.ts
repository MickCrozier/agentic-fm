export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  line: number;       // 1-based, 0 = file-level
  column: number;     // 1-based, 0 = whole line
  endLine: number;
  endColumn: number;
  fixHint?: string;
}

export interface LintResult {
  source: string;
  diagnostics: Diagnostic[];
  ok: boolean;
  errorCount: number;
  warningCount: number;
}
