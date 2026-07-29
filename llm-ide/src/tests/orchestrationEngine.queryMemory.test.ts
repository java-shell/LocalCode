import test from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestration } from '../backend/orchestrationEngine';
import * as llmClient from '../backend/llmClient';
import type { ChatMessage, LLMConfig, OrchestrationPlan, ToolDefinition } from '../shared/types';
import type { RetrievedMemoryItem, TurboVecDiagnostics } from '../backend/turboVecMemory';

/**
 * Mock TurboVec memory implementation for orchestration query_memory tests.
 *
 * Purpose: provide deterministic retrieval behavior without external dependencies.
 * Inputs: LLM config, query, and namespace options from query_memory tool.
 * Outputs: fixed memory hits and namespace diagnostics.
 */
class MockTurboMemory {
  async retrieve(_config: LLMConfig, _query: string, options: { namespace: string; k?: number }): Promise<RetrievedMemoryItem[]> {
    return [
      {
        id: 10,
        text: `direct-hit:${options.namespace}`,
        source: 'mock:retrieve',
        score: 0.92,
        metadata: { createdAt: '2026-01-01T00:00:00Z' }
      }
    ];
  }

  async retrieveMulti(_config: LLMConfig, _query: string, options: { namespaces: string[]; k?: number }): Promise<RetrievedMemoryItem[]> {
    return options.namespaces.map((namespace, index) => ({
      id: index + 1,
      text: `multi-hit:${namespace}`,
      source: 'mock:retrieveMulti',
      score: 0.9 - index * 0.1,
      metadata: { createdAt: '2026-01-01T00:00:00Z' }
    }));
  }

  async diagnostics(): Promise<TurboVecDiagnostics> {
    return {
      ok: true,
      pythonExecutable: 'python3',
      bridgeScriptPath: '/mock/bridge.py',
      memoryRoot: '/mock/memory',
      health: { ok: true },
      namespaces: [
        {
          namespace: 'orch:test',
          records: 5,
          indexBytes: 1024,
          metadataBytes: 128,
          updatedAt: new Date().toISOString(),
          graphrag: {
            retrievals: 0,
            vectorSeedHits: 0,
            expandedHits: 0,
            finalReturned: 0,
            avgExpansionFactor: 0,
            maxObservedHops: 0,
            linkHits: { sequential: 0, explicit: 0, turn: 0, source: 0 },
            lastRetrievedAt: null
          }
        }
      ],
      totals: {
        namespaces: 1,
        records: 5,
        indexBytes: 1024,
        metadataBytes: 128
      },
      graphrag: {
        retrievals: 0,
        vectorSeedHits: 0,
        expandedHits: 0,
        finalReturned: 0,
        avgExpansionFactor: 0,
        maxObservedHops: 0,
        linkHits: { sequential: 0, explicit: 0, turn: 0, source: 0 },
        lastRetrievedAt: null
      }
    };
  }
}

/**
 * Temporarily patch llmClient.chatWithTools for deterministic orchestration tests.
 *
 * Purpose: invoke orchestration executeTool callback in-process and restore client after test.
 * Inputs: mock implementation and asynchronous test body.
 * Outputs: test body result with original client restored.
 */
async function withMockedChatWithTools(
  mockImpl: (
    config: LLMConfig,
    initialMessages: ChatMessage[],
    tools: ToolDefinition[],
    executeTool: (name: string, args: unknown) => Promise<unknown>
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
 * Build a one-stage orchestration plan that enables query_memory tool.
 *
 * Purpose: isolate memory-tool behavior within orchestration execution.
 * Inputs: none.
 * Outputs: valid orchestration plan with single memory-capable stage.
 */
function makePlan(): OrchestrationPlan {
  return {
    version: 1,
    name: 'Orchestration query_memory regression',
    description: 'Ensures query_memory receives per-step llmConfig in orchestration runtime.',
    loopUntilComplete: false,
    steps: [
      {
        id: 'memory-stage',
        name: 'Memory Stage',
        provider: 'openai-compatible',
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'test-model',
        systemPrompt: 'Use memory before answering.',
        temperature: 0,
        maxTokens: 120,
        maxToolTurns: 4,
        maxRetries: 0,
        tools: [
          { name: 'query_memory', enabled: true }
        ],
        passOutputToNext: true,
        allowCompletionTool: false
      }
    ]
  };
}

test('orchestration step can execute query_memory without llmConfig errors', async () => {
  const plan = makePlan();
  const memory = new MockTurboMemory();

  await withMockedChatWithTools(async (_config, _messages, _tools, executeTool) => {
    const queryResult = await executeTool('query_memory', {
      query: 'find prior design decisions',
      limit: 3
    }) as { results?: Array<{ text: string }>; error?: string };

    assert.equal(queryResult.error, undefined);
    assert.ok(Array.isArray(queryResult.results));
    assert.ok((queryResult.results?.length ?? 0) > 0);
    assert.match(queryResult.results?.[0]?.text ?? '', /multi-hit:orch:test/);

    return {
      text: 'memory consulted',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, requests: 1 }
    };
  }, async () => {
    const run = await runOrchestration(
      plan,
      'Assess implementation risk',
      undefined,
      undefined,
      {
        workspaceDir: '/mock/workspace',
        rootDir: '/mock/root',
        turboMemory: memory,
        activeNamespaces: ['orch:test']
      }
    );

    assert.equal(run.steps.length, 1);
    assert.equal(run.steps[0].output, 'memory consulted');
  });
});

test('orchestration injects reference workspace guidance for stage models', async () => {
  const plan = makePlan();
  const memory = new MockTurboMemory();

  await withMockedChatWithTools(async (_config, initialMessages) => {
    const systemMessages = initialMessages.filter(message => message.role === 'system');
    const merged = systemMessages.map(message => String(message.content ?? '')).join('\n\n');

    assert.match(merged, /Reference workspaces are available for scoped tools/i);
    assert.match(merged, /ref:ref_alpha/);
    assert.match(merged, /Shared Library/);

    return {
      text: 'guidance seen',
      usage: { promptTokens: 6, completionTokens: 3, totalTokens: 9, requests: 1 }
    };
  }, async () => {
    const run = await runOrchestration(
      plan,
      'Review architecture',
      undefined,
      undefined,
      {
        workspaceDir: '/mock/workspace',
        rootDir: '/mock/root',
        turboMemory: memory,
        activeNamespaces: ['orch:test'],
        referenceWorkspaces: [
          {
            id: 'ref_alpha',
            label: 'Shared Library',
            path: '/mock/shared-library',
            allowWrite: false
          }
        ]
      }
    );

    assert.equal(run.steps.length, 1);
    assert.equal(run.steps[0].output, 'guidance seen');
  });
});
