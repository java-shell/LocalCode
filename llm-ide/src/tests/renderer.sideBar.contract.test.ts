import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Read shipped UI/IPC sources without launching the real app or accessing user history. */
async function sources() {
  const root = path.resolve(__dirname, '../..');
  const [html, renderer, preload, main, store] = await Promise.all([
    'renderer/index.html', 'renderer/app.js', 'src/preload.ts', 'src/main.ts', 'src/backend/chatSessionStore.ts'
  ].map(file => fs.readFile(path.join(root, file), 'utf8')));
  return { html, renderer, preload, main, store };
}

test('Side-Bar UI is next to Send with accessible state and a dedicated no-guidance route', async () => {
  const { html, renderer, preload } = await sources();
  assert.match(html, /id="chatSend"[\s\S]*?id="chatSideBar"[^>]*aria-pressed="false"/);
  assert.match(html, /id="chatSideBarStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(renderer, /sideBarMode === 'paused'[\s\S]*?await sendSideBarMessage\(text\);\s*return;/);
  assert.match(renderer, /action: 'message', content: text/);
  assert.match(renderer, /paused: 'Resume Work'/);
  assert.match(renderer, /offSideBarState\(\)/);
  assert.match(preload, /ipcRenderer\.invoke\('chat:sidebar', payload\)/);
  assert.match(preload, /removeListener\('chat:sidebar-state', wrapped\)/);
});

test('Side-Bar validates ownership, wires the safe boundary, and persists labels without new work runs', async () => {
  const { main, store, renderer } = await sources();
  assert.match(main, /event\.sender !== activeChatSender/);
  assert.match(main, /payload\.sessionId !== activeChatSessionId/);
  assert.match(main, /atSafeBoundary: reply => sideBar\.atBoundary\(reply, abortController\.signal\)/);
  assert.match(main, /attempt > 0\) attemptMessages\.push\(\.\.\.sideBar\.transcript\)/);
  assert.match(store, /sideBar: message\.sideBar === true \? true : undefined/);
  assert.match(renderer, /renderAssistantMessage\(String\(message\.content \|\| ''\), message\.sideBar === true\)/);
  const send = renderer.slice(renderer.indexOf('async function sendSideBarMessage'), renderer.indexOf('function clearGuidanceIndicatorResetTimer'));
  assert.match(send, /await persistActiveChatSession\(\)/);
  assert.doesNotMatch(send, /chatStream\(|injectChatGuidance\(/);
});