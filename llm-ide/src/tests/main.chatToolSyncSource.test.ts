import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Read main-process source for chat tool synchronization assertions.
 *
 * Purpose: ensure chat defaults and IPC export are wired from backend source of
 * truth in main process.
 * Inputs: none.
 * Outputs: main.ts source as UTF-8 text.
 * Side effects: filesystem read only.
 */
function readMainSource(): string {
  const mainPath = path.resolve(__dirname, '../../src/main.ts');
  return fs.readFileSync(mainPath, 'utf8');
}

/**
 * Verify main process falls back to backend-derived default chat tool names.
 *
 * Purpose: catch regressions where main reintroduces manual filtering logic.
 * Inputs: main.ts source text.
 * Outputs: assertions over helper usage in chat stream path.
 * Side effects: none.
 */
test('main chat stream uses backend default chat tool helper for fallback', () => {
  const source = readMainSource();
  assert.match(source, /const\s+defaultChatToolNames\s*=\s*getDefaultChatToolNames\(\)/);
  assert.match(source, /:\s*defaultChatToolNames;/);
});

/**
 * Verify main exposes default chat tool names over IPC.
 *
 * Purpose: ensure renderer can request backend-owned tool defaults instead of
 * hardcoding names.
 * Inputs: main.ts source text.
 * Outputs: assertions over chat tool-name IPC handler.
 * Side effects: none.
 */
test('main exposes chat:get-default-tool-names IPC endpoint', () => {
  const source = readMainSource();
  assert.match(source, /ipcMain\.handle\('chat:get-default-tool-names'/);
  assert.match(source, /toolNames:\s*getDefaultChatToolNames\(\)/);
});
