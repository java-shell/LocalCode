import { OrchestrationPlan } from '../shared/types';

export const defaultPlan: OrchestrationPlan = {
  version: 1,
  name: 'Planner -> Coder',
  description: 'Plan, inspect files, then implement with safe tools.',
  loopUntilComplete: false,
  maxLoops: 3,
  completionMarker: 'TASK_COMPLETE',
  steps: [
    {
      id: 'planner',
      name: 'Planner',
      provider: 'openai-compatible',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      model: 'llama3',
      contextWindowTokens: 32768,
      systemPrompt: 'Plan how to solve the user request and call tools as needed.',
      temperature: 0.2,
      maxTokens: 1200,
      maxToolTurns: 40,
      tools: [
        { name: 'browser_fetch', enabled: true },
        { name: 'list_repo_tree', enabled: true },
        { name: 'list_dir', enabled: true },
        { name: 'read_file', enabled: true },
        { name: 'grep_search', enabled: true },
        { name: 'git_status', enabled: true },
        { name: 'run_terminal_command', enabled: true }
      ],
      passOutputToNext: true,
      allowCompletionTool: false
    },
    {
      id: 'coder',
      name: 'Coder',
      provider: 'openai-compatible',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      model: 'llama3',
      contextWindowTokens: 32768,
      systemPrompt: 'Generate concrete implementation output and perform safe code edits using available tools.',
      temperature: 0.1,
      maxTokens: 2200,
      maxToolTurns: 40,
      tools: [
        { name: 'browser_fetch', enabled: true },
        { name: 'list_repo_tree', enabled: true },
        { name: 'file_search', enabled: true },
        { name: 'read_file', enabled: true },
        { name: 'create_file', enabled: true },
        { name: 'write_file', enabled: true },
        { name: 'replace_in_file', enabled: true },
        { name: 'insert_in_file', enabled: true },
        { name: 'create_directory', enabled: true },
        { name: 'move_path', enabled: true },
        { name: 'delete_path', enabled: false },
        { name: 'grep_search', enabled: true },
        { name: 'git_status', enabled: true },
        { name: 'git_diff', enabled: true },
        { name: 'run_terminal_command', enabled: true },
        { name: 'git_add', enabled: false },
        { name: 'git_commit', enabled: false }
      ],
      passOutputToNext: true,
      allowCompletionTool: true
    }
  ]
};

export function validatePlan(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') {
    return ['Plan must be a JSON object.'];
  }

  const plan = value as Partial<OrchestrationPlan>;
  if (plan.version !== 1) {
    errors.push('version must be 1.');
  }
  if (!plan.name || typeof plan.name !== 'string') {
    errors.push('name is required.');
  }
  if (!plan.description || typeof plan.description !== 'string') {
    errors.push('description is required.');
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('steps must contain at least one step.');
    return errors;
  }

  if (plan.loopUntilComplete !== undefined && typeof plan.loopUntilComplete !== 'boolean') {
    errors.push('loopUntilComplete must be a boolean when provided.');
  }
  if (plan.maxLoops !== undefined) {
    const maxLoops = Number(plan.maxLoops);
    if (!Number.isInteger(maxLoops) || maxLoops < 1 || maxLoops > 20) {
      errors.push('maxLoops must be an integer between 1 and 20.');
    }
  }
  if (plan.completionMarker !== undefined && typeof plan.completionMarker !== 'string') {
    errors.push('completionMarker must be a string when provided.');
  }

  for (const [i, step] of plan.steps.entries()) {
    if (!step.id) {
      errors.push(`steps[${i}].id is required.`);
    }
    if (!step.name) {
      errors.push(`steps[${i}].name is required.`);
    }
    if (!step.endpoint) {
      errors.push(`steps[${i}].endpoint is required.`);
    }
    if (!step.model) {
      errors.push(`steps[${i}].model is required.`);
    }
    if (step.contextWindowTokens !== undefined) {
      const contextWindowTokens = Number(step.contextWindowTokens);
      if (!Number.isInteger(contextWindowTokens) || contextWindowTokens < 1) {
        errors.push(`steps[${i}].contextWindowTokens must be an integer greater than 0 when provided.`);
      }
    }
    if (!Array.isArray(step.tools)) {
      errors.push(`steps[${i}].tools must be an array.`);
    }
    if (step.allowCompletionTool !== undefined && typeof step.allowCompletionTool !== 'boolean') {
      errors.push(`steps[${i}].allowCompletionTool must be a boolean when provided.`);
    }
    if (step.maxToolTurns !== undefined) {
      const maxToolTurns = Number(step.maxToolTurns);
      if (!Number.isInteger(maxToolTurns) || maxToolTurns < 1 || maxToolTurns > 200) {
        errors.push(`steps[${i}].maxToolTurns must be an integer between 1 and 200 when provided.`);
      }
    }
  }

  return errors;
}
