import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Read the renderer chat source used for tool registration handoff.
 *
 * Purpose: keep this regression test close to the deployed renderer source.
 * Inputs: none.
 * Outputs: renderer app.js source code as UTF-8 text.
 * Side effects: filesystem read only.
 */
function readRendererAppSource(): string {
  const rendererPath = path.resolve(__dirname, '../../renderer/app.js');
  return fs.readFileSync(rendererPath, 'utf8');
}

/**
 * Verify renderer requests chat tool names from backend IPC.
 *
 * Purpose: ensure frontend registration uses backend source-of-truth to avoid
 * hardcoded drift.
 * Inputs: renderer app.js source text.
 * Outputs: assertions over source-level integration markers.
 * Side effects: none.
 */
test('renderer chat flow requests default tool names from backend', () => {
  const source = readRendererAppSource();
  const chatStreamCallStart = source.indexOf('window.llmIde.chatStream({');
  assert.ok(chatStreamCallStart >= 0, 'Expected renderer chatStream invocation.');

  const snippet = source.slice(chatStreamCallStart, chatStreamCallStart + 5000);
  assert.match(source, /getDefaultChatToolNames\s*\(/);
  assert.match(snippet, /toolNames\s*:\s*chatToolNames/);
});

/**
 * Verify renderer no longer contains an inline hardcoded tool array in chat payload.
 *
 * Purpose: catch regressions where frontend reintroduces static tool names that
 * can drift from backend registrations.
 * Inputs: renderer app.js source text.
 * Outputs: assertion that hardcoded array syntax is absent in chat payload.
 * Side effects: none.
 */
test('renderer chat flow does not hardcode toolNames array literals', () => {
  const source = readRendererAppSource();
  const chatStreamCallStart = source.indexOf('window.llmIde.chatStream({');
  assert.ok(chatStreamCallStart >= 0, 'Expected renderer chatStream invocation.');

  const snippet = source.slice(chatStreamCallStart, chatStreamCallStart + 5000);
  assert.doesNotMatch(snippet, /toolNames\s*:\s*\[/);
});
