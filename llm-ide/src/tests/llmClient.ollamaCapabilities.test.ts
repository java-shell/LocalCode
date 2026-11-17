import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chatWithTools } from '../backend/llmClient';
import type { LLMConfig, ToolDefinition } from '../shared/types';

const tool: ToolDefinition = {
  type: 'function',
  function: { name: 'git_status', description: 'Read status.', parameters: { type: 'object', properties: {} } }
};

/** Local HTTP fixture exercises real Axios JSON/stream errors; snapshots contain synthetic data only. */
async function withOllamaServer(
  respond: (payload: Record<string, any>, requestNumber: number) => { status?: number; body: string },
  run: (endpoint: string, requests: Array<Record<string, any>>) => Promise<void>
): Promise<void> {
  const requests: Array<Record<string, any>> = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    const result = respond(payload, requests.length);
    response.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
    response.end(result.body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/api/chat`, requests); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

/** Minimal successful native response works as JSON or one NDJSON streaming chunk. */
function reply(content = 'Hello.'): string {
  return JSON.stringify({ message: { role: 'assistant', content }, done: true, prompt_eval_count: 4, eval_count: 2 }) + '\n';
}

for (const stream of [true, false]) {
  test(`Ollama completion-only model recovers thinking and tool capability failures (stream=${stream})`, async () => {
    await withOllamaServer(payload => {
      if (payload.think === true) return { status: 400, body: JSON.stringify({ error: '"foundation-sec" does not support thinking' }) };
      if (payload.tools?.length) return { status: 400, body: JSON.stringify({ error: 'foundation-sec does not support tools' }) };
      return { body: reply() };
    }, async (endpoint, requests) => {
      const config: LLMConfig = { provider: 'ollama', endpoint, model: 'foundation-sec', temperature: 0.2,
        ollamaThink: true, ollamaStreaming: stream, ollamaParameters: { keep_alive: '10m' } };
      const events: string[] = [];
      const tokens: string[] = [];
      let executions = 0;
      const result = await chatWithTools(config, [{ role: 'user', content: 'Say hello.' }], [tool],
        async () => { executions += 1; }, event => events.push(event), 1, undefined, token => tokens.push(token));
      assert.equal(result.text, 'Hello.');
      assert.equal(result.usage.requests, 1, 'rejected requests consume neither usage nor work turns');
      assert.equal(executions, 0);
      assert.equal(requests.length, 3);
      assert.equal(requests[0].think, true);
      assert.equal(Object.prototype.hasOwnProperty.call(requests[1], 'think'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(requests[2], 'think'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(requests[2], 'tools'), false);
      assert.ok(requests.every(payload => payload.stream === stream && payload.keep_alive === '10m'));
      assert.deepEqual(requests[0].messages, requests[2].messages);
      assert.equal(config.ollamaThink, true, 'do not rewrite persisted preferences');
      assert.equal(config.ollamaParameters?.keep_alive, '10m');
      assert.ok(events.some(event => /does not support thinking/i.test(event)));
      assert.ok(events.some(event => /text-only/i.test(event)));
      if (stream) assert.deepEqual(tokens, ['Hello.']);
    });
  });

  test(`Ollama preserves disabled thinking for compatible models (stream=${stream})`, async () => {
    await withOllamaServer(() => ({ body: reply() }), async (endpoint, requests) => {
      await chatWithTools({ provider: 'ollama', endpoint, model: 'qwen3', temperature: 0.2,
        ollamaThink: false, ollamaStreaming: stream }, [{ role: 'user', content: 'Hello.' }], [tool], async () => undefined);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].think, false);
      assert.equal(requests[0].tools.length, 1);
    });
  });

  for (const status of [400, 500]) {
    test(`Ollama reports a bounded readable HTTP ${status} error without inappropriate retries (stream=${stream})`, async () => {
      const detail = status === 500 ? 'does not support thinking' : 'invalid parameter';
      await withOllamaServer(() => ({ status, body: JSON.stringify({ error: detail }) }), async (endpoint, requests) => {
        await assert.rejects(chatWithTools({ provider: 'ollama', endpoint, model: 'foundation-sec', temperature: 0.2,
          ollamaThink: true, ollamaStreaming: stream }, [{ role: 'user', content: 'Hello.' }], [], async () => undefined), error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, new RegExp(`status=${status}`));
          assert.ok(error.message.includes(detail), error.message);
          assert.doesNotMatch(error.message, /_readableState|socket|_events/);
          return true;
        });
        assert.equal(requests.length, 1);
      });
    });
  }

  test(`Ollama retries a rejected capability only once (stream=${stream})`, async () => {
    await withOllamaServer(() => ({ status: 400, body: '{"error":"foundation-sec does not support thinking"}' }), async (endpoint, requests) => {
      await assert.rejects(chatWithTools({ provider: 'ollama', endpoint, model: 'foundation-sec', temperature: 0.2,
        ollamaThink: false, ollamaStreaming: stream }, [{ role: 'user', content: 'Hello.' }], [], async () => undefined), /does not support thinking/);
      assert.equal(requests.length, 2);
      assert.equal(Object.prototype.hasOwnProperty.call(requests[1], 'think'), false);
    });
  });

  test(`Ollama retains capability recovery through summary and Side-Bar requests (stream=${stream})`, async () => {
    await withOllamaServer((payload, number) => {
      if (payload.think === true) return { status: 400, body: '{"error":"foundation-sec does not support thinking"}' };
      if (payload.tools?.length) return { status: 400, body: '{"error":"foundation-sec does not support tools"}' };
      return { body: reply(number === 3 ? '' : 'Summary.') };
    }, async (endpoint, requests) => {
      let boundaries = 0;
      const result = await chatWithTools({ provider: 'ollama', endpoint, model: 'foundation-sec', temperature: 0.2,
        ollamaThink: true, ollamaStreaming: stream }, [{ role: 'user', content: 'Hello.' }], [tool], async () => undefined,
        undefined, 1, undefined, undefined, {
          atSafeBoundary: async respond => {
            boundaries += 1;
            if (boundaries === 2) assert.equal(await respond('Status?'), 'Summary.');
          }
        });
      assert.equal(result.text, 'Summary.');
      assert.equal(result.usage.requests, 3);
      assert.equal(requests.length, 5);
      for (const payload of requests.slice(2)) {
        assert.equal(Object.prototype.hasOwnProperty.call(payload, 'think'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(payload, 'tools'), false);
      }
    });
  });

  test(`Ollama capability fallback respects cancellation (stream=${stream})`, async () => {
    const controller = new AbortController();
    await withOllamaServer(() => ({ status: 400, body: '{"error":"foundation-sec does not support thinking"}' }), async (endpoint, requests) => {
      await assert.rejects(chatWithTools({ provider: 'ollama', endpoint, model: 'foundation-sec', temperature: 0.2,
        ollamaThink: true, ollamaStreaming: stream }, [{ role: 'user', content: 'Hello.' }], [], async () => undefined,
        event => { if (/does not support thinking/.test(event)) controller.abort(); }, 1, controller.signal), /cancel/i);
      assert.equal(requests.length, 1);
    });
  });
}

test('Ollama oversized streamed HTTP errors are bounded and do not trigger capability recovery', async () => {
  await withOllamaServer(() => ({ status: 400, body: JSON.stringify({ error: 'x'.repeat(70000) + ' does not support thinking' }) }), async (endpoint, requests) => {
    await assert.rejects(chatWithTools({ provider: 'ollama', endpoint, model: 'foundation-sec', temperature: 0.2,
      ollamaThink: true, ollamaStreaming: true }, [{ role: 'user', content: 'Hello.' }], [], async () => undefined), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /exceeded 64 KiB/);
        assert.ok(error.message.length < 1000);
        return true;
      });
    assert.equal(requests.length, 1);
  });
});