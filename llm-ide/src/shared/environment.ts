// Single source of truth for the runtime environment block injected into
// system prompts (chat + orchestration). Both paths call this so the model
// always knows which OS it is running on, where its working directory is, and
// which shell `run_terminal_command` actually executes commands in.
//
// The shell block is derived from the same resolved recipe the runner spawns
// with, so the prompt can never describe a shell different from the one in use.

import { describeShellForPrompt, resolveShellInvocation, type ShellInvocation } from './shellConfig';

/**
 * Build the runtime environment block injected into system prompts.
 *
 * @param workspaceDir - Selected workspace path; falls back to `process.cwd()`.
 * @param shell - Optional pre-resolved shell recipe. Callers that already resolved
 *                it pass it here so guidance and execution cannot drift apart.
 * @returns Multi-line guidance block. Never empty.
 * @sideEffects May resolve the shell (one PATH scan, cached process-wide).
 * @performance Constant size.
 * @rationale Naming the concrete shell and its real syntax rules is what prevents the
 *            cmd.exe/PowerShell syntax churn models otherwise produce on Windows.
 */
export function formatEnvironmentGuidance(workspaceDir?: string, shell: ShellInvocation = resolveShellInvocation()): string {
  const platform = process.platform;
  let osName: string;
  switch (platform) {
    case 'win32':
      osName = 'Windows';
      break;
    case 'darwin':
      osName = 'macOS';
      break;
    case 'linux':
      osName = 'Linux';
      break;
    default:
      osName = platform;
  }

  const dir = (workspaceDir && String(workspaceDir).trim()) || process.cwd();

  // Falls back to generic Unix wording on POSIX, where describeShellForPrompt returns
  // nothing because there is no shell-syntax ambiguity there.
  const shellGuidance = describeShellForPrompt(shell) ||
    'Use native commands appropriate for this OS; on Linux/macOS run commands with `sh`.';

  return [
    'Environment information:',
    `- Operating system: ${osName} (Node.js process.platform: ${platform})`,
    `- Working directory: ${dir}`,
    shellGuidance
  ].join('\n');
}
