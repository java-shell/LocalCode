import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import {
  ChatTurnCheckpoint,
  ChatTurnCheckpointResolution,
  ChatTurnCheckpointState
} from '../shared/types';

interface ChatTurnCheckpointStoreFile {
  version: 1;
  checkpoints: ChatTurnCheckpoint[];
}

interface UpsertCheckpointInput {
  sessionId: string;
  turnId: string;
  workspaceDir: string;
  prompt: string;
  model: string;
  state: ChatTurnCheckpointState;
  partialAssistantText?: string;
  lastToolName?: string;
  lastError?: string;
  interrupted?: boolean;
  resolved?: boolean;
  resolution?: ChatTurnCheckpointResolution;
}

const MAX_CHECKPOINTS = 400;
const STALE_ACTIVE_CHECKPOINT_MS = 15000;
let checkpointStorePathOverride: string | null = null;

/**
 * Configure a deterministic checkpoint store path for tests.
 *
 * Purpose: allow unit tests to isolate filesystem writes without relying on
 * Electron runtime paths.
 */
export function setChatTurnCheckpointStorePathForTests(filePath: string | null): void {
  checkpointStorePathOverride = filePath ? path.resolve(filePath) : null;
}

function getStorePath(): string {
  if (checkpointStorePathOverride) {
    return checkpointStorePathOverride;
  }
  return path.join(app.getPath('userData'), 'chat-turn-checkpoints.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeState(value: unknown): ChatTurnCheckpointState {
  const raw = String(value ?? '').trim();
  if (
    raw === 'queued' ||
    raw === 'streaming' ||
    raw === 'tool_call_started' ||
    raw === 'tool_call_completed' ||
    raw === 'completed' ||
    raw === 'interrupted'
  ) {
    return raw;
  }
  return 'queued';
}

function normalizeResolution(value: unknown): ChatTurnCheckpointResolution | undefined {
  const raw = String(value ?? '').trim();
  if (raw === 'dismissed' || raw === 'retried' || raw === 'regenerated' || raw === 'completed') {
    return raw;
  }
  return undefined;
}

function normalizeCheckpoint(raw: Partial<ChatTurnCheckpoint> | undefined): ChatTurnCheckpoint | null {
  const sessionId = String(raw?.sessionId ?? '').trim();
  const turnId = String(raw?.turnId ?? '').trim();
  const workspaceDir = String(raw?.workspaceDir ?? '').trim();
  const prompt = String(raw?.prompt ?? '').trim();
  const model = String(raw?.model ?? '').trim();
  const updatedAt = String(raw?.updatedAt ?? '').trim() || nowIso();
  const state = normalizeState(raw?.state);

  if (!sessionId || !turnId || !workspaceDir || !prompt || !model) {
    return null;
  }

  const interrupted = Boolean(raw?.interrupted ?? state === 'interrupted');
  const resolved = Boolean(raw?.resolved ?? state === 'completed');
  const resolution = normalizeResolution(raw?.resolution);
  const resolvedAt = String(raw?.resolvedAt ?? '').trim() || undefined;

  return {
    sessionId,
    turnId,
    workspaceDir,
    prompt,
    model,
    state,
    partialAssistantText: String(raw?.partialAssistantText ?? '').trim() || undefined,
    lastToolName: String(raw?.lastToolName ?? '').trim() || undefined,
    lastError: String(raw?.lastError ?? '').trim() || undefined,
    updatedAt,
    interrupted,
    resolved,
    resolvedAt,
    resolution
  };
}

function isActiveUnresolvedState(state: ChatTurnCheckpointState): boolean {
  return state === 'queued' || state === 'streaming' || state === 'tool_call_started' || state === 'tool_call_completed';
}

function maybePromoteStaleToInterrupted(entry: ChatTurnCheckpoint): ChatTurnCheckpoint {
  if (entry.resolved || entry.interrupted || !isActiveUnresolvedState(entry.state)) {
    return entry;
  }

  const updatedAtMs = new Date(entry.updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) {
    return {
      ...entry,
      state: 'interrupted',
      interrupted: true,
      lastError: entry.lastError || 'Recovered interrupted turn after restart',
      updatedAt: nowIso()
    };
  }

  if (Date.now() - updatedAtMs < STALE_ACTIVE_CHECKPOINT_MS) {
    return entry;
  }

  return {
    ...entry,
    state: 'interrupted',
    interrupted: true,
    lastError: entry.lastError || 'Recovered interrupted turn after restart',
    updatedAt: nowIso()
  };
}

async function readStore(): Promise<ChatTurnCheckpointStoreFile> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChatTurnCheckpointStoreFile>;
    const checkpoints = Array.isArray(parsed.checkpoints)
      ? parsed.checkpoints
          .map(item => normalizeCheckpoint(item))
          .filter((item): item is ChatTurnCheckpoint => Boolean(item))
      : [];
    return {
      version: 1,
      checkpoints
    };
  } catch {
    return {
      version: 1,
      checkpoints: []
    };
  }
}

