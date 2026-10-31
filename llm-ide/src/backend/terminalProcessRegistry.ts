import { ChildProcessWithoutNullStreams } from 'child_process';

export interface TerminalProcessRecord {
  pid: number;
  command?: string;
  cwd?: string;
  startedAt: string;
  running: boolean;
  code?: number | null;
  signal?: string | null;
}

interface InternalTerminalProcessRecord extends TerminalProcessRecord {
  child: ChildProcessWithoutNullStreams | null;
}

interface TerminalWaitSnapshot {
  pid?: number;
  running: boolean;
  code?: number | null;
  signal?: string | null;
}

interface TerminalWaiter {
  pid?: number;
  resolve: (snapshot: TerminalWaitSnapshot) => void;
}

/**
 * Tracks all terminal child processes created by model terminal commands.
 *
 * Purpose: maintain an authoritative registry of running and recently exited
 * terminal processes so UI and tools can inspect and interrupt by PID.
 * Inputs: child process lifecycle notifications (start/end) and optional
 * targeting parameters for interrupts/waits.
 * Outputs: snapshots for status/list APIs and wait completion payloads.
 * Side effects: sends POSIX signals to child processes during interrupts.
 * Errors: interrupt returns structured failure reasons instead of throwing.
 * Concurrency: safe for single-process Node event loop usage in Electron main.
 */
export class TerminalProcessRegistry {
  private readonly records = new Map<number, InternalTerminalProcessRecord>();
  private readonly waiters = new Set<TerminalWaiter>();
  private primaryPid: number | null = null;

  registerStart(
    child: ChildProcessWithoutNullStreams,
    metadata?: {
      command?: string;
      cwd?: string;
    }
  ): void {
    const pid = Number(child.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return;
    }

    this.records.set(pid, {
      pid,
      command: metadata?.command,
      cwd: metadata?.cwd,
      startedAt: new Date().toISOString(),
      running: true,
      code: null,
      signal: null,
      child
    });
    this.primaryPid = pid;
  }

  registerEnd(
    child: ChildProcessWithoutNullStreams,
    metadata?: {
      code?: number | null;
      signal?: string | null;
    }
  ): void {
    const pid = Number(child.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return;
    }

    const existing = this.records.get(pid);
    if (existing) {
      existing.running = false;
      existing.code = metadata?.code ?? existing.code ?? null;
      existing.signal = metadata?.signal ?? existing.signal ?? null;
      existing.child = null;
      this.records.set(pid, existing);
    }

    if (this.primaryPid === pid) {
      this.primaryPid = this.findLatestRunningPid();
    }

    this.notifyWaiters({
      pid,
      running: false,
      code: metadata?.code ?? existing?.code ?? null,
      signal: metadata?.signal ?? existing?.signal ?? null
    });
  }

  listProcesses(options?: { includeExited?: boolean; limit?: number }): {
    processes: TerminalProcessRecord[];
    activePid?: number;
  } {
    const includeExited = Boolean(options?.includeExited);
    const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 50)));

    const sorted = [...this.records.values()].sort((a, b) => {
      if (a.running !== b.running) {
        return a.running ? -1 : 1;
      }
      return String(b.startedAt).localeCompare(String(a.startedAt));
    });

    const filtered = includeExited ? sorted : sorted.filter(item => item.running);
    const processes = filtered.slice(0, limit).map(item => ({
      pid: item.pid,
      command: item.command,
      cwd: item.cwd,
      startedAt: item.startedAt,
      running: item.running,
      code: item.code ?? null,
      signal: item.signal ?? null
    }));

    return {
      processes,
      activePid: this.primaryPid ?? undefined
    };
  }

  getPrimarySnapshot(): {
    running: boolean;
    pid?: number;
    command?: string;
    cwd?: string;
    startedAt?: string;
    code?: number | null;
    signal?: string | null;
  } {
    const target = this.resolveTargetRecord();
    if (!target) {
      return { running: false };
    }

    return {
      running: target.running,
      pid: target.pid,
      command: target.command,
      cwd: target.cwd,
      startedAt: target.startedAt,
      code: target.code ?? null,
      signal: target.signal ?? null
    };
  }

  getChildForInput(targetPid?: number): ChildProcessWithoutNullStreams | null {
    const target = this.resolveTargetRecord(targetPid);
    if (!target || !target.running || !target.child) {
      return null;
    }
    return target.child;
  }

  interruptProcess(payload?: { pid?: number; signal?: NodeJS.Signals }): {
    interrupted: boolean;
    reason?: string;
    pid?: number;
    signal?: string;
  } {
    const target = this.resolveTargetRecord(payload?.pid);
    if (!target || !target.running || !target.child) {
      return { interrupted: false, reason: 'no_active_process' };
    }

    const signal = payload?.signal ?? 'SIGINT';
    const interrupted = target.child.kill(signal);
    if (!interrupted) {
      return { interrupted: false, reason: 'signal_failed', pid: target.pid, signal };
    }

    return { interrupted: true, pid: target.pid, signal };
  }

  async waitForProcess(timeoutMs: number, targetPid?: number): Promise<{
    running: boolean;
    timedOut?: boolean;
    pid?: number;
    code?: number | null;
    signal?: string | null;
  }> {
    const target = this.resolveTargetRecord(targetPid);
    if (!target || !target.running) {
      return {
        running: false,
        timedOut: false,
        pid: target?.pid,
        code: target?.code ?? null,
        signal: target?.signal ?? null
      };
    }

    const bounded = timeoutMs <= 0 ? 0 : Math.max(1000, Math.min(300000, timeoutMs));
    if (bounded === 0) {
      return {
        running: true,
        timedOut: true,
        pid: target.pid
      };
    }

    return await new Promise(resolve => {
      let settled = false;
      const waiter: TerminalWaiter = {
        pid: target.pid,
        resolve: snapshot => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve({
            running: snapshot.running,
            timedOut: false,
            pid: snapshot.pid,
            code: snapshot.code ?? null,
            signal: snapshot.signal ?? null
          });
        }
      };

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.waiters.delete(waiter);
        const latest = this.resolveTargetRecord(target.pid);
        resolve({
          running: Boolean(latest?.running),
          timedOut: true,
          pid: target.pid,
          code: latest?.code ?? null,
          signal: latest?.signal ?? null
        });
      }, bounded);

      this.waiters.add(waiter);
    });
  }

  private findLatestRunningPid(): number | null {
    const running = [...this.records.values()].filter(item => item.running);
    if (running.length === 0) {
      return null;
    }

    running.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return running[0]?.pid ?? null;
  }

  private resolveTargetRecord(targetPid?: number): InternalTerminalProcessRecord | null {
    if (typeof targetPid === 'number' && Number.isFinite(targetPid) && targetPid > 0) {
      return this.records.get(targetPid) ?? null;
    }

    if (this.primaryPid != null) {
      const primary = this.records.get(this.primaryPid);
      if (primary && primary.running) {
        return primary;
      }
    }

    const latestRunningPid = this.findLatestRunningPid();
    if (latestRunningPid == null) {
      return null;
    }
    this.primaryPid = latestRunningPid;
    return this.records.get(latestRunningPid) ?? null;
  }

  private notifyWaiters(snapshot: TerminalWaitSnapshot): void {
    for (const waiter of this.waiters) {
      if (waiter.pid && snapshot.pid && waiter.pid !== snapshot.pid) {
        continue;
      }
      waiter.resolve(snapshot);
      this.waiters.delete(waiter);
    }
  }
}
