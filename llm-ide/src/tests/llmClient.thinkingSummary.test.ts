import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { chatWithTools } from '../backend/llmClient';
import type { ChatMessage, LLMConfig } from '../shared/types';

interface MockOllamaResponse {
  data: {
    message: {
      role: 'assistant';
      content: string;
      thinking?: string;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: unknown;
        };
      }>;
    };
    prompt_eval_count: number;
    eval_count: number;
  };
}

/**
 * Replace axios.post for one test and restore it afterward.
 * Inputs: ordered mock responses and a callback containing assertions.
 * Side effects: temporarily mutates the shared axios client; callers must not run concurrently.
 */
async function withMockedAxiosPost(
  responses: MockOllamaResponse[],
  callback: (requests: Array<{ url: string; payload: Record<string, unknown> }>) => Promise<void>
): Promise<void> {
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<MockOllamaResponse>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (url, payload) => {
    requests.push({ url, payload });
    const response = responses[requests.length - 1];
    if (!response) {
      throw new Error('Unexpected extra Ollama request.');
    }
    return response;
  };

  try {
    await callback(requests);
  } finally {
    axiosRef.post = originalPost;
  }
}

test('thought-only Ollama exit requests a final summary with thinking disabled', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: true
  };
  const initialMessages: ChatMessage[] = [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'Inspect the issue and report the result.' }
  ];
  const events: string[] = [];

  await withMockedAxiosPost([
    {
      data: {
        message: { role: 'assistant', content: '', thinking: 'I completed the analysis.' },
        prompt_eval_count: 10,
        eval_count: 5
      }
    },
    {
      data: {
        message: { role: 'assistant', content: 'The issue was identified and the final result is ready.' },
        prompt_eval_count: 14,
        eval_count: 8
      }
    }
  ], async requests => {
    const result = await chatWithTools(
      config,
      initialMessages,
      [],
      async () => ({ ok: true }),
      event => events.push(event)
    );

    assert.equal(result.text, 'The issue was identified and the final result is ready.');
    assert.equal(result.usage.requests, 2);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].payload.think, true);
    assert.equal(requests[1].payload.think, false);
    assert.equal(requests[1].payload.tools, undefined);

    const summaryMessages = requests[1].payload.messages as ChatMessage[];
    assert.equal(summaryMessages[0]?.role, 'system');
    assert.equal(summaryMessages.at(-1)?.role, 'user');
    assert.match(summaryMessages.at(-1)?.content ?? '', /provide the final results summary/i);
    assert.ok(events.some(event => event.startsWith('thinking:')));
    assert.ok(events.includes('final-summary:received:thinking-only-output'));
  });
});

test('thought-only recovery formats a JSON summary as readable Markdown', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: true
  };

  await withMockedAxiosPost([
    {
      data: {
        message: { role: 'assistant', content: '', thinking: 'The work is complete.' },
        prompt_eval_count: 8,
        eval_count: 4
      }
    },
    {
      data: {
        message: {
          role: 'assistant',
          content: '{"summary":"Fixed the issue.","changes":["Updated request handling","Added coverage"],"status":"complete"}'
        },
        prompt_eval_count: 12,
        eval_count: 9
      }
    }
  ], async () => {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Fix the issue and report the result.' }],
      [],
      async () => ({ ok: true })
    );

    assert.equal(result.text.includes('{"summary"'), false);
    assert.match(result.text, /Fixed the issue\./);
    assert.match(result.text, /## Changes/);
    assert.match(result.text, /- Updated request handling/);
    assert.match(result.text, /Status: complete/);
  });
});

test('missing assistant message triggers final-summary recovery', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: true
  };
  const events: string[] = [];

  await withMockedAxiosPost([
    {
      data: {
        message: undefined as unknown as { role: 'assistant'; content: string; thinking?: string },
        prompt_eval_count: 7,
        eval_count: 2
      }
    },
    {
      data: {
        message: { role: 'assistant', content: 'Final summary after silent exit.' },
        prompt_eval_count: 11,
        eval_count: 6
      }
    }
  ], async requests => {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Complete the task and summarize.' }],
      [],
      async () => ({ ok: true }),
      event => events.push(event)
    );

    assert.equal(result.text, 'Final summary after silent exit.');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].payload.think, false);
    assert.ok(events.includes('final-summary:received:missing-assistant-message'));
  });
});

test('repeated identical tool calls stop session and request final summary with thinking disabled', async () => {
  const config: LLMConfig = {
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen3',
    temperature: 0.2,
    ollamaThink: true,
    ollamaStreaming: false
  };

  const events: string[] = [];
  const executedTools: Array<{ name: string; args: unknown }> = [];

  await withMockedAxiosPost([
    {
      data: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              function: {
                name: 'read_file',
                arguments: { path: 'README.md', startLine: 1, endLine: 50 }
              }
            }
          ]
        },
        prompt_eval_count: 10,
        eval_count: 5
      }
    },
    {
      data: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-2',
              function: {
                name: 'read_file',
                arguments: { path: 'README.md', startLine: 1, endLine: 50 }
              }
            }
          ]
        },
        prompt_eval_count: 10,
        eval_count: 5
      }
    },
    {
      data: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-3',
              function: {
                name: 'read_file',
                arguments: { path: 'README.md', startLine: 1, endLine: 50 }
              }
            }
          ]
        },
        prompt_eval_count: 10,
        eval_count: 5
      }
    },
    {
      data: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-4',
              function: {
                name: 'read_file',
                arguments: { path: 'README.md', startLine: 1, endLine: 50 }
              }
            }
          ]
        },
        prompt_eval_count: 10,
        eval_count: 5
      }
    },
    {
      data: {
        message: {
          role: 'assistant',
          content: 'Stopped loop. Completed: initial file read. Remaining: apply fix after user confirmation. Next: choose a different tool or update arguments.'
        },
        prompt_eval_count: 12,
        eval_count: 8
      }
    }
  ], async requests => {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Inspect README and continue.' }],
      [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                startLine: { type: 'number' },
                endLine: { type: 'number' }
              }
            }
          }
        }
      ],
      async (name, args) => {
        executedTools.push({ name, args });
        return { ok: true, content: 'file chunk' };
      },
      event => events.push(event),
      40
    );

    assert.equal(executedTools.length, 1);
    assert.equal(requests.length, 5);
    assert.equal(requests[4]?.payload.think, false);
    assert.equal(requests[4]?.payload.tools, undefined);
    assert.ok(events.some(event => event.startsWith('tool-repeat-threshold:read_file:4')));
    assert.ok(events.includes('final-summary:received:tool-repeat-threshold'));
    assert.match(result.text, /Stopped loop\./i);
    assert.match(result.text, /Completed:/i);
    assert.equal(result.continuationSummary?.length ? true : false, true);
  });
});