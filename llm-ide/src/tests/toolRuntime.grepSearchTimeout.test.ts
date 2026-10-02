import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { executeTool } from '../backend/toolRuntime';

/**
 * Create an isolated temporary workspace path for grep_search tests.
 *
 * Purpose: keep file-system fixtures deterministic and avoid touching repo files.
 * Inputs: none.
 * Outputs: absolute path to an empty temporary directory.
 * Side effects: creates a directory under OS temp.
 */
async function makeTempWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-grep-timeout-'));
}

test('grep_search enforces minimum timeout bound when timeoutMs is too small', async () => {
  const workspaceDir = await makeTempWorkspace();
  await fs.writeFile(path.join(workspaceDir, 'example.txt'), 'alpha\nbeta\ngamma\n', 'utf8');

  const result = await executeTool(
    'grep_search',
    { query: 'beta', timeoutMs: 1, maxResults: 10, scope: 'workspace' },
    { workspaceDir, rootDir: workspaceDir } as any
  ) as {
    matches: Array<{ file: string; line: number; text: string }>;
    timeoutMs?: number;
  };

  assert.equal(result.timeoutMs, 1000);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.file, 'example.txt');
});

test('grep_search skips FIFO/special files and returns promptly', async () => {
  if (process.platform === 'win32') {
    return;
  }

  const workspaceDir = await makeTempWorkspace();
  const fifoPath = path.join(workspaceDir, 'blocking.fifo');
  const mkfifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });

  if (mkfifo.status !== 0) {
    // If mkfifo is unavailable in this environment, skip gracefully.
    return;
  }

  await fs.writeFile(path.join(workspaceDir, 'match.txt'), 'needle\n', 'utf8');

  const resultPromise = executeTool(
    'grep_search',
    { query: 'needle', timeoutMs: 2000, maxResults: 10, scope: 'workspace' },
    { workspaceDir, rootDir: workspaceDir } as any
  ) as Promise<{
    matches: Array<{ file: string; line: number; text: string }>;
    skippedSpecialEntries?: number;
  }>;

  const result = await Promise.race([
    resultPromise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('grep_search did not complete within expected time window')), 3000);
    })
  ]);

  assert.ok(Array.isArray(result.matches));
  assert.equal(result.matches.some(match => match.file === 'match.txt'), true);
  assert.ok(Number(result.skippedSpecialEntries ?? 0) >= 1);
});
