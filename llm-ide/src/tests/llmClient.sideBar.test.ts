import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import axios from 'axios';
import { ChatSideBar } from '../backend/chatSideBar';
import { chatWithTools } from '../backend/llmClient';
import type { ChatMessage, LLMConfig, ToolDefinition } from '../shared/types';

const tool: ToolDefinition = {
  type: 'function',
  function: { name: 'read_file', description: 'Read evidence', parameters: { type: 'object', properties: {} } }
};

/** Controllable lifecycle milestone without wall-clock sleeps or provider I/O. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/**
 * Mock both supported wire protocols, snapshotting requests before the live
 * history mutates. Streaming emits one complete OpenAI event next tick.
 * Restores axios even on assertion failure; fixtures contain no private data.
 */
async function withResponses(
  responses: ChatMessage[],
  run: (requests: Array<Record<string, any>>) => Promise<void>,
  validate?: (payload: Record<string, any>) => void
): Promise<void> {
  const requests: Array<Record<string, any>> = [];
  const original = axios.post;
  axios.post = (async (_url: string, payload: Record<string, any>) => {
    requests.push(JSON.parse(JSON.stringify(payload)));
    validate?.(payload);
    const message = responses.shift();
    assert.ok(message, 'unexpected extra model request');
    const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };
    if (payload.stream) {
      const stream = new EventEmitter();
      setImmediate(() => {
        stream.emit('data', Buffer.from(`data: ${JSON.stringify({
          choices: [{ delta: message, finish_reason: 'stop' }], usage
        })}\n\ndata: [DONE]\n\n`));
        stream.emit('end');
      });
      return { data: stream };
    }
    return { data: { choices: [{ message }], usage, message, prompt_eval_count: 7, eval_count: 3 } };
  }) as typeof axios.post;
  try { await run(requests); }
  finally { axios.post = original; }
}

/** Two calls in one assistant turn prove pausing never strands an unmatched tool result. */
function toolBatch(): ChatMessage {
  return {
    role: 'assistant', content: '',
    tool_calls: ['first', 'second'].map(id => ({
      id, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: id }) }
    }))
  };
}

for (const provider of ['openai-compatible', 'ollama'] as const) {
  test(`${provider}: Side-Bar sees complete tool batch, retains exchanges, and consumes no work turns`, async () => {
    const paused = deferred<void>();
    const gate = new ChatSideBar('session', state => {
      if (state.mode === 'paused') paused.resolve();
    });
    const config: LLMConfig = {
      provider, endpoint: 'http://localhost:1234/v1/chat/completions', model: 'test',
      temperature: 0.2, ollamaStreaming: false,
      openaiParameters: { functions: [{ name: 'legacy' }], function_call: 'auto' }
    };
    await withResponses([
      toolBatch(),
      { role: 'assistant', content: 'Both files read.' },
      { role: 'assistant', content: 'I will keep the API unchanged.' },
      { role: 'assistant', content: 'Work complete.' }
    ], async requests => {
      let calls = 0;
      const events: string[] = [];
      const running = chatWithTools(config, [
        { role: 'system', content: 'Preserve the public API.' },
        { role: 'user', content: 'Implement the fix.' }
      ], [tool], async () => {
        calls += 1;
        if (calls === 1) gate.start();
        assert.equal(gate.state.mode, 'pending');
        return { evidence: `file-${calls}` };
      }, event => events.push(event), 2, undefined, undefined, {
        atSafeBoundary: reply => gate.atBoundary(reply)
      });
      await paused.promise;
      try {
        assert.equal(calls, 2);
        assert.equal(requests.length, 1, 'no next work request while paused');
        assert.equal((await gate.message('Status?')).text, 'Both files read.');
        assert.equal((await gate.message('Keep API unchanged.')).accepted, true);
        const sideRequest = requests[1];
        assert.equal(sideRequest.tools, undefined);
        assert.equal(sideRequest.tool_choice, undefined);
        assert.equal(sideRequest.functions, undefined);
        assert.equal(sideRequest.function_call, undefined);
        assert.ok(sideRequest.messages.some((m: ChatMessage) => m.content.includes('Preserve the public API.')));
        assert.equal(sideRequest.messages.filter((m: ChatMessage) => m.role === 'tool').length, 2);
        assert.ok(JSON.stringify(sideRequest.messages).includes('file-2'));
        assert.ok(JSON.stringify(requests[2].messages).includes('Both files read.'));
      } finally { gate.resume(); }
      const result = await running;
      assert.equal(result.text, 'Work complete.');
      assert.equal(calls, 2);
      assert.equal(requests.length, 4);
      assert.deepEqual(events.filter(value => value.startsWith('llm-turn:')), ['llm-turn:1/2', 'llm-turn:2/2']);
      assert.equal(result.debug?.turns.length, 2);
      assert.equal(result.usage.requests, 4, 'Side-Bar tokens still count as real model usage');
      assert.ok(JSON.stringify(requests[3].messages).includes('Keep API unchanged.'));
      assert.ok(JSON.stringify(requests[3].messages).includes('Side-Bar has ended'));
      assert.ok(requests[3].messages.every((message: ChatMessage) => message.sideBar === undefined));
      assert.equal(requests[3].tools.length, 1, 'work tools restored');
      assert.equal(result.debug?.finalMessages.filter(m => m.content === 'Both files read.').length, 1);
    });
  });
}

