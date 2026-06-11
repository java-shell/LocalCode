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
      requests: 0
    };

    existing.promptTokens += usage.promptTokens;
    existing.completionTokens += usage.completionTokens;
    existing.totalTokens += usage.totalTokens;
    existing.requests += usage.requests;
    usageMap.set(model, existing);
  }

  return Array.from(usageMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
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
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal
): Promise<OrchestrationRunStep[]> {
  let priorOutput = iterationPrompt;
  const originalPromptForModel = truncateText(originalPrompt, 4000);
  const iterationSteps: OrchestrationRunStep[] = [];

  for (const step of plan.steps) {
    onEvent?.(`step:start:${step.name}:iteration:${iteration}`);

    const config: LLMConfig = {
      endpoint: step.endpoint,
      model: step.model,
      apiKey: step.apiKey,
      temperature: step.temperature ?? 0.2,
      maxTokens: step.maxTokens
    };

    const messages: ChatMessage[] = [];
    if (step.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: step.systemPrompt });
    }

    if (memoryAdapter) {
      const recalled = await memoryAdapter.retrieve(config, `${originalPrompt}\n\n${priorOutput}`, step.name);
      if (recalled.length > 0) {
        messages.push({
          role: 'system',
          content:
            'Relevant long-term memory for this orchestration step is available below. Use it when helpful and ignore stale items.\n\n' +
            formatRecalledMemory(recalled)
        });
      }
    }

    messages.push({
      role: 'user',
      content: `Original request:\n${originalPromptForModel}\n\nStep input:\n${truncateText(priorOutput, 12000)}`
    });

    const allowedToolNames = step.tools.filter(tool => tool.enabled).map(tool => tool.name);
    const toolDefs = getAllowedToolDefinitions(allowedToolNames);

    let output = '';
    let usage: TokenUsage | undefined;
    try {
      const result = await chatWithTools(
        config,
        messages,
        toolDefs,
        async (name, args) => {
          if (!allowedToolNames.includes(name)) {
            throw new Error(`Tool ${name} is not enabled in step ${step.name}.`);
          }
          return executeTool(name, args, runtimeContext);
        },
        event => onEvent?.(`${step.name}:iteration:${iteration}:${event}`),
        40,
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

    iterationSteps.push({ id: step.id, name: step.name, output, iteration, model: step.model, usage });
    onEvent?.(`step:end:${step.name}:iteration:${iteration}`);

    if (step.passOutputToNext) {
      priorOutput = truncateText(output, 12000);
    }
  }

  return iterationSteps;
}

export async function runOrchestration(
  plan: OrchestrationPlan,
  userPrompt: string,
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

    const iterationSteps = await runSingleIteration(
      plan,
      userPrompt,
      iterationPrompt,
      iteration,
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

    if (containsCompletionMarker(iterationOutput, completionMarker)) {
      completed = true;
      onEvent?.(`loop:complete:${iteration}`);
      break;
    }

    iterationPrompt = truncateText([
      `Previous orchestration output (iteration ${iteration}):`,
      finalOutput,
      '',
      'Continue from this output. If the task is complete, include this exact marker in your final answer:',
      completionMarker
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
