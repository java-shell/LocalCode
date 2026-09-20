import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { chatWithTools, listModelCatalog } from './backend/llmClient';
import { runOrchestration } from './backend/orchestrationEngine';
import { deleteChatSession, listChatSessions, loadChatSession, saveChatSession } from './backend/chatSessionStore';
import { defaultPlan, normalizeAdvancedStageIds, validatePlan, planPresets } from './backend/schema';
import { loadPlan, savePlan } from './backend/planStore';
import { pruneChatContextDumps } from './backend/chatDebugDumps';
import { dispatchNotification, sendTestNotification, type NotifyConfig } from './backend/notify';
import {
  ChatSession,
  ChatStreamResult,
  ChatMessage,
  ChatStreamRequest,
  LLMConfig,
  NotifySettings,
  PromptSpecVersion,
  SubAgentConfigProfile,
  OrchestrationExportResult,
  OrchestrationImportResult,
  OrchestrationPlan,
  OrchestrationRunRequest,
  OrchestrationRunResult,
  WorkspaceState
} from './shared/types';
import { executeTool, getAllowedToolDefinitions, runTerminalCommand, toolDefinitions } from './backend/toolRuntime';
import { buildWorkspaceTree, readWorkspaceFile, writeWorkspaceFile } from './backend/workspaceFs';
import { TurboVecMemory, computeAdaptiveInjectionLimits } from './backend/turboVecMemory';
import { formatEnvironmentGuidance } from './shared/environment';

let mainWindow: BrowserWindow | null = null;
let selectedWorkspaceDir = process.cwd();
let referenceWorkspaces: import('./shared/types').ReferenceWorkspace[] = [];
let activeTerminalProcess: ChildProcessWithoutNullStreams | null = null;
let activeChatAbortController: AbortController | null = null;
let activeOrchestrationAbortController: AbortController | null = null;
const fileWatchRefs = new Map<string, { count: number; listener: (curr: fs.Stats, prev: fs.Stats) => void }>();
let turboMemory: TurboVecMemory | null = null;
const MAIN_STATE_FILE = 'localcode-main-state.json';
const DEFAULT_PROMPT_SPEC_VERSION: PromptSpecVersion = 'v2';

// Pending query_user promise for awaiting user response
let pendingQueryUserResolve: ((response: import('./backend/toolRuntime').QueryUserResponse) => void) | null = null;

function appResourcePath(...segments: string[]): string {
  return path.join(app.getAppPath(), ...segments);
}

function unpackedAppResourcePath(...segments: string[]): string {
  if (!app.isPackaged) {
    return appResourcePath(...segments);
  }

  return path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
}

function formatMemoryInjection(items: Array<{ source: string; text: string }>, limits?: { maxItems?: number; maxCharsPerItem?: number; maxTotalChars?: number }): string {
  const maxItems = Math.max(1, Math.min(20, Number(limits?.maxItems ?? 4)));
  const maxCharsPerItem = Math.max(200, Math.min(4000, Number(limits?.maxCharsPerItem ?? 1200)));
  const maxTotalChars = Math.max(500, Math.min(12000, Number(limits?.maxTotalChars ?? 4000)));

  let used = 0;
  const lines: string[] = [];

  for (const [index, item] of items.slice(0, maxItems).entries()) {
    const remaining = maxTotalChars - used;
    if (remaining <= 0) {
      break;
    }

    const bodyLimit = Math.max(120, Math.min(maxCharsPerItem, remaining));
    const normalizedText = String(item.text ?? '').replace(/\s+/g, ' ').trim();
    const text = normalizedText.length > bodyLimit
      ? `${normalizedText.slice(0, Math.max(0, bodyLimit - 3))}...`
      : normalizedText;
    const line = `${index + 1}. [${item.source}] ${text}`;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}

function estimateTokensFromText(text: string): number {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return 0;
  }
  // Approximate conversion used for UI visualization only.
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function formatReferenceWorkspaceGuidance(
  refs: import('./shared/types').ReferenceWorkspace[]
): string {
  if (!Array.isArray(refs) || refs.length === 0) {
    return '';
  }

  const lines = refs.map(ref => {
    const scope = `ref:${ref.id}`;
    const access = ref.allowWrite ? 'read/write' : 'read-only';
    return `- ${scope}: ${ref.label} (${access}) at ${ref.path}`;
  });

  return [
    'Reference workspaces are available for scoped tools.',
    'When a tool supports scope, set scope to one of these ref IDs:',
    ...lines
  ].join('\n');
}

function formatToolAvailabilityGuidance(toolNames: string[]): string {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return '';
  }

  const antiLoopGuidance = [
    'Loop prevention policy:',
    '- Track prior actions and outcomes; do not repeat the same failed action without a meaningful change.',
    '- If a tool call fails, analyze the error and modify arguments, tool choice, or approach before retrying.',
    '- Never retry a failed tool call with identical arguments.',
    '- If progress stalls after a few attempts, stop tool-calling, summarize the blocker, and ask the user for direction.'
  ].join('\n');

  const hasSubAgentTool = toolNames.includes('spawn_sub_agent');
  const subAgentGuidance = hasSubAgentTool
    ? [
        '',
        'Sub-agent strategy:',
        '- You can delegate narrow, well-scoped parallel tasks via spawn_sub_agent.',
        '- Use sub-agents when delegation will clearly improve speed or reduce context switching.',
        '- Avoid over-delegation: do not spawn sub-agents for trivial or tightly-coupled steps you can complete directly.',
        '- Sub-agent tool turns are clamped to 1-50 per run; omit maxToolTurns to use the default of 8.',
        '- Before spawning, define a focused objective, expected output, and the minimum tool set needed.',
        '- Integrate sub-agent results, verify quality, and keep final responsibility in this main chat turn.'
      ].join('\n')
    : '';

  return [
    'Tools are enabled for this turn.',
    'Use the exact function name and valid JSON arguments only.',
    `Enabled tools: ${toolNames.join(', ')}`,
    antiLoopGuidance,
    subAgentGuidance
  ].filter(Boolean).join('\n');
}

function normalizePromptSpecVersion(value: unknown): PromptSpecVersion {
  return String(value ?? '').trim().toLowerCase() === 'v2' ? 'v2' : 'v1';
}

function formatToolDecisionPolicyV2(toolNames: string[]): string {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return '';
  }

  return [
    'Tool decision policy:',
    '- Tools are optional, not mandatory.',
    '- Use tools when external evidence or state mutation is required.',
    '- For conceptual-only requests, respond directly without tool calls.',
    '- If a tool is needed, choose the least risky tool first and use exact function names with valid JSON arguments.',
    `Enabled tools: ${toolNames.join(', ')}`
  ].join('\n');
}

function formatLoopRetryPolicyV2(): string {
  return [
    'Loop and retry policy:',
    '- Never retry a failed tool call with identical arguments.',
    '- For bugs, test failures, or unexpected behavior, investigate root cause first before proposing or applying fixes.',
    '- On failure, modify arguments, tool choice, sequence, or overall strategy before retrying.',
    '- If no new evidence appears after two investigation steps, summarize the best hypothesis and next action, then ask the user whether to continue deeper.',
    '- If two attempts on the same objective fail to make progress, stop and ask the user for direction with a blocker summary.'
  ].join('\n');
}

