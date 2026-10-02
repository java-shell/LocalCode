import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  getLatestInterruptedChatTurn,
  resolveChatTurnCheckpoint,
  setChatTurnCheckpointStorePathForTests,
  upsertChatTurnCheckpoint
} from '../backend/chatTurnCheckpointStore';

/**
 * Create an isolated temporary directory for checkpoint-store tests.
 *
 * Purpose: avoid cross-test interference from shared filesystem state.
 * Outputs: absolute path to a writable temp directory.
 */
async function createTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'localcode-checkpoints-'));
}

/**
 * Remove a temporary directory recursively.
 *
 * Purpose: clean up test artifacts regardless of pass/fail outcomes.
 * Inputs: temp directory path created by createTempRoot.
 */
async function cleanupTempRoot(tmpDir: string): Promise<void> {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

test.describe('chat turn checkpoint store', () => {
  let tmpDir = '';
  let storePath = '';

  test.beforeEach(async () => {
    tmpDir = await createTempRoot();
    storePath = path.join(tmpDir, 'chat-turn-checkpoints.json');
    setChatTurnCheckpointStorePathForTests(storePath);
  });

  test.afterEach(async () => {
    setChatTurnCheckpointStorePathForTests(null);
    await cleanupTempRoot(tmpDir);
  });

  test('returns latest unresolved interrupted checkpoint for a session', async () => {
    await upsertChatTurnCheckpoint({
      sessionId: 'session-a',
      turnId: 'turn-1',
      workspaceDir: '/tmp/ws',
      prompt: 'first prompt',
      model: 'llama3',
      state: 'interrupted',
      interrupted: true,
      resolved: false,
      lastError: 'socket closed'
    });

    await upsertChatTurnCheckpoint({
      sessionId: 'session-a',
      turnId: 'turn-2',
      workspaceDir: '/tmp/ws',
      prompt: 'second prompt',
      model: 'llama3',
      state: 'completed',
      interrupted: false,
      resolved: true,
      resolution: 'completed'
    });

    const latest = await getLatestInterruptedChatTurn('session-a');

    assert.ok(latest, 'Expected interrupted checkpoint to be returned');
    assert.equal(latest?.turnId, 'turn-1');
    assert.equal(latest?.state, 'interrupted');
    assert.equal(latest?.resolved, false);
  });

  test('resolving a checkpoint removes it from interrupted recovery', async () => {
    await upsertChatTurnCheckpoint({
      sessionId: 'session-b',
      turnId: 'turn-9',
      workspaceDir: '/tmp/ws',
      prompt: 'need retry',
      model: 'llama3',
      state: 'interrupted',
      interrupted: true,
      resolved: false
    });

    const resolved = await resolveChatTurnCheckpoint('session-b', 'turn-9', 'dismissed');
    assert.ok(resolved, 'Expected checkpoint to resolve');
    assert.equal(resolved?.resolved, true);
    assert.equal(resolved?.resolution, 'dismissed');

    const latest = await getLatestInterruptedChatTurn('session-b');
    assert.equal(latest, null);
  });

  test('stale unresolved active checkpoint is promoted to interrupted on read', async () => {
    const staleRecord = {
      version: 1,
      checkpoints: [
        {
          sessionId: 'session-c',
          turnId: 'turn-stale',
          workspaceDir: '/tmp/ws',
          prompt: 'stale prompt',
          model: 'llama3',
          state: 'streaming',
          interrupted: false,
          resolved: false,
          updatedAt: new Date(Date.now() - 60_000).toISOString()
        }
      ]
    };

    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(staleRecord, null, 2), 'utf8');

    const latest = await getLatestInterruptedChatTurn('session-c');
    assert.ok(latest, 'Expected stale active record to become recoverable');
    assert.equal(latest?.turnId, 'turn-stale');
    assert.equal(latest?.state, 'interrupted');
    assert.equal(latest?.interrupted, true);
    assert.equal(latest?.resolved, false);
  });
});
