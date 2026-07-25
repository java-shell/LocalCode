import { chatWithTools } from './llmClient';
import { executeTool, getAllowedToolDefinitions } from './toolRuntime';
import {
  AgenticLink,
  AgenticStage,
  ChatMessage,
  LLMConfig,
  ModelUsage,
  OrchestrationPlan,
  OrchestrationRunResult,
  OrchestrationRunStep,
  OrchestrationStep,
  TokenUsage
} from '../shared/types';
import { RetrievedMemoryItem, computeAdaptiveInjectionLimits } from './turboVecMemory';

export interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
  turboMemory?: any; // TurboVecMemory instance for memory tools
  activeNamespaces?: string[]; // Namespaces to search by default
}

export interface OrchestrationMemoryAdapter {
  retrieve: (config: LLMConfig, query: string, stepName: string) => Promise<RetrievedMemoryItem[]>;
  store: (config: LLMConfig, text: string, stepName: string) => Promise<void>;
}

export interface OrchestrationRunOptions {
  requestTimeoutMs?: number;
}

function truncateText(value: string, maxChars: number): string {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsCompletionMarker(output: string, marker: string): boolean {
  const rawMarker = String(marker ?? '').trim();
  const rawOutput = String(output ?? '');
  if (!rawMarker || !rawOutput) {
    return false;
  }

  const normalizedOutput = rawOutput
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n');

  const markers = new Set<string>([rawMarker]);
  const tagCore = rawMarker.replace(/^<\/?\s*|\s*\/?\s*>$/g, '').trim();
  if (tagCore && tagCore !== rawMarker) {
    markers.add(tagCore);
  }

  for (const candidate of markers) {
    const escaped = escapeRegex(candidate);
    const flexible = escaped.replace(/[\s_-]+/g, '[\\s_-]*');
    const regex = new RegExp(flexible, 'i');
    if (regex.test(normalizedOutput)) {
      return true;
    }
  }

  return false;
}

function aggregateUsageByModel(steps: OrchestrationRunStep[]): ModelUsage[] {
  const usageMap = new Map<string, ModelUsage>();

  for (const step of steps) {
    const model = String(step.model ?? '').trim();
    const usage = step.usage;
    if (!model || !usage) {
      continue;
    }

    const existing = usageMap.get(model) ?? {
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      recalledPromptTokens: 0,
      contextWindowTokens: 0
    };

    existing.promptTokens += usage.promptTokens;
    existing.completionTokens += usage.completionTokens;
    existing.totalTokens += usage.totalTokens;
    existing.requests += usage.requests;
    existing.recalledPromptTokens = Math.max(0, Number(existing.recalledPromptTokens ?? 0)) + Math.max(0, Number(step.recalledPromptTokens ?? 0));
    const configuredContextWindow = Math.max(0, Number(step.contextWindowTokens ?? 0));
    if (configuredContextWindow > 0) {
      existing.contextWindowTokens = Math.max(Number(existing.contextWindowTokens ?? 0), configuredContextWindow);
    }
    usageMap.set(model, existing);
  }

  return Array.from(usageMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

function estimateTokensFromText(text: string): number {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return 0;
  }
  // Approximate conversion used only for UI attribution of memory recall usage.
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function formatRecalledMemory(items: RetrievedMemoryItem[], limits?: { maxItems?: number; maxCharsPerItem?: number; maxTotalChars?: number }): string {
  const maxItems = Math.max(1, Math.min(20, Number(limits?.maxItems ?? 4)));
  const maxCharsPerItem = Math.max(200, Math.min(4000, Number(limits?.maxCharsPerItem ?? 1000)));
  const maxTotalChars = Math.max(500, Math.min(12000, Number(limits?.maxTotalChars ?? 3500)));

  let used = 0;
  const lines: string[] = [];
  for (const [index, item] of items.slice(0, maxItems).entries()) {
    const remaining = maxTotalChars - used;
    if (remaining <= 0) {
      break;
    }

    const snippetLimit = Math.max(120, Math.min(maxCharsPerItem, remaining));
    const snippet = truncateText(String(item.text ?? '').replace(/\s+/g, ' '), snippetLimit);
    const line = `${index + 1}. [${item.source}] ${snippet}`;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}

function matchesBranchPattern(matchPattern: string | undefined, value: string): boolean {
  const pattern = String(matchPattern ?? '').trim();
  if (!pattern) {
    return true;
  }

  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function linkMatchesOutcome(link: AgenticLink, status: 'success' | 'error', detail: string): boolean {
  const condition = String(link.condition ?? '').trim();
  if (!condition || condition === 'always') {
    return matchesBranchPattern(link.matchPattern, detail);
  }

  if (condition === 'success') {
    return status === 'success' && matchesBranchPattern(link.matchPattern, detail);
  }

  if (condition === 'error') {
    return status === 'error' && matchesBranchPattern(link.matchPattern, detail);
  }

  if (condition.startsWith('error:')) {
    if (status !== 'error') {
      return false;
    }
    const tag = condition.slice('error:'.length).trim().toLowerCase();
    if (!tag) {
      return matchesBranchPattern(link.matchPattern, detail);
    }
    return detail.toLowerCase().includes(tag) && matchesBranchPattern(link.matchPattern, detail);
  }

  return false;
}

function clampMaxRetries(value: unknown): number {
  const parsed = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(10, parsed));
}

function normalizeAdvancedStage(stage: AgenticStage): OrchestrationStep {
  return {
    id: stage.id,
    name: stage.name,
    provider: stage.provider,
    endpoint: stage.endpoint,
    model: stage.model,
    contextWindowTokens: stage.contextWindowTokens,
    apiKey: stage.apiKey,
    systemPrompt: stage.systemPrompt,
    temperature: stage.temperature,
    maxTokens: stage.maxTokens,
    maxToolTurns: stage.maxToolTurns,
    maxRetries: stage.maxRetries,
    tools: Array.isArray(stage.tools) ? stage.tools : [],
    passOutputToNext: stage.passOutputToNext,
    allowCompletionTool: stage.allowCompletionTool
  };
}

interface StepExecutionResult {
  stepRecords: OrchestrationRunStep[];
  taskCompleted: boolean;
  completionSummary: string;
  handoffText: string;
  status: 'success' | 'error';
  errorDetail?: string;
  selectedDownstreamStageId?: string;
}

interface DownstreamStageOption {
  id: string;
  title: string;
  description: string;
  model: string;
}

function buildDownstreamRoutingToolDefinition(options: DownstreamStageOption[]) {
  const choices = options
    .map(option => {
      const safeDescription = truncateText(option.description || 'No description provided.', 220);
      return `- ${option.id}: ${option.title} (${option.model}) - ${safeDescription}`;
    })
    .join('\n');

  return {
    type: 'function' as const,
    function: {
      name: 'call_downstream_stage',
      description:
        'Route execution to one directly linked downstream stage. ' +
        'Choose a stageId from the available downstream options below.\n\n' +
        'Available downstream stages:\n' +
        choices,
      parameters: {
        type: 'object' as const,
        properties: {
          stageId: {
            type: 'string',
            enum: options.map(option => option.id),
            description: 'Direct downstream stage ID to invoke next.'
          },
          handoff: {
            type: 'string',
            description: 'Optional custom handoff content for the selected stage. If omitted, the current stage output is used.'
          },
          reason: {
            type: 'string',
            description: 'Brief reason for choosing this downstream stage.'
          }
        },
        required: ['stageId']
      }
    }
  };
}

async function runStepWithRetries(
  step: OrchestrationStep,
  originalPrompt: string,
  stepInput: string,
  iteration: number,
  loopMode: boolean,
  downstreamStageOptions: DownstreamStageOption[],
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal,
): Promise<StepExecutionResult> {
  const originalPromptForModel = truncateText(originalPrompt, 4000);
  const COMPLETION_TOOL = 'complete_orchestration_task';
  const DOWNSTREAM_STAGE_TOOL = 'call_downstream_stage';
  const stepToolCalls: Array<{ name: string; intent: string; timestamp: string }> = [];
  const stepMaxToolTurns = Math.max(1, Math.min(200, Math.floor(Number(step.maxToolTurns ?? 40) || 40)));
  const maxRetries = clampMaxRetries(step.maxRetries);
  const allowedToolNames = step.tools.filter(tool => tool.enabled).map(tool => tool.name);
  const allowCompletionTool = Boolean(step.allowCompletionTool);
  let selectedDownstreamStageId = '';
  let selectedDownstreamHandoff = '';

  const config: LLMConfig = {
    endpoint: step.endpoint,
    provider: step.provider,
    model: step.model,
    apiKey: step.apiKey,
    temperature: step.temperature ?? 0.2,
    maxTokens: step.maxTokens,
    contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)) || undefined,
    requestTimeoutMs: Number(options?.requestTimeoutMs || 0) || undefined
  };

  let attempt = 0;
  let lastErrorDetail = '';
  let recalledPromptTokens = 0;
  let completionSummary = '';
  let taskCompleted = false;

  while (attempt <= maxRetries) {
    const messages: ChatMessage[] = [];
    if (step.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: step.systemPrompt });
    }

    if (lastErrorDetail) {
      messages.push({
        role: 'system',
        content:
          `Previous attempt failed in this stage with: ${truncateText(lastErrorDetail, 1200)}\n` +
          'Retry this stage by fixing the issue directly. Keep output concise and continue from the existing stage input.'
      });
    }

    recalledPromptTokens = 0;
    if (memoryAdapter) {
      const recalled = await memoryAdapter.retrieve(config, `${originalPrompt}\n\n${stepInput}`, step.name);
      if (recalled.length > 0) {
        // P3 #8: Use adaptive injection limits based on context window
        const injectionLimits = computeAdaptiveInjectionLimits(config.contextWindowTokens);
        const recalledBlock = formatRecalledMemory(recalled, injectionLimits);
        messages.push({
          role: 'system',
          content:
            'Relevant long-term memory for this orchestration step is available below. Use it when helpful and ignore stale items.\n\n' +
            recalledBlock
        });
        recalledPromptTokens = estimateTokensFromText(recalledBlock);
      }
    }

    messages.push({
      role: 'user',
      content: `Original request:\n${originalPromptForModel}\n\nStep input:\n${truncateText(stepInput, 12000)}`
    });

    selectedDownstreamStageId = '';
    selectedDownstreamHandoff = '';

    let toolDefs = getAllowedToolDefinitions(allowedToolNames);
    if (downstreamStageOptions.length > 0) {
      toolDefs = [...toolDefs, buildDownstreamRoutingToolDefinition(downstreamStageOptions)];
    }
    if (loopMode && allowCompletionTool) {
      const completionDef = getAllowedToolDefinitions([COMPLETION_TOOL]);
      if (completionDef.length > 0 && !toolDefs.some(t => t.function.name === COMPLETION_TOOL)) {
        toolDefs = [...toolDefs, completionDef[0]];
      }
    }

    onEvent?.(`step:attempt:${step.name}:iteration:${iteration}:${attempt + 1}/${maxRetries + 1}`);
    const startedAt = Date.now();

    try {
      const result = await chatWithTools(
        config,
        messages,
        toolDefs,
        async (name, args) => {
          if (name === COMPLETION_TOOL) {
            taskCompleted = true;
            completionSummary = String((args as Record<string, unknown>)?.summary ?? '');
            return { ok: true, message: 'Task completion acknowledged. Orchestration will stop after this step.' };
          }
          if (name === DOWNSTREAM_STAGE_TOOL) {
            const input = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
            const requestedStageId = String(input.stageId ?? '').trim();
            const option = downstreamStageOptions.find(candidate => candidate.id === requestedStageId);
            if (!option) {
              const allowed = downstreamStageOptions.map(candidate => candidate.id).join(', ') || '(none)';
              throw new Error(`Stage ${step.name} can only route to direct downstream stages: ${allowed}.`);
            }
            selectedDownstreamStageId = option.id;
            selectedDownstreamHandoff = String(input.handoff ?? '').trim();
            return {
              ok: true,
              selectedStageId: option.id,
              selectedStageTitle: option.title,
              selectedStageModel: option.model,
              message: `Downstream stage ${option.title} selected.`
            };
          }
          if (!allowedToolNames.includes(name)) {
            throw new Error(`Tool ${name} is not enabled in step ${step.name}.`);
          }
          if (name === 'run_terminal_command') {
            const input = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
            const rawTimeout = Number(input.timeoutMs ?? 30000);
            const boundedTimeoutMs = rawTimeout <= 0 ? 30000 : Math.max(1000, Math.min(120000, rawTimeout));
            return executeTool(name, { ...input, timeoutMs: boundedTimeoutMs }, runtimeContext);
          }
          return executeTool(name, args, runtimeContext);
        },
        event => {
          onEvent?.(`${step.name}:iteration:${iteration}:${event}`);
          const TOOL_PREFIX = 'tool:';
          const INTENT_SEP = ' | intent: ';
          if (event.startsWith(TOOL_PREFIX)) {
            const toolPart = event.slice(TOOL_PREFIX.length);
            const sepIdx = toolPart.indexOf(INTENT_SEP);
            const toolName = sepIdx >= 0 ? toolPart.slice(0, sepIdx) : toolPart;
            const intent = sepIdx >= 0 ? toolPart.slice(sepIdx + INTENT_SEP.length) : '';
            stepToolCalls.push({ name: toolName, intent, timestamp: new Date().toISOString() });
          }
        },
        stepMaxToolTurns,
        signal
      );

      const durationMs = Date.now() - startedAt;
      const rawOutput = String(result.text ?? '');
      const handoffSummary = String(result.continuationSummary ?? '').trim();
      const budgetExhausted = Boolean(result.toolBudgetExhausted);

      const handoffText = budgetExhausted
        ? truncateText(
            [
              `Stage ${step.name} exhausted its tool-call budget (${stepMaxToolTurns}).`,
              handoffSummary || rawOutput
            ].join('\n\n'),
            12000
          )
        : truncateText(rawOutput, 12000);

      if (memoryAdapter) {
        await memoryAdapter.store(config, rawOutput, step.name);
      }

      const effectiveHandoffText = selectedDownstreamHandoff || handoffText;

      return {
        stepRecords: [
          {
            id: step.id,
            name: step.name,
            output: rawOutput,
            iteration,
            model: step.model,
            usage: result.usage,
            recalledPromptTokens: Math.max(0, Number(recalledPromptTokens ?? 0)),
            contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)),
            toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
            durationMs,
            attempts: attempt + 1,
            success: true,
            toolBudgetExhausted: budgetExhausted,
            continuationSummary: handoffSummary || undefined
          }
        ],
        taskCompleted,
        completionSummary,
        handoffText: effectiveHandoffText,
        status: 'success',
        selectedDownstreamStageId: selectedDownstreamStageId || undefined
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/canceled$/i.test(detail) || /stopped by user/i.test(detail)) {
        throw new Error(`Orchestration stopped by user during step ${step.name} (iteration ${iteration}).`);
      }

      lastErrorDetail = detail;
      if (attempt < maxRetries) {
        onEvent?.(`step:retry:${step.name}:iteration:${iteration}:${attempt + 1}/${maxRetries} | ${truncateText(detail, 400)}`);
        attempt += 1;
        continue;
      }

      const durationMs = Date.now() - startedAt;
      const errorText =
        `Stage ${step.name} failed after ${maxRetries + 1} attempt(s). ` +
        `Moving to next stage.\n\n${detail}`;

      return {
        stepRecords: [
          {
            id: step.id,
            name: step.name,
            output: errorText,
            iteration,
            model: step.model,
            recalledPromptTokens: Math.max(0, Number(recalledPromptTokens ?? 0)),
            contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)),
            toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
            durationMs,
            attempts: attempt + 1,
            success: false,
            error: detail
          }
        ],
        taskCompleted: false,
        completionSummary: '',
        handoffText: truncateText(errorText, 12000),
        status: 'error',
        errorDetail: detail
      };
    }
  }

  return {
    stepRecords: [],
    taskCompleted: false,
    completionSummary: '',
    handoffText: truncateText(stepInput, 12000),
    status: 'error',
    errorDetail: 'Unexpected orchestration retry state.'
  };
}

