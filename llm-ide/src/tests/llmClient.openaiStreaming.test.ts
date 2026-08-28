import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import axios from 'axios';
import { chatWithTools } from '../backend/llmClient';
import type { LLMConfig } from '../shared/types';

interface MockStreamResponse {
  data: EventEmitter;
}

/**
 * Replace axios.post with a streamed OpenAI-compatible response for one test.
 * Inputs: a stream emitter controlled by the test and a callback for assertions.
 * Side effects: temporarily mutates the shared axios client.
 */
async function withMockedOpenAIStreamPost(
  stream: EventEmitter,
  callback: (requests: Array<{ url: string; payload: Record<string, unknown> }>) => Promise<void>
): Promise<void> {
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<MockStreamResponse>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    return { data: stream };
  };

  try {
    await callback(requests);
  } finally {
    axiosRef.post = originalPost;
  }
}

test('openai-compatible streaming emits assistant tokens and a thought event from reasoning content', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: 'gpt-test',
    temperature: 0.2
  };
  const stream = new EventEmitter();
  const tokens: string[] = [];
  const events: string[] = [];

  await withMockedOpenAIStreamPost(stream, async requests => {
    const resultPromise = chatWithTools(
      config,
      [{ role: 'user', content: 'Summarize the fix.' }],
      [],
      async () => ({ ok: true }),
      event => events.push(event),
      40,
      undefined,
      token => tokens.push(token)
    );

    setImmediate(() => {
      stream.emit(
        'data',
        Buffer.from(
          'data: {"choices":[{"delta":{"reasoning_content":"Need to check the renderer first. "}}]}\n' +
          'data: {"choices":[{"delta":{"content":"The fix is ready."}}]}\n' +
          'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}\n' +
          'data: [DONE]\n'
        )
      );
      stream.emit('end');
    });

    const result = await resultPromise;

    assert.equal(result.text, 'The fix is ready.');
    assert.deepEqual(tokens, ['The fix is ready.']);
    assert.ok(events.some(event => event.startsWith('thinking:Need to check the renderer first.')));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.payload.stream, true);
  });
});

test('openai-compatible non-stream fallback still returns assistant text', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: 'gpt-test',
    temperature: 0.2
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{
      data: {
        choices: Array<{
          message: {
            role: 'assistant';
            content: string;
            reasoning_content?: string;
          };
        }>;
        usage: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      };
    }>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    return {
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Fallback reply.',
              reasoning_content: 'Inspected the request.'
            }
          }
        ],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 3,
          total_tokens: 10
        }
      }
    };
  };

  try {
    const events: string[] = [];
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Return a brief reply.' }],
      [],
      async () => ({ ok: true }),
      event => events.push(event)
    );

    assert.equal(result.text, 'Fallback reply.');
    assert.ok(events.some(event => event.startsWith('thinking:Inspected the request.')));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.payload.stream, false);
  } finally {
    axiosRef.post = originalPost;
  }
});

test('openai-compatible stream socket hang up falls back to non-stream response', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://192.168.0.32:8080/v1/chat/completions',
    model: 'qwen3.8-flash-next',
    temperature: 0.2
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const events: string[] = [];

  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{
      data: {
        choices: Array<{ message: { role: 'assistant'; content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    }>;
  };

  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    if (payload.stream === true) {
      const error = new Error('socket hang up') as Error & { code?: string; isAxiosError?: boolean };
      error.code = 'ECONNRESET';
      error.isAxiosError = true;
      throw error;
    }

    return {
      data: {
        choices: [{ message: { role: 'assistant', content: 'Recovered via non-stream fallback.' } }],
        usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 }
      }
    };
  };

  try {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Summarize quickly.' }],
      [],
      async () => ({ ok: true }),
      event => events.push(event),
      40,
      undefined,
      () => {
        // No tokens should be emitted before fallback in this scenario.
      }
    );

    assert.equal(result.text, 'Recovered via non-stream fallback.');
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.payload.stream, true);
    assert.equal(requests[1]?.payload.stream, false);
    assert.ok(events.some(event => event.startsWith('provider:openai-compatible | streaming request failed before any tokens')));
  } finally {
    axiosRef.post = originalPost;
  }
});

