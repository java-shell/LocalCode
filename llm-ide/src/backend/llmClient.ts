import axios from 'axios';
import { ChatMessage, LLMConfig, TokenUsage, ToolDefinition } from '../shared/types';

interface CompletionResponse {
  choices?: Array<{
    message?: ChatMessage & {
      reasoning?: string;
      reasoning_content?: string;
    };
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
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: CompletionResponse['usage'];
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

interface OllamaNativeStreamChunk extends OllamaNativeChatResponse {
  done?: boolean;
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
const MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS = 3;

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
  return Math.max(1000, Math.min(3600000, ms));
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
    return safeJsonStringify(value).slice(0, 800);
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

function isStreamTransportFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const code = String(error.code ?? '').toUpperCase();
  const message = String(error.message ?? '').toLowerCase();
  return (
    code === 'ECONNRESET'
    || code === 'ECONNABORTED'
    || message.includes('socket hang up')
    || message.includes('stream') && message.includes('aborted')
  );
}

function shouldFallbackOpenAIStreamingFailure(error: unknown): boolean {
  if (isStreamTransportFailure(error)) {
    return true;
  }

  if (!axios.isAxiosError(error) || error.code === 'ERR_CANCELED') {
    return false;
  }

  const status = Math.trunc(Number(error.response?.status ?? 0));
  return status >= 400 && status < 600;
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

/**
 * Convert a JSON property name into a readable Markdown heading.
 * Inputs: camelCase, snake_case, kebab-case, or plain property names.
 * Outputs: title-cased display text; has no side effects.
 */
function formatSummaryLabel(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.replace(/\b\w/g, character => character.toUpperCase());
}

/**
 * Render a parsed JSON value as concise Markdown for the chat results pane.
 * Inputs: JSON-compatible data returned by a model recovery request.
 * Outputs: human-readable Markdown without executing or trusting embedded content.
 * Rationale: Some models ignore output-format instructions and return structured JSON even when tools are disabled.
 */
function renderSummaryJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => `- ${typeof item === 'object' ? safeJsonStringify(item) : String(item)}`).join('\n');
  }

  const record = value as Record<string, unknown>;
  const sections: string[] = [];
  const summary = record.summary ?? record.result ?? record.answer ?? record.message;
  if (typeof summary === 'string' && summary.trim()) {
    sections.push(summary.trim());
  }

  for (const [key, item] of Object.entries(record)) {
    if (['summary', 'result', 'answer', 'message'].includes(key) || item === null || item === undefined) {
      continue;
    }
    const label = formatSummaryLabel(key);
    if (key.toLowerCase() === 'status' && typeof item !== 'object') {
      sections.push(`Status: ${String(item)}`);
      continue;
    }
    if (Array.isArray(item)) {
      const bullets = item.map(entry => `- ${typeof entry === 'object' ? safeJsonStringify(entry) : String(entry)}`).join('\n');
      sections.push(`## ${label}\n\n${bullets}`);
      continue;
    }
    if (typeof item === 'object') {
      const details = Object.entries(item as Record<string, unknown>)
        .map(([nestedKey, nestedValue]) => `- **${formatSummaryLabel(nestedKey)}:** ${typeof nestedValue === 'object' ? safeJsonStringify(nestedValue) : String(nestedValue)}`)
        .join('\n');
      sections.push(`## ${label}\n\n${details}`);
      continue;
    }
    sections.push(`## ${label}\n\n${String(item)}`);
  }

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Normalize a thought-recovery response for user display.
 * Inputs: raw model text, optionally a complete JSON object/array or fenced JSON block.
 * Outputs: readable Markdown for JSON responses, otherwise the original trimmed text.
 * Errors: malformed or partial JSON is left untouched rather than discarded.
 */
function normalizeThinkingSummaryOutput(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fencedMatch?.[1] ?? text).trim();
  if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
    return text;
  }

  try {
    return renderSummaryJson(JSON.parse(candidate)) || text;
  } catch {
    return text;
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
    'Use only values allowed by the tool schema (for example, scope must match one of the enum values such as workspace, root, or an allowed ref:<id> scope when present). ' +
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
  if (config.provider === 'ollama') {
    return true;
  }
  if (config.provider === 'openai-compatible') {
    return false;
  }
  return isLikelyOllamaEndpoint(config.endpoint);
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

function normalizeForStrictSystemTemplates(messages: ChatMessage[]): ChatMessage[] {
  const systemParts: string[] = [];
  const nonSystem: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      const text = String(message.content ?? '').trim();
      if (text) {
        systemParts.push(text);
      }
      continue;
    }
    nonSystem.push(message);
  }

  if (systemParts.length === 0) {
    return nonSystem;
  }

  return [
    {
      role: 'system',
      content: systemParts.join('\n\n')
    },
    ...nonSystem
  ];
}

function ensureOllamaUserPrompt(messages: ChatMessage[], fallbackPrompt = 'Please continue with the latest information and answer the user request.'): ChatMessage[] {
  const prepared = [...messages];
  const hasUserMessage = prepared.some(message => message.role === 'user' && String(message.content ?? '').trim().length > 0);
  if (!hasUserMessage) {
    prepared.push({ role: 'user', content: fallbackPrompt });
    return prepared;
  }

  if (prepared.length > 0 && prepared[prepared.length - 1].role === 'tool') {
    prepared.push({ role: 'user', content: fallbackPrompt });
  }

  return prepared;
}

