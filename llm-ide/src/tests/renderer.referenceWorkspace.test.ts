import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

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