async function runSingleIteration(
  plan: OrchestrationPlan,
  originalPrompt: string,
  iterationPrompt: string,
  iteration: number,
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal
): Promise<{ steps: OrchestrationRunStep[]; taskCompleted: boolean; completionSummary: string }> {
  let priorOutput = iterationPrompt;
  const iterationSteps: OrchestrationRunStep[] = [];

  for (const step of plan.steps) {
    onEvent?.(`step:start:${step.name}:iteration:${iteration}`);
    const outcome = await runStepWithRetries(
      step,
      originalPrompt,
      priorOutput,
      iteration,
      Boolean(plan.loopUntilComplete),
      [],
      options,
      onEvent,
      runtimeContext,
      memoryAdapter,
      signal
    );

    iterationSteps.push(...outcome.stepRecords);
    onEvent?.(`step:end:${step.name}:iteration:${iteration}`);

    if (outcome.taskCompleted) {
      return { steps: iterationSteps, taskCompleted: true, completionSummary: outcome.completionSummary };
    }

    if (step.passOutputToNext || outcome.status === 'error' || outcome.stepRecords.some(s => s.toolBudgetExhausted)) {
      priorOutput = truncateText(outcome.handoffText, 12000);
    }
  }

  return { steps: iterationSteps, taskCompleted: false, completionSummary: '' };
}

