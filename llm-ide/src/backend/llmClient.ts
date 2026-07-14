import axios from 'axios';
import { ChatMessage, LLMConfig, TokenUsage, ToolDefinition } from '../shared/types';

interface CompletionResponse {
  choices?: Array<{
    message?: ChatMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

interface OllamaNativeToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

interface OllamaNativeChatResponse {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: OllamaNativeToolCall[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

interface ModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      context_length?: number;
    };
  }>;
}

export interface ModelCatalog {
  models: string[];
  contextWindows?: Record<string, number>;
}

export interface ChatWithToolsResult {
  text: string;
  usage: TokenUsage;
  toolBudgetExhausted?: boolean;
  continuationSummary?: string;
  debug?: {
    initialMessageCount: number;
    finalMessageCount: number;
    totalToolCalls: number;
    turns: Array<{
      turn: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      messageCountBefore: number;
      messageCountAfter: number;
      assistantToolCalls: number;
    }>;
    finalMessages: ChatMessage[];
  };
}

type ChatWithToolsDebug = NonNullable<ChatWithToolsResult['debug']>;
const MAX_TOOL_RESULT_MESSAGE_CHARS = 16000;

function clampToolResultForPrompt(raw: string): string {
  if (raw.length <= MAX_TOOL_RESULT_MESSAGE_CHARS) {
    return raw;
  }

  const headChars = Math.floor(MAX_TOOL_RESULT_MESSAGE_CHARS * 0.75);
  const tailChars = Math.max(0, MAX_TOOL_RESULT_MESSAGE_CHARS - headChars);
  const head = raw.slice(0, headChars);
  const tail = tailChars > 0 ? raw.slice(-tailChars) : '';

  return JSON.stringify({
    truncated: true,
    originalChars: raw.length,
    keptChars: head.length + tail.length,
    head,
    tail,
    note: 'Tool output was truncated to protect context window. Narrow the tool query for full fidelity.'
  });
}

function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function toPositiveInteger(value: unknown): number | undefined {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function resolveRequestTimeoutMs(value: unknown): number {
  const ms = Math.trunc(Number(value));
  if (!Number.isFinite(ms)) {
    return 180000;
  }
  return Math.max(1000, Math.min(600000, ms));
}

function parseUsage(usage: CompletionResponse['usage']): Omit<TokenUsage, 'requests'> {
  const promptTokens = toFiniteNumber(usage?.prompt_tokens) || toFiniteNumber(usage?.input_tokens);
  const completionTokens = toFiniteNumber(usage?.completion_tokens) || toFiniteNumber(usage?.output_tokens);
  const totalTokens = toFiniteNumber(usage?.total_tokens) || promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function parseOllamaUsage(response: OllamaNativeChatResponse): Omit<TokenUsage, 'requests'> {
  const promptTokens = toFiniteNumber(response.prompt_eval_count);
  const completionTokens = toFiniteNumber(response.eval_count);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}

function summarizeResponseData(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.slice(0, 800);
  }

  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return String(value).slice(0, 800);
  }
}

function formatAxiosFailure(error: unknown, context: { operation: string; endpoint: string; model?: string }): Error {
  if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
    return new Error(`${context.operation} canceled`);
  }

  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const responseSummary = summarizeResponseData(error.response?.data);
  const messageParts = [
    `${context.operation} failed`,
    `endpoint=${context.endpoint}`,
    context.model ? `model=${context.model}` : '',
    status ? `status=${status}${statusText ? ` ${statusText}` : ''}` : '',
    responseSummary ? `response=${responseSummary}` : '',
    !status && error.message ? `error=${error.message}` : ''
  ].filter(Boolean);

  return new Error(messageParts.join(' | '));
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === 'bigint') {
        return currentValue.toString();
      }

      if (currentValue instanceof Error) {
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack
        };
      }

      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) {
          return '[Circular]';
        }
        seen.add(currentValue);
      }

      return currentValue;
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function isProviderToolParseFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const responseSummary = summarizeResponseData(error.response?.data).toLowerCase();
  return responseSummary.includes('error parsing tool call') || responseSummary.includes('tool call');
}

