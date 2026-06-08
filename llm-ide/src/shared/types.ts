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
  steps: OrchestrationStep[];
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
