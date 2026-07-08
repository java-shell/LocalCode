import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { defaultPlan, normalizeAdvancedStageIds, validatePlan } from './schema';
import { OrchestrationPlan } from '../shared/types';

function getPlanPath(): string {
  return path.join(app.getPath('userData'), 'orchestration.plan.json');
}

export async function loadPlan(): Promise<OrchestrationPlan> {
  const file = getPlanPath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = normalizeAdvancedStageIds(JSON.parse(raw) as OrchestrationPlan);
    const errors = validatePlan(parsed);
    if (errors.length > 0) {
      return defaultPlan;
    }
    return parsed;
  } catch {
    return defaultPlan;
  }
}

export async function savePlan(plan: OrchestrationPlan): Promise<void> {
  const normalized = normalizeAdvancedStageIds(plan);
  const errors = validatePlan(normalized);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  const file = getPlanPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(normalized, null, 2), 'utf8');
}
