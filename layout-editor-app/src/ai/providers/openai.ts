import type { AIProvider, AIMessage, AIProviderConfig, AIStreamEvent } from '../types';

export const openaiProvider: AIProvider = {
  id: 'openai',
  displayName: 'OpenAI',
  defaultModel: 'gpt-4o',
  models: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
  ],

  async chat(
    messages: AIMessage[],
    config: AIProviderConfig,
    onEvent: (event: AIStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const openaiMessages = messages.map(m => ({
      role: m.role as string,
      content: m.content,
    }));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || this.defaultModel,
        max_tokens: config.maxTokens ?? 4096,
        temperature: config.temperature ?? 0.3,
        messages: openaiMessages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const err = await response.text();
      onEvent({ type: 'error', error: `OpenAI API error ${response.status}: ${err}` });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onEvent({ type: 'error', error: 'No response body' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const event = JSON.parse(data);
              const delta = event.choices?.[0]?.delta?.content;
              if (delta) {
                onEvent({ type: 'text', text: delta });
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    onEvent({ type: 'done' });
  },

  async validateKey(config: AIProviderConfig): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
