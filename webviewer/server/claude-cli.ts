/**
 * Claude Code CLI integration.
 * Spawns `claude -p` in headless mode and bridges its stream-json output to SSE.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';

interface AIMessage {
  role: string;
  content: string;
}

/**
 * Build a single prompt string from the conversation messages.
 * System prompt is passed separately via --system-prompt flag.
 */
function buildPrompt(messages: AIMessage[]): string {
  const conversationMessages = messages.filter(m => m.role !== 'system');
  // For multi-turn, format as labeled turns so the CLI has context
  if (conversationMessages.length === 1) {
    return conversationMessages[0].content;
  }
  return conversationMessages
    .map(m => `[${m.role}]\n${m.content}`)
    .join('\n\n');
}

/** Stream a chat completion via the Claude CLI, writing SSE events to the response */
export function streamClaudeCode(
  messages: AIMessage[],
  model: string,
  res: ServerResponse,
  sessionId?: string,
): Promise<void> {
  return new Promise((resolve) => {
    const systemMessage = messages.find(m => m.role === 'system')?.content ?? '';

    const args: string[] = [];

    if (sessionId) {
      // Resuming an existing session — send only the latest user message
      const conversationMessages = messages.filter(m => m.role !== 'system');
      const latestUserMessage = conversationMessages[conversationMessages.length - 1]?.content ?? '';
      args.push('-p', latestUserMessage, '--resume', sessionId, '--output-format', 'stream-json', '--verbose');
    } else {
      // First message — start a new session
      const newId = randomUUID();
      const prompt = buildPrompt(messages);
      args.push('-p', prompt, '--session-id', newId, '--output-format', 'stream-json', '--verbose');

      if (systemMessage) {
        args.push('--system-prompt', systemMessage);
      }
    }

    if (model) {
      args.push('--model', model);
    }

    // Strip CLAUDECODE env var to prevent the child process from detecting
    // a nested session and exiting immediately (code 1).
    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Log spawn details (redact the full prompt/system-prompt to keep output readable)
    const logArgs = args.map((a, i) => {
      const prev = args[i - 1];
      if (prev === '-p' || prev === '--system-prompt') return `(${a.length} chars)`;
      return a;
    });
    console.log(`[ai-chat:cli] spawning: claude ${logArgs.join(' ')}`);

    let proc: ChildProcess;
    try {
      proc = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });
    } catch (err) {
      console.error(`[ai-chat:cli] spawn failed:`, err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Failed to spawn claude CLI: ${err}` })}\n\n`);
      res.write('data: {"type":"done"}\n\n');
      res.end();
      resolve();
      return;
    }

    let buffer = '';
    let stderrBuffer = '';
    // Track text we've already sent so we only forward new content.
    // Each `assistant` event contains the FULL message so far, not a delta.
    let sentTextLength = 0;
    let capturedSessionId: string | null = null;

    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          console.log(`[ai-chat:cli] event type=${event.type}`);

          // Capture session_id from the first event that has it
          if (!capturedSessionId && event.session_id) {
            capturedSessionId = event.session_id;
            res.write(`data: ${JSON.stringify({ type: 'session', sessionId: capturedSessionId })}\n\n`);
          }

          if (event.type === 'assistant' && event.message?.content) {
            // Extract all text blocks from the assistant message
            const contentBlocks = event.message.content as { type: string; text?: string }[];
            const fullText = contentBlocks
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text?: string }) => b.text ?? '')
              .join('');

            // Only send the new portion (each event has the full accumulated text)
            if (fullText.length > sentTextLength) {
              const delta = fullText.slice(sentTextLength);
              sentTextLength = fullText.length;
              res.write(`data: ${JSON.stringify({ type: 'text', text: delta })}\n\n`);
            }
          } else {
            // Send SSE comment as keepalive so the browser doesn't time out
            res.write(`: keepalive ${event.type}\n\n`);
          }
        } catch (e) {
          console.warn(`[ai-chat:cli] non-JSON stdout: ${trimmed.slice(0, 200)}`, e);
        }
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      console.warn(`[ai-chat:cli] stderr: ${text.trim()}`);
    });

    proc.on('close', (code) => {
      console.log(`[ai-chat:cli] process exited code=${code}${stderrBuffer ? ' stderr=' + stderrBuffer.trim().slice(0, 300) : ''}`);
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === 'assistant' && event.message?.content) {
            const contentBlocks = event.message.content as { type: string; text?: string }[];
            const fullText = contentBlocks
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text?: string }) => b.text ?? '')
              .join('');
            if (fullText.length > sentTextLength) {
              const delta = fullText.slice(sentTextLength);
              res.write(`data: ${JSON.stringify({ type: 'text', text: delta })}\n\n`);
            }
          }
        } catch (e) {
          console.warn(`[ai-chat:cli] malformed final buffer: ${buffer.trim().slice(0, 200)}`, e);
        }
      }

      if (code !== 0 && code !== null) {
        const rawErr = stderrBuffer.trim() || `claude CLI exited with code ${code}`;
        const isAuthError = rawErr.includes('authentication_error') || rawErr.includes('OAuth token has expired') || rawErr.includes('401');
        const errMsg = isAuthError
          ? "You don't have an active Claude session. You may need to log in again via the CLI (`claude login`)."
          : rawErr;
        console.warn(`[ai-chat:cli] error response: ${rawErr.slice(0, 300)}`);
        res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
      }

      res.write('data: {"type":"done"}\n\n');
      res.end();
      resolve();
    });

    proc.on('error', (err) => {
      console.error(`[ai-chat:cli] process error:`, err);
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Claude CLI error: ${err.message}` })}\n\n`);
      res.write('data: {"type":"done"}\n\n');
      res.end();
      resolve();
    });

    // Handle client disconnect — kill the child process
    res.on('close', () => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    });
  });
}

/** Check if the claude CLI binary is available */
export function checkClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', ['claude'], { stdio: ['ignore', 'pipe', 'ignore'] });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}
