import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildShellCommand,
  describeShellBriefly,
  describeShellForPrompt,
  resetShellInvocationCache,
  resolveShellInvocation,
  toPowerShellCommand
} from '../shared/shellConfig';
import { formatEnvironmentGuidance } from '../shared/environment';
import { runTerminalCommand, getAllowedToolDefinitions, toolDefinitions } from '../backend/toolRuntime';
import type { ToolDefinition } from '../shared/types';

/**
 * Fake Windows root, recreated per test so resolution tests cannot see each other's
 * fixtures and never depend on execution order.
 */
let fakeRoot = '';

/**
 * Create a fresh fake Windows root and return an environment pointing at it.
 *
 * @param extraPathDirs - Directories prepended to PATH.
 * @returns Env object with SystemRoot/ComSpec/ProgramFiles/PATH under the fake root.
 * @sideEffects Creates the fake root directory tree in the OS temp directory.
 */
function windowsEnv(extraPathDirs: string[] = []): NodeJS.ProcessEnv {
  fakeRoot = path.join(os.tmpdir(), `localcode-shell-fakeroot-${testCounter++}`);
  fs.mkdirSync(path.join(fakeRoot, 'System32'), { recursive: true });
  fs.mkdirSync(path.join(fakeRoot, 'Program Files'), { recursive: true });
  return {
    SystemRoot: fakeRoot,
    ComSpec: path.join(fakeRoot, 'System32', 'cmd.exe'),
    ProgramFiles: path.join(fakeRoot, 'Program Files'),
    PATH: [...extraPathDirs, path.join(fakeRoot, 'System32')].join(path.delimiter)
  };
}

let testCounter = 0;

/**
 * Materialise fake shell executables under the current fake Windows root.
 *
 * @param relativePaths - Paths relative to the fake root, e.g. `System32/cmd.exe`.
 * @returns Absolute paths of the created files.
 * @sideEffects Creates directories and empty files in the OS temp directory.
 */
function fakeShells(relativePaths: string[]): string[] {
  return relativePaths.map(relative => {
    const target = path.join(fakeRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '', 'utf8');
    return target;
  });
}

beforeEach(() => {
  resetShellInvocationCache();
});

test('resolveShellInvocation prefers Windows PowerShell over cmd.exe when pwsh is absent', () => {
  const env = windowsEnv();
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);

  const shell = resolveShellInvocation({ platform: 'win32', env });

  assert.equal(shell.kind, 'powershell');
  assert.equal(shell.isPowerShell, true);
  assert.match(shell.executable, /WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i);
  assert.deepEqual(shell.args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']);
  assert.equal(shell.verbatimArguments, false);
  assert.equal(shell.label, 'Windows PowerShell 5.1');
});

test('resolveShellInvocation prefers pwsh when PowerShell 7 is installed', () => {
  const pwshDir = path.join(os.tmpdir(), 'localcode-shell-pwshdir');
  fs.mkdirSync(pwshDir, { recursive: true });
  fs.writeFileSync(path.join(pwshDir, 'pwsh.exe'), '', 'utf8');

  const env = windowsEnv([pwshDir]);
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);

  const shell = resolveShellInvocation({ platform: 'win32', env });

  assert.equal(shell.kind, 'pwsh');
  assert.equal(shell.isPowerShell, true);
  assert.equal(shell.executable, path.join(pwshDir, 'pwsh.exe'));
  assert.equal(shell.label, 'PowerShell 7 (pwsh)');
});

test('resolveShellInvocation falls back to cmd.exe when PowerShell is not present', () => {
  // windowsEnv() gives a brand new root, so no PowerShell exists in it.
  const env = windowsEnv();
  fakeShells(['System32/cmd.exe']);

  const shell = resolveShellInvocation({ platform: 'win32', env });

  assert.equal(shell.kind, 'cmd');
  assert.equal(shell.isPowerShell, false);
  assert.deepEqual(shell.args, ['/d', '/s', '/c']);
  assert.equal(shell.label, 'cmd.exe');
});

