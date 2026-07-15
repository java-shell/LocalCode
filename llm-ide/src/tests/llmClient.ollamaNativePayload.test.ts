import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { chatWithTools } from '../backend/llmClient';
import type { ChatMessage, LLMConfig } from '../shared/types';

/**
 * Purpose: Verify Ollama native chat payloads always contain a non-empty user message.
 * Inputs: A system-only message history and an Ollama config.
 * Outputs: Assertions on outbound payload shape and assistant output passthrough.
 * Side Effects: Temporarily monkey-patches axios.post inside this test scope.
 */
test('chatWithTools injects fallback user query for Ollama native payloads', async t => {
  const originalPost = (axios as any).post;
  let capturedUrl = '';
  let capturedPayload: any = null;

  t.after(() => {
    (axios as any).post = originalPost;
  });

  (axios as any).post = async (url: string, payload: any) => {
    capturedUrl = String(url ?? '');
    capturedPayload = payload;
    return {
      data: {
        message: {
          role: 'assistant',
          content: 'ok'
        },
        prompt_eval_count: 12,
        eval_count: 4
      }
    };
  };

  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'test-model',
    temperature: 0.2
  };

  const initialMessages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant.'
    }
  ];

  const result = await chatWithTools(
    config,
    initialMessages,
    [],
    async () => ({ ok: true })
  );

  assert.equal(result.text, 'ok');
  assert.equal(capturedUrl, 'http://localhost:11434/api/chat');

  const outboundMessages = Array.isArray(capturedPayload?.messages) ? capturedPayload.messages : [];
  assert.ok(outboundMessages.length > 0, 'Expected Ollama payload to include messages');

  const hasNonEmptyUser = outboundMessages.some(
    (message: any) => String(message?.role ?? '') === 'user' && String(message?.content ?? '').trim().length > 0
  );
  assert.equal(hasNonEmptyUser, true, 'Expected fallback non-empty user query for Ollama template compatibility');
});
