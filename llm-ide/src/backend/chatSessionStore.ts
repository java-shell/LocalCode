import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { ChatMessage, ChatSession, ChatSessionConfig, ChatSessionSummary } from '../shared/types';

interface ChatSessionStoreFile {
  version: 1;
  sessions: ChatSession[];
}

function getChatSessionStorePath(): string {
  return path.join(app.getPath('userData'), 'chat-sessions.json');
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  return {
    role: message.role,
    content: String(message.content ?? ''),
    tool_call_id: message.tool_call_id ? String(message.tool_call_id) : undefined,
    tool_calls: Array.isArray(message.tool_calls)
      ? message.tool_calls.map(call => ({
          id: String(call.id ?? ''),
          type: 'function',
          function: {
            name: String(call.function?.name ?? ''),
            arguments: String(call.function?.arguments ?? '{}')
          }
        }))
      : undefined
  };
}

function normalizeConfig(config: Partial<ChatSessionConfig> | undefined): ChatSessionConfig {
  return {
    provider: String(config?.provider ?? '').trim().toLowerCase() === 'ollama' ? 'ollama' : 'openai-compatible',
    endpoint: String(config?.endpoint ?? '').trim(),
    model: String(config?.model ?? '').trim(),
    ollamaThink: config?.ollamaThink == null ? undefined : Boolean(config.ollamaThink),
    ollamaStreaming: config?.ollamaStreaming == null ? undefined : Boolean(config.ollamaStreaming),
    contextWindowTokens: Math.max(0, Number(config?.contextWindowTokens ?? 0)) || undefined,
    memoryNamespace: String(config?.memoryNamespace ?? '').trim() || undefined
  };
}

function normalizeSession(session: Partial<ChatSession>): ChatSession | null {
  const id = String(session.id ?? '').trim();
  const title = String(session.title ?? '').trim();
  const workspaceDir = String(session.workspaceDir ?? '').trim();
  const createdAt = String(session.createdAt ?? '').trim();
  const updatedAt = String(session.updatedAt ?? '').trim();
  const config = normalizeConfig(session.config);
  const messages = Array.isArray(session.messages)
    ? session.messages
        .filter(message => Boolean(message) && typeof message === 'object')
        .map(message => normalizeChatMessage(message as ChatMessage))
        .filter(message => (message.role === 'user' || message.role === 'assistant') && message.content.length > 0)
    : [];

  if (!id || !title || !workspaceDir || !createdAt || !updatedAt || !config.endpoint || !config.model) {
    return null;
  }

  const lastVisibleMessage = [...messages].reverse().find(message => message.content.trim().length > 0);

  return {
    id,
    title,
    workspaceDir,
    createdAt,
    updatedAt,
    messages,
    messageCount: messages.length,
    lastMessagePreview: lastVisibleMessage ? lastVisibleMessage.content.slice(0, 160) : undefined,
    config
  };
}

async function readStore(): Promise<ChatSessionStoreFile> {
  const filePath = getChatSessionStorePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChatSessionStoreFile>;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions
          .map(session => normalizeSession(session))
          .filter((session): session is ChatSession => Boolean(session))
      : [];
    return {
      version: 1,
      sessions
    };
  } catch {
    return {
      version: 1,
      sessions: []
    };
  }
}

async function writeStore(store: ChatSessionStoreFile): Promise<void> {
  const filePath = getChatSessionStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function toSummary(session: ChatSession): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    workspaceDir: session.workspaceDir,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    lastMessagePreview: session.lastMessagePreview,
    config: session.config
  };
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const store = await readStore();
  return store.sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
}

export async function loadChatSession(id: string): Promise<ChatSession | null> {
  const store = await readStore();
  return store.sessions.find(session => session.id === id) ?? null;
}

export async function saveChatSession(session: ChatSession): Promise<ChatSession> {
  const normalized = normalizeSession(session);
  if (!normalized) {
    throw new Error('Invalid chat session payload.');
  }

  const store = await readStore();
  const index = store.sessions.findIndex(existing => existing.id === normalized.id);
  if (index >= 0) {
    store.sessions[index] = normalized;
  } else {
    store.sessions.push(normalized);
  }

  store.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  await writeStore(store);
  return normalized;
}

export async function deleteChatSession(id: string): Promise<{ deleted: boolean }> {
  const store = await readStore();
  const nextSessions = store.sessions.filter(session => session.id !== id);
  if (nextSessions.length === store.sessions.length) {
    return { deleted: false };
  }
  store.sessions = nextSessions;
  await writeStore(store);
  return { deleted: true };
}