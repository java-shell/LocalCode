import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

async function readRendererSource(fileName: string): Promise<string> {
  const filePath = path.resolve(__dirname, '..', '..', 'renderer', fileName);
  return fs.readFile(filePath, 'utf8');
}

test('renderer terminal panel includes pid picker controls', async () => {
  const html = await readRendererSource('index.html');

  assert.match(html, /id="terminalProcessSelect"/);
  assert.match(html, /id="terminalInterrupt"/);
});

test('renderer terminal workflow refreshes process list and targets selected pid for interrupts', async () => {
  const appJs = await readRendererSource('app.js');

  assert.match(appJs, /listTerminalProcesses\(/);
  assert.match(appJs, /interruptTerminalProcess\(\{\s*pid/);
  assert.match(appJs, /sendTerminalInput\(\{\s*text:\s*`\$\{raw\}\\n`,\s*pid\s*\}\)/);
});
