import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read preload source for continuity/recovery bridge contract checks.
 *
 * Purpose: guard IPC bridge method names used by renderer continuity and
 * interrupted-turn recovery features.
 */
async function readPreloadSource(): Promise<string> {
  const preloadPath = path.resolve(__dirname, '..', '..', 'src', 'preload.ts');
  return fs.readFile(preloadPath, 'utf8');
}

test('preload exposes P0 continuity bridge methods', async () => {
  const source = await readPreloadSource();

  assert.match(source, /getUiContinuityState:\s*async/);
  assert.match(source, /workspace:get-ui-continuity/);
  assert.match(source, /updateUiContinuityState:\s*async/);
  assert.match(source, /workspace:update-ui-continuity/);
});

test('preload exposes P1 interrupted-turn bridge methods', async () => {
  const source = await readPreloadSource();

  assert.match(source, /getInterruptedChatTurn:\s*async/);
  assert.match(source, /chat:get-interrupted-turn/);
  assert.match(source, /resolveInterruptedChatTurn:\s*async/);
  assert.match(source, /chat:resolve-interrupted-turn/);
});
