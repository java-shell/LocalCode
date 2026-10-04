export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface QueryUserResponse {
  answer?: string;
  selectedOptions?: string[];
  cancelled?: boolean;
}

export interface QueryUserRequest {
  question: string;
  responseType: 'text' | 'yesno' | 'checkbox';
  options?: string[];
  allowMultiple?: boolean;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface LLMConfig {
  endpoint: string;
  model: string;
  provider?: 'openai-compatible' | 'ollama';
  apiKey?: string;
  ollamaThink?: boolean;
  ollamaStreaming?: boolean;
  temperature: number;
  maxTokens?: number;
  openaiParameters?: Record<string, unknown>;
  ollamaOptions?: Record<string, unknown>;
  ollamaParameters?: Record<string, unknown>;
  contextWindowTokens?: number;
  requestTimeoutMs?: number;
}

export type MCPServerTransport = 'stdio' | 'http' | 'sse';
export type MCPServerTarget = 'chat' | 'orchestration';

export interface MCPServerConfig {
  id: string;
  label: string;
  transport: MCPServerTransport;
  enabledForChat: boolean;
  enabledForOrchestration: boolean;
  command?: string;
  args?: string[];
  endpoint?: string;
  env?: Record<string, string>;
}

export type MCPServerLifecycleState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MCPServerRuntimeStatus {
  serverId: string;
  label: string;
  transport: MCPServerTransport;
  lifecycle: MCPServerLifecycleState;
  healthy: boolean;
  discoveredToolCount: number;
  discoveredToolNames: string[];
  lastError?: string;
  updatedAt: string;
}

export type PromptSpecVersion = 'v1' | 'v2';

export interface SubAgentConfigProfile extends LLMConfig {
  id: string;
  label?: string;
  maxConcurrentSpawns?: number;
  /** @deprecated Use maxConcurrentSpawns. Kept for backward compatibility with saved settings. */
  maxSpawnsPerRun?: number;
}

/**
 * Outbound notification settings (ntfy only). Mirrors `NotifyConfig` in
 * `src/backend/notify.ts`; kept here so it can travel over IPC.
 */
export interface NotifySettings {
  notifyEnabled?: boolean;
  notifyNtfyTopic?: string;
  notifyNtfyServer?: string;
  notifyEvents?: string[];
  notifyIncludeExcerpt?: boolean;
  notifyPriority?: number;
  notifyRateLimitSeconds?: number;
  notifyTimeoutMs?: number;
}

export type NotifyEventKind =
  | 'chat.completed'
  | 'chat.input_needed'
  | 'chat.error'
  | 'orchestration.completed';

export interface NotifyTestResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  status?: number;
}


export interface ChatStreamRequest {
  config: LLMConfig;
  subAgentConfig?: LLMConfig;
  subAgentConfigs?: SubAgentConfigProfile[];
  mcpServers?: MCPServerConfig[];
  sessionId?: string;
  turnId?: string;
  prompt: string;
  historyMessages?: ChatMessage[];
  toolNames?: string[];
  maxToolTurns?: number;
  memoryNamespace?: string;
  memoryGlobalNamespace?: string;
  contextWindowTokens?: number;
  chatDebugDumpsEnabled?: boolean;
  promptSpecVersion?: PromptSpecVersion;
  notify?: NotifySettings;
}

