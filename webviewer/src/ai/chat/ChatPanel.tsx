import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { streamChat } from '@/api/client';
import type { ChatStreamEvent } from '@/api/client';
import { buildSystemPrompt } from '../prompt/system-prompt';
import { MessageList } from './MessageList';
import type { FMContext } from '@/context/types';
import type { StepInfo } from '@/api/client';
import type { StepCatalogEntry } from '@/converter/catalog-types';

interface ChatPanelProps {
  context: FMContext | null;
  steps: StepInfo[];
  catalog?: StepCatalogEntry[];
  editorContent: string;
  promptMarker?: string;
  codingConventions?: string;
  knowledgeDocs?: string;
  customInstructions?: string;
  baseSystemPrompt?: string;
  onInsertScript?: (script: string, lineRange?: { start: number; end: number }) => void;
  onClearChat?: () => void;
  scriptName?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export function ChatPanel({ context, steps, catalog, editorContent, promptMarker, codingConventions, knowledgeDocs, customInstructions, baseSystemPrompt, onInsertScript, onClearChat, scriptName }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    const systemPrompt = buildSystemPrompt({ context, steps, catalog, promptMarker, codingConventions, knowledgeDocs, customInstructions, baseSystemPrompt });

    // Include editor content as context with line numbers
    let contextMsg = '';
    if (editorContent) {
      const numbered = editorContent
        .split('\n')
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');
      contextMsg = `\n\nCurrent editor content:\n\`\`\`\n${numbered}\n\`\`\``;
    }

    // When resuming a session, send only the latest user message (CLI has the history).
    // On first message, send full history with system prompt.
    const apiMessages = sessionId
      ? [{ role: 'user', content: text + contextMsg }]
      : [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: text + contextMsg },
        ];

    console.log(`[ai-chat] sending ${apiMessages.length} messages (session=${sessionId ? 'resume' : 'new'})`);

    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Add empty assistant message for streaming
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

    try {
      await streamChat(
        apiMessages,
        (event: ChatStreamEvent) => {
          if (event.type === 'session' && event.sessionId) {
            setSessionId(event.sessionId);
          } else if (event.type === 'text' && event.text) {
            setMessages(prev => {
              const updated = [...prev];
              updated[assistantIdx] = {
                ...updated[assistantIdx],
                content: updated[assistantIdx].content + event.text,
              };
              return updated;
            });
          } else if (event.type === 'error') {
            console.warn('[ai-chat] stream error event:', event.error);
            setMessages(prev => {
              const updated = [...prev];
              updated[assistantIdx] = {
                ...updated[assistantIdx],
                content: updated[assistantIdx].content + `\n\nError: ${event.error}`,
                streaming: false,
              };
              return updated;
            });
          } else if (event.type === 'done') {
            console.log('[ai-chat] stream complete');
            setMessages(prev => {
              const updated = [...prev];
              updated[assistantIdx] = { ...updated[assistantIdx], streaming: false };
              return updated;
            });
          }
        },
        controller.signal,
        sessionId ?? undefined,
      );
    } catch (err) {
      console.error('[ai-chat] streamChat threw:', err);
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = {
            ...updated[assistantIdx],
            content: updated[assistantIdx].content + `\n\nError: ${err}`,
            streaming: false,
          };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, context, steps, editorContent, promptMarker, sessionId]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div class="flex flex-col h-full bg-neutral-900 border-l border-neutral-700">
      <div class="flex items-center justify-between px-3 py-1.5 bg-neutral-800 border-b border-neutral-700 text-xs text-neutral-400 select-none">
        <span class="flex items-center gap-1 min-w-0">
          <span>AI Chat</span>
          {sessionId && scriptName && (
            <span class="text-neutral-500 truncate max-w-[160px]" title={scriptName}>
              — {scriptName}
            </span>
          )}
        </span>
        {onClearChat && (
          <button
            onClick={onClearChat}
            title="Start a new AI chat (clears history)"
            class="flex items-center justify-center w-5 h-5 rounded hover:bg-neutral-600 hover:text-neutral-200 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
              <path d="M12 8v6" />
              <path d="M9 11h6" />
            </svg>
          </button>
        )}
      </div>

      <MessageList messages={messages} onInsertScript={onInsertScript} />

      <div class="border-t border-neutral-700 p-2 flex flex-col gap-1.5">
        <textarea
          ref={inputRef}
          class="w-full bg-neutral-800 text-neutral-200 text-sm rounded px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-neutral-500"
          rows={2}
          placeholder="Ask about FileMaker scripting..."
          value={input}
          onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        <div class="flex justify-end">
          {isStreaming ? (
            <button
              onClick={handleStop}
              class="px-3 py-1.5 rounded text-xs bg-red-700 hover:bg-red-600 text-white"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={sendMessage}
              class="px-3 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
