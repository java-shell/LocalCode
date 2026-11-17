import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../backend/schema';
import { MAX_TOOL_TURNS } from '../shared/toolBudget';

/**
 * Build a minimal valid orchestration plan with a chosen per-step tool budget.
 *
 * Purpose: isolate the maxToolTurns validation from every other plan rule.
 * Inputs: the maxToolTurns value to place on the single step (undefined omits it).
 * Outputs: a plan object that passes every other validatePlan rule.
 * Side effects: none.
 * Errors: none; validation errors are returned by validatePlan, not thrown.
 * Performance: constant-time object literal.
 * Security/privacy: no user data.
 * Concurrency: read-only factory, safe to run concurrently.
 * Rationale: validatePlan rejects the whole plan on any error, so the fixture must
 * be otherwise clean for the maxToolTurns assertion to be meaningful.
 */
function makePlan(maxToolTurns: number | undefined): Record<string, unknown> {
  const step: Record<string, unknown> = {
    id: 'step-1',
    name: 'Inspect workspace',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3',
    tools: ['read_file']
  };
  if (maxToolTurns !== undefined) {
    step.maxToolTurns = maxToolTurns;
  }

  return {
    version: 1,
    name: 'Budget ceiling plan',
    description: 'Plan used to verify the shared step tool-turn ceiling.',
    steps: [step]
  };
}

test('validatePlan accepts a step maxToolTurns at the shared 1000 ceiling', () => {
  const errors = validatePlan(makePlan(MAX_TOOL_TURNS));

  assert.deepEqual(errors, []);
});

test('validatePlan accepts a step maxToolTurns below the ceiling', () => {
  assert.deepEqual(validatePlan(makePlan(250)), []);
  assert.deepEqual(validatePlan(makePlan(1)), []);
});

test('validatePlan rejects a step maxToolTurns above the ceiling with the shared limit', () => {
  const errors = validatePlan(makePlan(MAX_TOOL_TURNS + 1));

  assert.equal(errors.length, 1);
  assert.equal(
    errors[0],
    `steps[0].maxToolTurns must be an integer between 1 and ${MAX_TOOL_TURNS} when provided.`
  );
});

test('validatePlan rejects a non-integer or non-positive step maxToolTurns', () => {
  assert.match(validatePlan(makePlan(0))[0] ?? '', /maxToolTurns must be an integer between 1 and 1000/);
  assert.match(validatePlan(makePlan(12.5))[0] ?? '', /maxToolTurns must be an integer between 1 and 1000/);
});
