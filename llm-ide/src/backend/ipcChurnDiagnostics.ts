import type { App, IpcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

/** Count handled invokes without inspecting payloads; O(1) recording, at most 128 channels.
 * Snapshots consume interval counts but retain totals. Monotonic milliseconds are supplied
 * by the caller for deterministic tests; this is main-thread-only diagnostic state.
 */
export function createIpcChurnMeter(startMs = performance.now()) {
  const channels = new Map<string, { total: number; interval: number; peakPerSecond: number }>();
  let total = 0;
  let previousMs = startMs;
  return {
    /** Record one incoming registered invoke; arbitrary excess channel names share a bucket. */
    record(channel: string): void {
      const key = channels.has(channel) || channels.size < 127 ? channel : '[other]';
      const counts = channels.get(key) ?? { total: 0, interval: 0, peakPerSecond: 0 };
      counts.total++;
      counts.interval++;
      channels.set(key, counts);
      total++;
    },
    /** Return cumulative and interval rates, resetting only interval counts. No payload data. */
    snapshot(nowMs = performance.now()) {
      const intervalSeconds = Math.max(0.001, (nowMs - previousMs) / 1000);
      const elapsedSeconds = Math.max(0.001, (nowMs - startMs) / 1000);
      let intervalTotal = 0;
      const rows = [...channels].map(([channel, counts]) => {
        intervalTotal += counts.interval;
        const intervalPerSecond = counts.interval / intervalSeconds;
        counts.peakPerSecond = Math.max(counts.peakPerSecond, intervalPerSecond);
        const row = { channel, total: counts.total, intervalCount: counts.interval,
          intervalPerSecond, averagePerSecond: counts.total / elapsedSeconds,
          peakPerSecond: counts.peakPerSecond };
        counts.interval = 0;
        return row;
      }).sort((a, b) => b.total - a.total);
      previousMs = nowMs;
      return { elapsedSeconds, intervalSeconds, total, intervalTotal,
        intervalPerSecond: intervalTotal / intervalSeconds,
        averagePerSecond: total / elapsedSeconds, channels: rows };
    }
  };
}

/** Return an IPC registration facade which counts invokes only when opt-in is enabled.
 * Call before handler registration. No added IPC, payload logging, or unbounded history:
 * every 10 seconds overwrite one private JSON file with totals and at most 60 windows.
 * A Proxy avoids modifying Electron's global ipcMain; other methods bind to the original.
 * Listener arguments, return values, throws and rejections remain unchanged. Native event
 * construction, unhandled/internal messages, renderer sends and V8 allocations are not counted.
 * Disk failures are reported once and never prevent application operation. Timers do not
 * keep the app alive; normal quit flushes, while native crashes retain the last saved sample.
 */
export function createMeasuredIpcMain(
  app: Pick<App, 'once' | 'getPath' | 'getVersion'>,
  ipc: IpcMain,
  enabled = process.env.LOCALCODE_IPC_CHURN === '1'
): IpcMain {
  if (!enabled) return ipc;
  const meter = createIpcChurnMeter();
  const windows: ReturnType<typeof meter.snapshot>[] = [];
  let timer: NodeJS.Timeout | undefined;
  let failed = false;
  /** Persist aggregate metadata only; synchronous bounded writes avoid overlapping snapshots. */
  const flush = () => {
    const sample = meter.snapshot();
    windows.push(sample);
    if (windows.length > 60) windows.shift();
    try {
      const directory = path.join(app.getPath('userData'), 'debug');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(directory, 'ipc-churn.json'), JSON.stringify({
        schemaVersion: 1, pid: process.pid, appVersion: app.getVersion(),
        electronVersion: process.versions.electron, sampledAt: new Date().toISOString(),
        scope: 'LocalCode registered ipcMain.handle invocations; no payloads',
        latest: sample, windows
      }), { mode: 0o600 });
    } catch {
      if (!failed) console.error('[ipc-churn] Could not persist channel counters.');
      failed = true;
    }
  };
  app.once('ready', () => {
    console.info(`[ipc-churn] Enabled; aggregate counters: ${path.join(app.getPath('userData'), 'debug', 'ipc-churn.json')}`);
    flush();
    timer = setInterval(flush, 10000);
    timer.unref();
  });
  app.once('will-quit', () => { if (timer) clearInterval(timer); flush(); });
  return new Proxy(ipc, {
    get(target, property) {
      if (property === 'handle') {
        return (channel: string, listener: Parameters<IpcMain['handle']>[1]) =>
          target.handle(channel, (...args) => { meter.record(channel); return listener(...args); });
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}