function saferToolSetAfterParseFailure(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter(tool => tool.function.name !== 'write_file');
}

function buildProviderToolParseFailureFeedback(detail: string, retryAttempt: number, toolsStillEnabled: boolean): string {
  return [
    'The provider rejected the previous assistant response while parsing a tool call, so no tool was executed.',
    `Attempt ${retryAttempt}: ${detail}.`,
    'Review the last intended tool action and correct it before retrying.',
    'When calling a tool, emit only the tool call with pure JSON arguments and no prose, markdown, or extra text.',
    'Keep arguments compact and strictly valid for the tool schema.',
    toolsStillEnabled
      ? 'You may retry with a smaller or simpler tool call, choose a different tool, or answer in plain text if a tool is unnecessary.'
      : 'Tools are disabled for the rest of this turn, so answer in plain text only.'
  ].join(' ');
}

function toolParseFailureRetryMessage(): string {
  return (
    'The provider failed while parsing the previous tool call. Retry with smaller, simpler tool arguments. ' +
    'When calling a tool, emit only the tool call with pure JSON arguments and no explanatory prose, markdown, or extra text. ' +
    'Use only values allowed by the tool schema (for example, scope must be workspace or root when present). ' +
    'Do not use write_file for large files. For new files, call create_file with no content, then use insert_in_file in chunks under 3000 characters. ' +
    'For existing files, prefer replace_in_file with focused snippets. Keep each tool argument a valid compact JSON object.'
  );
}

function toolParseFailureDisableToolsMessage(): string {
  return (
    'The provider repeatedly failed while parsing tool calls. Do not call any tools in the next response. ' +
    'Answer in plain text only, using the prior conversation context and any already-returned tool results. ' +
    'If more validation or edits are needed, describe the next smallest action clearly instead of emitting a tool call.'
  );
}

function deriveModelsEndpoint(chatEndpoint: string): string {
  const normalized = chatEndpoint.trim();
  if (!normalized) {
    throw new Error('Endpoint is required.');
  }

  try {
    const url = new URL(normalized);
    if (url.pathname.endsWith('/chat/completions')) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
      return url.toString();
    }
    if (url.pathname.endsWith('/v1')) {
      url.pathname = `${url.pathname}/models`;
      return url.toString();
    }
    if (!url.pathname.endsWith('/models')) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
    }
    return url.toString();
  } catch {
    if (normalized.endsWith('/chat/completions')) {
      return normalized.replace(/\/chat\/completions$/, '/models');
    }
    if (normalized.endsWith('/v1')) {
      return `${normalized}/models`;
    }
    return `${normalized.replace(/\/$/, '')}/models`;
  }
}

function deriveOllamaTagsEndpoint(chatEndpoint: string): string {
  const normalized = chatEndpoint.trim();
  if (!normalized) {
    throw new Error('Endpoint is required.');
  }

  try {
    const url = new URL(normalized);
    url.pathname = '/api/tags';
    return url.toString();
  } catch {
    return `${normalized.replace(/\/(v1\/chat\/completions|api\/chat|v1\/models|models)$/, '').replace(/\/$/, '')}/api/tags`;
  }
}

function buildHeaders(config: LLMConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function normalizeModelId(value: unknown): string {
  return String(value ?? '').trim();
}

function inferContextWindowFromModelId(modelId: string): number | undefined {
  const normalized = normalizeModelId(modelId).toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/(?:ctx|context)[-_]?([0-9]{1,4})(k|m)\b|\b([0-9]{1,4})(k|m)\b/i);
  const amountText = match?.[1] ?? match?.[3];
  const unit = (match?.[2] ?? match?.[4] ?? '').toLowerCase();
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }

  if (unit === 'm') {
    return amount * 1024 * 1024;
  }
  if (unit === 'k') {
    return amount * 1024;
  }

  return undefined;
}

