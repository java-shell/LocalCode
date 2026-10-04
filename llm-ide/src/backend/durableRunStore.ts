import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import {
  DurableRun,
  DurableRunKind,
  DurableRunRecoveryAction,
  DurableRunStatus
} from '../shared/types';

interface DurableRunStoreFile {
  version: 1;
  runs: DurableRun[];
}

interface UpsertDurableRunInput {
  runId: string;
  kind: DurableRunKind;
  status: DurableRunStatus;
  workspaceDir: string;
  sessionId?: string;
  stageId?: string;
  model?: string;
  promptExcerpt?: string;
  promptSnapshot?: string;
  replayPolicyVersion?: number;
  checkpointRef?: string;
  error?: string;
  recoveryAction?: DurableRunRecoveryAction;
  recoveredAt?: string;
}

const DEFAULT_REPLAY_POLICY_VERSION = 1;
const MAX_RUNS = 500;
let durableRunStorePathOverride: string | null = null;

/**
 * Configure a deterministic durable-run store path for tests.
 *
 * Purpose: isolate file I/O in unit tests without relying on Electron runtime
 * user-data paths.
 */
export function setDurableRunStorePathForTests(filePath: string | null): void {
  durableRunStorePathOverride = filePath ? path.resolve(filePath) : null;
}

function getStorePath(): string {
  if (durableRunStorePathOverride) {
    return durableRunStorePathOverride;
  }
  return path.join(app.getPath('userData'), 'durable-runs.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeKind(value: unknown): DurableRunKind {
  return String(value ?? '').trim() === 'orchestration' ? 'orchestration' : 'chat';
}

function normalizeStatus(value: unknown): DurableRunStatus {
  const raw = String(value ?? '').trim();
  if (
    raw === 'pending' ||
    raw === 'running' ||
    raw === 'waiting_input' ||
    raw === 'waiting_tool' ||
    raw === 'completed' ||
    raw === 'failed' ||
    raw === 'canceled'
  ) {
    return raw;
  }
  return 'pending';
}

function normalizeRecoveryAction(value: unknown): DurableRunRecoveryAction | undefined {
  const raw = String(value ?? '').trim();
  if (raw === 'resume' || raw === 'restart' || raw === 'abort' || raw === 'dismiss') {
    return raw;
  }
  return undefined;
}

function normalizeRun(entry: Partial<DurableRun> | undefined): DurableRun | null {
  const runId = String(entry?.runId ?? '').trim();
  const workspaceDir = String(entry?.workspaceDir ?? '').trim();
  const createdAt = String(entry?.createdAt ?? '').trim() || nowIso();
  const updatedAt = String(entry?.updatedAt ?? '').trim() || nowIso();
  if (!runId || !workspaceDir) {
    return null;
  }

  return {
    runId,
    kind: normalizeKind(entry?.kind),
    status: normalizeStatus(entry?.status),
    workspaceDir,
    createdAt,
    updatedAt,
    completedAt: String(entry?.completedAt ?? '').trim() || undefined,
    sessionId: String(entry?.sessionId ?? '').trim() || undefined,
    stageId: String(entry?.stageId ?? '').trim() || undefined,
    model: String(entry?.model ?? '').trim() || undefined,
    promptExcerpt: String(entry?.promptExcerpt ?? '').trim() || undefined,
    promptSnapshot: String(entry?.promptSnapshot ?? '').trim() || undefined,
    replayPolicyVersion:
      Math.max(1, Number(entry?.replayPolicyVersion ?? DEFAULT_REPLAY_POLICY_VERSION)) ||
      DEFAULT_REPLAY_POLICY_VERSION,
    checkpointRef: String(entry?.checkpointRef ?? '').trim() || undefined,
    error: String(entry?.error ?? '').trim() || undefined,
    recoveryAction: normalizeRecoveryAction(entry?.recoveryAction),
    recoveredAt: String(entry?.recoveredAt ?? '').trim() || undefined
  };
}

async function readStore(): Promise<DurableRunStoreFile> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DurableRunStoreFile>;
    const runs = Array.isArray(parsed.runs)
      ? parsed.runs
          .map(item => normalizeRun(item))
          .filter((item): item is DurableRun => Boolean(item))
      : [];
    return {
      version: 1,
      runs
    };
  } catch {
    return {
      version: 1,
      runs: []
    };
  }
}

