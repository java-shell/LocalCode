import test from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestration } from '../backend/orchestrationEngine';
import * as llmClient from '../backend/llmClient';
import type { AdvancedOrchestrationConfig, ChatMessage, LLMConfig, OrchestrationPlan, ToolDefinition } from '../shared/types';

/**
 * Build a minimal advanced-stage plan for orchestration routing tests.
 *
 * Purpose: create deterministic stage graphs with lightweight defaults.
 * Inputs: stage definitions and links to include in advanced config.
 * Outputs: orchestration plan with advanced graph enabled.
 */
function makeAdvancedPlan(stages: AdvancedOrchestrationConfig['stages'], links: AdvancedOrchestrationConfig['links']): OrchestrationPlan {
  return {
    version: 1,
    name: 'Advanced routing test plan',
    description: 'Plan for validating downstream stage routing behavior.',
    loopUntilComplete: false,
    steps: [],
    advanced: {
      enabled: true,
      entryStageId: stages[0]?.id,
      maxStageExecutions: 10,
      stages,
      links
    }
  };
}

/**
 * Build a stage with stable defaults used by orchestration tests.
 *
 * Purpose: avoid repetitive boilerplate while keeping stage intent explicit.
 * Inputs: id, display name, model label, and optional system prompt.
 * Outputs: a valid advanced orchestration stage.
 */
function makeStage(id: string, name: string, model: string, systemPrompt: string) {
  return {
    id,
    name,
    provider: 'openai-compatible' as const,
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model,
    systemPrompt,
    temperature: 0,
    maxTokens: 200,
    maxToolTurns: 8,
    maxRetries: 0,
    tools: [],
    passOutputToNext: true,
    allowCompletionTool: false
  };
}

/**
 * Temporarily replace llmClient.chatWithTools for deterministic orchestration tests.
 *
 * Purpose: simulate stage model behavior without external network calls.
 * Inputs: mock implementation and callback containing test assertions.
 * Outputs: callback result with chatWithTools restored afterward.
 * Side effects: mutates module export for test scope only.
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

test('advanced routing tool exposes direct downstream stages with metadata and drives next stage selection', async () => {
  const planner = makeStage('stage-a', 'Planner', 'model-a', 'Plan and decide the next specialist.');
  const reviewer = makeStage('stage-b', 'Reviewer', 'model-b', 'Review plan quality and identify risks.');
  const implementer = makeStage('stage-c', 'Implementer', 'model-c', 'Implement changes once the plan is approved.');

  const plan = makeAdvancedPlan(
    [planner, reviewer, implementer],
    [
      { id: 'l1', fromStageId: 'stage-a', toStageId: 'stage-b', condition: 'always' },
      { id: 'l2', fromStageId: 'stage-b', toStageId: 'stage-c', condition: 'always' }
    ]
  );

  await withMockedChatWithTools(async (config, _messages, tools, executeTool) => {
    const routingTool = tools.find(tool => tool.function.name === 'call_downstream_stage');

    if (config.model === 'model-a') {
      assert.ok(routingTool, 'Stage A should receive call_downstream_stage tool');
      const enumValues = ((routingTool?.function.parameters.properties as { stageId?: { enum?: string[] } }).stageId?.enum) ?? [];
      assert.deepEqual(enumValues, ['stage-b']);
      assert.match(routingTool?.function.description ?? '', /Reviewer/);
      assert.match(routingTool?.function.description ?? '', /Review plan quality/);
      await executeTool('call_downstream_stage', {
        stageId: 'stage-b',
        handoff: 'Route to reviewer with the current draft.',
        reason: 'Need quality checks before implementation.'
      });
    }

    if (config.model === 'model-b') {
      assert.ok(routingTool, 'Stage B should receive call_downstream_stage tool');
      const enumValues = ((routingTool?.function.parameters.properties as { stageId?: { enum?: string[] } }).stageId?.enum) ?? [];
      assert.deepEqual(enumValues, ['stage-c']);
      assert.match(routingTool?.function.description ?? '', /Implementer/);
      await executeTool('call_downstream_stage', {
        stageId: 'stage-c',
        reason: 'Ready for implementation.'
      });
    }

    if (config.model === 'model-c') {
      assert.equal(routingTool, undefined, 'Final stage has no direct downstream and should not receive routing tool');
    }

    return {
      text: `output-${config.model}`,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requests: 1 }
    };
  }, async () => {
    const result = await runOrchestration(plan, 'Build feature X');
    assert.deepEqual(result.steps.map(step => step.id), ['stage-a', 'stage-b', 'stage-c']);
    assert.equal(result.iterations, 1);
  });
});

test('advanced graph allows backward edges, bounded by per-stage and global execution caps', async () => {
  const stageA = makeStage('stage-a', 'Stage A', 'model-a', 'Start stage.');
  const stageB = makeStage('stage-b', 'Stage B', 'model-b', 'Middle stage.');

  const plan = makeAdvancedPlan(
    [stageA, stageB],
    [
      { id: 'ab', fromStageId: 'stage-a', toStageId: 'stage-b', condition: 'always' },
      { id: 'ba', fromStageId: 'stage-b', toStageId: 'stage-a', condition: 'always' }
    ]
  );

  await withMockedChatWithTools(async (config, _messages, tools) => {
    if (config.model === 'model-b') {
      // Issue #1: backward edges are now exposed in the routing tool enum.
      const routingTool = tools.find(tool => tool.function.name === 'call_downstream_stage');
      assert.ok(routingTool, 'Stage B should receive call_downstream_stage tool (backward edge exposed).');
      const enumValues = ((routingTool?.function.parameters.properties as { stageId?: { enum?: string[] } }).stageId?.enum) ?? [];
      assert.deepEqual(enumValues, ['stage-a']);
    }

    return {
      text: `output-${config.model}`,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, requests: 1 }
    };
  }, async () => {
    const result = await runOrchestration(plan, 'Run graph once');
    // maxStageExecutions=10 with 2 stages -> perStageCap = ceil(10/2) = 5 each.
    // The a<->b always/always cycle alternates until the global budget is hit.
    assert.equal(result.steps.length, 10, 'Execution must be bounded by the global maxStageExecutions budget.');
    const aRuns = result.steps.filter(step => step.id === 'stage-a').length;
    const bRuns = result.steps.filter(step => step.id === 'stage-b').length;
    assert.equal(aRuns, 5, 'Stage A must be bounded by the per-stage cap.');
    assert.equal(bRuns, 5, 'Stage B must be bounded by the per-stage cap.');
    assert.deepEqual(
      result.steps.map(step => step.id),
      ['stage-a', 'stage-b', 'stage-a', 'stage-b', 'stage-a', 'stage-b', 'stage-a', 'stage-b', 'stage-a', 'stage-b'],
      'Backward edges must allow the graph to loop back.'
    );
    assert.equal(result.completed, true, 'All steps succeeded, so a non-loop plan is complete.');
  });
});
