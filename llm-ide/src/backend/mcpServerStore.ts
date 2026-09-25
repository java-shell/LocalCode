import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { MCPServerConfig, MCPServerTarget, MCPServerTransport } from '../shared/types';

interface MCPServerStoreFile {
  version: 1;
  servers: MCPServerConfig[];
}

function getMcpServerStorePath(): string {
  return path.join(app.getPath('userData'), 'mcp-servers.json');
}

function normalizeTransport(value: unknown): MCPServerTransport {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'http') return 'http';
  if (raw === 'sse') return 'sse';
  return 'stdio';
}

function normalizeMcpServer(entry: Partial<MCPServerConfig> | undefined, index: number): MCPServerConfig | null {
  const id = String(entry?.id ?? '').trim() || `mcp-server-${index + 1}`;
  const label = String(entry?.label ?? '').trim() || id;
  const transport = normalizeTransport(entry?.transport);
  const command = String(entry?.command ?? '').trim();
  const endpoint = String(entry?.endpoint ?? '').trim();

  if (transport === 'stdio' && !command) {
    return null;
  }
  if ((transport === 'http' || transport === 'sse') && !endpoint) {
    return null;
  }

  const args = Array.isArray(entry?.args)
    ? entry?.args.map(value => String(value ?? '').trim()).filter(Boolean)
    : [];

  const env: Record<string, string> = {};
  if (entry?.env && typeof entry.env === 'object') {
    for (const [key, value] of Object.entries(entry.env)) {
      const safeKey = String(key ?? '').trim();
      if (!safeKey) continue;
      env[safeKey] = String(value ?? '');
    }
  }

  return {
    id,
    label,
    transport,
    enabledForChat: Boolean(entry?.enabledForChat ?? true),
    enabledForOrchestration: Boolean(entry?.enabledForOrchestration ?? true),
    command: command || undefined,
    args: args.length > 0 ? args : undefined,
    endpoint: endpoint || undefined,
    env: Object.keys(env).length > 0 ? env : undefined
  };
}

function normalizeMcpServers(entries: MCPServerConfig[] | undefined): MCPServerConfig[] {
  const source = Array.isArray(entries) ? entries : [];
  const normalized: MCPServerConfig[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < source.length; index += 1) {
    const server = normalizeMcpServer(source[index], index);
    if (!server) {
      continue;
    }

    const uniqueId = seenIds.has(server.id) ? `${server.id}-${index + 1}` : server.id;
    seenIds.add(uniqueId);
    normalized.push({
      ...server,
      id: uniqueId
    });
  }

  return normalized;
}

async function readStore(): Promise<MCPServerStoreFile> {
  const filePath = getMcpServerStorePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MCPServerStoreFile>;
    return {
      version: 1,
      servers: normalizeMcpServers(parsed.servers)
    };
  } catch {
    return {
      version: 1,
      servers: []
    };
  }
}

async function writeStore(store: MCPServerStoreFile): Promise<void> {
  const filePath = getMcpServerStorePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

export async function listMcpServers(): Promise<MCPServerConfig[]> {
  const store = await readStore();
  return store.servers;
}

export async function saveMcpServers(servers: MCPServerConfig[]): Promise<MCPServerConfig[]> {
  const normalized = normalizeMcpServers(servers);
  await writeStore({
    version: 1,
    servers: normalized
  });
  return normalized;
}

export async function listMcpServersForTarget(target: MCPServerTarget): Promise<MCPServerConfig[]> {
  const servers = await listMcpServers();
  return servers.filter(server =>
    target === 'chat' ? server.enabledForChat : server.enabledForOrchestration
  );
}
