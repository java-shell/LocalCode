import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSubAgentToolTurns,
  clampToolTurns,
  DEFAULT_CHAT_TOOL_TURNS,
  DEFAULT_SUB_AGENT_TOOL_TURNS,
  MAX_SUB_AGENT_TOOL_TURNS,
  MAX_TOOL_TURNS
} from '../shared/toolBudget';

/**
 * Contract tests for the single source of truth behind every tool-turn budget.
 *
 * Purpose: pin the 1000 ceiling and 250 chat default so the UI, IPC handler, plan
 * schema, chat loop and sub-agent runtime cannot drift apart again.
 * Inputs: none; the shared module is imported directly.
 * Outputs: assertions on the exported constants and clamp boundaries.
 * Side effects: none, the module is pure.
 * Errors: assertion failures report the exact boundary that moved.
 * Performance: constant-time checks.
 * Security/privacy: no user data or secrets involved.
 * Concurrency: read-only and safe to run concurrently.
 * Rationale: the previous bug was fragmented ceilings (200 vs 50) that silently
 * re-clamped a user's setting, so the boundaries themselves are the contract.
 */
test('tool budget constants expose the agreed ceiling and defaults', () => {
  assert.equal(MAX_TOOL_TURNS, 1000);
  assert.equal(DEFAULT_CHAT_TOOL_TURNS, 250);
  assert.equal(MAX_SUB_AGENT_TOOL_TURNS, 1000);
  assert.equal(DEFAULT_SUB_AGENT_TOOL_TURNS, 8);
});

test('clampToolTurns accepts the full 1-1000 range', () => {
  assert.equal(clampToolTurns(1), 1);
  assert.equal(clampToolTurns(40), 40);
  assert.equal(clampToolTurns(250), 250);
  assert.equal(clampToolTurns(MAX_TOOL_TURNS), MAX_TOOL_TURNS);
});

test('clampToolTurns caps values above the ceiling and floors fractional values', () => {
  assert.equal(clampToolTurns(MAX_TOOL_TURNS + 1), MAX_TOOL_TURNS);
  assert.equal(clampToolTurns(99999), MAX_TOOL_TURNS);
  assert.equal(clampToolTurns(12.9), 12);
});

test('clampToolTurns falls back to the default for unusable values', () => {
  assert.equal(clampToolTurns(0), DEFAULT_CHAT_TOOL_TURNS);
  assert.equal(clampToolTurns(-5), DEFAULT_CHAT_TOOL_TURNS);
  assert.equal(clampToolTurns(Number.NaN), DEFAULT_CHAT_TOOL_TURNS);
  assert.equal(clampToolTurns(undefined), DEFAULT_CHAT_TOOL_TURNS);
  assert.equal(clampToolTurns('not-a-number'), DEFAULT_CHAT_TOOL_TURNS);
  assert.equal(clampToolTurns('300'), 300);
});

test('clampToolTurns honors an explicit fallback for orchestration steps', () => {
  assert.equal(clampToolTurns(undefined, 8), 8);
  assert.equal(clampToolTurns(0, 8), 8);
  assert.equal(clampToolTurns(600, 8), 600);
});

test('clampSubAgentToolTurns uses the sub-agent ceiling and default', () => {
  assert.equal(clampSubAgentToolTurns(1), 1);
  assert.equal(clampSubAgentToolTurns(999), 999);
  assert.equal(clampSubAgentToolTurns(MAX_SUB_AGENT_TOOL_TURNS), MAX_SUB_AGENT_TOOL_TURNS);
  assert.equal(clampSubAgentToolTurns(MAX_SUB_AGENT_TOOL_TURNS + 1), MAX_SUB_AGENT_TOOL_TURNS);
  assert.equal(clampSubAgentToolTurns(9999), MAX_SUB_AGENT_TOOL_TURNS);
  assert.equal(clampSubAgentToolTurns(undefined), DEFAULT_SUB_AGENT_TOOL_TURNS);
  assert.equal(clampSubAgentToolTurns(0), DEFAULT_SUB_AGENT_TOOL_TURNS);
  assert.equal(clampSubAgentToolTurns(Number.NaN), DEFAULT_SUB_AGENT_TOOL_TURNS);
});
