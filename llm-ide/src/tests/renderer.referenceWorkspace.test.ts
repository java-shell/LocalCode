import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDefaultChatToolNames } from '../backend/toolRuntime';

/**
 * Read renderer source as plain text for lightweight regression contracts.
 *
 * Purpose: validate UI wiring contracts that are hard to unit test in Node without a DOM runtime.
 * Inputs: workspace-relative renderer path.
 * Outputs: full renderer source text.
 */
async function readRendererSource(): Promise<string> {
  const rendererPath = path.resolve(__dirname, '..', '..', 'renderer', 'app.js');
  return fs.readFile(rendererPath, 'utf8');
}

test('reference workspace handlers call an existing loadWorkspaceState helper', async () => {
  const source = await readRendererSource();

  assert.match(source, /async function loadWorkspaceState\(\)\s*\{/);
  assert.match(source, /window\.llmIde\.getWorkspaceState\(\)/);
  assert.match(source, /workspacePath\.textContent = `Workspace: \$\{state\.workspaceDir\}\\nRoot: \$\{state\.rootDir\}`/);

  const callSites = source.match(/loadWorkspaceState\(\);\s*\/\/ Refresh tool definitions/g) ?? [];
  assert.ok(callSites.length >= 4, 'Expected all reference workspace mutation handlers to invoke loadWorkspaceState().');
});

/**
 * Verify the reference-workspace discovery tools reach both chat and orchestration UIs.
 *
 * Purpose: keep the two discovery tools available to the model after commit e1bf313 moved the
 * chat tool allowlist to the backend IPC (`toolNames: chatToolNames`). The renderer no longer
 * hardcodes the list, so the contract is asserted against the backend source of truth
 * `getDefaultChatToolNames()` plus the orchestration tool picker in the renderer source.
 * Inputs: none (reads renderer/app.js and the compiled tool runtime).
 * Outputs: none; throws AssertionError when a discovery tool is missing from either surface.
 * Side effects: none. Errors: AssertionError with the missing tool named.
 * Performance: one file read plus one O(n) filter over registered tools.
 * Security: no workspace or network access.
 * Rationale: renderer.chatToolRegistrationSync.test.ts asserts the renderer must NOT hardcode a
 * `toolNames: [` literal, so asserting the literal here contradicted a passing test.
 */
test('chat and advanced orchestration expose reference workspace discovery tool', async () => {
  const source = await readRendererSource();

  const chatToolNames = getDefaultChatToolNames();
  assert.ok(chatToolNames.includes('list_reference_workspaces'), 'Expected chat tools to expose list_reference_workspaces.');
  assert.ok(chatToolNames.includes('list_mcp_servers'), 'Expected chat tools to expose list_mcp_servers.');
  assert.match(source, /toolNames:\s*chatToolNames/);

  assert.match(source, /const availableTools = \[\s*'list_reference_workspaces',\s*'list_mcp_servers'/);
  assert.match(source, /enabled:\s*\['list_reference_workspaces', 'list_mcp_servers', 'list_repo_tree', 'list_dir', 'read_file', 'grep_search'\]\.includes\(toolName\)/);
});
