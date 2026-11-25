import * as fs from 'fs';
import * as path from 'path';

/**
 * Shell selection and command translation for model-driven terminal commands.
 *
 * Why this module exists:
 * `run_terminal_command` used `cmd.exe` unconditionally on Windows. Models are far
 * more fluent in PowerShell than in cmd.exe batch syntax, so they repeatedly emitted
 * commands cmd.exe could not run (`Get-ChildItem`, `$env:FOO`, `Write-Host`, pipelines
 * into `Select-Object`). Two further defects were found while investigating:
 *
 *   1. `spawn('cmd.exe', ['/d', '/s', '/c', command])` without
 *      `windowsVerbatimArguments: true` makes Node re-quote the command line, and
 *      cmd.exe then mis-parses it. Any command containing a double quote produced
 *      empty stdout/stderr and exit code 0 — a silent false success.
 *   2. PowerShell 5.1 (the version shipped with Windows) rejects `&&` and `||` as
 *      statement separators, so the chaining models reach for by default is a parse
 *      error there.
 *
 * This module resolves which shell to use, translates the command for that shell,
 * and produces the model-facing guidance that describes it.
 *
 * Measured behaviour on Windows 11 / PowerShell 5.1.26100 (see notes in the module
 * tests): PowerShell propagates native exit codes only when an explicit
 * `$LASTEXITCODE` guard is appended, and `if ($?) { ... }` chains reproduce `&&`
 * semantics exactly.
 */

export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'posix';

export interface ShellInvocation {
  /** Which shell family was selected; drives command translation. */
  kind: ShellKind;
  /** Absolute path or bare executable name passed to `spawn`. */
  executable: string;
  /** Arguments preceding the command string; the command is appended last. */
  args: string[];
  /**
   * When true, `spawn` must be called with `windowsVerbatimArguments: true` so Node
   * hands the command line to cmd.exe untouched. Only valid for cmd.exe, and only
   * when the executable path itself contains no spaces (Node does not quote the
   * executable under verbatim mode).
   */
  verbatimArguments: boolean;
  /** Human/model readable one-line description used in system prompt guidance. */
  label: string;
  /** True when PowerShell operator translation and the exit-code guard apply. */
  isPowerShell: boolean;
}

interface ResolveOptions {
  /** Override the shell selection. Accepts a kind name or an executable path. */
  override?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/** Cached resolution so each terminal command does not re-scan PATH. */
let cachedInvocation: ShellInvocation | null = null;

/**
 * Locate an executable by name across PATH and a few well-known Windows install
 * directories, without shelling out.
 *
 * @param name - Bare executable name, e.g. `pwsh.exe`.
 * @param env - Environment whose PATH is searched.
 * @param platform - Platform used to decide whether PATH lookup applies.
 * @returns Absolute path when found, otherwise null.
 * @sideEffects Filesystem reads only.
 * @performance O(PATH entries) `fs.existsSync` calls; cached by the caller.
 */
function findExecutableOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (platform !== 'win32') {
    return null;
  }
  const pathValue = String(env.PATH || env.Path || env.path || '');
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.join(entry, name);
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Unreadable PATH entry: skip rather than fail the whole resolution.
    }
  }
  return null;
}

/**
 * Resolve the shell used for every model terminal command.
 *
 * Preference order on Windows:
 *   1. `LOCALCODE_SHELL` override (kind name or explicit executable path).
 *   2. PowerShell 7 (`pwsh.exe`) when installed — best model compatibility, supports
 *      `&&`/`||` natively.
 *   3. Windows PowerShell 5.1 from System32 — present on every supported Windows.
 *   4. `cmd.exe` from `ComSpec` — last resort, preserves the previous behaviour.
 * On other platforms: `$SHELL` falling back to `/bin/sh`, as before.
 *
 * @param options - Override/platform/env overrides, defaulting to the live process.
 * @returns Spawn recipe plus the flags that drive command translation.
 * @sideEffects Reads PATH and well-known install paths on first call, then caches.
 * @errors Never throws; an unresolvable override falls back to the next candidate.
 * @performance One PATH scan per process; cached afterwards.
 * @security Only fixed candidate names and caller-supplied env paths are probed;
 *           no command is executed during resolution.
 * @concurrency Single-threaded Electron main process; cache is a plain module global.
 * @rationale A fixed preference order beats trusting `ComSpec`, which always points at
 *            cmd.exe. `pwsh` is probed first because it removes the `&&` translation
 *            need entirely, but it is optional software and must not be assumed.
 */