test('LOCALCODE_SHELL=cmd restores the cmd.exe path', () => {
  const env = windowsEnv();
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);

  const shell = resolveShellInvocation({ platform: 'win32', env: { ...env, LOCALCODE_SHELL: 'cmd' } });

  assert.equal(shell.kind, 'cmd');
  assert.equal(shell.executable, path.join(fakeRoot, 'System32', 'cmd.exe'));
});

test('LOCALCODE_SHELL accepts an explicit PowerShell path', () => {
  const env = windowsEnv();
  const [powershellPath] = fakeShells(['Custom/powershell.exe']);

  const shell = resolveShellInvocation({ platform: 'win32', env: { ...env, LOCALCODE_SHELL: powershellPath } });

  assert.equal(shell.kind, 'powershell');
  assert.equal(shell.executable, powershellPath);
  assert.equal(shell.isPowerShell, true);
});

test('an unusable LOCALCODE_SHELL value falls back to the normal preference order', () => {
  const env = windowsEnv();
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);

  const shell = resolveShellInvocation({ platform: 'win32', env: { ...env, LOCALCODE_SHELL: 'fish' } });

  assert.equal(shell.kind, 'powershell');
});

test('cmd.exe requires verbatim arguments only when its own path has no spaces', () => {
  const env = windowsEnv();
  fakeShells(['System32/cmd.exe']);
  const noSpaces = resolveShellInvocation({ platform: 'win32', env: { ...env, LOCALCODE_SHELL: 'cmd' } });
  assert.equal(noSpaces.kind, 'cmd');
  assert.equal(noSpaces.verbatimArguments, true);

  // Node does not quote the executable in verbatim mode, so a spaced path must not use it.
  const [spacedCmd] = fakeShells(['Program Files/some tools/cmd.exe']);
  const spaced = resolveShellInvocation({ platform: 'win32', env: { ...env, LOCALCODE_SHELL: spacedCmd } });
  assert.equal(spaced.kind, 'cmd');
  assert.equal(spaced.verbatimArguments, false);
});

test('non-Windows platforms keep the POSIX shell recipe', () => {
  const shell = resolveShellInvocation({ platform: 'linux', env: { SHELL: '/bin/bash' } });

  assert.equal(shell.kind, 'posix');
  assert.equal(shell.executable, '/bin/bash');
  assert.deepEqual(shell.args, ['-lc']);
  assert.equal(shell.isPowerShell, false);
  assert.equal(shell.verbatimArguments, false);
  assert.equal(describeShellForPrompt(shell), '');
});

test('toPowerShellCommand rebuilds && chains with if ($?) blocks', () => {
  const rewritten = toPowerShellCommand('Write-Host a && Write-Host b && Write-Host c');

  assert.equal(rewritten.includes('&&'), false);
  assert.match(rewritten, /^Write-Host a\nif \(\$\?\) \{ Write-Host b \}\nif \(\$\?\) \{ Write-Host c \}\n/m);
  // The guard is what makes a native program's real exit code reach the model.
  assert.match(rewritten, /if \(\$LASTEXITCODE -gt 0\) \{ exit \$LASTEXITCODE \}\s*$/);
});

test('toPowerShellCommand rebuilds || chains with if (-not $?) blocks', () => {
  const rewritten = toPowerShellCommand('Get-ChildItem missing || Write-Host fallback');

  assert.equal(rewritten.includes('||'), false);
  assert.match(rewritten, /if \(-not \$\?\) \{ Write-Host fallback \}/);
});

test('toPowerShellCommand folds mixed && and || left-associatively', () => {
  const rewritten = toPowerShellCommand('A && B || C');

  assert.deepEqual(
    rewritten.split('\n').filter(line => !line.startsWith('if ($LASTEXITCODE')),
    ['A', 'if ($?) { B }', 'if (-not $?) { C }']
  );
});

test('toPowerShellCommand never splits operators inside quotes', () => {
  const rewritten = toPowerShellCommand('Write-Output "a && b"');

  assert.match(rewritten, /^Write-Output "a && b"\n/);
});

test('toPowerShellCommand preserves single-quoted operators', () => {
  const rewritten = toPowerShellCommand("Write-Output 'a || b'");

  assert.match(rewritten, /^Write-Output 'a \|\| b'\n/);
});

