import { useCallback, useEffect, useRef } from 'preact/hooks';
import * as monaco from 'monaco-editor';
import { clearAgentOutput } from '@/api/client';
import { LANGUAGE_ID } from '@/editor/language/filemaker-script';
import { editorConfig } from '@/editor/editor.config';
import type { AgentOutput } from '@/api/client';

interface AgentOutputPanelProps {
  output: AgentOutput | null;
  visible: boolean;
  onClose: () => void;
  onAccept?: (content: string) => void;
}

/**
 * Agent output panel with persistent Monaco editors.
 *
 * Monaco editors share global services (IInstantiationService, ICodeEditorService).
 * Disposing an editor tears down those shared services, breaking autocomplete in
 * the main editor. To avoid this, the panel is always in the DOM (visibility
 * controlled via CSS) and its Monaco instances are created once and never disposed.
 * Models are managed normally — only editor instances persist.
 */
export function AgentOutputPanel({ output, visible, onClose, onAccept }: AgentOutputPanelProps) {
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const previewEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const diffModelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);

  const handleClose = useCallback(async () => {
    await clearAgentOutput();
    onClose();
  }, [onClose]);

  const handleAccept = useCallback(async () => {
    await clearAgentOutput();
    // Read from the modified editor — user may have edited the right pane
    const content = diffEditorRef.current
      ? diffEditorRef.current.getModifiedEditor().getValue()
      : output?.content ?? '';
    onAccept?.(content);
    onClose();
  }, [onClose, onAccept, output]);

  const handleReplace = useCallback(async () => {
    await clearAgentOutput();
    onAccept?.(output?.content ?? '');
    onClose();
  }, [onClose, onAccept, output]);

  // Lock body scroll while panel is visible
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  // Create or update Monaco editors when output changes
  useEffect(() => {
    if (!visible || !output) return;

    if (output.type === 'preview' || output.type === 'result') {
      const lang = output.type === 'preview' ? LANGUAGE_ID : 'plaintext';

      if (!previewEditorRef.current && previewContainerRef.current) {
        previewEditorRef.current = monaco.editor.create(previewContainerRef.current, {
          ...editorConfig,
          value: output.content,
          language: lang,
          theme: 'filemaker-dark',
          readOnly: true,
          automaticLayout: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
        });
      } else if (previewEditorRef.current) {
        const model = previewEditorRef.current.getModel();
        if (model) monaco.editor.setModelLanguage(model, lang);
        previewEditorRef.current.setValue(output.content);
      }
    }

    if (output.type === 'diff') {
      if (!diffEditorRef.current && diffContainerRef.current) {
        diffEditorRef.current = monaco.editor.createDiffEditor(diffContainerRef.current, {
          ...editorConfig,
          theme: 'filemaker-dark',
          automaticLayout: true,
          readOnly: false,
          renderSideBySide: true,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
        });
      }
      if (diffEditorRef.current) {
        // Dispose previous models to avoid leaks
        if (diffModelsRef.current) {
          diffModelsRef.current.original.dispose();
          diffModelsRef.current.modified.dispose();
        }
        const original = monaco.editor.createModel(output.before ?? '', LANGUAGE_ID);
        const modified = monaco.editor.createModel(output.content, LANGUAGE_ID);
        diffModelsRef.current = { original, modified };
        diffEditorRef.current.setModel({ original, modified });
      }
    }
  }, [visible, output]);

  // Force layout after becoming visible (container transitions from display:none)
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => {
      previewEditorRef.current?.layout();
      diffEditorRef.current?.layout();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const activeType = output?.type;

  const typeLabel = activeType === 'preview' ? 'Preview'
    : activeType === 'diff' ? 'Diff'
    : activeType === 'result' ? 'Result'
    : '';

  const typeColor = activeType === 'preview' ? 'bg-blue-700 text-blue-100'
    : activeType === 'diff' ? 'bg-purple-700 text-purple-100'
    : 'bg-neutral-600 text-neutral-200';

  return (
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      style={{ display: visible ? 'flex' : 'none' }}
    >
      <div
        class="bg-neutral-800 rounded-lg shadow-2xl flex flex-col border border-neutral-700"
        style={{ width: '85vw', height: '80vh' }}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-2 border-b border-neutral-700 shrink-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-neutral-200">Agent Output</span>
            {activeType && (
              <span class={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColor}`}>{typeLabel}</span>
            )}
          </div>
          <div class="flex items-center gap-2">
            {activeType === 'diff' && onAccept && (
              <button
                onClick={handleAccept}
                class="text-xs px-1.5 py-0.5 rounded font-medium bg-green-700 hover:bg-green-600 text-white transition-colors"
              >
                Accept
              </button>
            )}
            {activeType === 'preview' && onAccept && (
              <button
                onClick={handleReplace}
                class="text-xs px-1.5 py-0.5 rounded font-medium bg-green-700 hover:bg-green-600 text-white transition-colors"
              >
                Replace
              </button>
            )}
            <button
              onClick={handleClose}
              class="text-xs px-1.5 py-0.5 rounded font-medium bg-neutral-600 hover:bg-neutral-500 text-neutral-200 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>

        {/* Body — editor containers always in DOM, toggled via display */}
        <div class="flex-1 min-h-0 overflow-hidden rounded-b-lg bg-neutral-900">
          <div
            ref={previewContainerRef}
            class="h-full w-full"
            style={{ display: activeType === 'preview' || activeType === 'result' ? 'block' : 'none' }}
          />
          <div
            ref={diffContainerRef}
            class="h-full w-full"
            style={{ display: activeType === 'diff' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </div>
  );
}