function estimateMessageTokens(message: ChatMessage): number {
  const content = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  const toolTokens = Array.isArray(message.tool_calls)
    ? message.tool_calls.reduce((total, call) => {
        const name = String(call.function?.name ?? '');
        const args = String(call.function?.arguments ?? '');
        return total + name.length + args.length;
      }, 0)
    : 0;

  const tokenBudget = content.length + toolTokens + (message.tool_call_id ? 32 : 0) + (message.role === 'tool' ? 64 : 24);
  return Math.max(1, Math.ceil(tokenBudget / 4));
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function summarizeConversationForContext(messages: ChatMessage[]): string {
  return messages
    .map(message => {
      const content = String(message.content ?? '').replace(/\s+/g, ' ').trim();
      if (!content) {
        return '';
      }
      const roleText = message.role.toUpperCase();
      return `${roleText}: ${content.slice(0, 300)}`;
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
}

/**
 * Reduce a conversation to the configured context budget while retaining its newest request.
 *
 * The fallback first removes older retained messages, then truncates the final message only
 * when it alone exceeds the budget. This keeps overflow retries bounded instead of repeating
 * the same context-window failure.
 */
export function compactMessagesForContext(messages: ChatMessage[], contextWindowTokens?: number, safetyMarginTokens = 512, force = false): ChatMessage[] {
  const contextLimit = toPositiveInteger(contextWindowTokens);
  if (!contextLimit) {
    return messages;
  }

  const margin = force
    ? Math.max(safetyMarginTokens, Math.round(contextLimit * 0.3))
    : safetyMarginTokens;
  const safeLimit = Math.max(256, contextLimit - margin);
  if (!force && estimateMessagesTokens(messages) <= safeLimit) {
    return messages;
  }

  const recentWindow = Math.min(Math.max(2, messages.length), 6);
  const recent = messages.slice(-recentWindow);
  const older = messages.slice(0, -recentWindow);
  const summary = summarizeConversationForContext(older);
  const compacted = [
    ...(summary ? [{ role: 'user' as const, content: `Earlier context summary: ${summary}` }] : []),
    ...recent
  ];

  if (estimateMessagesTokens(compacted) <= safeLimit) {
    return compacted;
  }

  const aggressiveSummary = summary ? `Compressed earlier context: ${summary.slice(0, 900)}` : 'Earlier context omitted to fit the model context window.';
  const aggressive = [
    { role: 'user' as const, content: aggressiveSummary },
    ...recent.map(message => ({
      ...message,
      content: String(message.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 900)
    }))
  ];

  if (estimateMessagesTokens(aggressive) <= safeLimit) {
    return aggressive;
  }

  const bounded = aggressive.slice(-Math.min(aggressive.length, 4));
  while (estimateMessagesTokens(bounded) > safeLimit && bounded.length > 1) {
    bounded.shift();
  }

  if (estimateMessagesTokens(bounded) <= safeLimit) {
    return bounded;
  }

  const latestMessage = bounded[0];
  if (!latestMessage) {
    return bounded;
  }

  const messageOverheadTokens = estimateMessageTokens({ ...latestMessage, content: '' });
  const contentCharacterBudget = Math.max(0, (safeLimit - messageOverheadTokens) * 4);
  return [{
    ...latestMessage,
    content: String(latestMessage.content ?? '').slice(0, contentCharacterBudget)
  }];
}

function isContextOverflowError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = Math.trunc(Number(error.response?.status ?? 0));
  const summary = summarizeResponseData(error.response?.data).toLowerCase();
  return status === 400 && (
    summary.includes('context size')
    || summary.includes('exceed_context_size_error')
    || summary.includes('too many tokens')
    || summary.includes('token budget')
    || summary.includes('prompt is too long')
    || summary.includes('requested tokens')
    || summary.includes('context window')
    || summary.includes('context length')
    || summary.includes('messages resulted in')
    || summary.includes('reduce the length')
  );
}

function extractContextLimitFromError(error: unknown): number | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const data = error.response?.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const topNctx = toPositiveInteger(record.n_ctx);
    if (topNctx) {
      return topNctx;
    }
    const errorObj = record.error;
    if (errorObj && typeof errorObj === 'object') {
      const nested = errorObj as Record<string, unknown>;
      const nestedNctx = toPositiveInteger(nested.n_ctx);
      if (nestedNctx) {
        return nestedNctx;
      }
    }
  }
  const summary = summarizeResponseData(data);
  const patterns = [
    /context size \((\d+)\s*tokens?\)/i,
    /maximum context length is (\d+)/i,
    /context window of (\d+)/i,
    /context length of (\d+)/i
  ];
  for (const pattern of patterns) {
    const match = summary.match(pattern);
    if (match && match[1]) {
      const value = toPositiveInteger(match[1]);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function resolveCompactionWindow(config: LLMConfig, error: unknown): number | undefined {
  const configured = toPositiveInteger(config.contextWindowTokens);
  const reported = extractContextLimitFromError(error);
  if (configured && reported) {
    return Math.min(configured, reported);
  }
  return configured ?? reported;
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
  if (config.openaiParameters && typeof config.openaiParameters === 'object') {
    const reserved = new Set(['model', 'messages', 'tools', 'tool_choice', 'stream']);
    for (const [key, value] of Object.entries(config.openaiParameters)) {
      if (!key || reserved.has(key)) {
        continue;
      }
      payload[key] = value;
    }
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
  if (config.ollamaOptions && typeof config.ollamaOptions === 'object') {
    for (const [key, value] of Object.entries(config.ollamaOptions)) {
      if (!key) {
        continue;
      }
      options[key] = value;
    }
  }

  const payload: Record<string, unknown> = {
    model: config.model,
    messages: toOllamaMessages(messages),
    stream: false,
    think: Boolean(config.ollamaThink),
    options
  };
  if (config.ollamaParameters && typeof config.ollamaParameters === 'object') {
    const reserved = new Set(['model', 'messages', 'tools', 'stream', 'think', 'options']);
    for (const [key, value] of Object.entries(config.ollamaParameters)) {
      if (!key || reserved.has(key)) {
        continue;
      }
      payload[key] = value;
    }
  }
  if (tools.length > 0) {
    payload.tools = tools;
  }
  return payload;
}

async function streamOllamaNativeChat(
  endpoint: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  timeout: number,
  signal: AbortSignal | undefined,
  onToken?: (token: string) => void
): Promise<{ assistant?: ChatMessage; thinking?: string; usage: Omit<TokenUsage, 'requests'> }> {
  let response;
  try {
    response = await axios.post(endpoint, { ...payload, stream: true }, {
      headers: { ...headers, Accept: 'text/event-stream' },
      responseType: 'stream',
      timeout,
      signal
    });
  } catch (error) {
    throw error;
  }

  const responseData = response.data as { on?: unknown };
  if (typeof responseData.on !== 'function') {
    const data = response.data as OllamaNativeChatResponse;
    const assistant = ollamaResponseToAssistant(data);
    const usage = parseOllamaUsage(data);
    return {
      assistant,
      thinking: String(data.message?.thinking ?? '').trim(),
      usage
    };
  }

  return await new Promise((resolve, reject) => {
    let pending = '';
    let assistantContent = '';
    let assistantThinking = '';
    let toolCalls: OllamaNativeToolCall[] = [];
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;

      const assistant: ChatMessage | undefined = assistantContent || toolCalls.length > 0 || assistantThinking
        ? {
            role: 'assistant',
            content: assistantContent.trim(),
            tool_calls: toolCalls.length > 0
              ? toolCalls
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
                  }))
              : undefined
          }
        : undefined;

      resolve({ assistant, thinking: assistantThinking, usage });
    };

    const handleChunk = (data: string) => {
      const text = data.trim();
      if (!text || text === '[DONE]') {
        return;
      }

      try {
        const chunk = JSON.parse(text) as OllamaNativeStreamChunk;
        const message = chunk.message;
        const nextContent = String(message?.content ?? '');
        if (nextContent) {
          const delta = nextContent.startsWith(assistantContent)
            ? nextContent.slice(assistantContent.length)
            : nextContent;
          if (delta) {
            assistantContent = nextContent.startsWith(assistantContent)
              ? nextContent
              : `${assistantContent}${delta}`;
            onToken?.(delta);
          }
        }

        const nextThinking = String(message?.thinking ?? '');
        if (nextThinking) {
          assistantThinking = nextThinking.startsWith(assistantThinking)
            ? nextThinking
            : `${assistantThinking}${nextThinking}`;
        }

        if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
          toolCalls = message.tool_calls;
        }

        usage = {
          promptTokens: toFiniteNumber(chunk.prompt_eval_count),
          completionTokens: toFiniteNumber(chunk.eval_count),
          totalTokens: toFiniteNumber(chunk.prompt_eval_count) + toFiniteNumber(chunk.eval_count)
        };

        if (chunk.done) {
          finish();
        }
      } catch {
        // Ignore partial/non-json chunks.
      }
    };

    response.data.on('data', (buffer: Buffer) => {
      pending += buffer.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        if (line.startsWith('data:')) {
          handleChunk(line.replace(/^data:\s*/, ''));
          continue;
        }

        if (line.startsWith('{') || line.startsWith('[')) {
          handleChunk(line);
        }
      }
    });

    response.data.on('end', finish);
    response.data.on('error', (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(signal?.aborted ? new Error('Chat request canceled') : err);
    });
  });
}

