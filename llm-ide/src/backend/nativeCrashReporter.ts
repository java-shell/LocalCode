import type { App, CrashReporter } from 'electron';

/**
 * Start Crashpad before Electron creates renderers and return its local dump directory.
 * Call once in main-process bootstrap. No upload URL, user content, or custom annotations
 * are supplied; dumps themselves may contain sensitive memory. Preserve the OS crash
 * handler for independent core evidence. Initialization failures are logged and return
 * null rather than introducing a new startup failure. Crashpad, not a JS exit callback,
 * writes the native dump; normal exits, SIGKILL, and crashes before bootstrap are not covered.
 * Uses Electron's default crashDumps path without moving or deleting existing reports.
 */
export function startNativeCrashReporter(
  app: Pick<App, 'getPath'>,
  reporter: Pick<CrashReporter, 'start'>,
  logger: Pick<Console, 'info' | 'error'> = console
): string | null {
  try {
    const directory = app.getPath('crashDumps');
    reporter.start({ uploadToServer: false, ignoreSystemCrashHandler: false });
    logger.info(`[crash-reporter] Native crash dumps (local only): ${directory}`);
    return directory;
  } catch {
    // Avoid logging potentially sensitive native exception text.
    logger.error('[crash-reporter] initialization failed; native dumps may not be collected.');
    return null;
  }
}