export function resolveShellInvocation(options: ResolveOptions = {}): ShellInvocation {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform !== 'win32') {
    const executable = String(env.LOCALCODE_SHELL || env.SHELL || '/bin/sh');
    return {
      kind: 'posix',
      executable,
      args: ['-lc'],
      verbatimArguments: false,
      label: `POSIX shell (${path.basename(executable)})`,
      isPowerShell: false
    };
  }

  if (cachedInvocation && !options.override && !options.platform && !options.env) {
    return cachedInvocation;
  }

  const systemRoot = String(env.SystemRoot || env.windir || env.WINDIR || 'C:\\Windows');
  const windowsPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmdExecutable = String(env.ComSpec || 'cmd.exe');

  const candidates: Array<{ kind: ShellKind; executable: string; label: string }> = [
    {
      kind: 'pwsh',
      executable:
        findExecutableOnPath('pwsh.exe', env, platform) ||
        path.join(String(env.ProgramFiles || 'C:\\Program Files'), 'PowerShell', '7', 'pwsh.exe'),
      label: 'PowerShell 7 (pwsh)'
    },
    { kind: 'powershell', executable: windowsPowerShell, label: 'Windows PowerShell 5.1' },
    { kind: 'cmd', executable: cmdExecutable, label: 'cmd.exe' }
  ];

  const override = String(options.override ?? env.LOCALCODE_SHELL ?? '').trim();
  if (override) {
    const normalized = override.toLowerCase();
    if (normalized === 'cmd' || normalized === 'cmd.exe') {
      candidates.splice(0, candidates.length, { kind: 'cmd', executable: cmdExecutable, label: 'cmd.exe' });
    } else if (normalized === 'powershell' || normalized === 'windowspowershell') {
      candidates.splice(0, candidates.length, { kind: 'powershell', executable: windowsPowerShell, label: 'Windows PowerShell 5.1' });
    } else if (normalized === 'pwsh' || normalized === 'pwsh.exe') {
      const pwshPath = findExecutableOnPath('pwsh.exe', env, platform) || normalized;
      candidates.splice(0, candidates.length, { kind: 'pwsh', executable: pwshPath, label: 'PowerShell 7 (pwsh)' });
    } else if (/(^|[\\/])powershell(\.exe)?$/i.test(override) && fs.existsSync(override)) {
      candidates.splice(0, candidates.length, {
        kind: 'powershell',
        executable: override,
        label: `PowerShell (${path.basename(override)})`
      });
    } else if (/(^|[\\/])pwsh(\.exe)?$/i.test(override) && fs.existsSync(override)) {
      candidates.splice(0, candidates.length, { kind: 'pwsh', executable: override, label: `PowerShell (${path.basename(override)})` });
    } else if (/(^|[\\/])cmd(\.exe)?$/i.test(override) && fs.existsSync(override)) {
      candidates.splice(0, candidates.length, { kind: 'cmd', executable: override, label: `cmd.exe (${override})` });
    }
  }

  for (const candidate of candidates) {
    const exists = candidate.executable.includes(path.sep) || candidate.executable.includes('/')
      ? safeExists(candidate.executable)
      : true; // bare name: let the OS resolve it, same as the previous behaviour
    if (!exists) {
      continue;
    }

    const isPowerShell = candidate.kind === 'pwsh' || candidate.kind === 'powershell';
    const invocation: ShellInvocation = {
      kind: candidate.kind,
      executable: candidate.executable,
      args: isPowerShell
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
        : ['/d', '/s', '/c'],
      // Verbatim mode is what makes cmd.exe honour quoted arguments, but Node does
      // not quote the executable in that mode, so a spaced path would break.
      verbatimArguments: candidate.kind === 'cmd' && !/\s/.test(candidate.executable),
      label: candidate.label,
      isPowerShell
    };

    if (!options.override && !options.platform && !options.env) {
      cachedInvocation = invocation;
    }
    return invocation;
  }

  // Nothing resolved: keep the historical cmd.exe recipe rather than failing.
  const fallback: ShellInvocation = {
    kind: 'cmd',
    executable: cmdExecutable,
    args: ['/d', '/s', '/c'],
    verbatimArguments: !/\s/.test(cmdExecutable),
    label: 'cmd.exe',
    isPowerShell: false
  };
  if (!options.override && !options.platform && !options.env) {
    cachedInvocation = fallback;
  }
  return fallback;
}

