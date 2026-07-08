import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { isHistoricalChatContextDumpFile, pruneChatContextDumps } from '../backend/chatDebugDumps';

/**
 * Create a temporary directory for debug dump pruning tests.
 *
 * Purpose: isolate filesystem side effects per test run.
 * Inputs: none.
 * Outputs: absolute temp directory path.
 * Side effects: creates a directory under OS temp path.
 */
async function makeTempDebugDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'localcode-chat-dumps-'));
}

/**
 * Write a file and set its mtime offset from now.
 *
 * Purpose: build deterministic retention test fixtures.
 * Inputs: directory, file name, and age in days.
 * Outputs: created absolute path.
 * Side effects: writes file and modifies mtime.
 */
async function createAgedFile(dir: string, fileName: string, ageDays: number): Promise<string> {
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, '{"ok":true}\n', 'utf8');
  const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await fs.utimes(filePath, mtime, mtime);
  return filePath;
}

test('isHistoricalChatContextDumpFile recognizes only historical dump files', () => {
  assert.equal(isHistoricalChatContextDumpFile('chat-context-2026-07-08T11-02-00-000Z.json'), true);
  assert.equal(isHistoricalChatContextDumpFile('chat-context-latest.json'), false);
  assert.equal(isHistoricalChatContextDumpFile('notes.json'), false);
});

test('pruneChatContextDumps removes old dumps and keeps latest alias', async () => {
  const debugDir = await makeTempDebugDir();
  try {
    await createAgedFile(debugDir, 'chat-context-very-old.json', 30);
    await createAgedFile(debugDir, 'chat-context-recent.json', 2);
    await fs.writeFile(path.join(debugDir, 'chat-context-latest.json'), '{"latest":true}\n', 'utf8');

    const result = await pruneChatContextDumps(debugDir, { maxHistoricalFiles: 10, maxAgeDays: 14 });
    assert.equal(result.removedCount, 1);

    const remaining = await fs.readdir(debugDir);
    assert.equal(remaining.includes('chat-context-very-old.json'), false);
    assert.equal(remaining.includes('chat-context-recent.json'), true);
    assert.equal(remaining.includes('chat-context-latest.json'), true);
  } finally {
    await fs.rm(debugDir, { recursive: true, force: true });
  }
});

test('pruneChatContextDumps enforces max historical file count', async () => {
  const debugDir = await makeTempDebugDir();
  try {
    await createAgedFile(debugDir, 'chat-context-1.json', 1);
    await createAgedFile(debugDir, 'chat-context-2.json', 2);
    await createAgedFile(debugDir, 'chat-context-3.json', 3);

    const result = await pruneChatContextDumps(debugDir, { maxHistoricalFiles: 2, maxAgeDays: 365 });
    assert.equal(result.removedCount, 1);

    const historical = (await fs.readdir(debugDir)).filter(name => name.startsWith('chat-context-'));
    assert.equal(historical.length, 2);
  } finally {
    await fs.rm(debugDir, { recursive: true, force: true });
  }
});
