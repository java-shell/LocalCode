import { chatWithTools } from './llmClient';
import { executeTool, getAllowedToolDefinitions } from './toolRuntime';
import { ChatMessage, OrchestrationPlan } from '../shared/types';

export interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
}

export interface OrchestrationResult {
  output: string;
  steps: Array<{ id: string; name: string; output: string }>;
}

export async function runOrchestration(
  plan: OrchestrationPlan,
  userPrompt: string,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext
): Promise<OrchestrationResult> {
  let priorOutput = userPrompt;
  const steps: Array<{ id: string; name: string; output: string }> = [];

  for (const step of plan.steps) {
    onEvent?.(`step:start:${step.name}`);

    const messages: ChatMessage[] = [];
    if (step.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: step.systemPrompt });
    }
    messages.push({
      role: 'user',
      content: `Original request:\n${userPrompt}\n\nStep input:\n${priorOutput}`
    });

    const allowedToolNames = step.tools.filter(tool => tool.enabled).map(tool => tool.name);
    const toolDefs = getAllowedToolDefinitions(allowedToolNames);

    const output = await chatWithTools(
      {
        endpoint: step.endpoint,
        model: step.model,
        apiKey: step.apiKey,
        temperature: step.temperature ?? 0.2,
        maxTokens: step.maxTokens
      },
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