async function writeStore(store: ChatTurnCheckpointStoreFile): Promise<void> {
  const filePath = getStorePath();
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

function trimCheckpoints(checkpoints: ChatTurnCheckpoint[]): ChatTurnCheckpoint[] {
  return checkpoints
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CHECKPOINTS);
}

export async function upsertChatTurnCheckpoint(input: UpsertCheckpointInput): Promise<ChatTurnCheckpoint> {
  const normalized = normalizeCheckpoint({
    sessionId: input.sessionId,
    turnId: input.turnId,
    workspaceDir: input.workspaceDir,
    prompt: input.prompt,
    model: input.model,
    state: input.state,
    partialAssistantText: input.partialAssistantText,
    lastToolName: input.lastToolName,
    lastError: input.lastError,
    interrupted: input.interrupted,
    resolved: input.resolved,
    resolution: input.resolution,
    updatedAt: nowIso(),
    resolvedAt: input.resolved ? nowIso() : undefined
  });

  if (!normalized) {
    throw new Error('Invalid chat turn checkpoint payload.');
  }

  const store = await readStore();
  const idx = store.checkpoints.findIndex(
    entry => entry.sessionId === normalized.sessionId && entry.turnId === normalized.turnId
  );

  if (idx >= 0) {
    const previous = store.checkpoints[idx];
    store.checkpoints[idx] = {
      ...previous,
      ...normalized,
      partialAssistantText: normalized.partialAssistantText ?? previous.partialAssistantText,
      lastToolName: normalized.lastToolName ?? previous.lastToolName,
      lastError: normalized.lastError ?? previous.lastError,
      resolvedAt: normalized.resolved ? normalized.resolvedAt ?? nowIso() : previous.resolvedAt,
      resolution: normalized.resolution ?? previous.resolution
    };
  } else {
    store.checkpoints.push(normalized);
  }

  store.checkpoints = trimCheckpoints(store.checkpoints);
  await writeStore(store);

  const saved = store.checkpoints.find(
    entry => entry.sessionId === normalized.sessionId && entry.turnId === normalized.turnId
  );
  return saved ?? normalized;
}

export async function getLatestInterruptedChatTurn(sessionId: string): Promise<ChatTurnCheckpoint | null> {
  const safeSessionId = String(sessionId ?? '').trim();
  if (!safeSessionId) {
    return null;
  }

  const store = await readStore();
  const promoted = store.checkpoints.map(item => maybePromoteStaleToInterrupted(item));
  const changed = promoted.some((item, idx) => item !== store.checkpoints[idx]);

  const interrupted = promoted
    .filter(item => item.sessionId === safeSessionId && item.interrupted && !item.resolved)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (changed) {
    await writeStore({
      version: 1,
      checkpoints: trimCheckpoints(promoted)
    });
  }

  return interrupted[0] ?? null;
}

export async function resolveChatTurnCheckpoint(
  sessionId: string,
  turnId: string,
  resolution: ChatTurnCheckpointResolution
): Promise<ChatTurnCheckpoint | null> {
  const safeSessionId = String(sessionId ?? '').trim();
  const safeTurnId = String(turnId ?? '').trim();
  const safeResolution = normalizeResolution(resolution);

  if (!safeSessionId || !safeTurnId || !safeResolution) {
    return null;
  }

  const store = await readStore();
  const idx = store.checkpoints.findIndex(
    entry => entry.sessionId === safeSessionId && entry.turnId === safeTurnId
  );
  if (idx < 0) {
    return null;
  }

  const updated: ChatTurnCheckpoint = {
    ...store.checkpoints[idx],
    resolved: true,
    resolution: safeResolution,
    resolvedAt: nowIso(),
    interrupted: false,
    state: safeResolution === 'completed' ? 'completed' : store.checkpoints[idx].state,
    updatedAt: nowIso()
  };

  store.checkpoints[idx] = updated;
  await writeStore({
    version: 1,
    checkpoints: trimCheckpoints(store.checkpoints)
  });

  return updated;
}
