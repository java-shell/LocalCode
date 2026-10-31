import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessionManager } from '../backend/browserSessionManager';

test('identical normalized bounds emit one event rather than feeding renderer IPC echo', () => {
  let events = 0;
  const manager = new BrowserSessionManager({ enabled: true, onStateChanged: () => { events++; } });
  const bounds = { x: 0, y: 0, width: 0, height: 0, visible: false };
  const first = manager.setBounds(bounds);
  for (let i = 0; i < 1000; i++) {
    const result = manager.setBounds({ ...bounds, x: 0.9 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.state, first.state);
  }
  assert.equal(events, 1);
  manager.setBounds({ ...bounds, width: 100 });
  assert.equal(events, 2);
  manager.setBounds({ ...bounds, width: 100, visible: true });
  assert.equal(events, 3);
});

test('state callback echo terminates after the first unchanged bounds update', () => {
  let events = 0;
  const bounds = { x: 1, y: 2, width: 100, height: 200, visible: true };
  const manager = new BrowserSessionManager({ enabled: true, onStateChanged: () => {
    events++;
    // Model the renderer's synchronous echo with a cap to detect loops safely.
    if (events < 20) manager.setBounds(bounds);
  } });
  manager.setBounds(bounds);
  assert.equal(events, 1);
});