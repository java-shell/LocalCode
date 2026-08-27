import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../backend/toolRuntime';
import * as llmClient from '../backend/llmClient';
import type { ChatMessage, LLMConfig, ToolDefinition } from '../shared/types';

/**
 * Temporarily replace llmClient.chatWithTools so spawn_sub_agent behavior can be tested offline.
 *
 * Purpose: provide deterministic sub-agent responses without network calls.
 * Inputs: mock implementation and asynchronous callback containing assertions.
 * Outputs: callback result with the original llmClient.chatWithTools restored afterward.
 * Side effects: mutates module export during callback scope only.
 */
async function withMockedChatWithTools(
  mockImpl: (
    config: LLMConfig,
    initialMessages: ChatMessage[],
    tools: ToolDefinition[],
    executeTool: (name: string, args: unknown) => Promise<unknown>,
    onEvent?: (message: string) => void,
    maxToolTurns?: number,
    signal?: AbortSignal,
    onToken?: (token: string) => void
  ) => Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number; requests: number } }>,
  callback: () => Promise<void>
): Promise<void> {
  const llmClientMutable = llmClient as unknown as {
    chatWithTools: typeof llmClient.chatWithTools;
  };
  const original = llmClientMutable.chatWithTools;
  llmClientMutable.chatWithTools = mockImpl as typeof llmClient.chatWithTools;
  try {
    await callback();
  } finally {
    llmClientMutable.chatWithTools = original;
  }
}

/**
 * Build a minimal runtime context for testing spawn_sub_agent policy enforcement.
 *
 * Purpose: centralize stable context defaults and keep test setup concise.
 * Inputs: optional overrides for context fields.
 * Outputs: a plain runtime context object accepted by executeTool.
 */
function makeContext(overrides?: Record<string, unknown>) {
  return {
    workspaceDir: '/mock/workspace',
    rootDir: '/mock/workspace',
    llmConfig: {
      provider: 'openai-compatible' as const,
      endpoint: 'http://localhost:11434/v1/chat/completions',
      model: 'settings-model',
      temperature: 0.2
    } as LLMConfig,
    allowedToolNames: ['spawn_sub_agent', 'read_file', 'list_dir'],
    ...(overrides ?? {})
  };
}

test('spawn_sub_agent uses dedicated sub-agent model settings and returns findings', async () => {
  await withMockedChatWithTools(async (config, initialMessages, tools, _executeTool) => {
    assert.equal(config.model, 'sub-agent-model');
    assert.equal(config.endpoint, 'http://localhost:11435/v1/chat/completions');
    assert.equal(initialMessages[0]?.role, 'system');
    assert.equal(initialMessages[1]?.role, 'user');

    const toolNames = tools.map(tool => tool.function.name).sort();
    assert.deepEqual(toolNames, ['read_file']);

    return {
      text: 'Sub-agent findings: located relevant implementation details.',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, requests: 1 }
    };
  }, async () => {
    const result = await executeTool('spawn_sub_agent', {
      prompt: 'Inspect the parser path and summarize the key issues.',
      toolNames: ['read_file', 'spawn_sub_agent'],
      maxToolTurns: 6
    }, makeContext({
      llmConfig: {
        provider: 'openai-compatible',
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'parent-model',
        temperature: 0.2
      } as LLMConfig,
      subAgentConfig: {
        provider: 'ollama',
        endpoint: 'http://localhost:11435/v1/chat/completions',
        model: 'sub-agent-model',
        temperature: 0.2
      } as LLMConfig
    }) as any) as {
      ok: boolean;
      findings: string;
      toolNames: string[];
      model?: string;
      endpoint?: string;
    };

    assert.equal(result.ok, true);
    assert.match(result.findings, /Sub-agent findings/);
    assert.deepEqual(result.toolNames, ['read_file']);
    assert.equal(result.model, 'sub-agent-model');
    assert.equal(result.endpoint, 'http://localhost:11435/v1/chat/completions');
  });
});

test('spawn_sub_agent forwards full prompt without truncation', async () => {
  const longPrompt = 'x'.repeat(6000);

  await withMockedChatWithTools(async (_config, initialMessages) => {
    const userContent = initialMessages.find(message => message.role === 'user')?.content ?? '';
    assert.match(userContent, /Scoped sub-agent task:/);
    assert.ok(userContent.includes(longPrompt));
    return {
      text: 'ok',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requests: 1 }
    };
  }, async () => {
    const result = await executeTool('spawn_sub_agent', {
      prompt: longPrompt,
      toolNames: ['read_file']
    }, makeContext() as any) as { ok: boolean };

    assert.equal(result.ok, true);
  });
});

test('spawn_sub_agent rejects child tools not allowed by parent', async () => {
  const result = await executeTool('spawn_sub_agent', {
    prompt: 'Try a disallowed tool.',
    toolNames: ['read_file', 'delete_path']
  }, makeContext() as any) as {
    ok: boolean;
    error?: string;
  };

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /not allowed by parent/i);
});

test('spawn_sub_agent blocks nested delegation', async () => {
  const result = await executeTool('spawn_sub_agent', {
    prompt: 'Attempt nested delegation.',
    toolNames: ['read_file']
  }, makeContext({ subAgentDepth: 1 }) as any) as {
    ok: boolean;
    error?: string;
  };

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /nested sub-agent/i);
});

