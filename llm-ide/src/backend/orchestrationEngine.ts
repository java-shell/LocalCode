import { chatWithTools } from './llmClient';
import { executeTool, getAllowedToolDefinitions } from './toolRuntime';
import { ChatMessage, LLMConfig, OrchestrationPlan } from '../shared/types';
import { RetrievedMemoryItem } from './turboVecMemory';

export interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
}

export interface OrchestrationResult {
  output: string;
  steps: Array<{ id: string; name: string; output: string }>;
}

export interface OrchestrationMemoryAdapter {
  retrieve: (config: LLMConfig, query: string, stepName: string) => Promise<RetrievedMemoryItem[]>;
  store: (config: LLMConfig, text: string, stepName: string) => Promise<void>;
}

export async function runOrchestration(
  plan: OrchestrationPlan,
  userPrompt: string,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter
): Promise<OrchestrationResult> {
  let priorOutput = userPrompt;
  const steps: Array<{ id: string; name: string; output: string }> = [];

  for (const step of plan.steps) {
    onEvent?.(`step:start:${step.name}`);

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
      const recalled = await memoryAdapter.retrieve(config, `${userPrompt}\n\n${priorOutput}`, step.name);
      if (recalled.length > 0) {
        messages.push({
          role: 'system',
          content:
            'Relevant long-term memory for this orchestration step is available below. Use it when helpful and ignore stale items.\n\n' +
            recalled.map((item, index) => `${index + 1}. [${item.source}] ${item.text}`).join('\n')
        });
      }
    }

    messages.push({
      role: 'user',
      content: `Original request:\n${userPrompt}\n\nStep input:\n${priorOutput}`
    });

    const allowedToolNames = step.tools.filter(tool => tool.enabled).map(tool => tool.name);
    const toolDefs = getAllowedToolDefinitions(allowedToolNames);

    const output = await chatWithTools(
      config,
      messages,
      toolDefs,
      async (name, args) => {
        if (!allowedToolNames.includes(name)) {
          throw new Error(`Tool ${name} is not enabled in step ${step.name}.`);
        }
        return executeTool(name, args, runtimeContext);
      },
      event => onEvent?.(`${step.name}:${event}`)
    );

    if (memoryAdapter) {
      await memoryAdapter.store(config, output, step.name);
    }

    steps.push({ id: step.id, name: step.name, output });
    onEvent?.(`step:end:${step.name}`);

    if (step.passOutputToNext) {
      priorOutput = output;
    }
  }

  return {
    output: steps.length ? steps[steps.length - 1].output : '',
    steps
  };
}
