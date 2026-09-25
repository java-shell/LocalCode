import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import type {
  MCPServerConfig,
  MCPServerRuntimeStatus,
  MCPServerTarget,
  ToolDefinition
} from '../shared/types';

interface MCPToolDescriptor {
  serverId: string;
  toolName: string;
  namespacedToolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface ToolListResponse {
  tools?: Array<{
    name?: unknown;
    description?: unknown;
    inputSchema?: unknown;
  }>;
}

interface ToolCallResponse {
  content?: unknown;
  isError?: unknown;
  [key: string]: unknown;
}

interface MCPClient {
  start(): Promise<void>;
  initialize(): Promise<void>;
  listTools(): Promise<ToolListResponse>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse>;
  stop(): Promise<void>;
}

interface ManagedServerRecord {
  config: MCPServerConfig;
  status: MCPServerRuntimeStatus;
  tools: MCPToolDescriptor[];
  client?: MCPClient;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeNameSegment(value: string): string {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'tool';
}

function namespacedToolName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeNameSegment(serverId)}__${sanitizeNameSegment(toolName)}`;
}

function emptyStatus(config: MCPServerConfig): MCPServerRuntimeStatus {
  return {
    serverId: config.id,
    label: config.label,
    transport: config.transport,
    lifecycle: 'disconnected',
    healthy: false,
    discoveredToolCount: 0,
    discoveredToolNames: [],
    updatedAt: nowIso()
  };
}

function normalizeToolSchema(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      type: 'object',
      properties: {}
    };
  }
  const root = input as Record<string, unknown>;
  const type = String(root.type ?? 'object');
  if (type !== 'object') {
    return {
      type: 'object',
      properties: {
        value: {
          type,
          description: 'Wrapped MCP tool argument value.'
        }
      },
      required: ['value']
    };
  }
  return {
    ...root,
    properties: root.properties && typeof root.properties === 'object' ? root.properties : {}
  };
}

class MCPStdioClient {
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readBuffer = Buffer.alloc(0);
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private started = false;
  private lastStderr = '';

  constructor(config: MCPServerConfig) {
    this.command = String(config.command ?? '').trim();
    this.args = Array.isArray(config.args) ? config.args.map(arg => String(arg ?? '')) : [];
    this.env = config.env;
  }

  getLastStderr(): string {
    return this.lastStderr;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (!this.command) {
      throw new Error('stdio transport requires a command.');
    }

    const child = spawn(this.command, this.args, {
      stdio: 'pipe',
      env: {
        ...process.env,
        ...(this.env ?? {})
      }
    });

    this.process = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      const next = `${this.lastStderr}${text}`;
      this.lastStderr = next.slice(-2000);
    });

    child.on('exit', (code, signal) => {
      const detail = `MCP stdio process exited (code=${String(code)}, signal=${String(signal)})`;
      this.failPending(detail);
      this.started = false;
      this.process = null;
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', error => reject(error));
    });

    this.started = true;
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'LocalCode',
        version: '0.0.9'
      }
    });

    this.sendNotification('notifications/initialized', {});
  }

  async listTools(): Promise<ToolListResponse> {
    const result = await this.request('tools/list', {});
    return (result as ToolListResponse) || {};
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
    const result = await this.request('tools/call', {
      name: toolName,
      arguments: args
    });
    return (result as ToolCallResponse) || {};
  }

  async stop(): Promise<void> {
    this.failPending('MCP client stopped.');
    if (!this.process) {
      return;
    }

    const child = this.process;
    this.process = null;
    this.started = false;

    await new Promise<void>(resolve => {
      const done = () => resolve();
      child.once('exit', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 500);
      setTimeout(done, 900);
    });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.process || !this.started) {
      return Promise.reject(new Error('MCP client is not connected.'));
    }

    const id = this.nextId;
    this.nextId += 1;

    const message: JSONRPCMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 20000);

      this.pending.set(id, { resolve, reject, timeout });
      this.process?.stdin.write(Buffer.concat([header, payload]));
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process || !this.started) {
      return;
    }

    const message: JSONRPCMessage = {
      jsonrpc: '2.0',
      method,
      params
    };

    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
    this.process.stdin.write(Buffer.concat([header, payload]));
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);

    while (true) {
      const sep = this.readBuffer.indexOf('\r\n\r\n');
      if (sep < 0) {
        return;
      }

      const header = this.readBuffer.slice(0, sep).toString('utf8');
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        this.readBuffer = this.readBuffer.slice(sep + 4);
        continue;
      }

      const bodyLength = Number(match[1]);
      const totalLength = sep + 4 + bodyLength;
      if (this.readBuffer.length < totalLength) {
        return;
      }

      const body = this.readBuffer.slice(sep + 4, totalLength).toString('utf8');
      this.readBuffer = this.readBuffer.slice(totalLength);

      try {
        const parsed = JSON.parse(body) as JSONRPCMessage;
        this.handleMessage(parsed);
      } catch {
        // Ignore malformed payloads from child process.
      }
    }
  }

  private handleMessage(message: JSONRPCMessage): void {
    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.error) {
      pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      return;
    }

    pending.resolve(message.result);
  }

  private failPending(reason: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

class MCPHttpClient implements MCPClient {
  private readonly endpoint: string;
  private nextId = 1;
  private started = false;

  constructor(config: MCPServerConfig) {
    this.endpoint = String(config.endpoint ?? '').trim();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (!this.endpoint) {
      throw new Error('http transport requires an endpoint URL.');
    }
    this.started = true;
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'LocalCode',
        version: '0.0.9'
      }
    });
    await this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<ToolListResponse> {
    const result = await this.request('tools/list', {});
    return (result as ToolListResponse) || {};
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
    const result = await this.request('tools/call', {
      name: toolName,
      arguments: args
    });
    return (result as ToolCallResponse) || {};
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    if (!this.started) {
      return;
    }
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params
      } satisfies JSONRPCMessage)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`MCP notify failed (${response.status}): ${body.slice(0, 500)}`);
    }
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.started) {
      throw new Error('MCP client is not connected.');
    }

    const id = this.nextId;
    this.nextId += 1;

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      } satisfies JSONRPCMessage)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`MCP HTTP request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new Error(`MCP HTTP response is not JSON for method ${method}.`);
    }

    const payload = await response.json() as JSONRPCMessage;
    if (payload.error) {
      throw new Error(`MCP error ${payload.error.code}: ${payload.error.message}`);
    }
    return payload.result;
  }
}