function formatChatV2CorePromptSections(toolNames: string[]): string[] {
  const sections: string[] = [
    [
      'Identity and mission:',
      '- You are an agentic coding assistant for a local IDE runtime.',
      '- Solve the user request end-to-end while preserving safety and correctness.',
      '- Be concise, evidence-driven, and avoid speculation.'
    ].join('\n'),
    [
      'Behavioral policy:',
      '- Prefer the smallest sufficient change.',
      '- Preserve existing behavior unless the user explicitly requests a breaking change.',
      '- Use additive approaches first (flags, adapters, optional parameters) before replacing stable paths.',
      '- Keep solutions simple (KISS/YAGNI) and avoid unnecessary dependencies.',
      '- Surface blockers clearly when they occur.'
    ].join('\n')
  ];

  const toolDecisionPolicy = formatToolDecisionPolicyV2(toolNames);
  if (toolDecisionPolicy) {
    sections.push(toolDecisionPolicy);
  }

  sections.push(
    formatLoopRetryPolicyV2(),
    [
      'Ambiguity and escalation policy:',
      '- If required parameters are missing, ask one targeted clarification question.',
      '- If assumptions are low-risk and reversible, proceed and state assumptions explicitly.',
      '- Request explicit confirmation before destructive or high-impact actions.'
    ].join('\n'),
    [
      'Output contract:',
      '- Final response should include what was done, current state, and next step when unresolved.',
      '- Keep output concise unless the user asks for more depth.',
      '- Before declaring completion, verify relevant changes with appropriate checks/tests and report what was verified.',
      '- Provide decision summaries and avoid exposing hidden reasoning.'
    ].join('\n')
  );

  return sections;
}

function truncateText(value: string, maxChars: number): string {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isInternalServerRetryableError(detail: string): boolean {
  const normalized = String(detail ?? '').toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/canceled$/.test(normalized) || /stopped by user/.test(normalized)) {
    return false;
  }
  return /\bstatus=500\b/.test(normalized) || normalized.includes('internal server error');
}

// Outbound notifications are user-configured only (Settings dialog). They are
// never exposed as a model-callable tool, so a prompt-injected model cannot
// redirect them to an attacker-controlled endpoint.
type NotifyConfigCarrier = { notify?: NotifyConfig } | NotifyConfig | null | undefined;

function notifyConfigFrom(carrier: NotifyConfigCarrier): NotifyConfig | null {
  if (!carrier || typeof carrier !== 'object') {
    return null;
  }
  // Chat/orchestration requests carry the settings under `notify`; the
  // notify:test handler passes the settings object directly.
  if ('notify' in carrier) {
    const wrapped = (carrier as { notify?: NotifyConfig }).notify;
    return wrapped && typeof wrapped === 'object' ? wrapped : null;
  }
  return carrier as NotifyConfig;
}

function sumTotalTokens(usage: { totalTokens?: number }[] | undefined): number | undefined {
  if (!Array.isArray(usage) || usage.length === 0) {
    return undefined;
  }
  const total = usage.reduce((sum, entry) => sum + Math.max(0, Number(entry?.totalTokens ?? 0)), 0);
  return total > 0 ? total : undefined;
}



interface RuntimeSubAgentProfile {
  id: string;
  label: string;
  maxConcurrentSpawns: number;
  config: LLMConfig;
}

function normalizeSpawnLimit(value: unknown): number {
  const parsed = Math.floor(Number(value) || 0);
  return Math.max(1, Math.min(50, parsed || 1));
}

function normalizeRuntimeSubAgentProfiles(
  profiles: SubAgentConfigProfile[] | undefined,
  fallbackConfig: LLMConfig,
  legacySingleConfig?: LLMConfig
): RuntimeSubAgentProfile[] {
  const source = Array.isArray(profiles) ? profiles : [];
  const normalized: RuntimeSubAgentProfile[] = [];
  const seen = new Set<string>();

  for (const [index, profile] of source.entries()) {
    const endpoint = String(profile?.endpoint ?? '').trim();
    const model = String(profile?.model ?? '').trim();
    if (!endpoint || !model) {
      continue;
    }

    const rawId = String(profile?.id ?? '').trim() || `sub-agent-${index + 1}`;
    const id = seen.has(rawId) ? `${rawId}-${index + 1}` : rawId;
    seen.add(id);

    normalized.push({
      id,
      label: String(profile?.label ?? '').trim() || id,
      maxConcurrentSpawns: normalizeSpawnLimit(profile?.maxConcurrentSpawns ?? profile?.maxSpawnsPerRun),
      config: {
        endpoint,
        provider: profile?.provider ?? fallbackConfig.provider,
        model,
        apiKey: profile?.apiKey,
        temperature: Number(profile?.temperature ?? fallbackConfig.temperature ?? 0.2),
        maxTokens: Number(profile?.maxTokens ?? 0) || undefined,
        contextWindowTokens: Math.max(0, Number(profile?.contextWindowTokens ?? 0)) || undefined,
        requestTimeoutMs:
          Number(profile?.requestTimeoutMs ?? 0) ||
          fallbackConfig.requestTimeoutMs
      }
    });
  }

  if (normalized.length > 0) {
    return normalized;
  }

  const legacy = legacySingleConfig ?? fallbackConfig;
  const endpoint = String(legacy?.endpoint ?? '').trim() || String(fallbackConfig.endpoint ?? '').trim();
  const model = String(legacy?.model ?? '').trim() || String(fallbackConfig.model ?? '').trim();
  if (!endpoint || !model) {
    return [];
  }

  return [
    {
      id: 'default-sub-agent',
      label: 'Default Sub-Agent',
      maxConcurrentSpawns: 1,
      config: {
        endpoint,
        provider: legacy?.provider ?? fallbackConfig.provider,
        model,
        apiKey: legacy?.apiKey,
        temperature: Number(legacy?.temperature ?? fallbackConfig.temperature ?? 0.2),
        maxTokens: Number(legacy?.maxTokens ?? 0) || undefined,
        contextWindowTokens: Math.max(0, Number(legacy?.contextWindowTokens ?? 0)) || undefined,
        requestTimeoutMs:
          Number(legacy?.requestTimeoutMs ?? 0) ||
          fallbackConfig.requestTimeoutMs
      }
    }
  ];
}

interface ChatContextDebugMessage {
  role: ChatMessage['role'];
  content: string;
  contentChars: number;
  toolCallCount: number;
  contentTruncated: boolean;
}