export interface OrchestrationRunRequest {
  plan: OrchestrationPlan;
  subAgentConfig?: LLMConfig;
  subAgentConfigs?: SubAgentConfigProfile[];
  mcpServers?: MCPServerConfig[];
  prompt: string;
  memoryNamespace?: string;
  memoryGlobalNamespace?: string;
  requestTimeoutMs?: number;
  promptSpecVersion?: PromptSpecVersion;
  notify?: NotifySettings;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

export interface ModelUsage extends TokenUsage {
  model: string;
  recalledPromptTokens?: number;
  contextWindowTokens?: number;
}

export interface ChatStreamResult {
  text: string;
  usageByModel?: ModelUsage[];
}

export interface ChatSessionConfig {
  provider: 'openai-compatible' | 'ollama';
  endpoint: string;
  model: string;
  ollamaThink?: boolean;
  ollamaStreaming?: boolean;
  contextWindowTokens?: number;
  memoryNamespace?: string;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  workspaceDir: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
  config: ChatSessionConfig;
}

export interface ChatSession extends ChatSessionSummary {
  messages: ChatMessage[];
}

export type ChatTurnCheckpointState =
  | 'queued'
  | 'streaming'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'completed'
  | 'interrupted';

export type ChatTurnCheckpointResolution = 'dismissed' | 'retried' | 'regenerated' | 'completed';

export interface ChatTurnCheckpoint {
  sessionId: string;
  turnId: string;
  workspaceDir: string;
  prompt: string;
  model: string;
  state: ChatTurnCheckpointState;
  partialAssistantText?: string;
  lastToolName?: string;
  lastError?: string;
  updatedAt: string;
  interrupted: boolean;
  resolved: boolean;
  resolvedAt?: string;
  resolution?: ChatTurnCheckpointResolution;
}

export interface ToolPermission {
  name: string;
  enabled: boolean;
}

export interface OrchestrationStep {
  id: string;
  name: string;
  provider: 'openai-compatible' | 'ollama';
  endpoint: string;
  model: string;
  contextWindowTokens?: number;
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolTurns?: number;
  maxRetries?: number;
  tools: ToolPermission[];
  passOutputToNext: boolean;
  allowCompletionTool?: boolean;
}

export interface AgenticLink {
  id: string;
  fromStageId: string;
  toStageId: string;
  condition: 'always' | 'success' | 'error' | `error:${string}`;
  matchPattern?: string;
}

export interface AgenticStage extends OrchestrationStep {
  positionX?: number;
  positionY?: number;
}

export interface AdvancedOrchestrationConfig {
  enabled: boolean;
  entryStageId?: string;
  maxStageExecutions?: number;
  stages: AgenticStage[];
  links: AgenticLink[];
}

export interface OrchestrationPlan {
  version: 1;
  name: string;
  description: string;
  loopUntilComplete?: boolean;
  maxLoops?: number;
  completionMarker?: string;
  /**
   * Issue #7: when true, every successful step's raw output is stored to the
   * memory adapter. Default (false/omitted) stores only the terminal output,
   * avoiding intermediate-output noise and bloat across multi-stage runs.
   */
  storeIntermediateOutputs?: boolean;
  steps: OrchestrationStep[];
  advanced?: AdvancedOrchestrationConfig;
}

export interface OrchestrationToolCallRecord {
  name: string;
  intent: string;
  timestamp: string;
}

export interface OrchestrationRunStep {
  id: string;
  name: string;
  output: string;
  iteration: number;
  model: string;
  recalledPromptTokens?: number;
  contextWindowTokens?: number;
  durationMs?: number;
  attempts?: number;
  success?: boolean;
  error?: string;
  toolBudgetExhausted?: boolean;
  continuationSummary?: string;
  usage?: TokenUsage;
  toolCalls?: OrchestrationToolCallRecord[];
}

export interface OrchestrationRunResult {
  runId?: string;
  output: string;
  steps: OrchestrationRunStep[];
  iterations: number;
  completed: boolean;
  completionMarker?: string;
  usageByModel?: ModelUsage[];
}

export type DurableRunStatus =
  | 'pending'
  | 'running'
  | 'waiting_input'
  | 'waiting_tool'
  | 'completed'
  | 'failed'
  | 'canceled';

export type DurableRunKind = 'chat' | 'orchestration';

export type DurableRunRecoveryAction = 'resume' | 'restart' | 'abort' | 'dismiss';

export interface DurableRun {
  runId: string;
  kind: DurableRunKind;
  status: DurableRunStatus;
  workspaceDir: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  sessionId?: string;
  stageId?: string;
  model?: string;
  promptExcerpt?: string;
  promptSnapshot?: string;
  replayPolicyVersion: number;
  checkpointRef?: string;
  error?: string;
  recoveryAction?: DurableRunRecoveryAction;
  recoveredAt?: string;
}

export interface OrchestrationImportResult {
  plan: OrchestrationPlan;
  filePath: string;
}

export interface OrchestrationExportResult {
  filePath: string;
}

export interface MemoryNamespaceExportResult {
  ok: boolean;
  canceled?: boolean;
  reason?: string;
  filePath?: string;
  namespace?: string;
  recordCount?: number;
}

export interface MemoryNamespaceImportResult {
  ok: boolean;
  canceled?: boolean;
  reason?: string;
  filePath?: string;
  namespace?: string;
  replaced?: boolean;
  recordCount?: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface WorkspaceTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceState {
  workspaceDir: string;
  rootDir: string;
  referenceWorkspaces?: ReferenceWorkspace[];
  promptSpecVersion?: PromptSpecVersion;
}

export interface UiContinuityState {
  activeTab?: 'chat' | 'orchestration' | 'orchestration-advanced' | 'diagnostics';
  lastVisitedPanel?: string;
  activeChatSessionId?: string;
}


export interface ReferenceWorkspace {
  /** Unique identifier for this reference workspace */
  id: string;
  /** Display label shown in the UI */
  label: string;
  /** Absolute path to the reference folder */
  path: string;
  /** When true, the model may write to this workspace without prompting. Default: false (read-only). */
  allowWrite: boolean;
}

