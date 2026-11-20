import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runOrchestration } from '../backend/orchestrationEngine';
import { executeTool } from '../backend/toolRuntime';
import * as llmClient from '../backend/llmClient';
import type { ChatMessage, LLMConfig, OrchestrationPlan, ToolDefinition } from '../shared/types';

/**
 * Create an isolated temporary workspace holding .ai-rules fixtures.
 *
 * Purpose: exercise rules loading against real files without touching the repository.
 * Inputs: optional map of rules file name to content.
 * Outputs: absolute workspace path containing the requested .ai-rules files.
 * Side effects: creates a temporary directory and the rules files inside it.
 */
async function makeWorkspaceWithRules(files: Record<string, string>): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ai-rules-injection-'));
  await fs.mkdir(path.join(workspaceDir, '.ai-rules'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(workspaceDir, '.ai-rules', name), content, 'utf8');
  }
  return workspaceDir;
}

/**
 * Temporarily replace llmClient.chatWithTools to capture the messages a model would receive.
 *
 * Purpose: assert prompt assembly offline and deterministically.
 * Inputs: mock implementation and callback containing assertions.
 * Outputs: callback result, with chatWithTools restored afterward.
 * Side effects: mutates the module export for the callback scope only.
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
  const llmClientMutable = llmClient as unknown as { chatWithTools: typeof llmClient.chatWithTools };
  const original = llmClientMutable.chatWithTools;
  llmClientMutable.chatWithTools = mockImpl as typeof llmClient.chatWithTools;
  try {
    await callback();
  } finally {
    llmClientMutable.chatWithTools = original;
  }
}

function makeSingleStepPlan(stepSystemPrompt: string): OrchestrationPlan {
  return {
    version: 1,
    name: 'ai-rules injection plan',
    description: 'Single-step plan used to verify workspace rules reach orchestration stages.',
    loopUntilComplete: true,
    maxLoops: 2,
    completionMarker: 'TASK_COMPLETE',
    steps: [
      {
        id: 'step-1',
        name: 'step-1',
        provider: 'openai-compatible',
        endpoint: 'http://localhost:11434/v1/chat/completions',
        model: 'model-a',
        systemPrompt: stepSystemPrompt,
        temperature: 0,
        maxTokens: 100,
        maxToolTurns: 4,
        maxRetries: 0,
        tools: [],
        passOutputToNext: true,
        allowCompletionTool: false
      }
    ]
  };
}

test('orchestration injects .ai-rules guidance into every stage system messages', async () => {
  const workspaceDir = await makeWorkspaceWithRules({ 'rules.md': 'Always keep helpers documented.' });
  const plan = makeSingleStepPlan('Stage objective: produce a summary.');
  const captured: ChatMessage[][] = [];

  await withMockedChatWithTools(async (_config, messages) => {
    captured.push(messages);
    return {
      text: 'TASK_COMPLETE done',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, requests: 1 }
    };
  }, async () => {
    await runOrchestration(plan, 'summarize the repo', undefined, undefined, {
      workspaceDir,
      rootDir: workspaceDir
    } as any);
  });

  assert.ok(captured.length >= 1);
  for (const messages of captured) {
    const rulesMessage = messages.find(message => message.role === 'system' && message.content.includes('Always keep helpers documented.'));
    assert.ok(rulesMessage, 'stage must receive .ai-rules guidance');
    const stagePromptIndex = messages.findIndex(message => message.content === 'Stage objective: produce a summary.');
    const rulesIndex = messages.indexOf(rulesMessage!);
    const userIndex = messages.findIndex(message => message.role === 'user');
    assert.ok(stagePromptIndex >= 0 && rulesIndex > stagePromptIndex, 'rules follow the stage system prompt');
    assert.ok(rulesIndex < userIndex, 'rules precede the user envelope');
  }
});

test('runOrchestration caches .ai-rules for the whole run instead of re-reading per step', async () => {
  const workspaceDir = await makeWorkspaceWithRules({ 'rules.md': 'Cached rules body marker.' });
  const plan = makeSingleStepPlan('Stage objective: loop twice.');
  const rulesSeenPerCall: boolean[] = [];
  let modelCalls = 0;

  await withMockedChatWithTools(async (_config, messages) => {
    modelCalls += 1;
    rulesSeenPerCall.push(messages.some(message => message.content.includes('Cached rules body marker.')));
    // Delete the folder after the first stage: a per-step re-read would find nothing on step 2.
    await fs.rm(path.join(workspaceDir, '.ai-rules'), { recursive: true, force: true });
    return {
      text: `iteration ${modelCalls} output without the completion marker`,
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, requests: 1 }
    };
  }, async () => {
    await runOrchestration(plan, 'loop until exhausted', undefined, undefined, {
      workspaceDir,
      rootDir: workspaceDir
    } as any);
  });

  assert.equal(modelCalls, 2, 'plan should have run both loop iterations');
  assert.deepEqual(rulesSeenPerCall, [true, true], 'later stages must reuse the cached rules read');
});

test('orchestration leaves prompts unchanged when the workspace has no .ai-rules folder', async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ai-rules-absent-'));
  const plan = makeSingleStepPlan('Stage objective: no rules here.');
  let sawRules = false;

  await withMockedChatWithTools(async (_config, messages) => {
    sawRules = messages.some(message => message.content.includes('.ai-rules'));
    return {
      text: 'TASK_COMPLETE done',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, requests: 1 }
    };
  }, async () => {
    await runOrchestration(plan, 'summarize', undefined, undefined, {
      workspaceDir,
      rootDir: workspaceDir
    } as any);
  });

  assert.equal(sawRules, false);
});

test('spawn_sub_agent inherits cached .ai-rules guidance from its parent context', async () => {
  let captured: ChatMessage[] | undefined;

  await withMockedChatWithTools(async (_config, messages) => {
    captured = messages;
    return {
      text: 'Sub-agent findings ready.',
      usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8, requests: 1 }
    };
  }, async () => {
    const result = await executeTool(
      'spawn_sub_agent',
      { prompt: 'Inspect the module' },
      {
        workspaceDir: '/mock/workspace',
        rootDir: '/mock/workspace',
        subAgentConfig: {
          provider: 'openai-compatible' as const,
          endpoint: 'http://localhost:11435/v1/chat/completions',
          model: 'sub-agent-model',
          temperature: 0.2
        } as LLMConfig,
        allowedToolNames: ['spawn_sub_agent', 'read_file'],
        aiRulesContent: '## .ai-rules/rules.md\n\nInherited rules body marker.'
      } as any
    );

    assert.equal((result as { ok?: boolean; error?: string }).ok, true, (result as { error?: string }).error);
  });

  assert.ok(captured);
  const rulesMessage = captured.find(message => message.content.includes('Inherited rules body marker.'));
  assert.ok(rulesMessage, 'sub-agent must receive the parent workspace rules');
  assert.equal(captured[0]?.role, 'system', 'sub-agent identity prompt stays first');
  assert.ok(captured.indexOf(rulesMessage!) < captured.findIndex(message => message.role === 'user'));
});

test('spawn_sub_agent loads .ai-rules itself when the parent did not cache any', async () => {
  const workspaceDir = await makeWorkspaceWithRules({ 'rules.md': 'Self-loaded rules body marker.' });
  let captured: ChatMessage[] | undefined;

  await withMockedChatWithTools(async (_config, messages) => {
    captured = messages;
    return {
      text: 'Sub-agent findings ready.',
      usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8, requests: 1 }
    };
  }, async () => {
    await executeTool(
      'spawn_sub_agent',
      { prompt: 'Inspect the module' },
      {
        workspaceDir,
        rootDir: workspaceDir,
        subAgentConfig: {
          provider: 'openai-compatible' as const,
          endpoint: 'http://localhost:11435/v1/chat/completions',
          model: 'sub-agent-model',
          temperature: 0.2
        } as LLMConfig,
        allowedToolNames: ['spawn_sub_agent', 'read_file']
      } as any
    );
  });

  assert.ok(captured);
  assert.ok(captured.some(message => message.content.includes('Self-loaded rules body marker.')));
});

test('runOrchestration skips .ai-rules when the context disables injection', async () => {
  const workspaceDir = await makeWorkspaceWithRules({ 'rules.md': 'Disabled rules body marker.' });
  const plan = makeSingleStepPlan('Stage objective: no injection.');
  const events: string[] = [];
  const captured: ChatMessage[][] = [];

  await withMockedChatWithTools(async (_config, messages) => {
    captured.push(messages);
    return {
      text: 'TASK_COMPLETE done',
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, requests: 1 }
    };
  }, async () => {
    await runOrchestration(plan, 'summarize', undefined, event => events.push(event), {
      workspaceDir,
      rootDir: workspaceDir,
      aiRulesContent: null
    } as any);
  });

  assert.ok(captured.length >= 1);
  for (const messages of captured) {
    assert.equal(
      messages.some(message => message.content.includes('Disabled rules body marker.')),
      false,
      'disabled runs must not receive .ai-rules guidance'
    );
    assert.equal(
      messages.some(message => message.content.includes('.ai-rules')),
      false,
      'disabled runs must not mention .ai-rules at all'
    );
  }
  assert.deepEqual(events.filter(event => event.includes('[ai-rules]')), []);
});

test('spawn_sub_agent skips .ai-rules when the parent context disables injection', async () => {
  const workspaceDir = await makeWorkspaceWithRules({ 'rules.md': 'Must stay out of sub-agents.' });
  const captured: ChatMessage[] = [];

  await withMockedChatWithTools(async (_config, messages) => {
    captured.push(...messages);
    return {
      text: 'Sub-agent findings ready.',
      usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8, requests: 1 }
    };
  }, async () => {
    const result = await executeTool(
      'spawn_sub_agent',
      { prompt: 'Inspect the module' },
      {
        workspaceDir,
        rootDir: workspaceDir,
        subAgentConfig: {
          provider: 'openai-compatible' as const,
          endpoint: 'http://localhost:11435/v1/chat/completions',
          model: 'sub-agent-model',
          temperature: 0.2
        } as LLMConfig,
        allowedToolNames: ['spawn_sub_agent', 'read_file'],
        aiRulesContent: null
      } as any
    );

    assert.equal((result as { ok?: boolean; error?: string }).ok, true, (result as { error?: string }).error);
  });

  assert.equal(
    captured.some(message => message.content.includes('Must stay out of sub-agents.')),
    false,
    'a disabled parent must not re-read .ai-rules for its sub-agent'
  );
  assert.equal(captured.some(message => message.content.includes('.ai-rules')), false);
});