function extractOllamaContextWindows(response: OllamaTagsResponse): Record<string, number> {
  const contextWindows: Record<string, number> = {};

  for (const model of response.models ?? []) {
    const modelId = normalizeModelId(model.model || model.name);
    const contextLength = toPositiveInteger(model.details?.context_length) ?? inferContextWindowFromModelId(modelId);
    if (modelId && contextLength) {
      contextWindows[modelId] = contextLength;
    }
  }

  return contextWindows;
}

function isLikelyOllamaEndpoint(endpoint: string): boolean {
  const normalized = endpoint.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  try {
    const url = new URL(normalized);
    if (url.pathname.endsWith('/api/chat')) {
      return true;
    }
    if (url.pathname.endsWith('/v1/chat/completions') && ['localhost', '127.0.0.1'].includes(url.hostname)) {
      return true;
    }
    if (url.port === '11434' && /\/(v1\/chat\/completions|api\/chat)$/.test(url.pathname)) {
      return true;
    }
  } catch {
    // Fall through to string heuristics.
  }

  return normalized.includes(':11434/v1/chat/completions') || normalized.includes(':11434/api/chat');
}

function shouldUseOllamaNativeChat(config: LLMConfig): boolean {
  return config.provider === 'ollama' || isLikelyOllamaEndpoint(config.endpoint);
}

function deriveOllamaNativeChatEndpoint(chatEndpoint: string): string {
  const normalized = chatEndpoint.trim();
  if (!normalized) {
    throw new Error('Endpoint is required.');
  }

  try {
    const url = new URL(normalized);
    if (url.pathname.endsWith('/v1/chat/completions')) {
      url.pathname = url.pathname.replace(/\/v1\/chat\/completions$/, '/api/chat');
      return url.toString();
    }
    if (url.pathname.endsWith('/api/chat')) {
      return url.toString();
    }
    url.pathname = '/api/chat';
    return url.toString();
  } catch {
    if (normalized.endsWith('/v1/chat/completions')) {
      return normalized.replace(/\/v1\/chat\/completions$/, '/api/chat');
    }
    if (normalized.endsWith('/api/chat')) {
      return normalized;
    }
    return `${normalized.replace(/\/$/, '')}/api/chat`;
  }
}

function tryParseToolArguments(value: string): unknown {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return value;
  }
}

/**
 * Purpose: Normalize model-provided thought/intent text into a compact single-line status message for the chat pane.
 * Inputs: Raw free-form text from provider fields such as assistant content or thinking traces.
 * Outputs: Trimmed, whitespace-normalized string capped to keep event rows readable.
 * Side Effects: None.
 * Errors: Never throws; always returns a string.
 * Performance: O(n) in input length.
 * Security/Privacy: Does not alter trust boundaries; purely presentational.
 * Concurrency: Pure function, safe for concurrent calls.
 * Rationale: Keeps event rows legible while preserving user-visible model intent context.
 */
function summarizeThoughtText(value: unknown, maxChars = 500): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildToolNameByCallId(messages: ChatMessage[]): Map<string, string> {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.id && call.function?.name) {
        toolNames.set(call.id, call.function.name);
      }
    }
  }
  return toolNames;
}

function toOllamaMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const toolNames = buildToolNameByCallId(messages);
  return messages.map(message => {
    if (message.role === 'assistant') {
      const nativeMessage: Record<string, unknown> = {
        role: 'assistant',
        content: message.content ?? ''
      };
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        nativeMessage.tool_calls = message.tool_calls.map(call => ({
          id: call.id,
          function: {
            name: call.function.name,
            arguments: tryParseToolArguments(call.function.arguments)
          }
        }));
      }
      return nativeMessage;
    }

    if (message.role === 'tool') {
      const nativeMessage: Record<string, unknown> = {
        role: 'tool',
        content: message.content ?? ''
      };
      if (message.tool_call_id) {
        nativeMessage.tool_call_id = message.tool_call_id;
        const toolName = toolNames.get(message.tool_call_id);
        if (toolName) {
          nativeMessage.tool_name = toolName;
        }
      }
      return nativeMessage;
    }

    return {
      role: message.role,
      content: message.content ?? ''
    };
  });
}

