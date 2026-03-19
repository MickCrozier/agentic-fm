/**
 * Server-side AI proxy.
 * Streams chat completions from Anthropic/OpenAI, keeping API keys on the server.
 */

import type { ServerResponse } from 'node:http';
import https from 'node:https';
import { getApiKeyForProvider, getActiveConfig } from './settings';
import { streamClaudeCode } from './claude-cli';

interface ChatRequest {
  messages: { role: string; content: string }[];
  provider?: string;
  model?: string;
  sessionId?: string;
}

/** Stream a chat completion, writing SSE events to the response */
export async function streamChat(
  body: ChatRequest,
  res: ServerResponse,
): Promise<void> {
  const active = getActiveConfig();
  const providerId = body.provider ?? active.provider;
  const model = body.model ?? active.model;
  console.log(`[ai-chat] provider=${providerId} model=${model || '(default)'} messages=${body.messages.length}`);

  // Claude Code uses CLI auth — no API key needed
  if (providerId === 'claude-code') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    await streamClaudeCode(body.messages, model, res, body.sessionId);
    return;
  }

  const apiKey = getApiKeyForProvider(providerId);

  if (!apiKey) {
    console.warn(`[ai-chat] no API key for provider=${providerId}`);
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `No API key configured for ${providerId}. Open Settings to add one.` }));
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (providerId === 'anthropic') {
    await streamAnthropic(body.messages, model, apiKey, res);
  } else if (providerId === 'openai') {
    await streamOpenAI(body.messages, model, apiKey, res);
  } else {
    res.write(`data: ${JSON.stringify({ type: 'error', error: `Unknown provider: ${providerId}` })}\n\n`);
    res.end();
  }
}

function streamAnthropic(
  messages: { role: string; content: string }[],
  model: string,
  apiKey: string,
  res: ServerResponse,
): Promise<void> {
  const systemMessage = messages.find(m => m.role === 'system')?.content ?? '';
  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const payload = JSON.stringify({
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0.3,
    system: systemMessage,
    messages: conversationMessages,
    stream: true,
  });

  return proxyStream({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    payload,
    res,
    extractText(event: Record<string, unknown>): string | null {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.text) return delta.text as string;
      }
      return null;
    },
  });
}

function streamOpenAI(
  messages: { role: string; content: string }[],
  model: string,
  apiKey: string,
  res: ServerResponse,
): Promise<void> {
  const payload = JSON.stringify({
    model: model || 'gpt-4o',
    max_tokens: 4096,
    temperature: 0.3,
    messages,
    stream: true,
  });

  return proxyStream({
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    payload,
    res,
    extractText(event: Record<string, unknown>): string | null {
      const choices = event.choices as { delta?: { content?: string } }[] | undefined;
      const content = choices?.[0]?.delta?.content;
      return content ?? null;
    },
  });
}

interface ProxyOpts {
  hostname: string;
  path: string;
  headers: Record<string, string>;
  payload: string;
  res: ServerResponse;
  extractText: (event: Record<string, unknown>) => string | null;
}

function proxyStream(opts: ProxyOpts): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: opts.hostname,
        path: opts.path,
        method: 'POST',
        headers: {
          ...opts.headers,
          'Content-Length': Buffer.byteLength(opts.payload),
        },
      },
      (upstream) => {
        if (upstream.statusCode && upstream.statusCode >= 400) {
          let body = '';
          upstream.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          upstream.on('end', () => {
            console.warn(`[ai-chat] upstream API error ${upstream.statusCode}: ${body.slice(0, 500)}`);
            opts.res.write(`data: ${JSON.stringify({ type: 'error', error: `API error ${upstream.statusCode}: ${body}` })}\n\n`);
            opts.res.write('data: {"type":"done"}\n\n');
            opts.res.end();
            resolve();
          });
          return;
        }

        let buffer = '';
        upstream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const event = JSON.parse(data);
                const text = opts.extractText(event);
                if (text) {
                  opts.res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
                }
              } catch (e) {
                console.warn(`[ai-chat] malformed upstream SSE line: ${data.slice(0, 200)}`, e);
              }
            }
          }
        });

        upstream.on('end', () => {
          opts.res.write('data: {"type":"done"}\n\n');
          opts.res.end();
          resolve();
        });

        upstream.on('error', (err) => {
          console.warn(`[ai-chat] upstream stream error:`, err);
          opts.res.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
          opts.res.end();
          resolve();
        });
      },
    );

    req.on('error', (err) => {
      console.warn(`[ai-chat] HTTPS request error:`, err);
      opts.res.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
      opts.res.end();
      resolve();
    });

    // Handle client disconnect
    opts.res.on('close', () => {
      req.destroy();
    });

    req.write(opts.payload);
    req.end();
  });
}
