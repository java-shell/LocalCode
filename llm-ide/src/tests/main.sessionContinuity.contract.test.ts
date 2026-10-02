import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read main-process source for lightweight persistence/IPC contract checks.
 *
 * Purpose: protect continuity IPC names and persistence keys from accidental
 * regressions without requiring Electron runtime boot.
 */
async function readMainSource(): Promise<string> {
  const mainPath = path.resolve(__dirname, '..', '..', 'src', 'main.ts');
  return fs.readFile(mainPath, 'utf8');
}

test('main process exposes ui continuity IPC handlers', async () => {
  const source = await readMainSource();

  assert.match(source, /ipcMain\.handle\('workspace:get-ui-continuity'/);
  assert.match(source, /ipcMain\.handle\(\s*'workspace:update-ui-continuity'/);
  assert.match(source, /activeChatSessionIdByWorkspace/);
  assert.match(source, /continuityStateForWorkspace/);
});

test('main process exposes interrupted-turn recovery IPC handlers', async () => {
  const source = await readMainSource();

  assert.match(source, /ipcMain\.handle\('chat:get-interrupted-turn'/);
  assert.match(source, /ipcMain\.handle\(\s*'chat:resolve-interrupted-turn'/);
  assert.match(source, /upsertChatTurnCheckpoint/);
  assert.match(source, /resolveChatTurnCheckpoint/);
});
