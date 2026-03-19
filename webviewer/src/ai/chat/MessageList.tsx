import { useRef, useEffect, useMemo } from 'preact/hooks';
import { marked } from 'marked';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface MessageListProps {
  messages: Message[];
  onInsertScript?: (script: string, lineRange?: { start: number; end: number }) => void;
}

marked.setOptions({ breaks: true });

export function MessageList({ messages, onInsertScript }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div class="flex-1 flex items-center justify-center text-neutral-500 text-sm p-4">
        <div class="text-center">
          <p>Ask the AI to help write FileMaker scripts.</p>
          <p class="text-xs mt-2 text-neutral-600">
            The AI can see your current editor content and CONTEXT.json.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div class="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((msg, i) => (
        <div key={i} class={`text-sm ${msg.role === 'user' ? 'text-blue-300' : 'text-neutral-300'}`}>
          <div class="text-xs text-neutral-500 mb-0.5 select-none">
            {msg.role === 'user' ? 'You' : 'AI'}
            {msg.streaming && ' (streaming...)'}
          </div>
          {msg.role === 'user' ? (
            <div class="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
          ) : (
            <div class="leading-relaxed">
              {renderAssistantContent(msg.content, onInsertScript)}
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

/** Parse optional `lines=N-M` from a code fence's info string */
function parseLineRange(info: string): { start: number; end: number } | undefined {
  const m = info.match(/\blines=(\d+)-(\d+)\b/);
  if (!m) return undefined;
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

/**
 * Scan prose text for line-number hints when the code fence has no `lines=` attribute.
 * Matches patterns like:
 *   "after line 41"     → insert after line 41 (before 42)
 *   "before line 43"    → insert before line 43
 *   "insert at line 42" → insert before line 42
 *   "replace line 10"   → replace line 10
 *   "replace lines 10-15" / "replace lines 10–15" → replace range
 *   "lines 17-19" / "lines 17–19" → replace range
 *
 * Only the LAST match in the prose is used (closest to the code block).
 */
function parseLineRangeFromProse(prose: string): { start: number; end: number } | undefined {
  // Normalize unicode dashes to hyphens for matching
  const text = prose.replace(/[\u2013\u2014]/g, '-');

  const patterns: { re: RegExp; toRange: (m: RegExpMatchArray) => { start: number; end: number } }[] = [
    // "after line 41" → pure insert: before line 42
    { re: /after\s+line\s+(\d+)/gi, toRange: m => { const n = parseInt(m[1], 10); return { start: n + 1, end: n }; } },
    // "before line 43" → pure insert: before line 43
    { re: /before\s+line\s+(\d+)/gi, toRange: m => { const n = parseInt(m[1], 10); return { start: n, end: n - 1 }; } },
    // "insert at line 42" → pure insert
    { re: /insert\s+(?:at\s+)?line\s+(\d+)/gi, toRange: m => { const n = parseInt(m[1], 10); return { start: n, end: n - 1 }; } },
    // "replace lines 10-15" → replace range
    { re: /replace\s+lines?\s+(\d+)\s*-\s*(\d+)/gi, toRange: m => ({ start: parseInt(m[1], 10), end: parseInt(m[2], 10) }) },
    // "replace line 10" → replace single line
    { re: /replace\s+line\s+(\d+)/gi, toRange: m => { const n = parseInt(m[1], 10); return { start: n, end: n }; } },
    // "lines 17-19" (standalone) → replace range
    { re: /lines?\s+(\d+)\s*-\s*(\d+)/gi, toRange: m => ({ start: parseInt(m[1], 10), end: parseInt(m[2], 10) }) },
  ];

  let best: { start: number; end: number; pos: number } | undefined;

  for (const { re, toRange } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const range = toRange(m);
      // Keep the match closest to the end of the prose (nearest the code block)
      if (!best || m.index > best.pos) {
        best = { ...range, pos: m.index };
      }
    }
  }

  return best ? { start: best.start, end: best.end } : undefined;
}

/**
 * Format a line range into a human-readable label for the code block header.
 */
function formatLineLabel(range: { start: number; end: number }): string {
  if (range.start > range.end) return `Insert before L${range.start}`;
  if (range.start === range.end) return `L${range.start}`;
  return `L${range.start}\u2013${range.end}`;
}

/**
 * Handle Insert button click. If no line range is available, prompt the user.
 */
function handleInsertClick(
  code: string,
  lineRange: { start: number; end: number } | undefined,
  onInsertScript: (script: string, lineRange?: { start: number; end: number }) => void,
) {
  if (lineRange) {
    onInsertScript(code, lineRange);
    return;
  }
  // No line info — ask the user where to insert
  const answer = prompt(
    'No target lines detected. Enter a line number to insert before, or a range (e.g. "12" or "12-15" to replace):',
  );
  if (!answer) return; // cancelled

  const rangeMatch = answer.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (rangeMatch) {
    onInsertScript(code, { start: parseInt(rangeMatch[1], 10), end: parseInt(rangeMatch[2], 10) });
  } else {
    const lineNum = parseInt(answer.trim(), 10);
    if (isNaN(lineNum) || lineNum < 1) return;
    // Pure insert before the specified line
    onInsertScript(code, { start: lineNum, end: lineNum - 1 });
  }
}

/**
 * Split assistant content into prose segments and code blocks.
 * Code blocks become real Preact elements (with Insert button).
 * Prose segments are rendered as markdown via marked.
 */
function renderAssistantContent(
  content: string,
  onInsertScript?: (script: string, lineRange?: { start: number; end: number }) => void,
): preact.ComponentChildren {
  const parts: preact.ComponentChildren[] = [];
  // Capture the full info string after ``` (e.g. "script lines=17-19")
  const codeBlockRegex = /```([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Prose before this code block
    const prose = match.index > lastIndex ? content.slice(lastIndex, match.index) : '';
    if (prose) {
      parts.push(<MarkdownSpan key={`p${lastIndex}`} text={prose} />);
    }

    const info = match[1].trim();
    const code = match[2].trimEnd();

    // 1. Try explicit lines= in the code fence
    let lineRange = parseLineRange(info);
    let rangeSource: 'fence' | 'prose' | null = lineRange ? 'fence' : null;

    // 2. Fallback: scan the prose before this code block for line hints
    if (!lineRange && prose) {
      lineRange = parseLineRangeFromProse(prose);
      if (lineRange) rangeSource = 'prose';
    }

    // Strip the lines= part from the label, fall back to "Script"
    const label = info.replace(/\s*lines=\d+-\d+/, '').trim() || 'Script';
    const lineLabel = lineRange ? formatLineLabel(lineRange) : null;

    parts.push(
      <div key={`c${match.index}`} class="my-2 rounded bg-neutral-800 border border-neutral-700 min-w-0 overflow-hidden">
        <div class="flex items-center justify-between px-2 py-1 border-b border-neutral-700">
          <span class="text-xs text-neutral-500">
            {label}
            {lineLabel && (
              <span class={`ml-1.5 ${rangeSource === 'prose' ? 'text-amber-600' : 'text-neutral-600'}`}
                title={rangeSource === 'prose' ? 'Line range inferred from description' : undefined}
              >
                ({lineLabel})
              </span>
            )}
          </span>
          {onInsertScript && (
            <button
              onClick={() => handleInsertClick(code, lineRange, onInsertScript)}
              class="text-xs px-2 py-0.5 rounded bg-blue-700 hover:bg-blue-600 text-white"
            >
              Insert
            </button>
          )}
        </div>
        <pre class="p-2 text-xs overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>,
    );

    lastIndex = match.index + match[0].length;
  }

  // Remaining prose after the last code block
  if (lastIndex < content.length) {
    const prose = content.slice(lastIndex);
    parts.push(<MarkdownSpan key={`p${lastIndex}`} text={prose} />);
  }

  return parts.length > 0 ? parts : content;
}

/** Render a prose segment as markdown HTML */
function MarkdownSpan({ text }: { text: string }) {
  const html = useMemo(
    () => marked.parse(text, { async: false }) as string,
    [text],
  );
  return <span class="chat-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
