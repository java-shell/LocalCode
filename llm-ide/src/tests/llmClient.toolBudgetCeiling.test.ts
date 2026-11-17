import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { chatWithTools } from '../backend/llmClient';
import { DEFAULT_CHAT_TOOL_TURNS, MAX_TOOL_TURNS } from '../shared/toolBudget';
import type { LLMConfig } from '../shared/types';

interface MockCompletionResponse {
  data: {
    choices: Array<{ message: { role: string; content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };
}

/**
 * Replace axios.post with a single non-streaming completion for one test.
 *
 * Purpose: exercise the chat tool-turn loop offline so the budget ceiling can be
 * observed without performing hundreds of real model exchanges.
 * Inputs: a callback that runs assertions and receives the recorded requests.
 * Outputs: the callback result, with the original axios.post restored afterward.
 * Side effects: temporarily mutates the shared axios client for the callback scope.
 * Errors: propagates request errors; the original post is always restored.
 * Performance: one mocked request per turn, no network access.
 * Security/privacy: no credentials or user data are used.
 * Concurrency: not safe to run alongside other axios-mocking tests; node:test runs
 * each file in its own process so files stay isolated.
 * Rationale: the loop reports its budget as `llm-turn:<n>/<max>`, so the first
 * event proves the ceiling the loop accepted.
 */
async function withMockedCompletion(
  callback: (requests: Array<Record<string, unknown>>) => Promise<void>
): Promise<void> {
  const requests: Array<Record<string, unknown>> = [];
  const axiosRef = axios as unknown as {
    post: (url: string, payload: Record<string, unknown>) => Promise<MockCompletionResponse>;
  };
  const originalPost = axiosRef.post;
  axiosRef.post = async (_url, payload) => {
    requests.push(payload);
    return {
      data: {
        choices: [{ message: { role: 'assistant', content: 'Done.' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
      }
    };
  };

  try {
    await callback(requests);
  } finally {
    axiosRef.post = originalPost;
  }
}

const config: LLMConfig = {
  provider: 'openai-compatible',
  endpoint: 'http://localhost:1234/v1/chat/completions',
  model: 'gpt-test',
  temperature: 0.2
};

/**
 * Run one tool-free chat exchange and capture the loop's reported budget.
 *
 * Purpose: read the `llm-turn:1/<max>` event so a test can assert the ceiling the
 * loop actually used without running that many turns.
 * Inputs: the maxToolTurns value under test.
 * Outputs: the events emitted by chatWithTools.
 * Side effects: performs one mocked completion request.
 * Errors: propagates chatWithTools errors.
 * Performance: a single mocked request regardless of the budget value.
 * Security/privacy: mocked provider only.
 * Concurrency: sequential within this file.
 * Rationale: keeps ceiling coverage cheap and deterministic.
 */
async function captureTurnEvents(maxToolTurns: number | undefined): Promise<string[]> {
  const events: string[] = [];
  await withMockedCompletion(async () => {
    const result = await chatWithTools(
      config,
      [{ role: 'user', content: 'Report the budget you are running under.' }],
      [],
      async () => ({ ok: true }),
      event => events.push(event),
      maxToolTurns
    );
    assert.equal(result.text, 'Done.');
  });
  return events;
}

test('chatWithTools runs under the shared 1000 tool-turn ceiling', async () => {
  const events = await captureTurnEvents(MAX_TOOL_TURNS);

  assert.ok(
    events.includes(`llm-turn:1/${MAX_TOOL_TURNS}`),
    `Expected the loop to report a ${MAX_TOOL_TURNS}-turn budget, got: ${events.join(' | ')}`
  );
});

test('chatWithTools clamps a requested budget above the ceiling instead of rejecting it', async () => {
  const events = await captureTurnEvents(MAX_TOOL_TURNS + 500);

  assert.ok(events.includes(`llm-turn:1/${MAX_TOOL_TURNS}`));
  assert.ok(!events.some(event => /\/(1001|1500)$/.test(event)));
});

test('chatWithTools defaults to the shared chat default when no budget is provided', async () => {
  const events = await captureTurnEvents(undefined);

  assert.ok(events.includes(`llm-turn:1/${DEFAULT_CHAT_TOOL_TURNS}`));
});

test('chatWithTools still honors a small explicit budget', async () => {
  const events = await captureTurnEvents(4);

  assert.ok(events.includes('llm-turn:1/4'));
  assert.ok(!events.some(event => event.startsWith('llm-turn:5/')));
});
