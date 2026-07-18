import { OrchestrationPlan } from '../shared/types';

function baseStageId(value: unknown, index: number): string {
  const trimmed = String(value ?? '').trim();
  return trimmed || `agentic-stage-${index + 1}`;
}

function buildUniqueStageId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

// Backward compatibility: old plans with duplicate advanced stage IDs are normalized
// to unique IDs in deterministic order, and advanced links are remapped to the first
// stage for each legacy ID so existing plans remain loadable.
export function normalizeAdvancedStageIds(plan: OrchestrationPlan): OrchestrationPlan {
  const advanced = plan?.advanced;
  if (!advanced || !Array.isArray(advanced.stages) || advanced.stages.length === 0) {
    return plan;
  }

  const usedIds = new Set<string>();
  const firstResolvedByOriginal = new Map<string, string>();
  const normalizedStages = advanced.stages.map((stage, index) => {
    const originalId = baseStageId(stage?.id, index);
    const uniqueId = buildUniqueStageId(originalId, usedIds);
    if (!firstResolvedByOriginal.has(originalId)) {
      firstResolvedByOriginal.set(originalId, uniqueId);
    }
    return {
      ...stage,
      id: uniqueId
    };
  });

  const resolveLegacyId = (value: unknown): string => {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return raw;
    }
    return firstResolvedByOriginal.get(raw) || raw;
  };

  const normalizedLinks = Array.isArray(advanced.links)
    ? advanced.links.map(link => ({
      ...link,
      fromStageId: resolveLegacyId(link?.fromStageId),
      toStageId: resolveLegacyId(link?.toStageId)
    }))
    : [];

  return {
    ...plan,
    advanced: {
      ...advanced,
      entryStageId: resolveLegacyId(advanced.entryStageId),
      stages: normalizedStages,
      links: normalizedLinks
    }
  };
}

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
      maxRetries: 1,
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
      maxRetries: 1,
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
  const hasBasicSteps = Array.isArray(plan.steps) && plan.steps.length > 0;
  const hasAdvancedStages = Boolean(
    plan.advanced &&
    typeof plan.advanced === 'object' &&
    Array.isArray(plan.advanced.stages) &&
    plan.advanced.stages.length > 0
  );
  if (!hasBasicSteps && !hasAdvancedStages) {
    errors.push('steps must contain at least one step, or advanced.stages must contain at least one stage.');
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

  for (const [i, step] of (Array.isArray(plan.steps) ? plan.steps : []).entries()) {
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
    if (step.maxRetries !== undefined) {
      const maxRetries = Number(step.maxRetries);
      if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
        errors.push(`steps[${i}].maxRetries must be an integer between 0 and 10 when provided.`);
      }
    }
  }

  if (plan.advanced !== undefined) {
    const advanced = plan.advanced as Partial<OrchestrationPlan['advanced']>;
    if (!advanced || typeof advanced !== 'object') {
      errors.push('advanced must be an object when provided.');
    } else {
      if (advanced.enabled !== undefined && typeof advanced.enabled !== 'boolean') {
        errors.push('advanced.enabled must be a boolean when provided.');
      }
      if (advanced.maxStageExecutions !== undefined) {
        const maxStageExecutions = Number(advanced.maxStageExecutions);
        if (!Number.isInteger(maxStageExecutions) || maxStageExecutions < 1 || maxStageExecutions > 300) {
          errors.push('advanced.maxStageExecutions must be an integer between 1 and 300 when provided.');
        }
      }
      if (!Array.isArray(advanced.stages)) {
        errors.push('advanced.stages must be an array when advanced is provided.');
      }
      if (!Array.isArray(advanced.links)) {
        errors.push('advanced.links must be an array when advanced is provided.');
      }

      if (Array.isArray(advanced.stages)) {
        const seenIds = new Set<string>();
        for (const [index, stage] of advanced.stages.entries()) {
          const stageId = String(stage?.id ?? '').trim();
          if (!stageId) {
            errors.push(`advanced.stages[${index}].id is required.`);
            continue;
          }
          if (seenIds.has(stageId)) {
            errors.push(`advanced.stages[${index}].id must be unique (duplicate: ${stageId}).`);
            continue;
          }
          seenIds.add(stageId);
        }

        if (Array.isArray(advanced.links)) {
          const stageIndexById = new Map<string, number>();
          for (const [index, stage] of advanced.stages.entries()) {
            const stageId = String(stage?.id ?? '').trim();
            if (stageId) {
              stageIndexById.set(stageId, index);
            }
          }

          for (const [linkIndex, link] of advanced.links.entries()) {
            const fromStageId = String(link?.fromStageId ?? '').trim();
            const toStageId = String(link?.toStageId ?? '').trim();
            const fromIndex = stageIndexById.get(fromStageId);
            const toIndex = stageIndexById.get(toStageId);
            if (fromIndex === undefined || toIndex === undefined) {
              continue;
            }
            if (toIndex <= fromIndex) {
              errors.push(`advanced.links[${linkIndex}] must target a downstream stage appearing later in advanced.stages.`);
            }
          }
        }
      }
    }
  }

  return errors;
}
