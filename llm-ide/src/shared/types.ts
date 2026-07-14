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
  temperature: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  requestTimeoutMs?: number;
}

export interface ChatStreamRequest {
  config: LLMConfig;
  prompt: string;
  historyMessages?: ChatMessage[];
  toolNames?: string[];
  maxToolTurns?: number;
  memoryNamespace?: string;
  memoryGlobalNamespace?: string;
  contextWindowTokens?: number;
  chatDebugDumpsEnabled?: boolean;
}

export interface OrchestrationRunRequest {
  plan: OrchestrationPlan;
  prompt: string;
  memoryNamespace?: string;
  memoryGlobalNamespace?: string;
  requestTimeoutMs?: number;
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
  output: string;
  steps: OrchestrationRunStep[];
  iterations: number;
  completed: boolean;
  completionMarker?: string;
  usageByModel?: ModelUsage[];
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
}