/**
 * Clear the cached shell resolution.
 *
 * @returns void
 * @sideEffects Drops the module-level cache.
 * @rationale Tests inject different platform/env combinations and must not inherit a
 *            resolution made by an earlier test in the same process.
 */
export function resetShellInvocationCache(): void {
  cachedInvocation = null;
}

/**
 * Split a command line into segments on top-level `&&` / `||`.
 *
 * Quoted regions are never split, so `Write-Output "a && b"` stays intact. Single
 * `&` and `|` are preserved as literal characters because they carry different
 * meanings per shell (cmd separator, PowerShell pipe, `2>&1` redirection).
 *
 * @param command - Raw command line from the model.
 * @returns Ordered segments plus the operator that joined each following segment.
 * @performance O(n) single pass.
 */
function splitTopLevelOperators(command: string): Array<{ text: string; operator?: '&&' | '||' }> {
  const parts: Array<{ text: string; operator?: '&&' | '||' }> = [];
  let buffer = '';
  let inSingle = false;
  let inDouble = false;
  let pendingOperator: '&&' | '||' | undefined;

  const flush = () => {
    parts.push({ text: buffer, operator: pendingOperator });
    buffer = '';
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (inSingle) {
      buffer += ch;
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      // PowerShell escapes with a backtick inside double quotes; cmd.exe does not,
      // but a doubled quote is the common case there and toggles cleanly anyway.
      if (ch === '`' && command[i + 1] === '"') {
        buffer += '""';
        i++;
        continue;
      }
      buffer += ch;
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      buffer += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buffer += ch;
      continue;
    }

    const next = command[i + 1];
    if (ch === '&' && next === '&') {
      flush();
      pendingOperator = '&&';
      i++;
      continue;
    }
    if (ch === '|' && next === '|') {
      flush();
      pendingOperator = '||';
      i++;
      continue;
    }

    buffer += ch;
  }

  parts.push({ text: buffer, operator: pendingOperator });
  return parts;
}

/**
 * Rewrite a command line for PowerShell, preserving `&&` / `||` intent.
 *
 * PowerShell 5.1 treats `&&` and `||` as invalid tokens, so the chain is folded
 * left-associatively into `if ($?) { ... }` / `if (-not $?) { ... }` blocks, which
 * reproduce the same short-circuit behaviour. A trailing guard propagates the last
 * native program's exit code, because PowerShell otherwise collapses every native
 * failure to exit code 1 and hides the real status from the model.
 *
 * @param command - Raw command line, may contain `&&`, `||`, newlines and quotes.
 * @returns PowerShell command text with the exit-code guard appended.
 * @sideEffects None.
 * @performance O(n).
 * @rationale `$?` is the only construct available in 5.1 that tracks "did the previous
 *            statement succeed" for both cmdlets and native programs. The guard uses
 *            `-gt 0` rather than `-ne 0` because pipelines can leave `$LASTEXITCODE`
 *            at -1, and `exit -1` surfaces as 4294967295 to the caller.
 */
export function toPowerShellCommand(command: string): string {
  const parts = splitTopLevelOperators(command);
  let script = '';

  for (const part of parts) {
    const segment = part.text.trim();
    if (!segment) {
      continue;
    }
    if (!script) {
      script = segment;
      continue;
    }
    script = part.operator === '||'
      ? `${script}\nif (-not $?) { ${segment} }`
      : `${script}\nif ($?) { ${segment} }`;
  }

  if (!script) {
    return command;
  }

  // Leading newline keeps a trailing backtick in the model's command from swallowing
  // the guard into a line continuation.
  return `${script}\nif ($LASTEXITCODE -gt 0) { exit $LASTEXITCODE }`;
}

