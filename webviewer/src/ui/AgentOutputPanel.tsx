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
 * Agent output panel with persistent Monaco editors and Mermaid diagram rendering.
 *
 * Monaco editors share global services (IInstantiationService, ICodeEditorService).
 * Disposing an editor tears down those shared services, breaking autocomplete in
 * the main editor. To avoid this, the panel is always in the DOM (visibility
 * controlled via CSS) and its Monaco instances are created once and never disposed.
 * Models are managed normally — only editor instances persist.
 *
 * The diagram and layout-preview containers follow the same pattern — created once,
 * shown/hidden via CSS display, never removed from the DOM.
 */
export function AgentOutputPanel({ output, visible, onClose, onAccept }: AgentOutputPanelProps) {
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);
  const diagramContainerRef = useRef<HTMLDivElement>(null);
  const layoutContainerRef = useRef<HTMLDivElement>(null);
  const previewEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const diffModelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const mermaidInitRef = useRef(false);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

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

  const handleCopySource = useCallback(async () => {
    if (!output?.content) return;
    try {
      await navigator.clipboard.writeText(output.content);
    } catch { /* clipboard not available */ }
    await clearAgentOutput();
    onClose();
  }, [onClose, output]);

  const handleCopyHtml = useCallback(async () => {
    if (!output?.content) return;
    try {
      await navigator.clipboard.writeText(output.content);
    } catch { /* clipboard not available */ }
    await clearAgentOutput();
    onClose();
  }, [onClose, output]);

  // Lock body scroll while panel is visible
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  // Create or update Monaco editors / Mermaid diagram / layout preview when output changes
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

    if (output.type === 'diagram') {
      renderMermaid(output.content, diagramContainerRef.current, mermaidInitRef);
    }

    if (output.type === 'layout-preview') {
      renderLayoutPreview(output.content, output.styles, layoutContainerRef.current, shadowRootRef);
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
    : activeType === 'diagram' ? 'Diagram'
    : activeType === 'layout-preview' ? 'Layout Preview'
    : '';

  const typeColor = activeType === 'preview' ? 'bg-blue-700 text-blue-100'
    : activeType === 'diff' ? 'bg-purple-700 text-purple-100'
    : activeType === 'diagram' ? 'bg-teal-700 text-teal-100'
    : activeType === 'layout-preview' ? 'bg-amber-700 text-amber-100'
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
            {activeType === 'diagram' && (
              <button
                onClick={handleCopySource}
                class="text-xs px-1.5 py-0.5 rounded font-medium bg-green-700 hover:bg-green-600 text-white transition-colors"
              >
                Copy Source
              </button>
            )}
            {activeType === 'layout-preview' && (
              <button
                onClick={handleCopyHtml}
                class="text-xs px-1.5 py-0.5 rounded font-medium bg-green-700 hover:bg-green-600 text-white transition-colors"
              >
                Copy HTML
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

        {/* Body — editor/diagram/layout containers always in DOM, toggled via display */}
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
          <div
            ref={diagramContainerRef}
            class="h-full w-full overflow-auto flex items-center justify-center"
            style={{ display: activeType === 'diagram' ? 'flex' : 'none' }}
          />
          <div
            ref={layoutContainerRef}
            class="h-full w-full overflow-auto"
            style={{ display: activeType === 'layout-preview' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Render a layout preview HTML string inside a shadow DOM container.
 * Shadow DOM isolates the FM theme CSS from the webviewer's own Tailwind styles.
 * The container is persistent — the shadow root is created once and reused.
 */
function renderLayoutPreview(
  content: string,
  styles: string | undefined,
  container: HTMLDivElement | null,
  shadowRef: { current: ShadowRoot | null },
): void {
  if (!container) return;

  // Create shadow root once on first use
  if (!shadowRef.current) {
    shadowRef.current = container.attachShadow({ mode: 'open' });
  }

  const shadow = shadowRef.current;

  // Build the shadow DOM content with isolated styles
  const styleTag = styles ? `<style>${styles}</style>` : '';

  shadow.innerHTML = `
    ${styleTag}
    <style>
      :host {
        display: block;
        height: 100%;
        overflow: auto;
        background: #1a1a1a;
      }
      .fm-layout-wrapper {
        padding: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-height: 100%;
      }
      .fm-layout-viewport {
        background: white;
        border-radius: 4px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
        overflow: hidden;
        position: relative;
      }
      .fm-width-indicator {
        text-align: center;
        padding: 8px 0 4px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 11px;
        color: #888;
        letter-spacing: 0.5px;
      }
    </style>
    <div class="fm-layout-wrapper">
      <div class="fm-layout-viewport">${content}</div>
      <div class="fm-width-indicator" id="fm-width-label"></div>
    </div>
  `;

  // Measure and display the rendered width
  const viewport = shadow.querySelector('.fm-layout-viewport') as HTMLElement | null;
  const label = shadow.getElementById('fm-width-label');
  if (viewport && label) {
    // Use requestAnimationFrame to get the rendered width after layout
    requestAnimationFrame(() => {
      const width = viewport.scrollWidth;
      label.textContent = `${width}px wide`;
    });
  }
}

/**
 * Lazy-load mermaid and render the diagram SVG into the container.
 * Mermaid is only imported when a diagram payload first arrives.
 */
async function renderMermaid(
  source: string,
  container: HTMLDivElement | null,
  initRef: { current: boolean },
): Promise<void> {
  if (!container) return;

  try {
    const { default: mermaid } = await import('mermaid');

    if (!initRef.current) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
      });
      initRef.current = true;
    }

    // mermaid.render requires a unique ID each time to avoid collisions
    const id = `diagram-output-${Date.now()}`;
    const { svg } = await mermaid.render(id, source);
    container.innerHTML = svg;
  } catch (err) {
    container.innerHTML = `<pre class="text-red-400 text-xs p-4 whitespace-pre-wrap">Mermaid rendering error:\n${String(err)}</pre>`;
  }
}