class MCPSseClient implements MCPClient {
  private readonly endpoint: string;
  private nextId = 1;
  private started = false;
  private postEndpoint: string | null = null;
  private streamAbort: AbortController | null = null;
  private streamTask: Promise<void> | null = null;
  private sseBuffer = '';
  private endpointReadyResolvers: Array<() => void> = [];
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(config: MCPServerConfig) {
    this.endpoint = String(config.endpoint ?? '').trim();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (!this.endpoint) {
      throw new Error('sse transport requires an endpoint URL.');
    }

    this.streamAbort = new AbortController();
    const response = await fetch(this.endpoint, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream'
      },
      signal: this.streamAbort.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`MCP SSE connection failed (${response.status}).`);
    }

    this.streamTask = this.readSseStream(response.body).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      this.failPending(`MCP SSE stream failed: ${message}`);
    });

    this.started = true;
    await this.waitForPostEndpoint();
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'LocalCode',
        version: '0.0.9'
      }
    });
    await this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<ToolListResponse> {
    const result = await this.request('tools/list', {});
    return (result as ToolListResponse) || {};
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResponse> {
    const result = await this.request('tools/call', {
      name: toolName,
      arguments: args
    });
    return (result as ToolCallResponse) || {};
  }

  async stop(): Promise<void> {
    this.started = false;
    this.failPending('MCP SSE client stopped.');

    if (this.streamAbort) {
      this.streamAbort.abort();
      this.streamAbort = null;
    }
    if (this.streamTask) {
      await this.streamTask.catch(() => undefined);
      this.streamTask = null;
    }
    this.postEndpoint = null;
    this.sseBuffer = '';
  }

  private async waitForPostEndpoint(): Promise<void> {
    if (this.postEndpoint) {
      return;
    }

    // Fall back to standard MCP SSE convention when no explicit endpoint event arrives.
    const endpointUrl = this.endpoint.endsWith('/sse')
      ? `${this.endpoint.slice(0, -4)}/messages`
      : `${this.endpoint.replace(/\/$/, '')}/messages`;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearTimeout(timeout);
        reject(new Error('MCP SSE endpoint event timeout.'));
      }, 5000);

      const done = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.endpointReadyResolvers.push(done);
      if (this.postEndpoint) {
        done();
      }
    }).catch(() => {
      this.postEndpoint = endpointUrl;
    });

    if (!this.postEndpoint) {
      this.postEndpoint = endpointUrl;
    }
  }

  private async notify(method: string, params: unknown): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.waitForPostEndpoint();
    const url = this.postEndpoint;
    if (!url) {
      throw new Error('MCP SSE message endpoint is not available.');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params
      } satisfies JSONRPCMessage)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`MCP SSE notify failed (${response.status}): ${body.slice(0, 500)}`);
    }
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.started) {
      throw new Error('MCP client is not connected.');
    }

    await this.waitForPostEndpoint();
    const url = this.postEndpoint;
    if (!url) {
      throw new Error('MCP SSE message endpoint is not available.');
    }

    const id = this.nextId;
    this.nextId += 1;

    const waiting = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP SSE request timed out: ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timeout });
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      } satisfies JSONRPCMessage)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
      }
      throw new Error(`MCP SSE request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null) as JSONRPCMessage | null;
      if (payload && typeof payload.id === 'number') {
        this.handleMessage(payload);
      }
    }

    return waiting;
  }

  private async readSseStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        this.failPending('MCP SSE stream closed.');
        return;
      }

      this.sseBuffer += decoder.decode(value, { stream: true });
      this.consumeSseBuffer();
    }
  }

  private consumeSseBuffer(): void {
    while (true) {
      const separator = this.sseBuffer.indexOf('\n\n');
      if (separator < 0) {
        return;
      }

      const rawBlock = this.sseBuffer.slice(0, separator);
      this.sseBuffer = this.sseBuffer.slice(separator + 2);

      const lines = rawBlock.replace(/\r/g, '').split('\n');
      let eventName = 'message';
      const dataLines: string[] = [];

      for (const line of lines) {
        if (!line || line.startsWith(':')) {
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
        }
      }

      const payload = dataLines.join('\n').trim();
      if (!payload) {
        continue;
      }

      if (eventName === 'endpoint') {
        try {
          const resolved = new URL(payload, this.endpoint).toString();
          this.postEndpoint = resolved;
          while (this.endpointReadyResolvers.length > 0) {
            const resolve = this.endpointReadyResolvers.shift();
            resolve?.();
          }
        } catch {
          // Ignore invalid endpoint payloads.
        }
        continue;
      }

      try {
        const message = JSON.parse(payload) as JSONRPCMessage;
        this.handleMessage(message);
      } catch {
        // Ignore malformed message payloads.
      }
    }
  }

  private handleMessage(message: JSONRPCMessage): void {
    if (typeof message.id !== 'number') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.error) {
      pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      return;
    }

    pending.resolve(message.result);
  }

  private failPending(reason: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

function createClient(config: MCPServerConfig): MCPClient {
  if (config.transport === 'http') {
    return new MCPHttpClient(config);
  }
  if (config.transport === 'sse') {
    return new MCPSseClient(config);
  }
  return new MCPStdioClient(config);
}

export class MCPServerManager {
  private readonly records = new Map<string, ManagedServerRecord>();
  private readonly toolIndex = new Map<string, MCPToolDescriptor>();

  async configure(servers: MCPServerConfig[]): Promise<void> {
    const nextMap = new Map<string, MCPServerConfig>();
    for (const server of servers) {
      nextMap.set(server.id, server);
    }

    const removed = Array.from(this.records.keys()).filter(id => !nextMap.has(id));
    for (const id of removed) {
      await this.disconnectServer(id);
      this.records.delete(id);
    }

    for (const server of servers) {
      const existing = this.records.get(server.id);
      if (existing) {
        existing.config = server;
        existing.status = {
          ...existing.status,
          label: server.label,
          transport: server.transport,
          updatedAt: nowIso()
        };
      } else {
        this.records.set(server.id, {
          config: server,
          status: emptyStatus(server),
          tools: []
        });
      }
    }

    this.rebuildToolIndex();
  }

  async refreshAll(): Promise<void> {
    for (const id of this.records.keys()) {
      await this.refreshServer(id);
    }
  }

  async refreshServer(serverId: string): Promise<void> {
    const record = this.records.get(serverId);
    if (!record) {
      return;
    }

    record.status = {
      ...record.status,
      lifecycle: 'connecting',
      healthy: false,
      updatedAt: nowIso(),
      lastError: undefined
    };

    await this.disconnectServer(serverId);

    const client = createClient(record.config);

    try {
      await client.start();
      await client.initialize();
      const listed = await client.listTools();
      const rawTools = Array.isArray(listed.tools) ? listed.tools : [];

      const descriptors: MCPToolDescriptor[] = [];
      for (const raw of rawTools) {
        const toolName = String(raw?.name ?? '').trim();
        if (!toolName) {
          continue;
        }

        descriptors.push({
          serverId: record.config.id,
          toolName,
          namespacedToolName: namespacedToolName(record.config.id, toolName),
          description: String(raw?.description ?? '').trim() || `MCP tool ${toolName} from ${record.config.label}`,
          inputSchema: normalizeToolSchema(raw?.inputSchema)
        });
      }

      record.client = client;
      record.tools = descriptors;
      record.status = {
        ...record.status,
        lifecycle: 'connected',
        healthy: true,
        discoveredToolCount: descriptors.length,
        discoveredToolNames: descriptors.map(item => item.namespacedToolName),
        lastError: undefined,
        updatedAt: nowIso()
      };
      this.rebuildToolIndex();
    } catch (error) {
      await client.stop().catch(() => undefined);
      record.client = undefined;
      record.tools = [];
      record.status = {
        ...record.status,
        lifecycle: 'error',
        healthy: false,
        discoveredToolCount: 0,
        discoveredToolNames: [],
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      };
      this.rebuildToolIndex();
    }
  }

  async disconnectServer(serverId: string): Promise<void> {
    const record = this.records.get(serverId);
    if (!record || !record.client) {
      return;
    }

    await record.client.stop().catch(() => undefined);
    record.client = undefined;
    record.tools = [];
    record.status = {
      ...record.status,
      lifecycle: 'disconnected',
      healthy: false,
      discoveredToolCount: 0,
      discoveredToolNames: [],
      updatedAt: nowIso()
    };
    this.rebuildToolIndex();
  }

  async dispose(): Promise<void> {
    const ids = Array.from(this.records.keys());
    for (const id of ids) {
      await this.disconnectServer(id);
    }
  }

  getRuntimeStatus(): MCPServerRuntimeStatus[] {
    return Array.from(this.records.values()).map(record => ({ ...record.status }));
  }

  getToolDefinitionsForTarget(target: MCPServerTarget): ToolDefinition[] {
    const defs: ToolDefinition[] = [];

    for (const record of this.records.values()) {
      const enabled = target === 'chat'
        ? record.config.enabledForChat
        : record.config.enabledForOrchestration;
      if (!enabled) {
        continue;
      }
      if (!record.status.healthy || record.status.lifecycle !== 'connected') {
        continue;
      }

      for (const tool of record.tools) {
        defs.push({
          type: 'function',
          function: {
            name: tool.namespacedToolName,
            description: `[MCP:${record.config.label}] ${tool.description}`,
            parameters: {
              type: 'object',
              properties: tool.inputSchema.properties && typeof tool.inputSchema.properties === 'object'
                ? (tool.inputSchema.properties as Record<string, unknown>)
                : {},
              required: Array.isArray(tool.inputSchema.required)
                ? tool.inputSchema.required.filter(entry => typeof entry === 'string')
                : undefined
            }
          }
        });
      }
    }

    return defs;
  }

  async invokeTool(namespacedTool: string, args: Record<string, unknown>): Promise<unknown> {
    const descriptor = this.toolIndex.get(namespacedTool);
    if (!descriptor) {
      throw new Error(`Unknown MCP tool: ${namespacedTool}`);
    }

    const record = this.records.get(descriptor.serverId);
    if (!record || !record.client) {
      throw new Error(`MCP server ${descriptor.serverId} is not connected.`);
    }

    const result = await record.client.callTool(descriptor.toolName, args);
    return {
      serverId: descriptor.serverId,
      tool: descriptor.toolName,
      namespacedTool,
      result
    };
  }

  private rebuildToolIndex(): void {
    this.toolIndex.clear();
    for (const record of this.records.values()) {
      for (const tool of record.tools) {
        this.toolIndex.set(tool.namespacedToolName, tool);
      }
    }
  }
}
