import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultChatToolNames, toolDefinitions } from '../backend/toolRuntime';

/**
 * Verify default chat tool names are derived from backend tool registrations.
 *
 * Purpose: prevent drift between declared tools and default chat allowlist.
 * Inputs: backend tool definitions and computed default chat tool names.
 * Outputs: assertions on inclusion/exclusion and ordering behavior.
 * Side effects: none.
 */
test('default chat tool names are derived from backend definitions and exclude denylisted tools', () => {
  const defaults = getDefaultChatToolNames();
  const declared = toolDefinitions.map(def => def.function.name);

  assert.ok(defaults.length > 0);
  assert.equal(defaults.includes('delete_path'), false);
  assert.equal(defaults.includes('git_commit'), false);

  const expected = declared.filter(name => name !== 'delete_path' && name !== 'git_commit');
  assert.deepEqual(defaults, expected);
});

/**
 * Verify integrated browser tools remain available in default chat tool names.
 *
 * Purpose: guard against accidental removal of embedded browser tools from
 * model-facing defaults.
 * Inputs: backend-computed default chat tool names.
 * Outputs: assertions that integrated browser tools are present.
 * Side effects: none.
 */
test('default chat tool names include integrated browser tools', () => {
  const defaults = new Set(getDefaultChatToolNames());
  assert.equal(defaults.has('browser_open_page'), true);
  assert.equal(defaults.has('browser_get_snapshot'), true);
  assert.equal(defaults.has('browser_screenshot'), true);
});
