import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { executeTool } from '../backend/toolRuntime';

/** Run Git only inside the disposable fixture; propagate failures without invoking a shell. */
function fixtureGit(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true });
}

// Refs: AI-003. Exercise the app boundary, not just the dependency's exported factory.
test('Git tools preserve status, staging, commit, diff and tracked-tree contracts', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-git-tools-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const empty = path.join(base, 'empty');
  const repo = path.join(base, 'repo');
  await fs.mkdir(empty);
  await fs.mkdir(repo);
  fixtureGit(repo, 'init', '--template=' + empty);
  fixtureGit(repo, 'config', 'user.name', 'LocalCode Test');
  fixtureGit(repo, 'config', 'user.email', 'localcode-test@example.invalid');
  fixtureGit(repo, 'config', 'commit.gpgsign', 'false');
  fixtureGit(repo, 'config', 'core.hooksPath', empty);
  fixtureGit(repo, 'config', 'core.autocrlf', 'false');
  const context = { workspaceDir: repo, rootDir: repo };

  await fs.writeFile(path.join(repo, 'tracked.txt'), 'before\n');
  const initial = await executeTool('git_status', {}, context) as any;
  assert.equal(initial.isRepo, true);
  assert.deepEqual(initial.not_added, ['tracked.txt']);
  assert.deepEqual(await executeTool('git_add', { path: 'tracked.txt' }, context), { staged: 'tracked.txt' });
  const staged = await executeTool('git_status', {}, context) as any;
  assert.deepEqual(staged.staged, ['tracked.txt']);
  const committed = await executeTool('git_commit', { message: 'Fixture commit' }, context) as any;
  assert.match(committed.commit, /[a-f0-9]{7,40}/);
  assert.equal(committed.summary.changes, 1);

  await fs.writeFile(path.join(repo, 'tracked.txt'), 'after\n');
  await fs.writeFile(path.join(repo, 'untracked.txt'), 'new\n');
  const changed = await executeTool('git_status', {}, context) as any;
  assert.deepEqual(changed.modified, ['tracked.txt']);
  const diff = await executeTool('git_diff', { path: 'tracked.txt' }, context) as any;
  assert.equal(diff.path, 'tracked.txt');
  assert.match(diff.diff, /-before/);
  assert.match(diff.diff, /\+after/);
  const tree = await executeTool('list_repo_tree', { includeUntracked: false }, context) as any;
  assert.equal(tree.fileCount, 1); // Distinguishes Git enumeration from filesystem fallback.
  assert.match(tree.tree, /tracked\.txt/);
  assert.doesNotMatch(tree.tree, /untracked\.txt/);
  assert.deepEqual(await executeTool('git_add', { all: true }, context), { staged: 'all' });
  await assert.rejects(executeTool('git_commit', { message: ' ' }, context), /message is required/);
});

test('Git status retains its structured non-repository result', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-not-git-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const status = await executeTool('git_status', {}, { workspaceDir: base, rootDir: base }) as any;
  assert.equal(status.isRepo, false);
  assert.equal(status.path, base);
  assert.equal(status.branch, null);
  assert.deepEqual(status.modified, []);
});