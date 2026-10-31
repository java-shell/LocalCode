import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { TerminalProcessRegistry } from '../backend/terminalProcessRegistry';

function createMockChild(pid: number, killCalls: string[]): ChildProcessWithoutNullStreams {
  return {
    pid,
    exitCode: null,
    killed: false,
    kill: (signal?: NodeJS.Signals | number) => {
      killCalls.push(String(signal ?? 'SIGTERM'));
      return true;
    },
    stdin: {
      destroyed: false,
      write: () => true
    }
  } as unknown as ChildProcessWithoutNullStreams;
}

test('registry tracks all running terminal pids and active pid', () => {
  const registry = new TerminalProcessRegistry();
  const killCalls: string[] = [];
  const first = createMockChild(41001, killCalls);
  const second = createMockChild(41002, killCalls);

  registry.registerStart(first, { command: 'npm start', cwd: '.' });
  registry.registerStart(second, { command: 'npm run dev', cwd: '.' });

  const status = registry.listProcesses({ includeExited: false, limit: 10 });
  assert.equal(status.processes.length, 2);
  assert.equal(status.activePid, 41002);
  assert.deepEqual(
    status.processes.map(process => process.pid).sort((a, b) => a - b),
    [41001, 41002]
  );

  const primary = registry.getPrimarySnapshot();
  assert.equal(primary.running, true);
  assert.equal(primary.pid, 41002);
});

test('registry interrupts a selected pid and reports selection metadata', () => {
  const registry = new TerminalProcessRegistry();
  const killCallsA: string[] = [];
  const killCallsB: string[] = [];
  const first = createMockChild(42001, killCallsA);
  const second = createMockChild(42002, killCallsB);

  registry.registerStart(first, { command: 'first', cwd: '.' });
  registry.registerStart(second, { command: 'second', cwd: '.' });

  const interrupt = registry.interruptProcess({ pid: 42001, signal: 'SIGTERM' });
  assert.equal(interrupt.interrupted, true);
  assert.equal(interrupt.pid, 42001);
  assert.equal(interrupt.signal, 'SIGTERM');
  assert.deepEqual(killCallsA, ['SIGTERM']);
  assert.deepEqual(killCallsB, []);
});

test('registry wait resolves when targeted pid exits', async () => {
  const registry = new TerminalProcessRegistry();
  const killCalls: string[] = [];
  const child = createMockChild(43001, killCalls);

  registry.registerStart(child, { command: 'long-runner', cwd: '.' });
  const waiting = registry.waitForProcess(5000, 43001);

  setTimeout(() => {
    registry.registerEnd(child, { code: 0, signal: null });
  }, 25);

  const result = await waiting;
  assert.equal(result.running, false);
  assert.equal(result.pid, 43001);
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
});

test('registry promotes remaining running pid after active process exits', () => {
  const registry = new TerminalProcessRegistry();
  const killCalls: string[] = [];
  const first = createMockChild(44001, killCalls);
  const second = createMockChild(44002, killCalls);

  registry.registerStart(first, { command: 'first', cwd: '.' });
  registry.registerStart(second, { command: 'second', cwd: '.' });
  registry.registerEnd(second, { code: 0, signal: null });

  const active = registry.getPrimarySnapshot();
  assert.equal(active.running, true);
  assert.equal(active.pid, 44001);

  const running = registry.listProcesses({ includeExited: false, limit: 10 });
  assert.deepEqual(running.processes.map(process => process.pid), [44001]);
});