async function runAdvancedIteration(
  plan: OrchestrationPlan,
  originalPrompt: string,
  iterationPrompt: string,
  iteration: number,
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal
): Promise<{ steps: OrchestrationRunStep[]; taskCompleted: boolean; completionSummary: string }> {
  const advanced = plan.advanced;
  if (!advanced?.enabled || !Array.isArray(advanced.stages) || advanced.stages.length === 0) {
    return runSingleIteration(
      plan,
      originalPrompt,
      iterationPrompt,
      iteration,
      options,
      onEvent,
      runtimeContext,
      memoryAdapter,
      signal
    );
  }

  const stages = advanced.stages.map(normalizeAdvancedStage);
  const stageById = new Map(stages.map(stage => [stage.id, stage]));
  const stageIndexById = new Map(stages.map((stage, index) => [stage.id, index]));
  const links = Array.isArray(advanced.links) ? advanced.links : [];
  const entryStageId = (advanced.entryStageId && stageById.has(advanced.entryStageId)) ? advanced.entryStageId : stages[0].id;
  const maxStageExecutions = Math.max(1, Math.min(300, Math.floor(Number(advanced.maxStageExecutions ?? 100) || 100)));

  const queue: string[] = [entryStageId];
  const queued = new Set<string>([entryStageId]);
  const stageInputs = new Map<string, string[]>();
  stageInputs.set(entryStageId, [iterationPrompt]);

  const runSteps: OrchestrationRunStep[] = [];
  let stageExecutions = 0;

  while (queue.length > 0 && stageExecutions < maxStageExecutions) {
    const stageId = String(queue.shift() ?? '');
    queued.delete(stageId);
    const stage = stageById.get(stageId);
    if (!stage) {
      continue;
    }

    const pendingInputs = stageInputs.get(stageId) ?? [iterationPrompt];
    stageInputs.delete(stageId);
    const mergedInput = truncateText(pendingInputs.join('\n\n---\n\n'), 12000);

    const currentStageIndex = Number(stageIndexById.get(stageId));
    const directDownstreamLinks = links.filter(link => {
      if (link.fromStageId !== stageId) {
        return false;
      }
      if (!stageById.has(link.toStageId)) {
        return false;
      }
      const targetIndex = Number(stageIndexById.get(link.toStageId));
      return Number.isFinite(targetIndex) && targetIndex > currentStageIndex;
    });

    const directDownstreamStageOptions: DownstreamStageOption[] = [];
    const seenDownstreamStageIds = new Set<string>();
    for (const link of directDownstreamLinks) {
      if (seenDownstreamStageIds.has(link.toStageId)) {
        continue;
      }
      const downstream = stageById.get(link.toStageId);
      if (!downstream) {
        continue;
      }
      seenDownstreamStageIds.add(link.toStageId);
      directDownstreamStageOptions.push({
        id: downstream.id,
        title: downstream.name,
        description: String(downstream.systemPrompt ?? '').trim() || 'No description provided.',
        model: downstream.model
      });
    }

    onEvent?.(`graph:stage:start:${stage.name}:iteration:${iteration}`);
    const outcome = await runStepWithRetries(
      stage,
      originalPrompt,
      mergedInput,
      iteration,
      Boolean(plan.loopUntilComplete),
      directDownstreamStageOptions,
      options,
      onEvent,
      runtimeContext,
      memoryAdapter,
      signal
    );
    runSteps.push(...outcome.stepRecords);
    stageExecutions += 1;
    onEvent?.(`graph:stage:end:${stage.name}:iteration:${iteration}:${outcome.status}`);

    if (outcome.taskCompleted) {
      return {
        steps: runSteps,
        taskCompleted: true,
        completionSummary: outcome.completionSummary
      };
    }

    if (outcome.selectedDownstreamStageId) {
      const selectedStage = stageById.get(outcome.selectedDownstreamStageId);
      if (selectedStage) {
        const bucket = stageInputs.get(selectedStage.id) ?? [];
        bucket.push(`Input from ${stage.name} (toolcall: call_downstream_stage):\n${outcome.handoffText}`);
        stageInputs.set(selectedStage.id, bucket);
        if (!queued.has(selectedStage.id)) {
          queue.push(selectedStage.id);
          queued.add(selectedStage.id);
        }
        continue;
      }
    }

    const detailForBranching = `${outcome.handoffText}\n${outcome.errorDetail ?? ''}`;
    const nextLinks = directDownstreamLinks.filter(link => linkMatchesOutcome(link, outcome.status, detailForBranching));
    if (nextLinks.length === 0) {
      continue;
    }

    for (const link of nextLinks) {
      if (!stageById.has(link.toStageId)) {
        continue;
      }
      const bucket = stageInputs.get(link.toStageId) ?? [];
      bucket.push(`Input from ${stage.name} (${link.condition}):\n${outcome.handoffText}`);
      stageInputs.set(link.toStageId, bucket);
      if (!queued.has(link.toStageId)) {
        queue.push(link.toStageId);
        queued.add(link.toStageId);
      }
    }
  }

  if (stageExecutions >= maxStageExecutions) {
    onEvent?.(`graph:limit-reached:${maxStageExecutions}`);
  }

  return {
    steps: runSteps,
    taskCompleted: false,
    completionSummary: ''
  };
}

