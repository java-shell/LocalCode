import * as fs from 'fs/promises';
import * as path from 'path';

export interface ChatDumpPruneOptions {
  maxHistoricalFiles?: number;
  maxAgeDays?: number;
}

export interface ChatDumpPruneResult {
  removedCount: number;
  keptCount: number;
}

export const DEFAULT_CHAT_DUMP_PRUNE_OPTIONS: Required<ChatDumpPruneOptions> = {
  maxHistoricalFiles: 200,
  maxAgeDays: 14
};

/**
 * Check whether a file name is a timestamped chat context debug dump.
 *
 * Purpose: Restrict pruning to historical dump files and never touch unrelated files.
 * Inputs: Base file name.
 * Outputs: true only for files named like chat-context-<timestamp>.json.
 * Side effects: None.
 * Errors: None.
 * Performance: O(1) regex match.
 * Security: Filename-only validation prevents unintended broad file operations.
 * Concurrency: Pure function, safe for concurrent calls.
 * Rationale: Keep pruning scope narrow and predictable.
 */
export function isHistoricalChatContextDumpFile(fileName: string): boolean {
  return /^chat-context-(?!latest\.json$).+\.json$/i.test(String(fileName || '').trim());
}

/**
 * Prune old chat context dumps in a debug directory.
 *
 * Purpose: Prevent unbounded growth of chat debug dumps on disk.
 * Inputs: debug directory path and optional retention limits.
 * Outputs: Number of removed and kept historical dump files.
 * Side effects: Deletes historical dump files that exceed age/count retention.
 * Errors: Swallows per-file read/delete errors and only throws when directory listing fails unexpectedly.
 * Performance: O(n log n) due to sort by mtime for n historical dump files.
 * Security: Operates only on files discovered in the provided debug directory.
 * Concurrency: Idempotent best-effort behavior across concurrent calls.
 * Rationale: Apply both age and count caps so frequent sessions cannot fill disk.
 */
export async function pruneChatContextDumps(
  debugDir: string,
  options?: ChatDumpPruneOptions
): Promise<ChatDumpPruneResult> {
  const maxHistoricalFiles = Math.max(
    1,
    Math.floor(Number(options?.maxHistoricalFiles ?? DEFAULT_CHAT_DUMP_PRUNE_OPTIONS.maxHistoricalFiles))
  );
  const maxAgeDays = Math.max(1, Math.floor(Number(options?.maxAgeDays ?? DEFAULT_CHAT_DUMP_PRUNE_OPTIONS.maxAgeDays)));
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const entries = await fs.readdir(debugDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter(entry => entry.isFile() && isHistoricalChatContextDumpFile(entry.name))
      .map(async entry => {
        const absolutePath = path.join(debugDir, entry.name);
        try {
          const stat = await fs.stat(absolutePath);
          return {
            absolutePath,
            mtimeMs: Number(stat.mtimeMs || 0)
          };
        } catch {
          return null;
        }
      })
  );

  const historical = candidates
    .filter((value): value is { absolutePath: string; mtimeMs: number } => Boolean(value))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const toDelete = new Set<string>();

  for (const file of historical) {
    if (file.mtimeMs > 0 && nowMs - file.mtimeMs > maxAgeMs) {
      toDelete.add(file.absolutePath);
    }
  }

  historical.slice(maxHistoricalFiles).forEach(file => {
    toDelete.add(file.absolutePath);
  });

  let removedCount = 0;
  await Promise.all(
    Array.from(toDelete).map(async target => {
      try {
        await fs.unlink(target);
        removedCount += 1;
      } catch {
        // Ignore delete races and permission edge cases during best-effort pruning.
      }
    })
  );

  return {
    removedCount,
    keptCount: Math.max(0, historical.length - removedCount)
  };
}