test('toPowerShellCommand leaves a plain command intact and only appends the guard', () => {
  const rewritten = toPowerShellCommand('git status --short');

  assert.equal(rewritten, 'git status --short\nif ($LASTEXITCODE -gt 0) { exit $LASTEXITCODE }');
});

test('toPowerShellCommand keeps single pipes and redirections untouched', () => {
  const rewritten = toPowerShellCommand('git log -1 --name-only | Select-Object -First 3');

  assert.match(rewritten, /^git log -1 --name-only \| Select-Object -First 3\n/);
});

test('buildShellCommand leaves cmd.exe and POSIX commands verbatim', () => {
  const cmdShell = resolveShellInvocation({ platform: 'win32', env: { ...windowsEnv(), LOCALCODE_SHELL: 'cmd' } });
  assert.equal(buildShellCommand('echo a && echo b', cmdShell), 'echo a && echo b');

  const posixShell = resolveShellInvocation({ platform: 'linux', env: {} });
  assert.equal(buildShellCommand('echo a && echo b', posixShell), 'echo a && echo b');
});

test('describeShellForPrompt names the shell and its real constraints', () => {
  const env = windowsEnv();
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);
  const powershell = describeShellForPrompt(resolveShellInvocation({ platform: 'win32', env }));

  assert.match(powershell, /Terminal shell: Windows PowerShell 5\.1/);
  assert.match(powershell, /\$env:NAME/);
  assert.match(powershell, /Get-ChildItem/);
  assert.match(powershell, /does not accept `&&`/);
  assert.match(powershell, /cmd \/c/);

  const cmdGuidance = describeShellForPrompt(resolveShellInvocation({ platform: 'win32', env: { ...env, LOCALCODE_SHELL: 'cmd' } }));
  assert.match(cmdGuidance, /Terminal shell: cmd\.exe/);
  assert.match(cmdGuidance, /%VAR%/);
});

test('integration: run_terminal_command executes PowerShell syntax and reports real exit codes', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const cmdlet = await runTerminalCommand(
    { command: 'Get-ChildItem -Name -Filter package.json', scope: 'workspace', timeoutMs: 20000 },
    { workspaceDir: process.cwd(), rootDir: process.cwd() } as any
  ) as { success: boolean; stdout: string; stderr: string };

  assert.equal(cmdlet.success, true, `cmdlet should run under PowerShell: ${cmdlet.stderr}`);
  assert.equal(cmdlet.stdout.trim(), 'package.json');

  // A native failure must surface its own code, not PowerShell's blanket 1.
  const failing = await runTerminalCommand(
    { command: 'node -e "process.exit(7)"', scope: 'workspace', timeoutMs: 20000 },
    { workspaceDir: process.cwd(), rootDir: process.cwd() } as any
  ) as { success: boolean; code: number | null };

  assert.equal(failing.success, false);
  assert.equal(failing.code, 7);
});

test('integration: && short-circuits under PowerShell even though 5.1 rejects the token', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const result = await runTerminalCommand(
    {
      command: 'Write-Host first && Get-ChildItem definitely-missing-dir && Write-Host SHOULD_NOT_PRINT',
      scope: 'workspace',
      timeoutMs: 20000
    },
    { workspaceDir: process.cwd(), rootDir: process.cwd() } as any
  ) as { success: boolean; stdout: string; stderr: string };

  assert.equal(result.success, false);
  assert.match(result.stdout, /first/);
  assert.equal(result.stdout.includes('SHOULD_NOT_PRINT'), false);
  assert.match(result.stderr, /definitely-missing-dir/);
});

test('integration: || fallback runs only when the first command fails', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const fallback = await runTerminalCommand(
    { command: 'Get-ChildItem definitely-missing-dir || Write-Host fallback_ok', scope: 'workspace', timeoutMs: 20000 },
    { workspaceDir: process.cwd(), rootDir: process.cwd() } as any
  ) as { success: boolean; stdout: string };

  assert.equal(fallback.success, true);
  assert.match(fallback.stdout, /fallback_ok/);

  const skipped = await runTerminalCommand(
    { command: 'Write-Host ok || Write-Host SHOULD_NOT_PRINT', scope: 'workspace', timeoutMs: 20000 },
    { workspaceDir: process.cwd(), rootDir: process.cwd() } as any
  ) as { success: boolean; stdout: string };

  assert.equal(skipped.success, true);
  assert.equal(skipped.stdout.includes('SHOULD_NOT_PRINT'), false);
});

