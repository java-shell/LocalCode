import { chatWithTools } from './llmClient';
import { executeTool, getAllowedToolDefinitions } from './toolRuntime';
import { ChatMessage, LLMConfig, ModelUsage, OrchestrationPlan, OrchestrationRunResult, OrchestrationRunStep, TokenUsage } from '../shared/types';
import { RetrievedMemoryItem } from './turboVecMemory';

export interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
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

function formatRecalledMemory(items: RetrievedMemoryItem[]): string {
  const maxItems = 4;
  const maxCharsPerItem = 1000;
  const maxTotalChars = 3500;

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
  const originalPromptForModel = truncateText(originalPrompt, 4000);
  const iterationSteps: OrchestrationRunStep[] = [];
  const isLooping = Boolean(plan.loopUntilComplete);
  const COMPLETION_TOOL = 'complete_orchestration_task';

  for (const step of plan.steps) {
    onEvent?.(`step:start:${step.name}:iteration:${iteration}`);
    let recalledPromptTokens = 0;
    const allowCompletionTool = Boolean(step.allowCompletionTool);

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

    const messages: ChatMessage[] = [];
    if (step.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: step.systemPrompt });
    }

    if (memoryAdapter) {
      const recalled = await memoryAdapter.retrieve(config, `${originalPrompt}\n\n${priorOutput}`, step.name);
      if (recalled.length > 0) {
        const recalledBlock = formatRecalledMemory(recalled);
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
      content: `Original request:\n${originalPromptForModel}\n\nStep input:\n${truncateText(priorOutput, 12000)}`
    });

    const allowedToolNames = step.tools.filter(tool => tool.enabled).map(tool => tool.name);
    let toolDefs = getAllowedToolDefinitions(allowedToolNames);

    // Auto-inject the completion tool on every step when running in loop mode.
    if (isLooping && allowCompletionTool) {
      const completionDef = getAllowedToolDefinitions([COMPLETION_TOOL]);
      if (completionDef.length > 0 && !toolDefs.some(t => t.function.name === COMPLETION_TOOL)) {
        toolDefs = [...toolDefs, completionDef[0]];
      }
    }

    let taskCompleted = false;
    let completionSummary = '';
    const stepToolCalls: Array<{ name: string; intent: string; timestamp: string }> = [];
    const stepMaxToolTurns = Math.max(1, Math.min(200, Math.floor(Number(step.maxToolTurns ?? 40) || 40)));

    let output = '';
    let usage: TokenUsage | undefined;
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
      output = result.text;
      usage = result.usage;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/canceled$/i.test(detail) || /stopped by user/i.test(detail)) {
        throw new Error(`Orchestration stopped by user during step ${step.name} (iteration ${iteration}).`);
      }
      throw new Error(
        `Orchestration step failed: step=${step.name} id=${step.id} iteration=${iteration} endpoint=${step.endpoint} model=${step.model} | ${detail}`
      );
    }

    if (memoryAdapter) {
      await memoryAdapter.store(config, output, step.name);
    }

    iterationSteps.push({
      id: step.id,
      name: step.name,
      output,
      iteration,
      model: step.model,
      usage,
      recalledPromptTokens: Math.max(0, Number(recalledPromptTokens ?? 0)),
      contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)),
      toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined
    });
    onEvent?.(`step:end:${step.name}:iteration:${iteration}`);

    if (taskCompleted) {
      return { steps: iterationSteps, taskCompleted: true, completionSummary };
    }

    if (step.passOutputToNext) {
      priorOutput = truncateText(output, 12000);
    }
  }

  return { steps: iterationSteps, taskCompleted: false, completionSummary: '' };
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

    const { steps: iterationSteps, taskCompleted, completionSummary } = await runSingleIteration(
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
