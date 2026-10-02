import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read renderer source for continuity/recovery UI contracts.
 *
 * Purpose: preserve startup continuity wiring and interrupted-turn controls
 * without a browser DOM harness.
 */
async function readRendererSource(): Promise<string> {
  const rendererPath = path.resolve(__dirname, '..', '..', 'renderer', 'app.js');
  return fs.readFile(rendererPath, 'utf8');
}

test('renderer restores and persists P0 continuity state', async () => {
  const source = await readRendererSource();

  assert.match(source, /window\.llmIde\.getUiContinuityState\(\)/);
  assert.match(source, /window\.llmIde\.updateUiContinuityState\(payload\)/);
  assert.match(source, /activeChatSessionIdByWorkspace/);
  assert.match(source, /settingsState\.chatDraftText/);
  assert.match(source, /setActiveTab\(settingsState\.activeTab\)/);
});

test('renderer exposes interrupted-turn recovery UI and sends turn identifiers', async () => {
  const source = await readRendererSource();

  assert.match(source, /window\.llmIde\.getInterruptedChatTurn\(\{ sessionId: activeChatSessionId \}\)/);
  assert.match(source, /window\.llmIde\.resolveInterruptedChatTurn\(\{/);
  assert.match(source, /Interrupted Turn Recovered/);
  assert.match(source, /turnId:\s*createChatTurnId\(\)/);
  assert.match(source, /sessionId:\s*activeChatSessionId/);
});
