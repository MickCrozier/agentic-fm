import * as monaco from 'monaco-editor';
import type { StepCatalogEntry } from '@/converter/catalog-types';
import type { ConversionError } from '@/converter/hr-to-xml';
import type { LintConfig } from './config';
import type { Diagnostic } from './types';
import { createLinter, fetchLintConfig } from './index';

const MARKER_OWNER = 'fmlint';

/**
 * Rules that only apply in script mode.
 * In calc mode these are auto-disabled regardless of config.
 */
const SCRIPT_ONLY_RULES = new Set([
  'S005', 'S006', 'S007', 'S008',
  'D001', 'D002', 'D003',
  'B001', 'B002', 'B003', 'B004', 'B005',
]);

/**
 * Map linter severity string to Monaco MarkerSeverity.
 */
function severityToMonaco(sev: string): monaco.MarkerSeverity {
  switch (sev) {
    case 'error':   return monaco.MarkerSeverity.Error;
    case 'warning': return monaco.MarkerSeverity.Warning;
    case 'info':    return monaco.MarkerSeverity.Info;
    case 'hint':    return monaco.MarkerSeverity.Hint;
    default:        return monaco.MarkerSeverity.Info;
  }
}

/**
 * Convert a linter Diagnostic to a Monaco IMarkerData.
 */
function diagnosticToMarker(d: Diagnostic, model: monaco.editor.ITextModel): monaco.editor.IMarkerData {
  const lineNum = d.line > 0 ? d.line : 1;
  const lineContent = lineNum <= model.getLineCount() ? model.getLineContent(lineNum) : '';

  return {
    severity: severityToMonaco(d.severity),
    message: d.fixHint ? `${d.message}\nFix: ${d.fixHint}` : d.message,
    source: `fmlint(${d.ruleId})`,
    startLineNumber: d.line > 0 ? d.line : 1,
    startColumn: d.column > 0 ? d.column : 1,
    endLineNumber: d.endLine > 0 ? d.endLine : lineNum,
    endColumn: d.endColumn > 0 ? d.endColumn : lineContent.length + 1,
  };
}

/**
 * Apply mode-based rule filtering to a config.
 * In calc mode, script-only rules are added to the disabled set.
 */
function applyModeFilter(config: LintConfig, mode: 'script' | 'calc'): LintConfig {
  if (mode === 'script') return config;

  // Clone the disabled set and add script-only rules
  const disabled = new Set(config.disabled);
  for (const ruleId of SCRIPT_ONLY_RULES) {
    disabled.add(ruleId);
  }

  return { ...config, disabled };
}

/**
 * Create a diagnostics provider that runs FMLint rules on editor content.
 * Loads rule configuration from fmlint.config.json via the API server,
 * ensuring the same rules and settings apply in both Python and TypeScript.
 *
 * @param editor     - Monaco editor instance
 * @param catalog    - Step catalog entries (used to build the known-step set)
 * @param editorMode - 'script' for HR script editing, 'calc' for calculation editing
 * @returns Disposable that cleans up the content change listener
 */
export function createLintDiagnosticsProvider(
  editor: monaco.editor.IStandaloneCodeEditor,
  catalog: StepCatalogEntry[],
  editorMode: 'script' | 'calc' = 'script',
): monaco.IDisposable {
  const model = editor.getModel();
  if (!model) return { dispose() {} };

  // Start with default config, then upgrade once the real config loads
  let linter = createLinter(catalog);

  // Fetch config asynchronously — apply mode filter, re-create linter
  fetchLintConfig().then((config: LintConfig) => {
    const filtered = applyModeFilter(config, editorMode);
    linter = createLinter(catalog, filtered);
    validate();
  });

  function validate() {
    const model = editor.getModel();
    if (!model) return;

    const text = model.getValue();
    const result = linter.lint(text);

    const markers = result.diagnostics.map(d => diagnosticToMarker(d, model));
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }

  // Run on content change, debounced to 300ms
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const disposable = model.onDidChangeContent(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(validate, 300);
  });

  // Initial validation (with default config — will re-run when config loads)
  validate();

  return {
    dispose() {
      if (debounceTimer) clearTimeout(debounceTimer);
      disposable.dispose();
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      }
    },
  };
}

/**
 * Update conversion diagnostics (HR->XML errors and warnings).
 * Errors are real conversion failures. Warnings are unresolved references
 * that will still produce valid XML (FM resolves by name on paste).
 */
export function updateConversionDiagnostics(
  model: monaco.editor.ITextModel,
  errors: ConversionError[],
  warnings?: ConversionError[],
): void {
  const markers: monaco.editor.IMarkerData[] = [];

  for (const err of errors) {
    const lineNumber = err.line > 0 ? err.line : 1;
    const lineContent = lineNumber <= model.getLineCount() ? model.getLineContent(lineNumber) : '';
    markers.push({
      severity: monaco.MarkerSeverity.Error,
      message: err.message,
      startLineNumber: lineNumber,
      startColumn: 1,
      endLineNumber: lineNumber,
      endColumn: lineContent.length + 1,
    });
  }

  if (warnings) {
    for (const warn of warnings) {
      const lineNumber = warn.line > 0 ? warn.line : 1;
      const lineContent = lineNumber <= model.getLineCount() ? model.getLineContent(lineNumber) : '';
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: warn.message,
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: lineContent.length + 1,
      });
    }
  }

  monaco.editor.setModelMarkers(model, 'filemaker-conversion', markers);
}