function ollamaResponseToAssistant(response: OllamaNativeChatResponse): ChatMessage | undefined {
  const message = response.message;
  if (!message) {
    return undefined;
  }

  const toolCalls = (message.tool_calls ?? [])
    .filter(call => Boolean(call.function?.name))
    .map((call, index) => ({
      id: call.id || `ollama-tool-${index + 1}`,
      type: 'function' as const,
      function: {
        name: String(call.function?.name ?? ''),
        arguments:
          typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {})
      }
    }));

  return {
    role: 'assistant',
    content: message.content ?? '',
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
  };
}

function payloadBase(config: LLMConfig, messages: ChatMessage[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature
  };
  if ((config.maxTokens ?? 0) > 0) {
    payload.max_tokens = config.maxTokens;
  }
  return payload;
}

function buildOllamaNativePayload(config: LLMConfig, messages: ChatMessage[], tools: ToolDefinition[]): Record<string, unknown> {
  const options: Record<string, unknown> = {
    temperature: config.temperature
  };
  if ((config.maxTokens ?? 0) > 0) {
    options.num_predict = config.maxTokens;
  }
  const numCtx = toPositiveInteger(config.contextWindowTokens);
  if (numCtx) {
    options.num_ctx = numCtx;
  }

  const payload: Record<string, unknown> = {
    model: config.model,
    messages: toOllamaMessages(messages),
    stream: false,
    think: false,
    options
  };
  if (tools.length > 0) {
    payload.tools = tools;
  }
  return payload;
}

export async function streamChat(
  config: LLMConfig,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<string> {
  let response;
  try {
    response = await axios.post(
      config.endpoint,
      {
        ...payloadBase(config, messages),
        stream: true
      },
      {
        headers: { ...buildHeaders(config), Accept: 'text/event-stream' },
        responseType: 'stream',
        signal
      }
    );
  } catch (error) {
    throw formatAxiosFailure(error, {
      operation: 'Streaming chat request',
      endpoint: config.endpoint,
      model: config.model
    });
  }

  return await new Promise<string>((resolve, reject) => {
    let total = '';
    let pending = '';

    response.data.on('data', (buffer: Buffer) => {
      pending += buffer.toString('utf8');
      const parts = pending.split('\n\n');
      pending = parts.pop() ?? '';

      for (const part of parts) {
        const lines = part
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.startsWith('data:'));

        for (const line of lines) {
          const data = line.replace(/^data:\s*/, '');
          if (!data || data === '[DONE]') {
            continue;
          }
          try {
            const chunk = JSON.parse(data) as StreamChunk;
            const token = chunk.choices?.[0]?.delta?.content ?? '';
            if (token) {
              total += token;
              onToken(token);
            }
          } catch {
            // Ignore partial/non-json chunks.
          }
        }
      }
    });

    response.data.on('end', () => resolve(total));
    response.data.on('error', (err: Error) => reject(err));
  });
}

export async function listModelCatalog(config: Pick<LLMConfig, 'endpoint' | 'apiKey' | 'provider'>): Promise<ModelCatalog> {
  const endpoint = deriveModelsEndpoint(config.endpoint);
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  let response;
  try {
    response = await axios.get<ModelsResponse>(endpoint, { headers });
  } catch (error) {
    throw formatAxiosFailure(error, { operation: 'Model listing request', endpoint });
  }
  const models = (response.data?.data ?? [])
    .map(item => item.id)
    .filter((value): value is string => Boolean(value));

  let contextWindows: Record<string, number> | undefined;
  if (shouldUseOllamaNativeChat({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    provider: config.provider,
    model: '',
    temperature: 0
  })) {
    try {
      const tagsEndpoint = deriveOllamaTagsEndpoint(config.endpoint);
      const tagsResponse = await axios.get<OllamaTagsResponse>(tagsEndpoint, { headers });
      const extracted = extractOllamaContextWindows(tagsResponse.data);
      if (Object.keys(extracted).length > 0) {
        contextWindows = extracted;
      }
    } catch {
      // Best-effort only; model listing should still work when /api/tags is unavailable.
    }
  }

  return {
    models: models.sort((a, b) => a.localeCompare(b)),
    contextWindows
  };
}

