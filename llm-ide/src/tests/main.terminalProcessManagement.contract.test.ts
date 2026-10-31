import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

async function readMainSource(): Promise<string> {
  const mainPath = path.resolve(__dirname, '..', '..', 'src', 'main.ts');
  return fs.readFile(mainPath, 'utf8');
}

test('main process exposes terminal process list and pid-targeted interrupt handlers', async () => {
  const source = await readMainSource();

  assert.match(source, /ipcMain\.handle\('terminal:list-processes'/);
  assert.match(source, /ipcMain\.handle\('terminal:interrupt',\s*async\s*\(_event,\s*payload\?:\s*\{\s*pid\?:\s*number/);
  assert.match(source, /terminalProcessRegistry/);
  assert.match(source, /interruptTrackedTerminalProcess\(\{\s*pid:/);
});

test('main process routes terminal input to selected pid when provided', async () => {
  const source = await readMainSource();

  assert.match(source, /ipcMain\.handle\('terminal:send-input',\s*async\s*\(_event,\s*payload:\s*\{\s*text:\s*string;\s*pid\?:\s*number\s*\}/);
  assert.match(source, /getChildForInput\(/);
});
