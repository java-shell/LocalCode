import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  AI_RULES_MAX_CHARS,
  AI_RULES_PER_FILE_MAX_CHARS,
  formatAiRulesGuidance,
  loadAiRules
} from '../backend/workspaceFs';

/**
 * Create an isolated temporary workspace for .ai-rules tests.
 *
 * Purpose: keep rules-loading assertions deterministic without touching repo files.
 * Inputs: none.
 * Outputs: absolute path to an empty temporary directory.
 * Side effects: creates a directory under OS temp; the caller writes fixtures into it.
 */
async function makeTempWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ai-rules-'));
}

async function writeRules(workspaceDir: string, fileName: string, content: string): Promise<void> {
  await fs.mkdir(path.join(workspaceDir, '.ai-rules'), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, '.ai-rules', fileName), content, 'utf8');
}

test('loadAiRules returns null when the workspace has no .ai-rules folder', async () => {
  const workspaceDir = await makeTempWorkspace();
  await fs.writeFile(path.join(workspaceDir, 'README.md'), 'root readme', 'utf8');

  const result = await loadAiRules(workspaceDir);

  assert.equal(result, null);
});

test('loadAiRules returns null when .ai-rules has no readable Markdown content', async () => {
  const workspaceDir = await makeTempWorkspace();
  await writeRules(workspaceDir, 'notes.txt', 'not markdown');
  await writeRules(workspaceDir, 'blank.md', '   \n  ');

  const result = await loadAiRules(workspaceDir);

  assert.equal(result, null);
});

test('loadAiRules concatenates Markdown files under .ai-rules/<file> headers', async () => {
  const workspaceDir = await makeTempWorkspace();
  await writeRules(workspaceDir, 'rules.md', 'Always run tests.');
  await writeRules(workspaceDir, 'style.md', 'Prefer small functions.');

  const result = await loadAiRules(workspaceDir);

  assert.ok(result);
  assert.deepEqual(result.files, ['rules.md', 'style.md']);
  assert.ok(result.content.includes('## .ai-rules/rules.md\n\nAlways run tests.'));
  assert.ok(result.content.includes('## .ai-rules/style.md\n\nPrefer small functions.'));
  assert.equal(result.truncated, false);
});

test('loadAiRules orders README.md and RULES-QUICKREF.md before the rest', async () => {
  const workspaceDir = await makeTempWorkspace();
  await writeRules(workspaceDir, 'zeta.md', 'zeta body');
  await writeRules(workspaceDir, 'RULES-QUICKREF.md', 'quickref body');
  await writeRules(workspaceDir, 'alpha.md', 'alpha body');
  await writeRules(workspaceDir, 'README.md', 'readme body');

  const result = await loadAiRules(workspaceDir);

  assert.ok(result);
  assert.deepEqual(result.files, ['README.md', 'RULES-QUICKREF.md', 'alpha.md', 'zeta.md']);
  assert.ok(result.content.indexOf('readme body') < result.content.indexOf('quickref body'));
  assert.ok(result.content.indexOf('quickref body') < result.content.indexOf('alpha body'));
});

test('loadAiRules caps the combined block and flags truncation', async () => {
  const workspaceDir = await makeTempWorkspace();
  await writeRules(workspaceDir, 'huge-a.md', 'a'.repeat(AI_RULES_MAX_CHARS + 500));
  await writeRules(workspaceDir, 'huge-b.md', 'b'.repeat(AI_RULES_MAX_CHARS + 500));

  const result = await loadAiRules(workspaceDir);

  assert.ok(result);
  assert.ok(result.content.length <= AI_RULES_MAX_CHARS, 'combined block must respect the char budget');
  assert.equal(result.truncated, true);
  // Both files survive (per-file caps leave room) but neither arrives whole.
  assert.deepEqual(result.files, ['huge-a.md', 'huge-b.md']);
  const aRun = (result.content.match(/a+/g) ?? []).map(run => run.length);
  const bRun = (result.content.match(/b+/g) ?? []).map(run => run.length);
  assert.ok(aRun.length > 0 && Math.max(...aRun) < AI_RULES_MAX_CHARS, 'huge-a.md must be cut');
  assert.ok(bRun.length > 0 && Math.max(...bRun) < AI_RULES_MAX_CHARS, 'huge-b.md must be cut');
});

test('loadAiRules caps each file so a large rules.md cannot crowd out the overview files', async () => {
  const workspaceDir = await makeTempWorkspace();
  await writeRules(workspaceDir, 'README.md', 'readme body');
  await writeRules(workspaceDir, 'rules.md', 'r'.repeat(AI_RULES_PER_FILE_MAX_CHARS * 4));

  const result = await loadAiRules(workspaceDir);

  assert.ok(result);
  assert.deepEqual(result.files, ['README.md', 'rules.md']);
  assert.ok(result.content.includes('readme body'));
  const rulesBody = result.content.split('## .ai-rules/rules.md')[1] ?? '';
  assert.ok(rulesBody.trim().length <= AI_RULES_PER_FILE_MAX_CHARS);
  assert.equal(result.truncated, true);
});

test('loadAiRules ignores nested paths and non-Markdown entries', async () => {
  const workspaceDir = await makeTempWorkspace();
  await writeRules(workspaceDir, 'rules.md', 'top level rule');
  await fs.mkdir(path.join(workspaceDir, '.ai-rules', 'nested'), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, '.ai-rules', 'nested', 'deep.md'), 'nested rule', 'utf8');

  const result = await loadAiRules(workspaceDir);

  assert.ok(result);
  assert.deepEqual(result.files, ['rules.md']);
  assert.ok(!result.content.includes('nested rule'));
});

test('loadAiRules never throws when the rules folder is unreadable', async () => {
  const workspaceDir = await makeTempWorkspace();
  await fs.mkdir(path.join(workspaceDir, '.ai-rules'), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, '.ai-rules', 'rules.md'), 'rule body', 'utf8');
  await fs.chmod(path.join(workspaceDir, '.ai-rules', 'rules.md'), 0o000);

  try {
    const result = await loadAiRules(workspaceDir);
    // Either the file is skipped (null) or the OS allowed the read; it must not throw.
    assert.ok(result === null || result.files.length >= 0);
  } finally {
    await fs.chmod(path.join(workspaceDir, '.ai-rules', 'rules.md'), 0o644);
  }
});

test('formatAiRulesGuidance returns empty guidance when there are no rules', () => {
  assert.equal(formatAiRulesGuidance(undefined), '');
  assert.equal(formatAiRulesGuidance(null), '');
  assert.equal(formatAiRulesGuidance('   \n '), '');
});

test('formatAiRulesGuidance wraps rules content in a workspace-guidance instruction', () => {
  const guidance = formatAiRulesGuidance('## .ai-rules/rules.md\n\nAlways run tests.');

  assert.match(guidance, /Workspace coding rules loaded from the \.ai-rules\/ folder/);
  assert.ok(guidance.includes('Always run tests.'));
  assert.match(guidance, /Follow these workspace rules when making changes/);
});