async function writeChatContextDebugDump(payload: {
  workspaceDir: string;
  namespace: string;
  model: string;
  contextWindowTokens?: number;
  recalledPromptTokens: number;
  historyMessageCount: number;
  initialMessages: ChatMessage[];
  finalMessages?: ChatMessage[];
  turns?: Array<{
    turn: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    messageCountBefore: number;
    messageCountAfter: number;
    assistantToolCalls: number;
  }>;
  totalToolCalls?: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
  };
}): Promise<string | null> {
  try {
    const debugDir = path.join(app.getPath('userData'), 'debug');
    await fs.promises.mkdir(debugDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const compactStamp = timestamp.replace(/[:.]/g, '-');
    const dumpFilePath = path.join(debugDir, `chat-context-${compactStamp}.json`);
    const latestFilePath = path.join(debugDir, 'chat-context-latest.json');

    const messageRoleCounts = payload.initialMessages.reduce<Record<string, number>>((acc, message) => {
      const key = String(message.role || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const maxMessageChars = 12000;
    const serializeMessages = (messages: ChatMessage[]): ChatContextDebugMessage[] =>
      messages.map(message => {
        const raw = String(message.content ?? '');
        const contentTruncated = raw.length > maxMessageChars;
        return {
          role: message.role,
          content: contentTruncated ? `${raw.slice(0, maxMessageChars)}...[truncated]` : raw,
          contentChars: raw.length,
          toolCallCount: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
          contentTruncated
        };
      });

    const serializedInitialMessages = serializeMessages(payload.initialMessages);
    const serializedFinalMessages = serializeMessages(payload.finalMessages ?? payload.initialMessages);
    const finalRoleCounts = (payload.finalMessages ?? payload.initialMessages).reduce<Record<string, number>>((acc, message) => {
      const key = String(message.role || 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const dump = {
      timestamp,
      workspaceDir: payload.workspaceDir,
      namespace: payload.namespace,
      model: payload.model,
      contextWindowTokens: Math.max(0, Number(payload.contextWindowTokens ?? 0)) || null,
      recalledPromptTokens: Math.max(0, Number(payload.recalledPromptTokens ?? 0)),
      historyMessageCount: Math.max(0, Number(payload.historyMessageCount ?? 0)),
      initialMessageCount: serializedInitialMessages.length,
      finalMessageCount: serializedFinalMessages.length,
      messageRoleCounts,
      finalMessageRoleCounts: finalRoleCounts,
      totalToolCalls: Math.max(0, Number(payload.totalToolCalls ?? 0)),
      turns: Array.isArray(payload.turns) ? payload.turns : [],
      usage: payload.usage,
      initialMessages: serializedInitialMessages,
      finalMessages: serializedFinalMessages
    };

    const raw = `${JSON.stringify(dump, null, 2)}\n`;
    await Promise.all([
      fs.promises.writeFile(dumpFilePath, raw, 'utf8'),
      fs.promises.writeFile(latestFilePath, raw, 'utf8')
    ]);

    // Best-effort retention so debug dumps do not grow without bound on disk.
    await pruneChatContextDumps(debugDir);

    return latestFilePath;
  } catch {
    return null;
  }
}

function memoryNamespace(mode: 'chat' | 'orchestration', workspaceDir: string, suffix?: string): string {
  const trimmedSuffix = String(suffix ?? '').trim();
  return trimmedSuffix ? `${mode}:${workspaceDir}:${trimmedSuffix}` : `${mode}:${workspaceDir}`;
}

function runtimeContext(
  sender?: Electron.WebContents,
  eventChannel: 'chat:event' | 'orch:event' = 'chat:event',
  abortSignal?: AbortSignal,
  promptSpecVersion: PromptSpecVersion = DEFAULT_PROMPT_SPEC_VERSION
) {
  return {
    workspaceDir: selectedWorkspaceDir,
    rootDir: selectedWorkspaceDir,
    referenceWorkspaces,
    abortSignal,
    promptSpecVersion,
    onTerminalOutput: sender
      ? (payload: { source: 'stdout' | 'stderr'; text: string }) => {
          sender.send('terminal:output', payload);
        }
      : undefined,
    onTerminalEvent: sender
      ? (payload: {
          type: 'start' | 'end';
          command: string;
          cwd: string;
          code?: number | null;
          signal?: string | null;
        }) => {
          sender.send('terminal:event', payload);
        }
      : undefined,
    setActiveTerminalProcess: (child: ChildProcessWithoutNullStreams | null) => {
      activeTerminalProcess = child;
    },
    requestOutsideWorkspaceApproval: async (payload: {
      tool: string;
      summary: string;
      targets: string[];
    }) => {
      sender?.send(
        eventChannel,
        `[warning] ${payload.tool} targets path(s) outside workspace and needs approval: ${payload.summary}`
      );

      if (!mainWindow) {
        return false;
      }

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Approve File Mutation Outside Workspace',
        message: `Tool ${payload.tool} wants to modify files outside workspace scope.`,
        detail: `Intent: ${payload.summary}\n\nTargets:\n${payload.targets.join('\n')}`
      });

      const approved = result.response === 0;
      sender?.send(eventChannel, `[warning] outside-workspace operation ${approved ? 'approved' : 'denied'}.`);
      return approved;
    },
    requestReferenceWriteApproval: async (payload: {
      tool: string;
      summary: string;
      referenceLabel: string;
      targets: string[];
    }) => {
      sender?.send(
        eventChannel,
        `[warning] ${payload.tool} wants to write to read-only reference workspace "${payload.referenceLabel}" and needs approval: ${payload.summary}`
      );

      if (!mainWindow) {
        return false;
      }

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Approve Write To Read-Only Reference Workspace',
        message: `Tool ${payload.tool} wants to modify files in read-only reference workspace "${payload.referenceLabel}".`,
        detail: `Intent: ${payload.summary}\n\nTargets:\n${payload.targets.join('\n')}`
      });

      const approved = result.response === 0;
      sender?.send(eventChannel, `[warning] reference-write operation ${approved ? 'approved' : 'denied'}.`);
      return approved;
    }
  };
}

function workspaceState(): WorkspaceState {
  return {
    workspaceDir: selectedWorkspaceDir,
    rootDir: selectedWorkspaceDir,
    referenceWorkspaces,
    promptSpecVersion: DEFAULT_PROMPT_SPEC_VERSION
  };
}

function resolveWatchedWorkspacePath(relativePath: string): { absolute: string; relative: string } {
  const absolute = path.resolve(selectedWorkspaceDir, relativePath);
  const relative = path.relative(selectedWorkspaceDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path must be inside selected workspace directory.');
  }
  return { absolute, relative };
}

function clearAllFileWatches() {
  for (const [absolutePath, ref] of fileWatchRefs.entries()) {
    fs.unwatchFile(absolutePath, ref.listener);
  }
  fileWatchRefs.clear();
}

function mainStatePath(): string {
  return path.join(app.getPath('userData'), MAIN_STATE_FILE);
}

function restoreLastWorkspaceSelection() {
  try {
    const raw = fs.readFileSync(mainStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as { lastWorkspaceDir?: unknown; referenceWorkspaces?: import('./shared/types').ReferenceWorkspace[] };
    const candidate = String(parsed?.lastWorkspaceDir ?? '').trim();
    if (candidate) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isDirectory()) {
          selectedWorkspaceDir = candidate;
        }
      } catch {
        // Directory no longer exists, keep default
      }
    }
    if (Array.isArray(parsed?.referenceWorkspaces)) {
      referenceWorkspaces = parsed.referenceWorkspaces.filter(ref => {
        try {
          return fs.statSync(ref.path).isDirectory();
        } catch {
          return false;
        }
      });
    }
  } catch {
    // Ignore missing/invalid state file and keep default workspace.
  }
}

function persistLastWorkspaceSelection() {
  const payload = {
    lastWorkspaceDir: selectedWorkspaceDir,
    referenceWorkspaces
  };

  void fs.promises
    .mkdir(path.dirname(mainStatePath()), { recursive: true })
    .then(() => fs.promises.writeFile(mainStatePath(), JSON.stringify(payload, null, 2), 'utf8'))
    .catch(() => {
      // Persistence failures should not block workspace usage.
    });
}

async function importPlanFromDisk(): Promise<OrchestrationImportResult | null> {
  const dialogOptions: Electron.OpenDialogOptions = {
    title: 'Import Orchestration Plan',
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  };

  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const raw = await fs.promises.readFile(filePath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const normalizedPlan = normalizeAdvancedStageIds(parsed as OrchestrationPlan);
  const errors = validatePlan(normalizedPlan);
  if (errors.length > 0) {
    throw new Error(`Invalid orchestration plan in ${path.basename(filePath)}: ${errors.join(' ')}`);
  }

  return {
    plan: normalizedPlan,
    filePath
  };
}

async function exportPlanToDisk(plan: OrchestrationPlan): Promise<OrchestrationExportResult | null> {
  const normalizedPlan = normalizeAdvancedStageIds(plan);
  const errors = validatePlan(normalizedPlan);
  if (errors.length > 0) {
    throw new Error(`Invalid orchestration plan: ${errors.join(' ')}`);
  }

  const dialogOptions: Electron.SaveDialogOptions = {
    title: 'Export Orchestration Plan',
    defaultPath: `${normalizedPlan.name || 'orchestration-plan'}.json`,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  };

  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.promises.writeFile(result.filePath, JSON.stringify(normalizedPlan, null, 2), 'utf8');
  return { filePath: result.filePath };
}

async function exportMemoryNamespaceToDisk(
  namespace: string
): Promise<{ filePath: string; namespace: string; recordCount: number } | null> {
  if (!turboMemory) {
    throw new Error('Memory subsystem is not initialized.');
  }

  const archive = await turboMemory.exportNamespaceArchive(namespace);
  const dialogOptions: Electron.SaveDialogOptions = {
    title: 'Export Memory Namespace',
    defaultPath: `${archive.namespace}.turbovec-namespace.json`,
    filters: [
      { name: 'TurboVec Namespace Archive', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  };

  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return null;
  }

  await fs.promises.writeFile(result.filePath, JSON.stringify(archive, null, 2), 'utf8');
  return {
    filePath: result.filePath,
    namespace: archive.namespace,
    recordCount: archive.recordCount
  };
}

async function importMemoryNamespaceFromDisk(payload?: {
  targetNamespace?: string;
  overwrite?: boolean;
}): Promise<{ filePath: string; namespace: string; replaced: boolean; recordCount: number } | null> {
  if (!turboMemory) {
    throw new Error('Memory subsystem is not initialized.');
  }

  const dialogOptions: Electron.OpenDialogOptions = {
    title: 'Import Memory Namespace',
    properties: ['openFile'],
    filters: [
      { name: 'TurboVec Namespace Archive', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  };

  const selection = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (selection.canceled || selection.filePaths.length === 0) {
    return null;
  }

  const filePath = selection.filePaths[0];
  const raw = await fs.promises.readFile(filePath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid namespace archive JSON in ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const imported = await turboMemory.importNamespaceArchive(parsed, {
    targetNamespace: String(payload?.targetNamespace ?? '').trim() || undefined,
    overwrite: Boolean(payload?.overwrite)
  });

  return {
    filePath,
    ...imported
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(appResourcePath('renderer', 'index.html'));
}

app.whenReady().then(() => {
  restoreLastWorkspaceSelection();

  const memoryRoot = path.join(app.getPath('userData'), 'turbovec-memory');
  const globalMemoryRoot = path.join(app.getPath('userData'), 'turbovec-global-memory');
  const turboVecVenvDir = path.join(app.getPath('userData'), '.turbovec-venv');
  const bridgeScript = unpackedAppResourcePath('src', 'backend', 'turbovec_bridge.py');
  turboMemory = new TurboVecMemory(memoryRoot, bridgeScript, undefined, turboVecVenvDir, globalMemoryRoot);
  // P3 #10: Load persisted GraphRAG stats from disk on startup
  turboMemory.loadPersistedGraphRagStats().catch(() => {});
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle(
  'chat:stream',
  async (event, payload: ChatStreamRequest): Promise<ChatStreamResult> => {
    const config: LLMConfig = {
      ...payload.config,
      contextWindowTokens: Math.max(0, Number(payload.contextWindowTokens ?? 0)) || undefined
    };
    const legacySubAgentConfig: LLMConfig = {
      endpoint: String(payload.subAgentConfig?.endpoint ?? config.endpoint).trim() || config.endpoint,
      provider: payload.subAgentConfig?.provider ?? config.provider,
      model: String(payload.subAgentConfig?.model ?? config.model).trim() || config.model,
      apiKey: payload.subAgentConfig?.apiKey ?? config.apiKey,
      temperature: Number(payload.subAgentConfig?.temperature ?? config.temperature ?? 0.2),
      maxTokens: Number(payload.subAgentConfig?.maxTokens ?? 0) || undefined,
      contextWindowTokens:
        Math.max(0, Number(payload.subAgentConfig?.contextWindowTokens ?? 0)) || undefined,
      requestTimeoutMs:
        Number(payload.subAgentConfig?.requestTimeoutMs ?? 0) || config.requestTimeoutMs
    };
    const subAgentProfiles = normalizeRuntimeSubAgentProfiles(
      payload.subAgentConfigs,
      config,
      legacySubAgentConfig
    );
    const subAgentActiveCounts: Record<string, number> = {};
    const abortController = new AbortController();
    activeChatAbortController = abortController;
    const chatStartedAt = Date.now();
    const notifyCfg = notifyConfigFrom(payload);
    const requestedChatNamespace = String(payload.memoryNamespace ?? '').trim();
    const requestedGlobalNamespace = String(payload.memoryGlobalNamespace ?? '').trim();
    
    // Build list of namespaces to retrieve from (global + workspace)
    const chatNamespaces: string[] = [];
    if (requestedGlobalNamespace) {
      chatNamespaces.push(requestedGlobalNamespace);
    }
    const workspaceChatNamespace = requestedChatNamespace
      ? requestedChatNamespace
      : memoryNamespace('chat', selectedWorkspaceDir, config.model);
    if (workspaceChatNamespace && !chatNamespaces.includes(workspaceChatNamespace)) {
      chatNamespaces.push(workspaceChatNamespace);
    }
    
    const messages: ChatMessage[] = [];
    const systemPromptSections: string[] = [];
    const promptSpecVersion = normalizePromptSpecVersion(payload.promptSpecVersion);
    let recalledMemorySystemSection = '';
    let recalledPromptTokens = 0;

    try {
      if (turboMemory && chatNamespaces.length > 0) {
        // Use multi-namespace retrieval when both global and workspace namespaces are set
        const recalled = chatNamespaces.length > 1
          ? await turboMemory.retrieveMulti(config, payload.prompt, {
              namespaces: chatNamespaces,
              k: 6
            })
          : await turboMemory.retrieve(config, payload.prompt, {
              namespace: chatNamespaces[0],
              k: 6
            });

        if (recalled.length > 0) {
          // P3 #8: Use adaptive injection limits based on context window
          const injectionLimits = computeAdaptiveInjectionLimits(
            payload.contextWindowTokens || config.contextWindowTokens
          );
          const memoryLines = formatMemoryInjection(recalled, injectionLimits);
          recalledPromptTokens = estimateTokensFromText(memoryLines);
          const memorySection =
            'Relevant long-term memory from prior interactions is available below. Use it only when useful and ignore stale items.\n\n' +
            memoryLines;
          if (promptSpecVersion === 'v2') {
            recalledMemorySystemSection = memorySection;
          } else {
            systemPromptSections.push(memorySection);
          }
          event.sender.send('chat:event', `[memory] injected ${recalled.length} memory item(s).`);
        }
      }

      const priorMessages = Array.isArray(payload.historyMessages)
        ? payload.historyMessages
            .filter(message => Boolean(message) && typeof message === 'object')
            .map(message => ({
              role: message.role,
              content: String(message.content ?? ''),
              tool_call_id: message.tool_call_id,
              tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined
            }))
            .filter(message => (message.role === 'user' || message.role === 'assistant') && message.content.trim().length > 0)
        : [];

      const availableToolNames = toolDefinitions.map(def => def.function.name);
      const requestedToolNames = Array.isArray(payload.toolNames) && payload.toolNames.length > 0
        ? payload.toolNames
        : availableToolNames.filter(name => name !== 'delete_path' && name !== 'git_commit');

      if (promptSpecVersion === 'v2') {
        systemPromptSections.push(...formatChatV2CorePromptSections(requestedToolNames));
      } else {
        const toolGuidance = formatToolAvailabilityGuidance(requestedToolNames);
        if (toolGuidance) {
          systemPromptSections.push(toolGuidance);
        }
      }

      const environmentGuidance = formatEnvironmentGuidance(selectedWorkspaceDir);
      if (environmentGuidance) {
        systemPromptSections.push(environmentGuidance);
      }

      if (referenceWorkspaces.length > 0) {
        systemPromptSections.push(formatReferenceWorkspaceGuidance(referenceWorkspaces));
      }

      if (promptSpecVersion === 'v2' && recalledMemorySystemSection) {
        systemPromptSections.push(recalledMemorySystemSection);
      }

      if (systemPromptSections.length > 0) {
        messages.push({ role: 'system', content: systemPromptSections.join('\n\n') });
      }

      if (priorMessages.length > 0) {
        messages.push(...priorMessages);
      }

      messages.push({ role: 'user', content: payload.prompt });

      event.sender.send('chat:event', `[tools] enabled ${requestedToolNames.length} tool(s): ${requestedToolNames.join(', ')}`);

      // Build runtime context with memory access for this request
      const chatRuntimeContext = {
        ...runtimeContext(event.sender, 'chat:event', abortController.signal, promptSpecVersion),
        turboMemory: turboMemory ?? undefined,
        llmConfig: config,
        subAgentConfig: subAgentProfiles[0]?.config,
        subAgentProfiles,
        subAgentActiveCounts,
        activeNamespaces: chatNamespaces.length > 0 ? chatNamespaces : undefined,
        allowedToolNames: requestedToolNames,
        onAgentEvent: (message: string) => {
          event.sender.send('chat:event', message);
        },
        onQueryUser: async (request: import('./backend/toolRuntime').QueryUserRequest) => {
          // Send query to renderer and wait for user response
          event.sender.send('chat:query-user', request);
          // This is the case where the user is most likely away from the keyboard.
          dispatchNotification(notifyCfg, {
            kind: 'chat.input_needed',
            title: 'Model is waiting for your answer',
            detail: request.question,
            model: config.model,
            workspaceDir: selectedWorkspaceDir,
            durationMs: Date.now() - chatStartedAt
          });
          return new Promise<import('./backend/toolRuntime').QueryUserResponse>(resolve => {
            pendingQueryUserResolve = resolve;
          });
        }
      };

      event.sender.send('chat:event', `[prompt] using ${promptSpecVersion} prompt policy.`);

      const toolDefs = getAllowedToolDefinitions(requestedToolNames, chatRuntimeContext);

      const chatMaxRetries = 1;
      let attempt = 0;
      let retryErrorDetail = '';
      let result: Awaited<ReturnType<typeof chatWithTools>> | null = null;
      let initialMessagesForDebug: ChatMessage[] = [...messages];
      let streamedTokenCount = 0;

      while (attempt <= chatMaxRetries) {
        const attemptMessages: ChatMessage[] = [...messages];
        streamedTokenCount = 0;
        if (retryErrorDetail) {
          attemptMessages.push({
            role: 'user',
            content:
              `Internal retry note: previous attempt failed with: ${truncateText(retryErrorDetail, 1200)}\n` +
              'Continue the same user request. Fix the issue directly, keep output concise, and do not change scope.'
          });
          event.sender.send(
            'chat:event',
            `[retry] internal server error detected; asking model to try again (${attempt + 1}/${chatMaxRetries + 1}).`
          );
        }

        try {
          initialMessagesForDebug = attemptMessages;
          result = await chatWithTools(
            config,
            attemptMessages,
            toolDefs,
            async (name, args) => {
              if (!requestedToolNames.includes(name)) {
                throw new Error(`Tool ${name} is not enabled for chat.`);
              }
              return executeTool(name, args, chatRuntimeContext);
            },
            message => {
              event.sender.send('chat:event', message);
            },
            payload.maxToolTurns ?? 40,
            abortController.signal,
            token => {
              streamedTokenCount += 1;
              event.sender.send('chat:token', token);
            }
          );
          break;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (attempt < chatMaxRetries && isInternalServerRetryableError(detail)) {
            retryErrorDetail = detail;
            attempt += 1;
            continue;
          }
          throw error;
        }
      }

      if (!result) {
        throw new Error('Chat failed after retry attempts without returning a result.');
      }
      const text = result.text;

      const debugDumpEnabled = payload.chatDebugDumpsEnabled !== false;
      const debugDumpPath = debugDumpEnabled
        ? await writeChatContextDebugDump({
            workspaceDir: selectedWorkspaceDir,
            namespace: chatNamespaces.length > 0 ? chatNamespaces.join(',') : '',
            model: config.model,
            contextWindowTokens: payload.contextWindowTokens,
            recalledPromptTokens,
            historyMessageCount: Array.isArray(payload.historyMessages) ? payload.historyMessages.length : 0,
            initialMessages: initialMessagesForDebug,
            finalMessages: result.debug?.finalMessages,
            turns: result.debug?.turns,
            totalToolCalls: result.debug?.totalToolCalls,
            usage: result.usage
          })
        : null;

      if (debugDumpPath) {
        event.sender.send('chat:event', `[debug] wrote chat context dump: ${debugDumpPath}`);
      }

      if (turboMemory) {
        try {
          await turboMemory.store(
            config,
            [
              {
                text: payload.prompt.slice(0, 4000),
                source: 'chat:user',
                metadata: { workspaceDir: selectedWorkspaceDir }
              },
              {
                text: text.slice(0, 6000),
                source: 'chat:assistant',
                metadata: { workspaceDir: selectedWorkspaceDir }
              }
            ],
            {
              namespace: workspaceChatNamespace
            }
          );
          event.sender.send('chat:event', '[memory] stored latest conversation turn in TurboVec memory.');
        } catch (storeErr) {
          event.sender.send('chat:event', `[memory] store failed: ${storeErr instanceof Error ? storeErr.message : String(storeErr)}`);
        }
      }

      if (streamedTokenCount === 0) {
        const chunkSize = 16;
        for (let i = 0; i < text.length; i += chunkSize) {
          event.sender.send('chat:token', text.slice(i, i + chunkSize));
        }
      }

      const usageByModel = [{
        model: config.model,
        ...result.usage,
        recalledPromptTokens,
        contextWindowTokens: Math.max(0, Number(payload.contextWindowTokens ?? 0)) || undefined
      }];

      dispatchNotification(notifyCfg, {
        kind: 'chat.completed',
        title: 'Chat complete',
        excerpt: text,
        model: config.model,
        workspaceDir: selectedWorkspaceDir,
        durationMs: Date.now() - chatStartedAt,
        totalTokens: sumTotalTokens(usageByModel)
      });

      return {
        text,
        usageByModel
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // User-initiated stops are not failures; do not notify for them.
      if (!/canceled/i.test(detail) && !/stopped by user/i.test(detail)) {
        dispatchNotification(notifyCfg, {
          kind: 'chat.error',
          title: 'Chat failed',
          detail,
          model: config.model,
          workspaceDir: selectedWorkspaceDir,
          durationMs: Date.now() - chatStartedAt
        });
      }
      throw error;
    } finally {
      if (activeChatAbortController === abortController) {
        activeChatAbortController = null;
      }
    }
  }
);

ipcMain.handle('chat:stop', async () => {
  let stopped = false;

  if (activeChatAbortController) {
    activeChatAbortController.abort();
    activeChatAbortController = null;
    stopped = true;
  }

  if (pendingQueryUserResolve) {
    const resolve = pendingQueryUserResolve;
    pendingQueryUserResolve = null;
    resolve({ cancelled: true, answer: '[interrupted by user]' });
    stopped = true;
  }

  if (activeTerminalProcess) {
    activeTerminalProcess.kill('SIGINT');
    stopped = true;
  }

  if (!stopped) {
    return { stopped: false, reason: 'no_active_chat' };
  }

  return { stopped: true };
});

// Handle user response to query_user tool
ipcMain.handle('chat:query-user-response', async (_event, payload: import('./backend/toolRuntime').QueryUserResponse) => {
  if (pendingQueryUserResolve) {
    const resolve = pendingQueryUserResolve;
    pendingQueryUserResolve = null;
    resolve(payload);
  }
  return { accepted: true };
});

ipcMain.handle('chat:list-sessions', async () => {
  const sessions = await listChatSessions();
  return { sessions };
});

ipcMain.handle('chat:load-session', async (_event, payload: { id?: string }) => {
  const id = String(payload?.id ?? '').trim();
  if (!id) {
    throw new Error('Chat session id is required.');
  }
  return loadChatSession(id);
});

ipcMain.handle('chat:save-session', async (_event, payload: { session?: ChatSession }) => {
  if (!payload?.session) {
    throw new Error('Chat session payload is required.');
  }
  return saveChatSession(payload.session);
});

ipcMain.handle('chat:delete-session', async (_event, payload: { id?: string }) => {
  const id = String(payload?.id ?? '').trim();
  if (!id) {
    throw new Error('Chat session id is required.');
  }
  return deleteChatSession(id);
});

ipcMain.handle('chat:list-models', async (_event, payload: { endpoint: string; apiKey?: string }) => {
  const catalog = await listModelCatalog({
    endpoint: payload.endpoint,
    apiKey: payload.apiKey
  });
  return catalog;
});

ipcMain.handle('memory:diagnostics', async (_event, payload?: { model?: string }) => {
  if (!turboMemory) {
    return {
      ok: false,
      reason: 'memory_not_initialized'
    };
  }

  // Only filter workspace-scoped namespaces by workspace path when a specific model is requested.
  // When called without a model (e.g., Diagnostics tab), show ALL namespaces so the user can see everything.
  // Global namespaces are always shown regardless of filter.
  const model = String(payload?.model ?? '').trim();
  const filter = model ? `${selectedWorkspaceDir}:${model}` : undefined;
  return turboMemory.diagnostics(filter);
});

ipcMain.handle('memory:clear-namespace', async (_event, payload?: { namespace?: string }) => {
  if (!turboMemory) {
    return {
      ok: false,
      reason: 'memory_not_initialized'
    };
  }

  const namespace = String(payload?.namespace ?? '').trim();
  if (!namespace) {
    return {
      ok: false,
      reason: 'namespace_required'
    };
  }

  const result = await turboMemory.clearNamespace(namespace);
  return {
    ok: true,
    ...result
  };
});

ipcMain.handle('memory:export-namespace', async (_event, payload?: { namespace?: string }) => {
  const namespace = String(payload?.namespace ?? '').trim();
  if (!namespace) {
    return {
      ok: false,
      reason: 'namespace_required'
    };
  }

  const result = await exportMemoryNamespaceToDisk(namespace);
  if (!result) {
    return {
      ok: false,
      canceled: true
    };
  }

  return {
    ok: true,
    ...result
  };
});

ipcMain.handle('memory:import-namespace', async (_event, payload?: { targetNamespace?: string; overwrite?: boolean }) => {
  const result = await importMemoryNamespaceFromDisk(payload);
  if (!result) {
    return {
      ok: false,
      canceled: true
    };
  }

  return {
    ok: true,
    ...result
  };
});

ipcMain.handle('memory:set-locked-namespaces', async (_event, payload?: { namespaces?: string[] }) => {
  if (!turboMemory) {
    return {
      ok: false,
      reason: 'memory_not_initialized'
    };
  }

  const namespaces = Array.isArray(payload?.namespaces) ? payload.namespaces : [];
  turboMemory.setLockedNamespaces(namespaces);
  return {
    ok: true,
    lockedNamespaces: turboMemory.getLockedNamespaces()
  };
});

ipcMain.handle('memory:get-locked-namespaces', async () => {
  if (!turboMemory) {
    return {
      ok: false,
      reason: 'memory_not_initialized'
    };
  }

  return {
    ok: true,
    lockedNamespaces: turboMemory.getLockedNamespaces()
  };
});

ipcMain.handle('terminal:send-input', async (_event, payload: { text: string }) => {
  if (!activeTerminalProcess || !activeTerminalProcess.stdin || activeTerminalProcess.stdin.destroyed) {
    return { sent: false, reason: 'no_active_process' };
  }

  const text = String(payload.text ?? '');
  activeTerminalProcess.stdin.write(text);
  return { sent: true };
});

ipcMain.handle('terminal:run-command', async (event, payload: { command: string; cwd?: string }) => {
  const command = String(payload.command ?? '').trim();
  if (!command) {
    return { started: false, reason: 'empty_command' };
  }

  if (activeTerminalProcess) {
    return { started: false, reason: 'process_active' };
  }

  void runTerminalCommand(
    {
      command,
      cwd: payload.cwd,
      scope: 'workspace',
      timeoutMs: 0
    },
    runtimeContext(event.sender, 'chat:event')
  ).catch(error => {
    event.sender.send('terminal:output', {
      source: 'stderr',
      text: `${error instanceof Error ? error.message : String(error)}\n`
    });
  });

  return { started: true };
});

ipcMain.handle('terminal:interrupt', async () => {
  if (!activeTerminalProcess) {
    return { interrupted: false, reason: 'no_active_process' };
  }
  const interrupted = activeTerminalProcess.kill('SIGINT');
  return { interrupted };
});

ipcMain.handle('orch:stop', async () => {
  if (!activeOrchestrationAbortController) {
    return { stopped: false, reason: 'no_active_orchestration' };
  }

  activeOrchestrationAbortController.abort();
  activeOrchestrationAbortController = null;
  return { stopped: true };
});

ipcMain.handle('workspace:get-state', async () => workspaceState());

ipcMain.handle('workspace:select-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Workspace Directory',
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    clearAllFileWatches();
    selectedWorkspaceDir = result.filePaths[0];
    persistLastWorkspaceSelection();
  }

  return workspaceState();
});

ipcMain.handle('workspace:list-tree', async () => {
  return buildWorkspaceTree(selectedWorkspaceDir);
});

ipcMain.handle('workspace:read-file', async (_event, payload: { path: string }) => {
  const content = await readWorkspaceFile(selectedWorkspaceDir, payload.path);
  return { content };
});

ipcMain.handle('workspace:write-file', async (_event, payload: { path: string; content: string }) => {
  await writeWorkspaceFile(selectedWorkspaceDir, payload.path, payload.content);
  return { ok: true };
});

ipcMain.handle('workspace:watch-file', async (event, payload: { path: string }) => {
  const { absolute, relative } = resolveWatchedWorkspacePath(payload.path);
  const existing = fileWatchRefs.get(absolute);
  if (existing) {
    existing.count += 1;
    return { watching: true };
  }

  const listener = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      event.sender.send('workspace:file-changed', relative);
    }
  };

  fs.watchFile(absolute, { interval: 700 }, listener);
  fileWatchRefs.set(absolute, { count: 1, listener });
  return { watching: true };
});

ipcMain.handle('workspace:unwatch-file', async (_event, payload: { path: string }) => {
  const { absolute } = resolveWatchedWorkspacePath(payload.path);
  const existing = fileWatchRefs.get(absolute);
  if (!existing) {
    return { watching: false };
  }

  existing.count -= 1;
  if (existing.count <= 0) {
    fs.unwatchFile(absolute, existing.listener);
    fileWatchRefs.delete(absolute);
    return { watching: false };
  }

  return { watching: true };
});

ipcMain.handle('orch:load-plan', async () => {
  return loadPlan();
});

ipcMain.handle('orch:import-plan', async () => {
  return importPlanFromDisk();
});

ipcMain.handle('orch:export-plan', async (_event, plan: OrchestrationPlan) => {
  return exportPlanToDisk(plan);
});

ipcMain.handle('orch:save-plan', async (_event, plan: OrchestrationPlan) => {
  await savePlan(plan);
});

ipcMain.handle('orch:validate-plan', async (_event, raw: string) => {
  try {
    const parsed = JSON.parse(raw) as OrchestrationPlan;
    return validatePlan(normalizeAdvancedStageIds(parsed));
  } catch (error) {
    return [error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON'];
  }
});

ipcMain.handle('orch:list-plan-presets', async () => {
  const presets: Record<string, { name: string; description: string }> = {};
  for (const [key, plan] of Object.entries(planPresets) as [string, OrchestrationPlan][]) {
    presets[key] = { name: plan.name, description: plan.description };
  }
  return presets;
});

ipcMain.handle('orch:get-plan-preset', async (_event, key: string) => {
  const preset = planPresets[key];
  if (!preset) {
    throw new Error(`Unknown preset: ${key}`);
  }
  return preset;
});

ipcMain.handle(
  'orch:run',
  async (
    event,
    payload: OrchestrationRunRequest
  ): Promise<OrchestrationRunResult> => {
    const normalizedPlan = normalizeAdvancedStageIds(payload.plan ?? defaultPlan);
    const errors = validatePlan(normalizedPlan);
    if (errors.length > 0) {
      throw new Error(errors.join(' '));
    }

    const abortController = new AbortController();
    activeOrchestrationAbortController = abortController;
    const orchStartedAt = Date.now();
    const notifyCfg = notifyConfigFrom(payload);

    const requestedNamespace = String(payload.memoryNamespace ?? '').trim();
    const requestedGlobalNamespace = String(payload.memoryGlobalNamespace ?? '').trim();
    const fallbackStep = normalizedPlan?.steps?.[0];
    const fallbackConfig: LLMConfig = {
      endpoint: String(fallbackStep?.endpoint ?? '').trim(),
      provider: fallbackStep?.provider,
      model: String(fallbackStep?.model ?? '').trim(),
      apiKey: fallbackStep?.apiKey,
      temperature: Number(fallbackStep?.temperature ?? 0.2),
      maxTokens: Number(fallbackStep?.maxTokens ?? 0) || undefined,
      contextWindowTokens:
        Math.max(0, Number(fallbackStep?.contextWindowTokens ?? 0)) || undefined,
      requestTimeoutMs: Number(payload.requestTimeoutMs ?? 0) || undefined
    };
    const legacySubAgentConfig: LLMConfig = {
      endpoint: String(payload.subAgentConfig?.endpoint ?? fallbackStep?.endpoint ?? '').trim(),
      provider: payload.subAgentConfig?.provider ?? fallbackStep?.provider,
      model: String(payload.subAgentConfig?.model ?? fallbackStep?.model ?? '').trim(),
      apiKey: payload.subAgentConfig?.apiKey ?? fallbackStep?.apiKey,
      temperature: Number(payload.subAgentConfig?.temperature ?? fallbackStep?.temperature ?? 0.2),
      maxTokens: Number(payload.subAgentConfig?.maxTokens ?? 0) || undefined,
      contextWindowTokens:
        Math.max(0, Number(payload.subAgentConfig?.contextWindowTokens ?? 0)) || undefined,
      requestTimeoutMs:
        Number(payload.subAgentConfig?.requestTimeoutMs ?? 0) ||
        Number(payload.requestTimeoutMs ?? 0) ||
        undefined
    };
    const subAgentProfiles = normalizeRuntimeSubAgentProfiles(
      payload.subAgentConfigs,
      fallbackConfig,
      legacySubAgentConfig
    );
    const promptSpecVersion = normalizePromptSpecVersion(payload.promptSpecVersion);
    const subAgentActiveCounts: Record<string, number> = {};
    
    // Build list of namespaces to retrieve from (global + workspace)
    const orchestrationNamespaces: string[] = [];
    if (requestedGlobalNamespace) {
      orchestrationNamespaces.push(requestedGlobalNamespace);
    }
    const workspaceOrchestrationNamespace = requestedNamespace
      ? requestedNamespace
      : memoryNamespace('orchestration', selectedWorkspaceDir);
    if (workspaceOrchestrationNamespace && !orchestrationNamespaces.includes(workspaceOrchestrationNamespace)) {
      orchestrationNamespaces.push(workspaceOrchestrationNamespace);
    }

    // Build runtime context with memory access for orchestration
    const orchRuntimeContext = {
      ...runtimeContext(event.sender, 'orch:event', abortController.signal, promptSpecVersion),
      turboMemory: turboMemory ?? undefined,
      llmConfig: normalizedPlan?.steps?.[0]
        ? {
            endpoint: normalizedPlan.steps[0].endpoint,
            provider: normalizedPlan.steps[0].provider,
            model: normalizedPlan.steps[0].model,
            apiKey: normalizedPlan.steps[0].apiKey,
            temperature: normalizedPlan.steps[0].temperature ?? 0.2,
            maxTokens: normalizedPlan.steps[0].maxTokens,
            requestTimeoutMs: Number(payload.requestTimeoutMs ?? 0) || undefined
          }
        : undefined,
      subAgentConfig: subAgentProfiles[0]?.config,
      subAgentProfiles,
      subAgentActiveCounts,
      activeNamespaces: orchestrationNamespaces.length > 0 ? orchestrationNamespaces : undefined,
      promptSpecVersion
    };

    event.sender.send('orch:event', `[prompt] using ${promptSpecVersion} prompt policy.`);

    try {
      const run = await runOrchestration(normalizedPlan, payload.prompt, {
        requestTimeoutMs: Number(payload.requestTimeoutMs ?? 0) || undefined
      }, message => {
        event.sender.send('orch:event', message);
      }, orchRuntimeContext as any, {
        retrieve: async (config, query, stepName) => {
          if (!turboMemory || orchestrationNamespaces.length === 0) {
            return [];
          }
          const items = orchestrationNamespaces.length > 1
            ? await turboMemory.retrieveMulti(config, query, {
                namespaces: orchestrationNamespaces,
                k: 8
              })
            : await turboMemory.retrieve(config, query, {
                namespace: orchestrationNamespaces[0],
                k: 8
              });
          event.sender.send('orch:event', `[memory] ${stepName} retrieved ${items.length} memory item(s).`);
          return items;
        },
        store: async (config, text, stepName) => {
          if (!turboMemory) {
            return;
          }
          try {
            await turboMemory.store(
              config,
              [
                {
                  text: text.slice(0, 7000),
                  source: `orchestration:${stepName}`,
                  metadata: { workspaceDir: selectedWorkspaceDir }
                }
              ],
              {
                namespace: workspaceOrchestrationNamespace,
                replaceSources: [`orchestration:${stepName}`]
              }
            );
            event.sender.send('orch:event', `[memory] ${stepName} stored output in TurboVec memory.`);
          } catch (error) {
            event.sender.send('orch:event', `[memory] ${stepName} store skipped: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }, abortController.signal);

      dispatchNotification(notifyCfg, {
        kind: 'orchestration.completed',
        title: run?.completed
          ? `Orchestration complete: ${normalizedPlan?.name ?? 'plan'}`
          : `Orchestration stopped early: ${normalizedPlan?.name ?? 'plan'}`,
        excerpt: run?.output,
        workspaceDir: selectedWorkspaceDir,
        durationMs: Date.now() - orchStartedAt,
        detail: `${run?.steps?.length ?? 0} step(s) across ${run?.iterations ?? 0} iteration(s)`,
        totalTokens: sumTotalTokens(run?.usageByModel)
      });

      return run;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!/canceled/i.test(detail) && !/stopped by user/i.test(detail)) {
        dispatchNotification(notifyCfg, {
          kind: 'chat.error',
          title: `Orchestration failed: ${normalizedPlan?.name ?? 'plan'}`,
          detail,
          workspaceDir: selectedWorkspaceDir,
          durationMs: Date.now() - orchStartedAt
        });
      }
      throw error;
    } finally {
      if (activeOrchestrationAbortController === abortController) {
        activeOrchestrationAbortController = null;
      }
    }
  }
);

// Reference workspace management IPC handlers
ipcMain.handle('workspace:list-reference-workspaces', async () => {
  return { referenceWorkspaces };
});

ipcMain.handle('workspace:add-reference-workspace', async (_event, payload: { label?: string; path?: string; allowWrite?: boolean }) => {
  let targetPath = String(payload.path ?? '').trim();

  if (!targetPath) {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Reference Workspace Directory',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'canceled' };
    }
    targetPath = result.filePaths[0];
  }

  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return { ok: false, reason: 'not_a_directory' };
    }
  } catch {
    return { ok: false, reason: 'path_not_found' };
  }

  const label = String(payload.label ?? path.basename(targetPath)).trim();
  const id = 'ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const allowWrite = Boolean(payload.allowWrite);

  if (referenceWorkspaces.some(ref => ref.path === targetPath)) {
    return { ok: false, reason: 'duplicate_path' };
  }

  referenceWorkspaces.push({ id, label, path: targetPath, allowWrite });
  persistLastWorkspaceSelection();
  return { ok: true, id, label, path: targetPath, allowWrite };
});

ipcMain.handle('workspace:remove-reference-workspace', async (_event, payload: { id: string }) => {
  const id = String(payload.id ?? '').trim();
  const index = referenceWorkspaces.findIndex(ref => ref.id === id);
  if (index < 0) {
    return { ok: false, reason: 'not_found' };
  }
  referenceWorkspaces.splice(index, 1);
  persistLastWorkspaceSelection();
  return { ok: true };
});

ipcMain.handle('workspace:update-reference-workspace', async (_event, payload: { id: string; allowWrite?: boolean; label?: string }) => {
  const id = String(payload.id ?? '').trim();
  const ref = referenceWorkspaces.find(r => r.id === id);
  if (!ref) {
    return { ok: false, reason: 'not_found' };
  }
  if (typeof payload.allowWrite === 'boolean') {
    ref.allowWrite = payload.allowWrite;
  }
  if (typeof payload.label === 'string') {
    ref.label = payload.label.trim() || require('path').basename(ref.path);
  }
  persistLastWorkspaceSelection();
  return { ok: true, referenceWorkspace: ref };
});

// Outbound notification test (Settings dialog). Awaiting on purpose so the UI
// can surface the real failure reason; `dispatchNotification` is fire-and-forget.
ipcMain.handle('notify:test', async (_event, payload: NotifySettings) => {
  return sendTestNotification(notifyConfigFrom(payload) ?? {});
});
