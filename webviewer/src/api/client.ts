import type { FMContext } from '@/context/types';
import type { StepCatalogEntry } from '@/converter/catalog-types';

const BASE = '';

export async function fetchContext(): Promise<FMContext> {
  const res = await fetch(`${BASE}/api/context`);
  if (!res.ok) throw new Error(`Failed to fetch context: ${res.status}`);
  return res.json();
}

export async function fetchIndex(name: string, solution?: string): Promise<string[][]> {
  const qs = solution ? `?solution=${encodeURIComponent(solution)}` : '';
  const res = await fetch(`${BASE}/api/index/${encodeURIComponent(name)}${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch index: ${name}`);
  return res.json();
}

export async function fetchSteps(): Promise<StepInfo[]> {
  const res = await fetch(`${BASE}/api/steps`);
  if (!res.ok) throw new Error('Failed to fetch steps');
  return res.json();
}

export async function fetchStepCatalog(): Promise<StepCatalogEntry[]> {
  const res = await fetch(`${BASE}/api/step-catalog`);
  if (!res.ok) throw new Error('Failed to fetch step catalog');
  return res.json();
}

export interface DocsResult {
  conventions: string;
  knowledge: string;
}

export async function fetchDocs(): Promise<DocsResult> {
  const res = await fetch(`${BASE}/api/docs`);
  if (!res.ok) throw new Error('Failed to fetch docs');
  return res.json();
}

export async function fetchSnippet(category: string, step: string): Promise<string> {
  const res = await fetch(`${BASE}/api/snippet/${encodeURIComponent(category)}/${encodeURIComponent(step)}`);
  if (!res.ok) throw new Error(`Failed to fetch snippet: ${category}/${step}`);
  return res.text();
}

export async function validateSnippet(xml: string): Promise<ValidationResult> {
  const res = await fetch(`${BASE}/api/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  return res.json();
}

export async function clipboardWrite(xml: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/clipboard/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  return res.json();
}

export async function clipboardRead(): Promise<{ xml: string }> {
  const res = await fetch(`${BASE}/api/clipboard/read`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to read clipboard');
  return res.json();
}

export async function listSandbox(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/sandbox`);
  if (!res.ok) throw new Error('Failed to list sandbox');
  return res.json();
}

export async function readSandbox(filename: string): Promise<string> {
  const res = await fetch(`${BASE}/api/sandbox/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`Failed to read sandbox file: ${filename}`);
  return res.text();
}

export async function writeSandbox(filename: string, content: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/sandbox/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: content,
  });
  return res.json();
}

// --- Script search & load ---

export interface ScriptSearchResult {
  name: string;
  id: number;
  folder: string;
}

export interface ScriptLoadResult {
  hr?: string;
  xml?: string;
  name?: string;
}

export async function searchScripts(query: string): Promise<ScriptSearchResult[]> {
  const res = await fetch(`${BASE}/api/scripts/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Failed to search scripts');
  return res.json();
}

export async function loadScript(id: number, name: string): Promise<ScriptLoadResult> {
  const res = await fetch(
    `${BASE}/api/scripts/load?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) throw new Error('Failed to load script');
  return res.json();
}

// --- Library ---

export interface LibraryItem {
  path: string;
  name: string;
  category: string;
}

export async function fetchLibrary(): Promise<LibraryItem[]> {
  const res = await fetch(`${BASE}/api/library`);
  if (!res.ok) throw new Error('Failed to fetch library');
  const data = await res.json();
  return data.items ?? [];
}

export async function fetchLibraryItem(itemPath: string): Promise<string> {
  const res = await fetch(`${BASE}/api/library/item?path=${encodeURIComponent(itemPath)}`);
  if (!res.ok) throw new Error(`Failed to fetch library item: ${itemPath}`);
  return res.text();
}

export async function saveLibraryItem(itemPath: string, content: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/api/library/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: itemPath, content }),
  });
  if (!res.ok) throw new Error('Failed to save library item');
  return res.json();
}

// --- AI Settings (server-side .env.local) ---

export interface AISettingsResponse {
  provider: string;
  model: string;
  configuredProviders: string[];
  promptMarker: string;
}

export async function fetchSettings(): Promise<AISettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function saveSettings(update: {
  provider?: string;
  model?: string;
  apiKey?: string;
  apiKeyProvider?: string;
  promptMarker?: string;
}): Promise<AISettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

// --- Custom Instructions ---

export async function fetchCustomInstructions(): Promise<string> {
  const res = await fetch(`${BASE}/api/custom-instructions`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.content ?? '';
}

export async function saveCustomInstructions(content: string): Promise<void> {
  await fetch(`${BASE}/api/custom-instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

// --- System prompt (base instructions) ---

export async function fetchSystemPrompt(): Promise<string> {
  const res = await fetch(`${BASE}/api/system-prompt`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.content ?? '';
}

// --- AI Chat (server-side proxy) ---

export interface ChatStreamEvent {
  type: 'text' | 'done' | 'error' | 'session';
  text?: string;
  error?: string;
  sessionId?: string;
}

/**
 * Stream chat via XHR instead of fetch+ReadableStream.
 * FileMaker's WebKit webview buffers the entire fetch response before
 * ReadableStream yields, breaking incremental streaming. XHR's onprogress
 * fires as chunks arrive, which WebKit has supported reliably for years.
 */
export function streamChat(
  messages: { role: string; content: string }[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<void> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/chat`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    let processed = 0;
    let buffer = '';

    const processNewData = () => {
      const raw = xhr.responseText;
      if (raw.length <= processed) return;

      buffer += raw.slice(processed);
      processed = raw.length;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
            onEvent(event);
          } catch (e) {
            console.warn('[ai-chat] malformed SSE event:', line.slice(0, 200), e);
          }
        }
      }
    };

    xhr.onprogress = processNewData;

    xhr.onload = () => {
      // Process any remaining buffered data
      processNewData();
      resolve();
    };

    xhr.onerror = () => {
      onEvent({ type: 'error', error: 'Network error' });
      resolve();
    };

    xhr.onabort = () => {
      resolve();
    };

    if (signal) {
      if (signal.aborted) { xhr.abort(); resolve(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(JSON.stringify({ messages, sessionId }));
  });
}

export interface StepInfo {
  name: string;
  category: string;
  file: string;
}

// --- Agent output ---

export interface AgentOutput {
  type: 'preview' | 'diff' | 'result';
  content: string;
  before?: string;
  timestamp?: number;
  available?: boolean;
}

export async function fetchAgentOutput(): Promise<AgentOutput> {
  try {
    const res = await fetch(`${BASE}/api/agent-output`);
    if (!res.ok) return { type: 'result', content: '', available: false };
    return res.json();
  } catch {
    return { type: 'result', content: '', available: false };
  }
}

export async function clearAgentOutput(): Promise<void> {
  try {
    await fetch(`${BASE}/api/agent-output`, { method: 'DELETE' });
  } catch { /* ignore */ }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
