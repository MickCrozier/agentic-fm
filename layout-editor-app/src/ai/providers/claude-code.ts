import type { AIProvider, AIProviderConfig, AIMessage, AIStreamEvent } from '../types';

export const claudeCodeProvider: AIProvider = {
  id: 'claude-code',
  displayName: 'Claude Code',
  defaultModel: 'sonnet',
  models: ['sonnet', 'opus', 'haiku'],
  requiresKey: false,

  async chat(
    _messages: AIMessage[],
    _config: AIProviderConfig,
    onEvent: (event: AIStreamEvent) => void,
    _signal?: AbortSignal,
  ): Promise<void> {
    // Claude Code provider is handled server-side via CLI subprocess.
    // This client-side chat() should not be called directly.
    onEvent({ type: 'error', error: 'Claude Code provider requires server-side proxy' });
  },

  async validateKey(_config: AIProviderConfig): Promise<boolean> {
    // No API key needed — uses claude login session
    return true;
  },
};
