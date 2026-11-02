import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';

/** Execute the built preload against isolated IPC mocks; never load Electron or user data. */
async function loadBrowserBridge() {
  const ipc = new EventEmitter();
  const calls: unknown[][] = [];
  let exposed: { name: string; api: Record<string, (...args: any[]) => any> } | undefined;
  const result = { ok: true };
  const source = await fs.readFile(path.resolve(__dirname, '../preload.js'), 'utf8');
  vm.runInNewContext(source, {
    exports: {},
    // Only the Electron boundary is permitted in the sandboxed preload.
    require(id: string) {
      assert.equal(id, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld(name: string, api: Record<string, (...args: any[]) => any>) {
            exposed = { name, api };
          }
        },
        ipcRenderer: {
          on: ipc.on.bind(ipc),
          removeListener: ipc.removeListener.bind(ipc),
          async invoke(...args: unknown[]) {
            calls.push(args);
            return result;
          }
        }
      };
    }
  });
  assert.equal(exposed?.name, 'llmIde');
  return { api: exposed!.api, ipc, calls, result };
}

test('npm start builds the main/preload pair before launching Electron', async () => {
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../package.json'), 'utf8'));
  assert.equal(manifest.scripts.prestart, 'npm run build');
  assert.equal(manifest.scripts.start, 'electron .');
});

test('compiled browser bridge forwards every request to its fixed IPC channel', async () => {
  const { api, calls, result } = await loadBrowserBridge();
  const requests: [string, string, unknown?][] = [
    ['getBrowserFeatureState', 'browser:get-feature-state'],
    ['setBrowserFeatureEnabled', 'browser:set-feature-enabled', { enabled: true }],
    ['createBrowserSession', 'browser:create-session'],
    ['destroyBrowserSession', 'browser:destroy-session'],
    ['getBrowserState', 'browser:get-state'],
    ['navigateBrowser', 'browser:navigate', { url: 'https://example.com' }],
    ['getBrowserSnapshot', 'browser:get-snapshot'],
    ['captureBrowser', 'browser:capture', { format: 'png' }],
    ['setBrowserBounds', 'browser:set-bounds', { x: 0, y: 0, width: 800, height: 600, visible: true }],
    ['interactBrowser', 'browser:interact', { action: 'click', selector: 'button' }]
  ];
  for (const [method, channel, payload] of requests) {
    assert.equal(typeof api[method], 'function', `Missing built preload method: ${method}`);
    const args = payload === undefined ? [] : [payload];
    assert.equal(await api[method](...args), result);
    assert.deepEqual(calls.pop(), [channel, ...args]);
  }
});

test('compiled onBrowserEvent strips the Electron event and unsubscribes only its listener', async () => {
  const { api, ipc } = await loadBrowserBridge();
  assert.equal(typeof api.onBrowserEvent, 'function');
  const received: unknown[][] = [];
  const other: unknown[] = [];
  const off = api.onBrowserEvent((...args: unknown[]) => received.push(args));
  const offOther = api.onBrowserEvent((state: unknown) => other.push(state));
  const state = { sessionActive: true, currentUrl: 'https://example.com' };
  ipc.emit('browser:event', { sender: 'must not cross bridge' }, state);
  assert.deepEqual(received, [[state]]);
  off();
  off(); // Cleanup is safe when invoked repeatedly.
  ipc.emit('browser:event', {}, state);
  assert.equal(received.length, 1);
  assert.equal(other.length, 2);
  offOther();
  assert.equal(ipc.listenerCount('browser:event'), 0);
});

// Opt in on machines that can launch Electron; use a hidden window and disposable profile only.
test('real isolated Electron exposes browser calls and events across context isolation', {
  skip: process.env.LOCALCODE_TEST_ELECTRON_BROWSER !== '1'
}, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-browser-bridge-'));
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [
      path.resolve(__dirname, 'fixtures/browserBridge.fixture.js'), profile,
      path.resolve(__dirname, '../preload.js')
    ], { cwd: profile, env, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /browser bridge integration passed/);
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});