export async function runOrchestration(
  plan: OrchestrationPlan,
  userPrompt: string,
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal
): Promise<OrchestrationRunResult> {
  const loopUntilComplete = Boolean(plan.loopUntilComplete);
  const maxLoops = Math.max(1, Math.min(20, Number(plan.maxLoops ?? 3)));
  const completionMarker = String(plan.completionMarker ?? 'TASK_COMPLETE').trim();
  const loopLimit = loopUntilComplete ? maxLoops : 1;

  const allSteps: OrchestrationRunStep[] = [];
  let iterationPrompt = userPrompt;
  let finalOutput = '';
  let completed = !loopUntilComplete;
  let iterations = 0;

  for (let iteration = 1; iteration <= loopLimit; iteration += 1) {
    onEvent?.(`loop:start:${iteration}`);

    const useAdvancedGraph = Boolean(plan.advanced?.enabled && Array.isArray(plan.advanced?.stages) && plan.advanced.stages.length > 0);
    const { steps: iterationSteps, taskCompleted, completionSummary } = useAdvancedGraph
      ? await runAdvancedIteration(
          plan,
          userPrompt,
          iterationPrompt,
          iteration,
          options,
          onEvent,
          runtimeContext,
          memoryAdapter,
          signal
        )
      : await runSingleIteration(
          plan,
          userPrompt,
          iterationPrompt,
          iteration,
          options,
          onEvent,
          runtimeContext,
          memoryAdapter,
          signal
        );

    allSteps.push(...iterationSteps);
    finalOutput = iterationSteps.length ? iterationSteps[iterationSteps.length - 1].output : '';
    const iterationOutput = iterationSteps.map(step => step.output || '').join('\n\n');
    iterations = iteration;

    onEvent?.(`loop:end:${iteration}`);

    if (!loopUntilComplete) {
      break;
    }

    // Primary: completion signalled via complete_orchestration_task tool call.
    if (taskCompleted) {
      completed = true;
      onEvent?.(`loop:complete:${iteration}${completionSummary ? `:${completionSummary}` : ''}`);
      break;
    }

    // Fallback: completion marker still present in text output (backward compat).
    if (containsCompletionMarker(iterationOutput, completionMarker)) {
      completed = true;
      onEvent?.(`loop:complete:${iteration}`);
      break;
    }

    iterationPrompt = truncateText([
      `Previous orchestration output (iteration ${iteration}):`,
      finalOutput,
      '',
      'Continue from this output. When the task is fully complete, call the complete_orchestration_task tool with a brief summary of what was accomplished.',
      'Do not signal completion by emitting text — use the tool call.'
    ].join('\n'), 12000);
  }

  return {
    output: finalOutput,
    steps: allSteps,
    iterations,
    completed,
    completionMarker: loopUntilComplete ? completionMarker : undefined,
    usageByModel: aggregateUsageByModel(allSteps)
  };
}