async function writeStore(store: DurableRunStoreFile): Promise<void> {
  const filePath = getStorePath();
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

function finalizeStatus(status: DurableRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function isRecoverableStatus(status: DurableRunStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'waiting_input' || status === 'waiting_tool';
}

function compactRuns(runs: DurableRun[]): DurableRun[] {
  return runs
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_RUNS);
}

export async function upsertDurableRun(input: UpsertDurableRunInput): Promise<DurableRun> {
  const safeRunId = String(input.runId ?? '').trim();
  const safeWorkspaceDir = String(input.workspaceDir ?? '').trim();
  if (!safeRunId || !safeWorkspaceDir) {
    throw new Error('runId and workspaceDir are required for durable runs.');
  }

  const status = normalizeStatus(input.status);
  const normalized = normalizeRun({
    runId: safeRunId,
    kind: input.kind,
    status,
    workspaceDir: safeWorkspaceDir,
    sessionId: input.sessionId,
    stageId: input.stageId,
    model: input.model,
    promptExcerpt: input.promptExcerpt,
    promptSnapshot: input.promptSnapshot,
    replayPolicyVersion: input.replayPolicyVersion,
    checkpointRef: input.checkpointRef,
    error: input.error,
    recoveryAction: input.recoveryAction,
    recoveredAt: input.recoveredAt,
    updatedAt: nowIso(),
    completedAt: finalizeStatus(status) ? nowIso() : undefined
  });

  if (!normalized) {
    throw new Error('Invalid durable run payload.');
  }

  const store = await readStore();
  const index = store.runs.findIndex(run => run.runId === normalized.runId);
  if (index >= 0) {
    const existing = store.runs[index];
    store.runs[index] = {
      ...existing,
      ...normalized,
      createdAt: existing.createdAt,
      completedAt: finalizeStatus(status) ? normalized.completedAt ?? nowIso() : existing.completedAt,
      error: normalized.error ?? existing.error,
      promptSnapshot: normalized.promptSnapshot ?? existing.promptSnapshot,
      recoveryAction: normalized.recoveryAction ?? existing.recoveryAction,
      recoveredAt: normalized.recoveredAt ?? existing.recoveredAt
    };
  } else {
    store.runs.push({
      ...normalized,
      createdAt: nowIso()
    });
  }

  store.runs = compactRuns(store.runs);
  await writeStore(store);

  const saved = store.runs.find(run => run.runId === normalized.runId);
  return saved ?? normalized;
}

export async function listDurableRuns(limit = 100): Promise<DurableRun[]> {
  const store = await readStore();
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return store.runs
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, safeLimit);
}

export async function getDurableRun(runId: string): Promise<DurableRun | null> {
  const safeRunId = String(runId ?? '').trim();
  if (!safeRunId) {
    return null;
  }
  const store = await readStore();
  return store.runs.find(run => run.runId === safeRunId) ?? null;
}

export async function listRecoverableDurableRuns(params?: {
  workspaceDir?: string;
  kind?: DurableRunKind;
  limit?: number;
}): Promise<DurableRun[]> {
  const safeWorkspaceDir = String(params?.workspaceDir ?? '').trim();
  const safeKind = params?.kind;
  const safeLimit = Math.max(1, Math.min(500, Number(params?.limit ?? 100) || 100));

  const runs = await listDurableRuns(Math.max(safeLimit * 2, safeLimit));
  return runs
    .filter(run => {
      if (!isRecoverableStatus(run.status)) {
        return false;
      }
      if (safeWorkspaceDir && run.workspaceDir !== safeWorkspaceDir) {
        return false;
      }
      if (safeKind && run.kind !== safeKind) {
        return false;
      }
      return true;
    })
    .slice(0, safeLimit);
}

export async function applyDurableRunRecoveryAction(
  runId: string,
  action: DurableRunRecoveryAction
): Promise<DurableRun | null> {
  const current = await getDurableRun(runId);
  if (!current) {
    return null;
  }

  const safeAction = normalizeRecoveryAction(action);
  if (!safeAction) {
    return null;
  }

  const note = `Recovery action applied: ${safeAction}`;
  return upsertDurableRun({
    runId: current.runId,
    kind: current.kind,
    status: 'canceled',
    workspaceDir: current.workspaceDir,
    sessionId: current.sessionId,
    stageId: current.stageId,
    model: current.model,
    promptExcerpt: current.promptExcerpt,
    promptSnapshot: current.promptSnapshot,
    replayPolicyVersion: current.replayPolicyVersion,
    checkpointRef: current.checkpointRef,
    error: current.error ? `${current.error} | ${note}` : note,
    recoveryAction: safeAction,
    recoveredAt: nowIso()
  });
}
