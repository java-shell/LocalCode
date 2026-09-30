import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import axios from 'axios';
import { chatWithTools } from '../backend/llmClient';
import type { ChatMessage, LLMConfig } from '../shared/types';

interface MockStreamResponse {
  data: EventEmitter;
}

/**
 * Replace axios.post with a streamed Ollama response for one test.
 * Inputs: a stream emitter that the test can drive and a callback for assertions.
 * Side effects: temporarily mutates the shared axios client.
 */
async function withMockedOllamaStreamPost(
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

test('ollama streaming emits incremental assistant tokens before completion', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: false,
    ollamaStreaming: true
  };
  const stream = new EventEmitter();
  const tokens: string[] = [];

  await withMockedOllamaStreamPost(stream, async requests => {
    const resultPromise = chatWithTools(
      config,
      [{ role: 'user', content: 'Write a short hello.' }],
      [],
      async () => ({ ok: true }),
      undefined,
      40,
      undefined,
      token => tokens.push(token)
    );

    setImmediate(() => {
      stream.emit(
        'data',
        Buffer.from(
          '{"message":{"role":"assistant","content":"Hel"},"prompt_eval_count":12,"eval_count":1}\n' +
          '{"message":{"role":"assistant","content":"lo"},"prompt_eval_count":12,"eval_count":2,"done":true}\n'
        )
      );
      stream.emit('end');
    });

    const result = await resultPromise;

    assert.equal(result.text, 'Hello');
    assert.deepEqual(tokens, ['Hel', 'lo']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.payload.stream, true);
  });
});

test('ollama streaming flag false keeps the legacy completion-only request path', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: false,
    ollamaStreaming: false
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{ data: { message: { role: 'assistant'; content: string }; prompt_eval_count: number; eval_count: number } }>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    return {
      data: {
        message: { role: 'assistant', content: 'Legacy reply.' },
        prompt_eval_count: 10,
        eval_count: 5
      }
    };
  };

  try {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Return a brief response.' }],
      [],
      async () => ({ ok: true })
    );

    assert.equal(result.text, 'Legacy reply.');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.payload.stream, false);
  } finally {
    axiosRef.post = originalPost;
  }
});

test('ollama request includes advanced ollama options when provided', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.42,
    ollamaThink: false,
    ollamaStreaming: false,
    ollamaOptions: {
      repeat_penalty: 1.2,
      top_k: 40,
      top_p: 0.93,
      seed: 13
    }
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{ data: { message: { role: 'assistant'; content: string }; prompt_eval_count: number; eval_count: number } }>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    return {
      data: {
        message: { role: 'assistant', content: 'Configured.' },
        prompt_eval_count: 8,
        eval_count: 3
      }
    };
  };

  try {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Use advanced settings.' }],
      [],
      async () => ({ ok: true })
    );

    assert.equal(result.text, 'Configured.');
    assert.equal(requests.length, 1);
    const options = requests[0]?.payload.options as Record<string, unknown>;
    assert.equal(options.temperature, 0.42);
    assert.equal(options.repeat_penalty, 1.2);
    assert.equal(options.top_k, 40);
    assert.equal(options.top_p, 0.93);
    assert.equal(options.seed, 13);
  } finally {
    axiosRef.post = originalPost;
  }
});

test('ollama request includes top-level ollama request parameters when provided', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: false,
    ollamaStreaming: false,
    ollamaParameters: {
      keep_alive: '10m',
      format: 'json'
    }
  };
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<{ data: { message: { role: 'assistant'; content: string }; prompt_eval_count: number; eval_count: number } }>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    return {
      data: {
        message: { role: 'assistant', content: 'Top-level configured.' },
        prompt_eval_count: 8,
        eval_count: 3
      }
    };
  };

  try {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Use top-level request settings.' }],
      [],
      async () => ({ ok: true })
    );

    assert.equal(result.text, 'Top-level configured.');
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.payload.keep_alive, '10m');
    assert.equal(requests[0]?.payload.format, 'json');
  } finally {
    axiosRef.post = originalPost;
  }
});