test('openai-compatible stream HTTP 400 falls back to non-stream response', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://192.168.0.224:8085/v1/chat/completions',
    model: '/home/dan/extra/huggingface_models/qwen3.8/Qwen3.8-27B-UD-Q4_K_M.gguf',
    temperature: 0.2
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const events: string[] = [];

  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{
      data: {
        choices: Array<{ message: { role: 'assistant'; content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    }>;
  };

  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    if (payload.stream === true) {
      const error = new Error('Request failed with status code 400') as Error & {
        code?: string;
        isAxiosError?: boolean;
        response?: { status: number; statusText: string; data: unknown };
      };
      error.isAxiosError = true;
      error.response = {
        status: 400,
        statusText: 'Bad Request',
        data: {
          error: {
            message: 'streaming not supported for this endpoint'
          }
        }
      };
      throw error;
    }

    return {
      data: {
        choices: [{ message: { role: 'assistant', content: 'Recovered after HTTP 400 stream rejection.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }
      }
    };
  };

  try {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Return the summary.' }],
      [],
      async () => ({ ok: true }),
      event => events.push(event),
      40,
      undefined,
      () => {
        // No streamed tokens arrive before the HTTP error.
      }
    );

    assert.equal(result.text, 'Recovered after HTTP 400 stream rejection.');
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.payload.stream, true);
    assert.equal(requests[1]?.payload.stream, false);
    assert.ok(events.some(event => event.startsWith('provider:openai-compatible | streaming request failed before any tokens')));
  } finally {
    axiosRef.post = originalPost;
  }
});

test('openai-compatible retries with compacted history only after context overflow error', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: 'gpt-test',
    temperature: 0.2,
    contextWindowTokens: 1200
  };

  const longText = 'This is a long repeated transcript chunk to make the history large enough to exceed the configured context window. '.repeat(80);
  const history = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `${index + 1}. ${longText}`
  }));

  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{
      data: {
        choices: Array<{ message: { role: 'assistant'; content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    }>;
  };

  const originalPost = axiosRef.post;
  const firstError = new Error('Request failed with status code 400') as Error & {
    isAxiosError?: boolean;
    response?: { status: number; statusText: string; data: unknown };
  };
  firstError.isAxiosError = true;
  firstError.response = {
    status: 400,
    statusText: 'Bad Request',
    data: {
      error: {
        message: 'request (131176 tokens) exceeds the available context size (131072 tokens), try increasing it',
        type: 'exceed_context_size_error'
      }
    }
  };

  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    if (requests.length === 1) {
      throw firstError;
    }
    return {
      data: {
        choices: [{ message: { role: 'assistant', content: 'Compact reply.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
      }
    };
  };

  try {
    const result = await chatWithTools(
      config,
      history,
      [],
      async () => ({ ok: true }),
      () => undefined
    );

    assert.equal(result.text, 'Compact reply.');
    assert.equal(requests.length, 2);
    const firstAttempt = requests[0]?.payload.messages as Array<{ role?: string; content?: string }> | undefined;
    const secondAttempt = requests[1]?.payload.messages as Array<{ role?: string; content?: string }> | undefined;
    const firstSerialized = JSON.stringify(firstAttempt ?? []);
    const secondSerialized = JSON.stringify(secondAttempt ?? []);

    assert.ok(firstSerialized.includes(longText.slice(0, 80)));
    assert.ok(!firstSerialized.includes('Earlier context summary:'));
    assert.ok(secondSerialized.length < firstSerialized.length);
  } finally {
    axiosRef.post = originalPost;
  }
});
