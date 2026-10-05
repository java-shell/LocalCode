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
    assert.equal(requests[0]?.url, 'http://localhost:1234/v1/chat/completions');
    assert.equal(requests[0]?.payload.stream, true);
  });
});

test('Gemini OpenAI-compatible base URL gets the chat route and canonical model ID', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'models/gemini-3.6-flash',
    temperature: 0.2
  };
  const stream = new EventEmitter();

  await withMockedOpenAIStreamPost(stream, async requests => {
    const resultPromise = chatWithTools(
      config,
      [{ role: 'user', content: 'Say hello.' }],
      [],
      async () => ({ ok: true })
    );

    setImmediate(() => {
      stream.emit('data', Buffer.from(
        'data: {"choices":[{"delta":{"content":"Hello."}}]}\n' +
        'data: {"choices":[{"finish_reason":"stop"}]}\n' +
        'data: [DONE]\n'
      ));
      stream.emit('end');
    });

    const result = await resultPromise;
    assert.equal(result.text, 'Hello.');
    assert.equal(requests[0]?.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(requests[0]?.payload.model, 'gemini-3.6-flash');
  });
});

test('Gemini thought signatures from streamed tool calls are sent back on the next turn', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-3.6-flash',
    temperature: 0.2
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{ data: EventEmitter }>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    const stream = new EventEmitter();
    const responseNumber = requests.length;
    setImmediate(() => {
      const data = responseNumber === 1
        ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"git_status","arguments":"{}"},"extra_content":{"google":{"thought_signature":"gemini-signature-1"}}}]},"finish_reason":"tool_calls"}]}\n'
        : 'data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n';
      stream.emit('data', Buffer.from(`${data}data: [DONE]\n`));
      stream.emit('end');
    });
    return { data: stream };
  };

  try {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Check git status.' }],
      [{
        type: 'function',
        function: {
          name: 'git_status',
          description: 'Read repository status.',
          parameters: { type: 'object', properties: {} }
        }
      }],
      async () => ({ ok: true }),
      undefined,
      40,
      undefined,
      () => undefined
    );

    assert.equal(result.text, 'Done.');
    assert.equal(requests.length, 2);
    const secondTurnMessages = requests[1]?.payload.messages as Array<Record<string, unknown>>;
    const assistantToolMessage = secondTurnMessages.find(message =>
      message.role === 'assistant' && Array.isArray(message.tool_calls)
    );
    assert.ok(assistantToolMessage, JSON.stringify(secondTurnMessages));
    const toolCalls = assistantToolMessage?.tool_calls as Array<Record<string, unknown>>;
    assert.deepEqual(toolCalls[0]?.extra_content, {
      google: { thought_signature: 'gemini-signature-1' }
    });
  } finally {
    axiosRef.post = originalPost;
  }
});

test('non-Gemini OpenAI-compatible providers retain model IDs and omit Gemini-only tool metadata', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'https://api.example.test/v1/chat/completions',
    model: 'models/provider-model',
    temperature: 0.2
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{ data: EventEmitter }>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    const stream = new EventEmitter();
    const responseNumber = requests.length;
    setImmediate(() => {
      const data = responseNumber === 1
        ? 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"git_status","arguments":"{}"},"extra_content":{"google":{"thought_signature":"provider-extension"}}}]},"finish_reason":"tool_calls"}]}\n'
        : 'data: {"choices":[{"delta":{"content":"Done."},"finish_reason":"stop"}]}\n';
      stream.emit('data', Buffer.from(`${data}data: [DONE]\n`));
      stream.emit('end');
    });
    return { data: stream };
  };

  try {
    await chatWithTools(
      config,
      [{ role: 'user', content: 'Check git status.' }],
      [{
        type: 'function',
        function: {
          name: 'git_status',
          description: 'Read repository status.',
          parameters: { type: 'object', properties: {} }
        }
      }],
      async () => ({ ok: true }),
      undefined,
      40,
      undefined,
      () => undefined
    );

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.payload.model, 'models/provider-model');
    const secondTurnMessages = requests[1]?.payload.messages as Array<Record<string, unknown>>;
    const assistantToolMessage = secondTurnMessages.find(message =>
      message.role === 'assistant' && Array.isArray(message.tool_calls)
    );
    assert.ok(assistantToolMessage, JSON.stringify(secondTurnMessages));
    const toolCalls = assistantToolMessage.tool_calls as Array<Record<string, unknown>>;
    assert.equal(toolCalls[0]?.extra_content, undefined);
  } finally {
    axiosRef.post = originalPost;
  }
});

