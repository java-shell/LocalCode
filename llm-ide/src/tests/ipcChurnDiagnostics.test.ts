import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { App, IpcMain } from 'electron';
import { createIpcChurnMeter, createMeasuredIpcMain } from '../backend/ipcChurnDiagnostics';

test('churn meter computes rates, retains totals, resets intervals and bounds channels', () => {
  const meter = createIpcChurnMeter(0);
  for (let i = 0; i < 100; i++) meter.record('browser:set-bounds');
  const first = meter.snapshot(10000);
  assert.equal(first.intervalPerSecond, 10);
  assert.equal(first.total, 100);
  const second = meter.snapshot(20000);
  assert.equal(second.total, 100);
  assert.equal(second.intervalTotal, 0);
  assert.equal(second.channels[0].peakPerSecond, 10);
  for (let i = 0; i < 1000; i++) meter.record(`channel-${i}`);
  assert.ok(meter.snapshot(30000).channels.length <= 128);
});

test('diagnostics is disabled by default and preserves handler arguments/results/errors when enabled', async () => {
  const app = new EventEmitter() as unknown as Pick<App, 'once' | 'getPath' | 'getVersion'>;
  const listeners = new Map<string, (...args: any[]) => any>();
  const ipc = { handle(channel: string, listener: (...args: any[]) => any) {
    assert.equal(this, ipc);
    listeners.set(channel, listener);
  }, removeHandler(channel: string) { assert.equal(this, ipc); listeners.delete(channel); } } as unknown as IpcMain;
  assert.equal(createMeasuredIpcMain(app, ipc, false), ipc);
  const measured = createMeasuredIpcMain(app, ipc, true);
  const event = { sender: {} };
  const payload = { secret: 'not recorded' };
  measured.handle('ok', (actualEvent, actualPayload) => {
    assert.equal(actualEvent, event);
    assert.equal(actualPayload, payload);
    return Promise.resolve(42);
  });
  assert.equal(await listeners.get('ok')!(event, payload), 42);
  const error = new Error('original');
  measured.handle('fail', () => { throw error; });
  assert.throws(() => listeners.get('fail')!(event), error);
  measured.removeHandler('ok');
  assert.equal(listeners.has('ok'), false);
});

test('ready/quit writes aggregate counts privately without IPC payloads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-churn-test-'));
  const app = Object.assign(new EventEmitter(), {
    getPath: () => directory, getVersion: () => 'test'
  });
  let handler: ((...args: any[]) => any) | undefined;
  const ipc = { handle: (_channel: string, listener: (...args: any[]) => any) => { handler = listener; } } as unknown as IpcMain;
  try {
    const measured = createMeasuredIpcMain(app as unknown as App, ipc, true);
    measured.handle('browser:set-bounds', () => 'result');
    app.emit('ready');
    handler!({}, { secret: 'NEVER_WRITE_PAYLOAD' });
    app.emit('will-quit');
    const file = path.join(directory, 'debug', 'ipc-churn.json');
    const text = fs.readFileSync(file, 'utf8');
    const report = JSON.parse(text);
    assert.equal(report.latest.total, 1);
    assert.equal(report.latest.channels[0].channel, 'browser:set-bounds');
    assert.doesNotMatch(text, /NEVER_WRITE_PAYLOAD|secret/);
    assert.ok(report.windows.length <= 60);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    app.emit('will-quit');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});