export async function listModels(config: Pick<LLMConfig, 'endpoint' | 'apiKey' | 'provider'>): Promise<string[]> {
  const catalog = await listModelCatalog(config);
  return catalog.models;
}

export async function chatWithTools(
  config: LLMConfig,
  initialMessages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: (name: string, args: unknown) => Promise<unknown>,
  onEvent?: (message: string) => void,
  maxToolTurns = 40,
  signal?: AbortSignal
): Promise<ChatWithToolsResult> {
  const messages = [...initialMessages];
  const maxTurns = Math.max(1, Math.min(200, Math.floor(maxToolTurns || 40)));
  let activeTools = tools;
  const isToolAllowed = (name: string): boolean => activeTools.some(tool => tool.function.name === name);
  let providerToolParseFailures = 0;
  const useOllamaNativeChat = shouldUseOllamaNativeChat(config);
  const ollamaNativeEndpoint = useOllamaNativeChat ? deriveOllamaNativeChatEndpoint(config.endpoint) : undefined;
  const requestTimeoutMs = resolveRequestTimeoutMs(config.requestTimeoutMs);
  const usageTotals: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0
  };
  const debugTurns: ChatWithToolsDebug['turns'] = [];
  let totalToolCalls = 0;

  function snapshotMessages(items: ChatMessage[]): ChatMessage[] {
    return items.map(message => ({
      role: message.role,
      content: String(message.content ?? ''),
      tool_call_id: message.tool_call_id,
      tool_calls: Array.isArray(message.tool_calls)
        ? message.tool_calls.map(call => ({
            id: String(call.id ?? ''),
            type: 'function',
            function: {
              name: String(call.function?.name ?? ''),
              arguments: String(call.function?.arguments ?? '')
            }
          }))
        : undefined
    }));
  }

  function buildDebug(): NonNullable<ChatWithToolsResult['debug']> {
    return {
      initialMessageCount: initialMessages.length,
      finalMessageCount: messages.length,
      totalToolCalls,
      turns: [...debugTurns],
      finalMessages: snapshotMessages(messages)
    };
  }

  if (useOllamaNativeChat && ollamaNativeEndpoint && toPositiveInteger(config.contextWindowTokens)) {
    onEvent?.(`provider:ollama | using native /api/chat with options.num_ctx=${toPositiveInteger(config.contextWindowTokens)}`);
  }

  async function requestAssistantWithoutTools(prompt: string): Promise<string | null> {
    const summaryMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'system',
        content: prompt
      }
    ];

    if (useOllamaNativeChat && ollamaNativeEndpoint) {
      const payload = buildOllamaNativePayload(config, summaryMessages, []);
      const response = await axios.post<OllamaNativeChatResponse>(ollamaNativeEndpoint, payload, {
        headers: buildHeaders(config),
        timeout: requestTimeoutMs,
        signal
      });
      return String(ollamaResponseToAssistant(response.data)?.content ?? '').trim() || null;
    }

    const payload: Record<string, unknown> = {
      ...payloadBase(config, summaryMessages),
      stream: false
    };
    const response = await axios.post<CompletionResponse>(config.endpoint, payload, {
      headers: buildHeaders(config),
      timeout: requestTimeoutMs,
      signal
    });
    return String(response.data.choices?.[0]?.message?.content ?? '').trim() || null;
  }

  function handleProviderToolParseFailure(error: unknown, context: { operation: string; endpoint: string; model?: string }): boolean {
    if (!isProviderToolParseFailure(error) || activeTools.length === 0) {
      return false;
    }

    providerToolParseFailures += 1;
    const detail = formatAxiosFailure(error, context).message;

    if (providerToolParseFailures === 1) {
      activeTools = saferToolSetAfterParseFailure(activeTools);
      messages.push({
        role: 'system',
        content: `${toolParseFailureRetryMessage()} ${buildProviderToolParseFailureFeedback(detail, providerToolParseFailures, activeTools.length > 0)}`
      });
      onEvent?.('provider tool-call parser failed; retrying with stricter JSON-only tool-call instructions and a safer tool subset.');
      return true;
    }

    if (providerToolParseFailures < maxTurns) {
      messages.push({
        role: 'system',
        content: buildProviderToolParseFailureFeedback(detail, providerToolParseFailures, activeTools.length > 0)
      });
      onEvent?.('provider tool-call parser failed again; returning the failure to the model so it can correct the next action.');
      return true;
    }

    return false;
  }

  function intentSummary(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case 'browser_fetch':
        return `fetch webpage ${String(args.url ?? '')}`;
      case 'web_search':
        return `search web for ${String(args.query ?? '')}`;
      case 'list_repo_tree':
        return 'list full repository tree';
      case 'list_dir':
        return `list directory ${String(args.path ?? '.')}`;
      case 'file_search':
        return `search files for ${String(args.query ?? '')}`;
      case 'read_file':
        return `read ${String(args.path ?? '')}`;
      case 'create_file':
        return `create ${String(args.path ?? '')}`;
      case 'write_file':
        return `write ${String(args.path ?? '')}`;
      case 'replace_in_file':
        return `replace text in ${String(args.path ?? '')}`;
      case 'insert_in_file':
        return `insert text in ${String(args.path ?? '')}`;
      case 'create_directory':
        return `create directory ${String(args.path ?? '')}`;
      case 'move_path':
        return `move ${String(args.from ?? '')} -> ${String(args.to ?? '')}`;
      case 'delete_path':
        return `delete ${String(args.path ?? '')}`;
      case 'grep_search':
        return `grep search for ${String(args.query ?? '')}`;
      case 'git_status':
        return 'read git status';
      case 'git_diff':
        return args.path ? `read git diff for ${String(args.path)}` : 'read git diff';
      case 'git_add':
        return args.all ? 'stage all changes' : `stage ${String(args.path ?? '')}`;
      case 'git_commit':
        return `commit with message ${String(args.message ?? '')}`;
      case 'run_terminal_command':
        return `run command ${String(args.command ?? '')}`;
      case 'complete_orchestration_task':
        return args.summary ? `signal completion: ${String(args.summary).slice(0, 120)}` : 'signal task completion';
      case 'query_user':
        return `ask user: ${String(args.question ?? '').slice(0, 80)}`;
      default:
        return 'execute requested operation';
    }
  }

  for (let i = 0; i < maxTurns; i += 1) {
    onEvent?.(`llm-turn:${i + 1}/${maxTurns}`);
    const messageCountBefore = messages.length;
    let assistant: ChatMessage | undefined;
    let assistantThinking = '';
    let usage: Omit<TokenUsage, 'requests'>;

    if (useOllamaNativeChat && ollamaNativeEndpoint) {
      const payload = buildOllamaNativePayload(config, messages, activeTools);
      let response;
      try {
        response = await axios.post<OllamaNativeChatResponse>(ollamaNativeEndpoint, payload, {
          headers: buildHeaders(config),
          timeout: requestTimeoutMs,
          signal
        });
      } catch (error) {
        if (handleProviderToolParseFailure(error, {
          operation: 'Ollama native chat request',
          endpoint: ollamaNativeEndpoint,
          model: config.model
        })) {
          continue;
        }
        throw formatAxiosFailure(error, {
          operation: 'Ollama native chat request',
          endpoint: ollamaNativeEndpoint,
          model: config.model
        });
      }

      assistant = ollamaResponseToAssistant(response.data);
      assistantThinking = summarizeThoughtText(response.data.message?.thinking);
      usage = parseOllamaUsage(response.data);
    } else {
      const payload: Record<string, unknown> = {
        ...payloadBase(config, messages),
        stream: false
      };
      if (activeTools.length > 0) {
        payload.tools = activeTools;
        payload.tool_choice = 'auto';
        payload.parallel_tool_calls = false;
      }

      let response;
      try {
        response = await axios.post<CompletionResponse>(config.endpoint, payload, {
          headers: buildHeaders(config),
          timeout: requestTimeoutMs,
          signal
        });
      } catch (error) {
        if (handleProviderToolParseFailure(error, {
          operation: 'Chat completion request',
          endpoint: config.endpoint,
          model: config.model
        })) {
          continue;
        }
        throw formatAxiosFailure(error, {
          operation: 'Chat completion request',
          endpoint: config.endpoint,
          model: config.model
        });
      }

      assistant = response.data.choices?.[0]?.message;
      usage = parseUsage(response.data.usage);
    }

    usageTotals.promptTokens += usage.promptTokens;
    usageTotals.completionTokens += usage.completionTokens;
    usageTotals.totalTokens += usage.totalTokens;
    usageTotals.requests += 1;
    if (!assistant) {
      return {
        text: '',
        usage: usageTotals,
        debug: buildDebug()
      };
    }

    const assistantThought = summarizeThoughtText(assistant.content);
    if ((assistant.tool_calls?.length ?? 0) > 0) {
      const combinedThought = [assistantThinking, assistantThought].filter(Boolean).join(' | ');
      if (combinedThought) {
        onEvent?.(`thought:${combinedThought}`);
      }
    }

    messages.push(assistant);
    const assistantToolCalls = assistant.tool_calls?.length ?? 0;
    totalToolCalls += assistantToolCalls;

    if (!assistant.tool_calls || assistant.tool_calls.length === 0) {
      debugTurns.push({
        turn: i + 1,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        messageCountBefore,
        messageCountAfter: messages.length,
        assistantToolCalls: 0
      });
      return {
        text: assistant.content ?? '',
        usage: usageTotals,
        debug: buildDebug()
      };
    }

    for (const call of assistant.tool_calls) {
      const toolName = call.function.name;
      if (!isToolAllowed(toolName)) {
        onEvent?.(`tool-blocked:${toolName}`);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: clampToolResultForPrompt(safeJsonStringify({
            ok: false,
            error: `Tool ${toolName} is not allowed for this step.`
          }))
        });
        continue;
      }
      let parsedArgs: unknown = {};
      try {
        parsedArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      const summarizedArgs = (parsedArgs && typeof parsedArgs === 'object')
        ? (parsedArgs as Record<string, unknown>)
        : {};
      onEvent?.(`thought:intent: ${intentSummary(toolName, summarizedArgs)}`);
      onEvent?.(`tool:${toolName}`);
      let result: unknown;
      try {
        result = await executeTool(toolName, parsedArgs);
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: clampToolResultForPrompt(safeJsonStringify(result))
      });
    }

    debugTurns.push({
      turn: i + 1,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      messageCountBefore,
      messageCountAfter: messages.length,
      assistantToolCalls
    });
  }

  const exhaustedMessage = `Tool-call budget reached (${maxTurns}) for this response.`;
  onEvent?.(`tool-budget-exhausted:${maxTurns}`);

  try {
    const summary = await requestAssistantWithoutTools(
      'You have reached the tool-call budget and cannot call any more tools in this response. ' +
      'Do not request or invoke tools. Summarize: (1) what you accomplished so far, (2) what remains, and (3) the best next action for the user.'
    );
    if (summary) {
      return {
        text: `${exhaustedMessage}\n\n${summary}`,
        usage: usageTotals,
        toolBudgetExhausted: true,
        continuationSummary: summary,
        debug: buildDebug()
      };
    }
  } catch (error) {
    onEvent?.(`tool-budget-summary-failed:${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    text: `${exhaustedMessage}\n\nSummary unavailable. Please continue from this state or raise the per-step tool-call budget.`,
    usage: usageTotals,
    toolBudgetExhausted: true,
    debug: buildDebug()
  };
}
