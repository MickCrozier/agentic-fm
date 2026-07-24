/** Slim API client for the layout editor dev-server endpoints. */

const BASE = '';

// --- AI Settings (mirrors webviewer — same server) ---

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
}): Promise<AISettingsResponse> {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

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

export async function fetchLayoutInstructions(): Promise<string> {
  const res = await fetch(`${BASE}/api/layout-instructions`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.content ?? '';
}

export async function saveLayoutInstructions(content: string): Promise<void> {
  await fetch(`${BASE}/api/layout-instructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function fetchLayoutDocs(): Promise<string> {
  const res = await fetch(`${BASE}/api/docs`);
  if (!res.ok) return '';
  const data = await res.json();
  return data.knowledge ?? '';
}

// --- Layout context ---

export interface LayoutObject {
  id: number;
  type: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fieldRef?: { table: string; field: string };
  partType?: string;
}

export interface LayoutData {
  name: string;
  id: number;
  objects: LayoutObject[];
  parts: { type: string; height: number }[];
}

export async function fetchLayout(): Promise<LayoutData | null> {
  try {
    const res = await fetch(`${BASE}/api/layout`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchFields(): Promise<{ table: string; field: string; type: string }[]> {
  try {
    const res = await fetch(`${BASE}/api/fields`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// --- Clipboard ---

export async function clipboardWriteXml(xml: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/clipboard/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    return res.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function clipboardRead(): Promise<{ xml: string }> {
  const res = await fetch(`${BASE}/api/clipboard/read`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to read clipboard');
  return res.json();
}

// --- AI Chat streaming (same XHR pattern as webviewer) ---

export interface ChatStreamEvent {
  type: 'text' | 'done' | 'error' | 'session';
  text?: string;
  error?: string;
  sessionId?: string;
}

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
            onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent);
          } catch { /* skip malformed */ }
        }
      }
    };

    xhr.onprogress = processNewData;
    xhr.onload = () => { processNewData(); resolve(); };
    xhr.onerror = () => { onEvent({ type: 'error', error: 'Network error' }); resolve(); };
    xhr.onabort = () => resolve();

    if (signal) {
      if (signal.aborted) { xhr.abort(); resolve(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(JSON.stringify({ messages, sessionId }));
  });
}