function extractOpenAIReasoning(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const record = message as Record<string, unknown>;
  const direct = typeof record.reasoning_content === 'string'
    ? record.reasoning_content
    : typeof record.reasoning === 'string'
      ? record.reasoning
      : '';
  return String(direct ?? '').trim();
}

async function streamOpenAICompatibleChat(
  endpoint: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  timeout: number,
  signal: AbortSignal | undefined,
  onToken?: (token: string) => void
): Promise<{ assistant?: ChatMessage; thinking?: string; usage: Omit<TokenUsage, 'requests'> }> {
  let response;
  try {
    response = await axios.post(endpoint, { ...payload, stream: true }, {
      headers: { ...headers, Accept: 'text/event-stream' },
      responseType: 'stream',
      timeout,
      signal
    });
  } catch (error) {
    throw error;
  }

  const responseData = response.data as { on?: unknown };
  if (typeof responseData.on !== 'function') {
    const data = response.data as CompletionResponse;
    const assistant = data.choices?.[0]?.message;
    return {
      assistant,
      thinking: extractOpenAIReasoning(assistant),
      usage: parseUsage(data.usage)
    };
  }

  return await new Promise((resolve, reject) => {
    let pending = '';
    let assistantContent = '';
    let assistantThinking = '';
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;

      const normalizedToolCalls = Array.from(toolCalls.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([index, call]) => ({
          id: call.id || `openai-tool-${index + 1}`,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: call.arguments || '{}'
          }
        }))
        .filter(call => Boolean(call.function.name));

      const assistant: ChatMessage | undefined = assistantContent || normalizedToolCalls.length > 0 || assistantThinking
        ? {
            role: 'assistant',
            content: assistantContent.trim(),
            tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined
          }
        : undefined;

      resolve({ assistant, thinking: assistantThinking, usage });
    };

    const handleChunk = (data: string) => {
      const text = data.trim();
      if (!text || text === '[DONE]') {
        if (text === '[DONE]') {
          finish();
        }
        return;
      }

      try {
        const chunk = JSON.parse(text) as StreamChunk;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        const nextContent = String(delta?.content ?? '');
        if (nextContent) {
          assistantContent += nextContent;
          onToken?.(nextContent);
        }

        const nextThinking = String(delta?.reasoning_content ?? delta?.reasoning ?? '');
        if (nextThinking) {
          assistantThinking += nextThinking;
        }

        for (const toolDelta of delta?.tool_calls ?? []) {
          const index = Math.max(0, Number(toolDelta.index ?? 0) || 0);
          const existing = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
          if (toolDelta.id) {
            existing.id = String(toolDelta.id);
          }
          if (toolDelta.function?.name) {
            existing.name += String(toolDelta.function.name);
          }
          if (toolDelta.function?.arguments) {
            existing.arguments += String(toolDelta.function.arguments);
          }
          toolCalls.set(index, existing);
        }

        usage = parseUsage(chunk.usage);

        if (choice?.finish_reason) {
          finish();
        }
      } catch {
        // Ignore partial/non-json chunks.
      }
    };

    response.data.on('data', (buffer: Buffer) => {
      pending += buffer.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        if (line.startsWith('data:')) {
          handleChunk(line.replace(/^data:\s*/, ''));
          continue;
        }
        if (line.startsWith('{') || line.startsWith('[')) {
          handleChunk(line);
        }
      }
    });

    response.data.on('end', finish);
    response.data.on('error', (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(signal?.aborted ? new Error('Chat request canceled') : err);
    });
  });
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
  signal?: AbortSignal,
  onToken?: (token: string) => void
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

  async function requestAssistantWithoutTools(
    prompt: string,
    options?: { disableThinking?: boolean; normalizeOutput?: boolean }
  ): Promise<string | null> {
    const summaryMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'user',
        content: prompt
      }
    ];

    // Proactive compaction: the final summary sends the full conversation in one
    // request, so compact up front when the estimate reaches ~80% of the window.
    // Only act while the estimate is still within the window (80%-100%); if it is
    // already over 100%, the request will fail and the reactive path compacts
    // using the server-reported limit, which is more accurate.
    const proactiveWindow = toPositiveInteger(config.contextWindowTokens);
    if (proactiveWindow) {
      const proactiveThreshold = Math.round(proactiveWindow * 0.8);
      const proactiveCeiling = proactiveWindow;
      const proactiveEstimate = estimateMessagesTokens(summaryMessages);
      if (proactiveEstimate > proactiveThreshold && proactiveEstimate <= proactiveCeiling) {
        const compacted = compactMessagesForContext(summaryMessages, proactiveWindow, 1024, true);
        if (JSON.stringify(compacted) !== JSON.stringify(summaryMessages)) {
          summaryMessages.length = 0;
          summaryMessages.push(...compacted);
          onEvent?.(`context:compacted-proactively (final summary, estimate ${proactiveEstimate} tokens, threshold ${proactiveThreshold})`);
        }
      }
    }

    let streamedTokenCount = 0;

    const attemptRequest = async (requestMessages: ChatMessage[], useStream: boolean) => {
      streamedTokenCount = 0;
      const countToken = () => {
        streamedTokenCount += 1;
      };

      if (useOllamaNativeChat && ollamaNativeEndpoint) {
        const payload = buildOllamaNativePayload(
          { ...config, ollamaThink: options?.disableThinking ? false : config.ollamaThink },
          normalizeForStrictSystemTemplates(ensureOllamaUserPrompt(requestMessages)),
          []
        );
        const shouldStream = useStream && Boolean(config.ollamaStreaming ?? true);
        const response = shouldStream
          ? await streamOllamaNativeChat(
              ollamaNativeEndpoint,
              payload,
              buildHeaders(config),
              requestTimeoutMs,
              signal,
              countToken
            )
          : await axios.post<OllamaNativeChatResponse>(ollamaNativeEndpoint, payload, {
              headers: buildHeaders(config),
              timeout: requestTimeoutMs,
              signal
            }).then(result => ({
              assistant: ollamaResponseToAssistant(result.data),
              thinking: String(result.data.message?.thinking ?? '').trim(),
              usage: parseOllamaUsage(result.data)
            }));
        const usage = response.usage;
        usageTotals.promptTokens += usage.promptTokens;
        usageTotals.completionTokens += usage.completionTokens;
        usageTotals.totalTokens += usage.totalTokens;
        usageTotals.requests += 1;
        const text = String(response.assistant?.content ?? '').trim();
        if (!text) {
          return null;
        }
        return options?.normalizeOutput ? normalizeThinkingSummaryOutput(text) : text;
      }

      if (useStream) {
        const streamed = await streamOpenAICompatibleChat(
          config.endpoint,
          payloadBase(config, requestMessages),
          buildHeaders(config),
          requestTimeoutMs,
          signal,
          countToken
        );
        const usage = streamed.usage;
        usageTotals.promptTokens += usage.promptTokens;
        usageTotals.completionTokens += usage.completionTokens;
        usageTotals.totalTokens += usage.totalTokens;
        usageTotals.requests += 1;
        const text = String(streamed.assistant?.content ?? '').trim();
        if (!text) {
          return null;
        }
        return options?.normalizeOutput ? normalizeThinkingSummaryOutput(text) : text;
      }

      const payload: Record<string, unknown> = {
        ...payloadBase(config, requestMessages),
        stream: false
      };
      const response = await axios.post<CompletionResponse>(config.endpoint, payload, {
        headers: buildHeaders(config),
        timeout: requestTimeoutMs,
        signal
      });
      const usage = parseUsage(response.data.usage);
      usageTotals.promptTokens += usage.promptTokens;
      usageTotals.completionTokens += usage.completionTokens;
      usageTotals.totalTokens += usage.totalTokens;
      usageTotals.requests += 1;
      const text = String(response.data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) {
        return null;
      }
      return options?.normalizeOutput ? normalizeThinkingSummaryOutput(text) : text;
    };

    try {
      // Stream first so the connection stays active during long generations.
      // The summary sends the full conversation context in one request; a
      // non-streaming call leaves the socket idle while the model generates,
      // which trips proxy/server idle timeouts ("socket hang up"). Streaming
      // keeps bytes flowing and avoids that.
      try {
        return await attemptRequest(summaryMessages, true);
      } catch (streamError) {
        if (isContextOverflowError(streamError)) {
          const compacted = compactMessagesForContext(summaryMessages, resolveCompactionWindow(config, streamError), 1024, true);
          if (JSON.stringify(compacted) !== JSON.stringify(summaryMessages)) {
            onEvent?.('context:compacted-after-exceeding-window');
            return await attemptRequest(compacted, false);
          }
          throw streamError;
        }
        if (streamedTokenCount === 0 && shouldFallbackOpenAIStreamingFailure(streamError)) {
          onEvent?.('final-summary:streaming-failed; retrying without stream');
          return await attemptRequest(summaryMessages, false);
        }
        throw streamError;
      }
    } catch (error) {
      if (isContextOverflowError(error)) {
        const compacted = compactMessagesForContext(summaryMessages, resolveCompactionWindow(config, error), 1024, true);
        if (JSON.stringify(compacted) !== JSON.stringify(summaryMessages)) {
          onEvent?.('context:compacted-after-exceeding-window');
          return await attemptRequest(compacted, false);
        }
      }
      throw error;
    }
  }

  async function requestFinalSummary(reason: string): Promise<string | null> {
    const summaryPrompt =
      'The prior response ended without a usable final answer. ' +
      'Using the same conversation context and completed work, provide the final results summary now. ' +
      'Do not call tools or include internal reasoning. Respond as concise, readable Markdown for the user. ' +
      'Do not return JSON, a tool-call object, or a schema wrapper.';

    onEvent?.(`final-summary:requesting:${reason}`);
    try {
      const summary = await requestAssistantWithoutTools(summaryPrompt, {
        disableThinking: true,
        normalizeOutput: true
      });
      if (!summary) {
        onEvent?.(`final-summary:empty:${reason}`);
        return null;
      }

      messages.push({ role: 'user', content: summaryPrompt });
      messages.push({ role: 'assistant', content: summary });
      onEvent?.(`final-summary:received:${reason}`);
      return summary;
    } catch (error) {
      onEvent?.(`final-summary:failed:${reason}:${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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
        role: 'user',
        content: `${toolParseFailureRetryMessage()} ${buildProviderToolParseFailureFeedback(detail, providerToolParseFailures, activeTools.length > 0)}`
      });
      onEvent?.('provider tool-call parser failed; retrying with stricter JSON-only tool-call instructions and a safer tool subset.');
      return true;
    }

    if (providerToolParseFailures < maxTurns) {
      messages.push({
        role: 'user',
        content: buildProviderToolParseFailureFeedback(detail, providerToolParseFailures, activeTools.length > 0)
      });
      onEvent?.('provider tool-call parser failed again; returning the failure to the model so it can correct the next action.');
      return true;
    }

    return false;
  }

  // Produce a stable, order-independent signature for a tool's arguments so we can
  // detect when the exact same call is issued back-to-back. Used by the direct-
  // sequence repeat guard. Pure: no side effects.
  function stableSignature(args: Record<string, unknown>): string {
    if (!args || typeof args !== 'object') return '';
    const sortedKeys = Object.keys(args).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const value = args[key];
      normalized[key] = typeof value === 'string' ? value.trim() : value;
    }
    try {
      return JSON.stringify(normalized);
    } catch {
      return String(args);
    }
  }

  function intentSummary(name: string, args: Record<string, unknown>): string {
    const spawnSubAgentPreviewChars = 320;
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
      case 'spawn_sub_agent':
        return `spawn sub-agent for: ${String(args.prompt ?? '').slice(0, spawnSubAgentPreviewChars)}`;
      default:
        return 'execute requested operation';
    }
  }

  // Track the last requested tool call so we can detect direct-sequence repeats —
  // the same tool called with identical arguments back-to-back. Such a repeat is
  // almost always a broken loop. We first block individual repeats, then hard-stop
  // the session when the same call is requested more than the configured threshold.
  // Legitimate iteration (e.g. read_file with changing bounds) has different args.
  let lastToolCallKey = '';
  let consecutiveIdenticalToolCallCount = 0;

  for (let i = 0; i < maxTurns; i += 1) {
    onEvent?.(`llm-turn:${i + 1}/${maxTurns}`);
    const messageCountBefore = messages.length;
    let assistant: ChatMessage | undefined;
    let assistantThinking = '';
    let usage: Omit<TokenUsage, 'requests'>;

    // Proactive compaction: when the estimated context reaches ~80% of the
    // configured window, compact before the request so we stay under the limit
    // instead of waiting for the provider to reject the request. The character
    // estimator undercounts real tokens, so 80% of the window leaves headroom.
    // Only act while the estimate is still within the window (80%-100%); if it is
    // already over 100%, the request will fail and the reactive path compacts
    // using the server-reported limit, which is more accurate.
    const proactiveWindow = toPositiveInteger(config.contextWindowTokens);
    if (proactiveWindow) {
      const proactiveThreshold = Math.round(proactiveWindow * 0.8);
      const proactiveCeiling = proactiveWindow;
      const proactiveEstimate = estimateMessagesTokens(messages);
      if (proactiveEstimate > proactiveThreshold && proactiveEstimate <= proactiveCeiling) {
        const compacted = compactMessagesForContext(messages, proactiveWindow, 1024, true);
        if (JSON.stringify(compacted) !== JSON.stringify(messages)) {
          messages.length = 0;
          messages.push(...compacted);
          onEvent?.(`context:compacted-proactively (estimate ${proactiveEstimate} tokens, threshold ${proactiveThreshold})`);
        }
      }
    }

    const requestMessages = messages;

    if (useOllamaNativeChat && ollamaNativeEndpoint) {
      const payload = buildOllamaNativePayload(config, normalizeForStrictSystemTemplates(ensureOllamaUserPrompt(requestMessages)), activeTools);
      try {
        const shouldStream = Boolean(config.ollamaStreaming ?? true);
        if (shouldStream) {
          const streamed = await streamOllamaNativeChat(
            ollamaNativeEndpoint,
            payload,
            buildHeaders(config),
            requestTimeoutMs,
            signal,
            onToken
          );
          assistant = streamed.assistant;
          assistantThinking = String(streamed.thinking ?? '').trim();
          usage = streamed.usage;
        } else {
          const response = await axios.post<OllamaNativeChatResponse>(ollamaNativeEndpoint, payload, {
            headers: buildHeaders(config),
            timeout: requestTimeoutMs,
            signal
          });

          assistant = ollamaResponseToAssistant(response.data);
          assistantThinking = String(response.data.message?.thinking ?? '').trim();
          usage = parseOllamaUsage(response.data);
        }
      } catch (error) {
        if (isContextOverflowError(error)) {
          const compacted = compactMessagesForContext(messages, resolveCompactionWindow(config, error), 1024, true);
          if (JSON.stringify(compacted) !== JSON.stringify(requestMessages)) {
            onEvent?.('context:compacted-before-retry');
            const retryPayload = buildOllamaNativePayload(config, normalizeForStrictSystemTemplates(ensureOllamaUserPrompt(compacted)), activeTools);
            const retryStream = Boolean(config.ollamaStreaming ?? true);
            if (retryStream) {
              const streamed = await streamOllamaNativeChat(
                ollamaNativeEndpoint,
                retryPayload,
                buildHeaders(config),
                requestTimeoutMs,
                signal,
                onToken
              );
              assistant = streamed.assistant;
              assistantThinking = String(streamed.thinking ?? '').trim();
              usage = streamed.usage;
            } else {
              const response = await axios.post<OllamaNativeChatResponse>(ollamaNativeEndpoint, retryPayload, {
                headers: buildHeaders(config),
                timeout: requestTimeoutMs,
                signal
              });
              assistant = ollamaResponseToAssistant(response.data);
              assistantThinking = String(response.data.message?.thinking ?? '').trim();
              usage = parseOllamaUsage(response.data);
            }
          } else {
            throw formatAxiosFailure(error, {
              operation: 'Ollama native chat request',
              endpoint: ollamaNativeEndpoint,
              model: config.model
            });
          }
        } else {
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
      }
    } else {
      const payload: Record<string, unknown> = {
        ...payloadBase(config, requestMessages),
        stream: false
      };
      if (activeTools.length > 0) {
        payload.tools = activeTools;
        payload.tool_choice = 'auto';
        payload.parallel_tool_calls = false;
      }

      try {
        if (onToken) {
          let streamedTokenCount = 0;
          try {
            const streamed = await streamOpenAICompatibleChat(
              config.endpoint,
              payload,
              buildHeaders(config),
              requestTimeoutMs,
              signal,
              token => {
                streamedTokenCount += 1;
                onToken(token);
              }
            );
            assistant = streamed.assistant;
            assistantThinking = String(streamed.thinking ?? '').trim();
            usage = streamed.usage;
          } catch (streamError) {
            if (isContextOverflowError(streamError)) {
              const compacted = compactMessagesForContext(messages, resolveCompactionWindow(config, streamError), 1024, true);
              if (JSON.stringify(compacted) !== JSON.stringify(requestMessages)) {
                onEvent?.('context:compacted-before-retry');
                const retryPayload: Record<string, unknown> = {
                  ...payloadBase(config, compacted),
                  stream: false
                };
                if (activeTools.length > 0) {
                  retryPayload.tools = activeTools;
                  retryPayload.tool_choice = 'auto';
                  retryPayload.parallel_tool_calls = false;
                }

                const response = await axios.post<CompletionResponse>(config.endpoint, retryPayload, {
                  headers: buildHeaders(config),
                  timeout: requestTimeoutMs,
                  signal
                });
                assistant = response.data.choices?.[0]?.message;
                assistantThinking = extractOpenAIReasoning(assistant);
                usage = parseUsage(response.data.usage);
              } else {
                throw streamError;
              }
            } else if (streamedTokenCount > 0 || !shouldFallbackOpenAIStreamingFailure(streamError)) {
              throw streamError;
            } else {
              onEvent?.('provider:openai-compatible | streaming request failed before any tokens; retrying without stream for this turn.');
              const response = await axios.post<CompletionResponse>(config.endpoint, payload, {
                headers: buildHeaders(config),
                timeout: requestTimeoutMs,
                signal
              });
              assistant = response.data.choices?.[0]?.message;
              assistantThinking = extractOpenAIReasoning(assistant);
              usage = parseUsage(response.data.usage);
            }
          }
        } else {
          const response = await axios.post<CompletionResponse>(config.endpoint, payload, {
            headers: buildHeaders(config),
            timeout: requestTimeoutMs,
            signal
          });

          assistant = response.data.choices?.[0]?.message;
          assistantThinking = extractOpenAIReasoning(assistant);
          usage = parseUsage(response.data.usage);
        }
      } catch (error) {
        if (isContextOverflowError(error)) {
          const compacted = compactMessagesForContext(messages, resolveCompactionWindow(config, error), 1024, true);
          if (JSON.stringify(compacted) !== JSON.stringify(requestMessages)) {
            onEvent?.('context:compacted-before-retry');
            const retryPayload: Record<string, unknown> = {
              ...payloadBase(config, compacted),
              stream: false
            };
            if (activeTools.length > 0) {
              retryPayload.tools = activeTools;
              retryPayload.tool_choice = 'auto';
              retryPayload.parallel_tool_calls = false;
            }
            const response = await axios.post<CompletionResponse>(config.endpoint, retryPayload, {
              headers: buildHeaders(config),
              timeout: requestTimeoutMs,
              signal
            });
            assistant = response.data.choices?.[0]?.message;
            assistantThinking = extractOpenAIReasoning(assistant);
            usage = parseUsage(response.data.usage);
          } else {
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
        } else {
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
      }
    }

    usageTotals.promptTokens += usage.promptTokens;
    usageTotals.completionTokens += usage.completionTokens;
    usageTotals.totalTokens += usage.totalTokens;
    usageTotals.requests += 1;
    if (!assistant) {
      const recoveredSummary = await requestFinalSummary('missing-assistant-message');
      return {
        text: recoveredSummary ?? '',
        usage: usageTotals,
        debug: buildDebug()
      };
    }

    if (assistantThinking) {
      onEvent?.(`thinking:${assistantThinking}`);
    }

    messages.push(assistant);
    const assistantToolCalls = assistant.tool_calls?.length ?? 0;
    totalToolCalls += assistantToolCalls;

    if (!assistant.tool_calls || assistant.tool_calls.length === 0) {
      let finalText = String(assistant.content ?? '').trim();
      if (!finalText) {
        const summaryReason = assistantThinking ? 'thinking-only-output' : 'empty-output';
        const recoveredSummary = await requestFinalSummary(summaryReason);
        if (recoveredSummary) {
          finalText = recoveredSummary;
        }
      }

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
        text: finalText,
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
      onEvent?.(`intent:${intentSummary(toolName, summarizedArgs)}`);

      // Direct-sequence repeat guard: if the exact same tool call is issued
      // back-to-back (same name + identical arguments), it is almost certainly a
      // broken loop. Surface the read_file arguments to the user first (so
      // legitimate iteration through a file stays visible), then stop re-executing
      // and feed the model a hint to proceed differently. We only treat *consecutive*
      // identical calls as a loop — a later re-read after other work is fine.
      const signature = stableSignature(summarizedArgs);
      const currentToolCallKey = signature ? `${toolName}:${signature}` : '';
      const isConsecutiveRepeat = Boolean(currentToolCallKey) && currentToolCallKey === lastToolCallKey;
      if (isConsecutiveRepeat) {
        consecutiveIdenticalToolCallCount += 1;
      } else if (currentToolCallKey) {
        lastToolCallKey = currentToolCallKey;
        consecutiveIdenticalToolCallCount = 1;
      } else {
        lastToolCallKey = '';
        consecutiveIdenticalToolCallCount = 0;
      }

      if (isConsecutiveRepeat && consecutiveIdenticalToolCallCount > MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS) {
        const repeatError =
          `Tool ${toolName} was requested ${consecutiveIdenticalToolCallCount} times in a row with identical arguments. ` +
          'Ending this session to prevent a loop and requesting a final summary.';

        onEvent?.(`tool-repeat-threshold:${toolName}:${consecutiveIdenticalToolCallCount}`);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: clampToolResultForPrompt(safeJsonStringify({
            ok: false,
            error: repeatError
          }))
        });

        let summaryText = '';
        try {
          const summary = await requestAssistantWithoutTools(
            'A repeated identical tool-call loop was detected and the tool session was stopped. ' +
            'Do not call tools or include internal reasoning. ' +
            'Provide a concise Markdown final summary with: (1) what was completed, (2) what remains, and (3) the best next user action.',
            {
              disableThinking: true,
              normalizeOutput: true
            }
          );
          if (summary) {
            summaryText = summary;
            onEvent?.('final-summary:received:tool-repeat-threshold');
          } else {
            onEvent?.('final-summary:empty:tool-repeat-threshold');
          }
        } catch (error) {
          onEvent?.(`final-summary:failed:tool-repeat-threshold:${error instanceof Error ? error.message : String(error)}`);
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

        return {
          text: summaryText ||
            'Session stopped due to repeated identical tool calls. Summary unavailable. Please adjust strategy and continue.',
          usage: usageTotals,
          continuationSummary: summaryText || undefined,
          debug: buildDebug()
        };
      }

      if (isConsecutiveRepeat && signature) {
        onEvent?.(`tool-args:${toolName}:${JSON.stringify(summarizedArgs)}`);
        onEvent?.(`tool-repeat:${toolName}`);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: clampToolResultForPrompt(safeJsonStringify({
            ok: false,
            error: `Tool ${toolName} was called with identical arguments immediately after a previous call. Do not repeat it; proceed to the next step or answer in plain text.`
          }))
        });
        continue;
      }

      // Expose read_file arguments to the user so they can see which file and
      // chunk bounds the model is reading, even when it iterates through a file.
      if (toolName === 'read_file') {
        const pathArg = String(summarizedArgs.path ?? '');
        const startLineArg = summarizedArgs.startLine;
        const endLineArg = summarizedArgs.endLine;
        const maxCharsArg = summarizedArgs.maxChars;
        const scopeArg = summarizedArgs.scope;
        const offsetArg = summarizedArgs.offset;
        const limitArg = summarizedArgs.limit;
        const toolArgsForEvent: Record<string, unknown> = { path: pathArg };

        const startLineNumber = Number(startLineArg);
        if (startLineArg !== undefined && Number.isFinite(startLineNumber)) {
          toolArgsForEvent.startLine = Math.trunc(startLineNumber);
        }

        const endLineNumber = Number(endLineArg);
        if (endLineArg !== undefined && Number.isFinite(endLineNumber)) {
          toolArgsForEvent.endLine = Math.trunc(endLineNumber);
        }

        const maxCharsNumber = Number(maxCharsArg);
        if (maxCharsArg !== undefined && Number.isFinite(maxCharsNumber)) {
          toolArgsForEvent.maxChars = Math.trunc(maxCharsNumber);
        }

        if (scopeArg !== undefined) {
          toolArgsForEvent.scope = String(scopeArg);
        }

        // Keep legacy fields visible for compatibility with older prompts/tool schemas.
        const offsetNumber = Number(offsetArg);
        if (offsetArg !== undefined && Number.isFinite(offsetNumber)) {
          toolArgsForEvent.offset = Math.trunc(offsetNumber);
        }

        const limitNumber = Number(limitArg);
        if (limitArg !== undefined && Number.isFinite(limitNumber)) {
          toolArgsForEvent.limit = Math.trunc(limitNumber);
        }

        onEvent?.(`tool-args:${toolName}:${JSON.stringify({
          ...toolArgsForEvent
        })}`);
      }

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
      , {
        disableThinking: true,
        normalizeOutput: true
      }
    );
    if (summary) {
      onEvent?.('final-summary:received:tool-budget-exhausted');
      return {
        text: `${exhaustedMessage}\n\n${summary}`,
        usage: usageTotals,
        toolBudgetExhausted: true,
        continuationSummary: summary,
        debug: buildDebug()
      };
    }
    onEvent?.('final-summary:empty:tool-budget-exhausted');
  } catch (error) {
    onEvent?.(`final-summary:failed:tool-budget-exhausted:${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    text: `${exhaustedMessage}\n\nSummary unavailable. Please continue from this state or raise the per-step tool-call budget.`,
    usage: usageTotals,
    toolBudgetExhausted: true,
    debug: buildDebug()
  };
}