test('Side-Bar on the last tool turn pauses before the budget summary and survives a rejected tool response', async () => {
  const paused = deferred<void>();
  const gate = new ChatSideBar('session', state => { if (state.mode === 'paused') paused.resolve(); });
  const badReply = toolBatch();
  badReply.content = 'Trying an unsolicited tool';
  await withResponses([toolBatch(), badReply, { role: 'assistant', content: 'Safe reply.' },
    { role: 'assistant', content: 'Budget summary.' }], async requests => {
    let tools = 0;
    const running = chatWithTools({
      provider: 'openai-compatible', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'test', temperature: 0.2
    }, [{ role: 'user', content: 'Fix.' }], [tool], async () => {
      tools += 1;
      gate.start();
      return { ok: true };
    }, undefined, 1, undefined, undefined, { atSafeBoundary: reply => gate.atBoundary(reply) });
    await paused.promise;
    try {
      await assert.rejects(gate.message('Status?'), /tools are disabled/);
      assert.equal(gate.state.mode, 'paused');
      assert.equal((await gate.message('Try text.')).text, 'Safe reply.');
      assert.equal(requests.length, 3);
    } finally { gate.resume(); }
    const result = await running;
    assert.equal(tools, 2, 'unsolicited Side-Bar tools were never executed');
    assert.equal(result.toolBudgetExhausted, true);
    assert.equal(result.debug?.turns.length, 1);
    assert.ok(JSON.stringify(requests[3].messages).includes('Safe reply.'));
    assert.ok(!JSON.stringify(requests[3].messages).includes('Trying an unsolicited tool'));
  });
});

test('stopping a paused chat cancels the same run without another model request', async () => {
  const paused = deferred<void>();
  const abort = new AbortController();
  const gate = new ChatSideBar('session', state => { if (state.mode === 'paused') paused.resolve(); });
  await withResponses([toolBatch()], async requests => {
    const running = chatWithTools({ provider: 'openai-compatible', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'test', temperature: 0.2 },
      [{ role: 'user', content: 'Fix.' }], [tool], async () => { gate.start(); return {}; },
      undefined, 2, abort.signal, undefined, { atSafeBoundary: reply => gate.atBoundary(reply, abort.signal) });
    await paused.promise;
    abort.abort();
    await assert.rejects(running, /canceled/);
    assert.equal(requests.length, 1);
  });
});

test('a pause requested during a final text response is honored before the run returns', async () => {
  const gate = new ChatSideBar('session', () => {});
  await withResponses([{ role: 'assistant', content: 'Finished.' },
    { role: 'assistant', content: 'Here is the update.' }], async requests => {
    const result = await chatWithTools({
      provider: 'openai-compatible', endpoint: 'http://localhost:1234/v1/chat/completions', model: 'test', temperature: 0.2
    }, [{ role: 'user', content: 'Fix.' }], [], async () => ({}), () => {
      // This callback runs after the initial boundary, just before the request.
      gate.start();
    }, 1, undefined, undefined, {
      atSafeBoundary: async reply => {
        const waiting = gate.atBoundary(reply);
        if (gate.state.mode === 'paused') {
          assert.equal((await gate.message('Update?')).text, 'Here is the update.');
          gate.resume();
        }
        await waiting;
      }
    });
    assert.equal(result.text, 'Finished.');
    assert.equal(result.debug?.turns.length, 1);
    assert.equal(requests.length, 2);
    assert.ok(result.debug?.finalMessages.some(message => message.content === 'Here is the update.'));
  });
});

