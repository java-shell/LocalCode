import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessionManager } from '../backend/browserSessionManager';

test('BrowserSessionManager is disabled by default and rejects session creation', () => {
  const manager = new BrowserSessionManager({ enabled: false });
  const feature = manager.getFeatureState();
  assert.equal(feature.enabled, false);

  const created = manager.createSession();
  assert.equal(created.ok, false);
  assert.equal(created.reason, 'feature_disabled');
  assert.equal(created.state.sessionActive, false);
});

test('BrowserSessionManager enters embedded mode when enabled and requires host window', () => {
  const manager = new BrowserSessionManager({ enabled: true });
  const feature = manager.getFeatureState();
  assert.equal(feature.enabled, true);
  assert.equal(feature.mode, 'embedded');

  const created = manager.createSession();
  assert.equal(created.ok, false);
  assert.equal(created.reason, 'host_window_unavailable');
});