test('integration: a quoted argument survives the shell instead of vanishing', async () => {
  const result = await runTerminalCommand(
    { command: 'node -e "console.log(1)"', scope: 'workspace', timeoutMs: 20000 },
    { workspaceDir: process.cwd(), rootDir: process.cwd() } as any
  ) as { success: boolean; stdout: string; stderr: string; code: number | null };

  // Under the old cmd.exe recipe this returned success with empty stdout.
  assert.equal(result.success, true, `stderr: ${result.stderr}`);
  assert.equal(result.stdout.trim(), '1');
  assert.equal(result.code, 0);
});

test('run_terminal_command tool schema names the shell the model is writing for', () => {
  const [definition] = getAllowedToolDefinitions(['run_terminal_command'], {
    workspaceDir: process.cwd(),
    rootDir: process.cwd()
  } as any) as [ToolDefinition];

  assert.ok(definition, 'run_terminal_command definition should be returned');
  assert.match(definition.function.description, /Execute a shell command inside selected scope/);
  // The schema must name the concrete shell rather than leave the syntax family ambiguous.
  assert.match(definition.function.description, /Shell: (Windows PowerShell|PowerShell 7 \(pwsh\)|cmd\.exe|sh)\b/);
  // Guidance is one line here; the full rules live in the environment system block.
  assert.ok(definition.function.description.length < 400, 'tool description should stay brief to limit prompt tokens');
});

test('the shell note is not appended repeatedly across calls', () => {
  const context = { workspaceDir: process.cwd(), rootDir: process.cwd() } as any;
  const first = getAllowedToolDefinitions(['run_terminal_command'], context)[0].function.description;
  const second = getAllowedToolDefinitions(['run_terminal_command'], context)[0].function.description;
  const third = getAllowedToolDefinitions(['run_terminal_command'], context)[0].function.description;

  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(first.split('Shell: ').length - 1, 1);
  // The shared definition array must stay untouched so other callers see the base text.
  assert.equal(toolDefinitions.find(def => def.function.name === 'run_terminal_command')
    ?.function.description.includes('Shell:'), false);
});

test('describeShellBriefly does not duplicate the full guidance block', () => {
  const env = windowsEnv();
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);
  const shell = resolveShellInvocation({ platform: 'win32', env });

  const brief = describeShellBriefly(shell);
  const full = describeShellForPrompt(shell);

  assert.ok(brief.length < full.length / 3, 'brief form must be much shorter than the full block');
  assert.equal(brief.includes('\n'), false);
  assert.match(brief, /Windows PowerShell/);
});

test('formatEnvironmentGuidance replaces the vague cmd.exe/PowerShell line with the real shell', () => {
  const env = windowsEnv();
  fakeShells(['System32/WindowsPowerShell/v1.0/powershell.exe', 'System32/cmd.exe']);
  const shell = resolveShellInvocation({ platform: 'win32', env });

  const guidance = formatEnvironmentGuidance('/tmp/workspace', shell);

  assert.match(guidance, /Terminal shell: Windows PowerShell 5\.1/);
  assert.match(guidance, /\$env:NAME/);
  // The old wording told the model cmd.exe was acceptable, which is what produced
  // the syntax churn this change removes.
  assert.equal(guidance.includes('prefer cmd.exe/PowerShell syntax'), false);
});

test('formatEnvironmentGuidance keeps usable wording on POSIX', () => {
  const posixShell = resolveShellInvocation({ platform: 'linux', env: { SHELL: '/bin/bash' } });
  const guidance = formatEnvironmentGuidance('/tmp/workspace', posixShell);

  assert.match(guidance, /run commands with `sh`/);
  assert.equal(guidance.includes('Terminal shell'), false);
});
