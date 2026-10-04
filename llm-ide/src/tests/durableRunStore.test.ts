import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  applyDurableRunRecoveryAction,
  getDurableRun,
  listRecoverableDurableRuns,
  listDurableRuns,
  setDurableRunStorePathForTests,
  upsertDurableRun
} from '../backend/durableRunStore';

/**
 * Create an isolated temporary directory for durable run store tests.
 *
 * Purpose: ensure file-backed run ledger tests are hermetic.
 */
async function createTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'localcode-runs-'));
}

/**
 * Cleanup helper for test temp folders.
 */
async function cleanupTempRoot(tmpDir: string): Promise<void> {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

test.describe('durable run store', () => {
  let tmpDir = '';
  let storePath = '';

  test.beforeEach(async () => {
    tmpDir = await createTempRoot();
    storePath = path.join(tmpDir, 'durable-runs.json');
    setDurableRunStorePathForTests(storePath);
  });

  test.afterEach(async () => {
    setDurableRunStorePathForTests(null);
    await cleanupTempRoot(tmpDir);
  });

  test('upsert creates then updates a run preserving identity', async () => {
    const created = await upsertDurableRun({
      runId: 'run-1',
      kind: 'chat',
      status: 'pending',
      workspaceDir: '/tmp/ws',
      promptExcerpt: 'hello world'
    });

    assert.equal(created.runId, 'run-1');
    assert.equal(created.status, 'pending');

    const updated = await upsertDurableRun({
      runId: 'run-1',
      kind: 'chat',
      status: 'completed',
      workspaceDir: '/tmp/ws',
      promptExcerpt: 'hello world'
    });

    assert.equal(updated.runId, 'run-1');
    assert.equal(updated.status, 'completed');
    assert.ok(updated.completedAt, 'completed runs should carry completedAt');
  });

  test('list returns most recent runs first with limit applied', async () => {
    await upsertDurableRun({
      runId: 'run-a',
      kind: 'chat',
      status: 'running',
      workspaceDir: '/tmp/ws'
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    await upsertDurableRun({
      runId: 'run-b',
      kind: 'orchestration',
      status: 'running',
      workspaceDir: '/tmp/ws'
    });

    const runs = await listDurableRuns(1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'run-b');
  });

  test('getDurableRun returns null for unknown ids', async () => {
    const run = await getDurableRun('missing');
    assert.equal(run, null);
  });

  test('listRecoverableDurableRuns filters to unfinished runs in workspace', async () => {
    await upsertDurableRun({
      runId: 'run-chat-active',
      kind: 'chat',
      status: 'running',
      workspaceDir: '/tmp/ws-a'
    });
    await upsertDurableRun({
      runId: 'run-chat-done',
      kind: 'chat',
      status: 'completed',
      workspaceDir: '/tmp/ws-a'
    });
    await upsertDurableRun({
      runId: 'run-other-ws',
      kind: 'chat',
      status: 'pending',
      workspaceDir: '/tmp/ws-b'
    });

    const runs = await listRecoverableDurableRuns({
      workspaceDir: '/tmp/ws-a',
      kind: 'chat',
      limit: 20
    });

    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'run-chat-active');
  });

  test('applyDurableRunRecoveryAction marks run canceled with action metadata', async () => {
    await upsertDurableRun({
      runId: 'run-recover',
      kind: 'orchestration',
      status: 'waiting_tool',
      workspaceDir: '/tmp/ws-a',
      promptExcerpt: 'recover me'
    });

    const recovered = await applyDurableRunRecoveryAction('run-recover', 'restart');
    assert.ok(recovered, 'Expected recovery action to return updated run');
    assert.equal(recovered?.status, 'canceled');
    assert.equal(recovered?.recoveryAction, 'restart');
    assert.ok(recovered?.recoveredAt, 'Expected recoveredAt to be set');
  });
});