test('spawn_sub_agent can target specific configured profile id', async () => {
  await withMockedChatWithTools(async (config) => {
    assert.equal(config.model, 'endpoint-b-model');
    assert.equal(config.endpoint, 'http://localhost:9002/v1/chat/completions');
    return {
      text: 'Profile B executed.',
      usage: { promptTokens: 8, completionTokens: 6, totalTokens: 14, requests: 1 }
    };
  }, async () => {
    const context = makeContext({
      subAgentProfiles: [
        {
          id: 'profile-a',
          label: 'Endpoint A',
          maxConcurrentSpawns: 2,
          config: {
            provider: 'openai-compatible',
            endpoint: 'http://localhost:9001/v1/chat/completions',
            model: 'endpoint-a-model',
            temperature: 0.2
          }
        },
        {
          id: 'profile-b',
          label: 'Endpoint B',
          maxConcurrentSpawns: 2,
          config: {
            provider: 'openai-compatible',
            endpoint: 'http://localhost:9002/v1/chat/completions',
            model: 'endpoint-b-model',
            temperature: 0.2
          }
        }
      ],
      subAgentActiveCounts: {}
    });

    const result = await executeTool('spawn_sub_agent', {
      profileId: 'profile-b',
      prompt: 'Run on endpoint B only.',
      toolNames: ['read_file']
    }, context as any) as { ok: boolean; endpoint?: string; model?: string };

    assert.equal(result.ok, true);
    assert.equal(result.endpoint, 'http://localhost:9002/v1/chat/completions');
    assert.equal(result.model, 'endpoint-b-model');
  });
});

test('spawn_sub_agent enforces per-profile concurrent spawn limits', async () => {
  let releaseFirstRun: (() => void) | null = null;
  const firstRunGate = new Promise<void>(resolve => {
    releaseFirstRun = resolve;
  });

  await withMockedChatWithTools(async () => {
    await firstRunGate;
    return {
      text: 'Limited profile run completed.',
      usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9, requests: 1 }
    };
  }, async () => {
    const activeCounts: Record<string, number> = {};
    const context = makeContext({
      subAgentProfiles: [
        {
          id: 'limited-profile',
          label: 'Limited',
          maxConcurrentSpawns: 1,
          config: {
            provider: 'openai-compatible',
            endpoint: 'http://localhost:9100/v1/chat/completions',
            model: 'limited-model',
            temperature: 0.2
          }
        }
      ],
      subAgentActiveCounts: activeCounts
    });

    const firstPromise = executeTool('spawn_sub_agent', {
      profileId: 'limited-profile',
      prompt: 'First allowed run.',
      toolNames: ['read_file']
    }, context as any) as Promise<{ ok: boolean }>;

    await Promise.resolve();

    const second = await executeTool('spawn_sub_agent', {
      profileId: 'limited-profile',
      prompt: 'Second run should be blocked while first is active.',
      toolNames: ['read_file']
    }, context as any) as { ok: boolean; error?: string };
    assert.equal(second.ok, false);
    assert.match(second.error ?? '', /max concurrent spawns/i);

    assert.ok(releaseFirstRun);
    releaseFirstRun?.();

    const first = await firstPromise;
    assert.equal(first.ok, true);
  });
});

test('spawn_sub_agent can fan out parallel tasks in one tool call', async () => {
  let callCount = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });

  await withMockedChatWithTools(async (_config, messages) => {
    callCount += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);

    if (callCount <= 2) {
      await gate;
    }

    inFlight -= 1;
    const userPrompt = messages.find(message => message.role === 'user')?.content ?? '';
    return {
      text: `Handled: ${userPrompt.slice(0, 40)}`,
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, requests: 1 }
    };
  }, async () => {
    const context = makeContext({
      subAgentProfiles: [
        {
          id: 'parallel-profile',
          label: 'Parallel',
          maxConcurrentSpawns: 2,
          config: {
            provider: 'openai-compatible',
            endpoint: 'http://localhost:9200/v1/chat/completions',
            model: 'parallel-model',
            temperature: 0.2
          }
        }
      ],
      subAgentActiveCounts: {}
    });

    const batchPromise = executeTool('spawn_sub_agent', {
      maxParallel: 2,
      tasks: [
        {
          profileId: 'parallel-profile',
          prompt: 'Task A investigation',
          toolNames: ['read_file']
        },
        {
          profileId: 'parallel-profile',
          prompt: 'Task B investigation',
          toolNames: ['read_file']
        }
      ]
    }, context as any) as Promise<{
      ok: boolean;
      findings: string;
      batch?: { total: number; succeeded: number; failed: number; maxParallel: number };
    }>;

    for (let i = 0; i < 20 && callCount < 2; i += 1) {
      await Promise.resolve();
    }

    assert.equal(callCount, 2);
    assert.ok(release);
    release?.();

    const result = await batchPromise;
    assert.equal(result.ok, true);
    assert.ok(result.batch);
    assert.equal(result.batch?.total, 2);
    assert.equal(result.batch?.succeeded, 2);
    assert.equal(result.batch?.failed, 0);
    assert.equal(result.batch?.maxParallel, 2);
    assert.match(result.findings, /Task 1:/);
    assert.match(result.findings, /Task 2:/);
    assert.equal(peakInFlight, 2);
  });
});

test('spawn_sub_agent clamps maxToolTurns to 50', async () => {
  await withMockedChatWithTools(async (
    _config: LLMConfig,
    _initialMessages: ChatMessage[],
    _tools: ToolDefinition[],
    _executeTool: (name: string, args: unknown) => Promise<unknown>,
    _onEvent?: (message: string) => void,
    maxToolTurns?: number
  ) => {
    assert.equal(maxToolTurns, 50);
    return {
      text: 'Clamped tool-turn run completed.',
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7, requests: 1 }
    };
  }, async () => {
    const result = await executeTool('spawn_sub_agent', {
      prompt: 'Use a high tool-turn budget.',
      toolNames: ['read_file'],
      maxToolTurns: 999
    }, makeContext() as any) as { ok: boolean; findings: string };

    assert.equal(result.ok, true);
    assert.match(result.findings, /Clamped tool-turn run completed/);
  });
});
