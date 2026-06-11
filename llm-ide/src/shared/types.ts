export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

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
  apiKey?: string;
  temperature: number;
  maxTokens?: number;
}

export interface ChatStreamRequest {
  config: LLMConfig;
  prompt: string;
  toolNames?: string[];
  maxToolTurns?: number;
  memoryNamespace?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

export interface ModelUsage extends TokenUsage {
  model: string;
}

export interface ChatStreamResult {
  text: string;
  usageByModel?: ModelUsage[];
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
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools: ToolPermission[];
  passOutputToNext: boolean;
}

export interface OrchestrationPlan {
  version: 1;
  name: string;
  description: string;
  loopUntilComplete?: boolean;
  maxLoops?: number;
  completionMarker?: string;
  steps: OrchestrationStep[];
}

export interface OrchestrationRunStep {
  id: string;
  name: string;
  output: string;
  iteration: number;
  model: string;
  usage?: TokenUsage;
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