/**
 * Build the exact command string to hand the selected shell.
 *
 * @param command - Raw command line from the model.
 * @param shell - Resolution from `resolveShellInvocation`.
 * @returns Translated command for PowerShell, otherwise the command unchanged.
 * @rationale cmd.exe keeps the command verbatim: its own `&&`/`||` already work, and
 *            rewriting would change batch semantics the model did not ask for.
 */
export function buildShellCommand(command: string, shell: ShellInvocation): string {
  return shell.isPowerShell ? toPowerShellCommand(command) : command;
}

/**
 * Produce the model-facing description of the shell it is talking to.
 *
 * @param shell - Resolution from `resolveShellInvocation`.
 * @returns Multi-line guidance block, or an empty string on POSIX where the existing
 *          Unix guidance already applies.
 * @rationale Naming the concrete shell and its real constraints is what stops the
 *            cmd.exe/PowerShell syntax churn this module exists to fix. Guidance is
 *            deliberately short: every line is a rule the model would otherwise learn
 *            from a failed command.
 */
export function describeShellForPrompt(shell: ShellInvocation): string {
  if (!shell.isPowerShell) {
    if (shell.kind === 'cmd') {
      return [
        `Terminal shell: ${shell.label}.`,
        'Use cmd.exe batch syntax: `&&` chains, `%VAR%` expansion, `dir`, `type`, `del`.',
        'PowerShell cmdlets such as `Get-ChildItem`, `Write-Host` and `$env:VAR` do not work here.'
      ].join('\n');
    }
    return '';
  }

  const versionLine = shell.kind === 'pwsh'
    ? 'PowerShell 7 supports `&&` and `||` natively.'
    : 'PowerShell 5.1 does not accept `&&` or `||`; write `;` instead and the runner will rebuild the chain for you.';

  return [
    `Terminal shell: ${shell.label} (non-interactive, no profile).`,
    'Write PowerShell syntax, not cmd.exe batch syntax:',
    '- Chain commands with `;`. ' + versionLine,
    '- Environment variables are `$env:NAME`, never `%NAME%`.',
    '- Use cmdlets: `Get-ChildItem`, `Get-Content`, `Select-String`, `Select-Object -First N`, `Test-Path`, `Set-Content`, `Remove-Item`, `New-Item -ItemType Directory`.',
    '- `grep`, `sed`, `head`, `tail`, `which` and `test` are not installed; use the cmdlets above instead.',
    '- `ls`, `cd`, `echo`, `cat` and `rm` exist as PowerShell aliases but take PowerShell parameters: `rm -rf x` and `mkdir -p x` fail; use `Remove-Item -Recurse -Force x` and `New-Item -ItemType Directory -Force x`.',
    '- Run an executable whose path contains spaces with the call operator: `& "C:\\Program Files\\app\\app.exe" --flag`.',
    '- For cmd.exe-only syntax, wrap it: `cmd /c "..."`.',
    '- Quote arguments containing spaces; single quotes are literal, double quotes allow `$` expansion.'
  ].join('\n');
}

/**
 * One-line shell name for tool schemas.
 *
 * @param shell - Resolution from `resolveShellInvocation`.
 * @returns Short suffix describing the shell and its chaining operators.
 * @rationale The full block from `describeShellForPrompt` already ships in the
 *            environment system message; repeating ~1KB in every tool schema would
 *            duplicate tokens (§26) for no extra signal. The schema only needs to
 *            settle which syntax family applies.
 */
export function describeShellBriefly(shell: ShellInvocation): string {
  if (shell.kind === 'pwsh') {
    return 'Shell: PowerShell 7 (pwsh) — PowerShell syntax, `&&`/`||` supported.';
  }
  if (shell.kind === 'powershell') {
    return 'Shell: Windows PowerShell — PowerShell syntax (`$env:NAME`, cmdlets), not cmd.exe batch syntax. `&&`/`||` are rewritten for you.';
  }
  if (shell.kind === 'cmd') {
    return 'Shell: cmd.exe — batch syntax (`%VAR%`, `dir`, `type`); PowerShell cmdlets do not work.';
  }
  return `Shell: ${path.basename(shell.executable)} — Unix syntax.`;
}

/**
 * `fs.existsSync` wrapper that treats any failure as "not available".
 *
 * @param target - Path to probe.
 * @returns True only when the path is confirmed present.
 */
function safeExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}