test('openai-compatible stream reports a user-aborted socket reset as cancellation', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: 'gpt-test',
    temperature: 0.2
  };
  const stream = new EventEmitter();
  const controller = new AbortController();

  await withMockedOpenAIStreamPost(stream, async requests => {
    const resultPromise = chatWithTools(
      config,
      [{ role: 'user', content: 'Wait for cancellation.' }],
      [],
      async () => ({ ok: true }),
      undefined,
      40,
      controller.signal,
      () => undefined
    );

    setImmediate(() => {
      controller.abort();
      const error = new Error('aborted') as Error & { code?: string };
      error.code = 'ECONNRESET';
      stream.emit('error', error);
    });

    await assert.rejects(resultPromise, /Chat request canceled/);
    assert.equal(requests.length, 1);
  });
});

test('openai-compatible request includes advanced OpenAI parameters when provided', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: 'gpt-test',
    temperature: 0.35,
    openaiParameters: {
      presence_penalty: 0.7,
      frequency_penalty: 0.2,
      top_p: 0.9,
      seed: 42
    }
  };
  const stream = new EventEmitter();

  await withMockedOpenAIStreamPost(stream, async requests => {
    const resultPromise = chatWithTools(
      config,
      [{ role: 'user', content: 'Answer briefly.' }],
      [],
      async () => ({ ok: true })
    );

    setImmediate(() => {
      stream.emit(
        'data',
        Buffer.from(
          'data: {"choices":[{"delta":{"content":"Done."}}]}\n' +
          'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n' +
          'data: [DONE]\n'
        )
      );
      stream.emit('end');
    });

    const result = await resultPromise;
    assert.equal(result.text, 'Done.');
    assert.ok(requests.length >= 1);
    assert.ok(
      requests.some(entry =>
        entry.payload.temperature === 0.35
        && entry.payload.presence_penalty === 0.7
        && entry.payload.frequency_penalty === 0.2
        && entry.payload.top_p === 0.9
        && entry.payload.seed === 42
      )
    );
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

test('openai-compatible compaction retry fits the configured context budget', async () => {
  const config: LLMConfig = {
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: 'gpt-test',
    temperature: 0.2,
    contextWindowTokens: 1200
  };
  const longText = 'This transcript entry is intentionally oversized for a small retry context budget. '.repeat(120);
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `${index + 1}. ${longText}`
  }));
  const requests: Array<{ payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{
      data: {
        choices: Array<{ message: { role: 'assistant'; content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    }>;
  };
  const originalPost = axiosRef.post;
  const overflowError = new Error('Request failed with status code 400') as Error & {
    isAxiosError?: boolean;
    response?: { status: number; statusText: string; data: unknown };
  };
  overflowError.isAxiosError = true;
  overflowError.response = {
    status: 400,
    statusText: 'Bad Request',
    data: { error: { message: 'context window exceeded' } }
  };

  axiosRef.post = async (_url, payload) => {
    requests.push({ payload });
    if (requests.length === 1) {
      throw overflowError;
    }

    const retryMessages = payload.messages as Array<{ content?: string }>;
    const retryCharacterCount = retryMessages.reduce((total, message) => total + String(message.content ?? '').length, 0);
    assert.ok(retryCharacterCount <= 1024, `Expected compacted retry to fit 256 tokens; got ${retryCharacterCount} characters.`);
    return {
      data: {
        choices: [{ message: { role: 'assistant', content: 'Compact reply.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
      }
    };
  };

  try {
    const result = await chatWithTools(config, history, [], async () => ({ ok: true }));
    assert.equal(result.text, 'Compact reply.');
    assert.equal(requests.length, 2);
  } finally {
    axiosRef.post = originalPost;
  }
});