/** Model the llama.cpp/Qwen template constraint without a live endpoint or private conversation. */
function requireLeadingSystem(payload: Record<string, any>): void {
  const misplaced = payload.messages.some((message: ChatMessage, index: number) => index > 0 && message.role === 'system');
  if (misplaced) {
    throw new axios.AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 500, statusText: 'Internal Server Error', headers: {}, config: {} as any,
      data: { error: { message: 'System message must be at the beginning.' } }
    });
  }
}

test('strict OpenAI templates accept Side-Bar and resumed work without losing tool history or user decisions', async () => {
  const gate = new ChatSideBar('strict-session', () => {});
  let toolCount = 0;
  const config: LLMConfig = {
    provider: 'openai-compatible', endpoint: 'http://provider.invalid/chat/completions',
    model: 'qwen-test', temperature: 0.2
  };
  await withResponses([
    toolBatch(), { role: 'assistant', content: 'Both files read.' },
    { role: 'assistant', content: 'I will preserve the API.' },
    { role: 'assistant', content: 'Work complete.' }
  ], async requests => {
    const result = await chatWithTools(config, [
      { role: 'system', content: 'Preserve the public API.' },
      { role: 'user', content: 'Implement the fix.' }
    ], [tool], async () => { toolCount += 1; gate.start(); return { evidence: `file-${toolCount}` }; },
    undefined, 2, undefined, undefined, {
      atSafeBoundary: async reply => {
        const waiting = gate.atBoundary(reply);
        if (gate.state.mode === 'paused') {
          try {
            assert.equal((await gate.message('Status?')).text, 'Both files read.');
            assert.equal((await gate.message('Keep API unchanged.')).text, 'I will preserve the API.');
          } finally { gate.resume(); }
        }
        await waiting;
      }
    });
    assert.equal(result.text, 'Work complete.');
    assert.equal(requests.length, 4);
    assert.equal(toolCount, 2);
    for (const request of requests) {
      assert.equal(request.messages[0].role, 'system');
      assert.equal(request.messages.filter((message: ChatMessage) => message.role === 'system').length, 1);
      assert.ok(request.messages[0].content.includes('Preserve the public API.'));
    }
    assert.ok(requests[1].messages[0].content.includes('Side-Bar mode'));
    assert.ok(requests[3].messages[0].content.includes('Side-Bar has ended'));
    assert.ok(!requests[3].messages[0].content.includes('Side-Bar mode'), 'temporary pause instruction must not persist');
    assert.ok(JSON.stringify(requests[3].messages).includes('Keep API unchanged.'));
    assert.equal(requests[3].messages.filter((message: ChatMessage) => message.role === 'tool').length, 2);
    assert.equal(result.debug?.turns.length, 2);
  }, requireLeadingSystem);
});

test('Side-Bar provider errors include response detail but do not expose Axios request objects', async () => {
  const original = axios.post;
  const secret = 'private-test-api-key';
  axios.post = (async () => {
    throw new axios.AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE', {
      headers: { Authorization: `Bearer ${secret}` }, data: 'private-test-conversation'
    } as any, undefined, {
      status: 500, statusText: 'Internal Server Error', config: {} as any, headers: {},
      data: { error: { message: 'Synthetic provider failure' } }
    });
  }) as typeof axios.post;
  try {
    await assert.rejects(chatWithTools({
      provider: 'openai-compatible', endpoint: 'http://provider.invalid/chat/completions',
      model: 'qwen-test', temperature: 0.2
    }, [{ role: 'user', content: 'Fix.' }], [], async () => ({}), undefined, 2, undefined, undefined, {
      atSafeBoundary: async reply => { await reply('Status?'); }
    }), error => {
      assert.ok(error instanceof Error);
      assert.equal(axios.isAxiosError(error), false);
      assert.match(error.message, /Side-Bar chat request failed/);
      assert.match(error.message, /status=500/);
      assert.match(error.message, /Synthetic provider failure/);
      assert.ok(!('config' in error));
      assert.ok(!JSON.stringify(error).includes(secret));
      return true;
    });
  } finally { axios.post = original; }
});