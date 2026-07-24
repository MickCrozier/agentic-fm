/**
 * FileMaker JS bridge utilities.
 * When running inside a FileMaker web viewer, window.FileMaker is available.
 */

declare global {
  interface Window {
    FileMaker?: {
      PerformScript(scriptName: string, parameter?: string): void;
    };
    pushContext?: (jsonString: string) => void;
    loadScript?: (content: string, format?: string) => void;
    onClipboardReady?: () => void;
    /** Trigger a Monaco editor action by action ID — called via Perform JavaScript in Web Viewer */
    triggerEditorAction?: (actionId: string) => void;
    /** Trigger an app-level toolbar action by action ID — called via Perform JavaScript in Web Viewer */
    triggerAppAction?: (actionId: string) => void;
  }
}

/** Check if running inside a FileMaker web viewer */
export function isFileMakerWebViewer(): boolean {
  return typeof window.FileMaker !== 'undefined';
}

/** Call a FileMaker script via the JS bridge */
export function callFileMakerScript(scriptName: string, parameter?: string): void {
  if (window.FileMaker) {
    window.FileMaker.PerformScript(scriptName, parameter ?? '');
  }
}

/** Notify FileMaker that the editor is ready */
export function notifyEditorReady(): void {
  callFileMakerScript('Editor Ready', '');
}

/** Request FileMaker to refresh context (the plugin regenerates it on next idle) */
export function requestContext(): void {
  callFileMakerScript('AGFM_Bridge', JSON.stringify({ command: 'refreshContext' }));
}
