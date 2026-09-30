import test from 'node:test';
import assert from 'node:assert/strict';
import { runTerminalCommand } from '../backend/toolRuntime';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * Validate timeoutAction=continue returns control without killing the running process.
 *
 * Purpose: ensure model gets a hung/long-running signal and can choose follow-up actions.
 * Inputs: long-running node command, short timeout, timeoutAction=continue.
 * Outputs: structured result with timedOut=true and running=true.
 * Side effects: spawns a child process and explicitly terminates it in test cleanup.
 */
test('runTerminalCommand reports timedOut/running when timeoutAction is continue', async () => {
  let activeChild: ChildProcessWithoutNullStreams | null = null;

  const result = await runTerminalCommand(
    {
      command: `${process.execPath} -e "setTimeout(() => process.exit(0), 2500)"`,
      timeoutMs: 1000,
      timeoutAction: 'continue',
      scope: 'workspace'
    },
    {
      workspaceDir: process.cwd(),
      rootDir: process.cwd(),
      setActiveTerminalProcess: (child: ChildProcessWithoutNullStreams | null) => {
        activeChild = child;
      }
    } as any
  ) as {
    timedOut?: boolean;
    running?: boolean;
    timeoutAction?: string;
  };

  assert.equal(result.timedOut, true);
  assert.equal(result.running, true);
  assert.equal(result.timeoutAction, 'continue');

  const child = activeChild as ChildProcessWithoutNullStreams | null;
  if (child && child.exitCode === null && !child.killed) {
    child.kill('SIGTERM');
  }
});
