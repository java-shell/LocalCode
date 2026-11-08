import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { MCPServerManager } from '../backend/mcpServerManager';
import type { MCPServerConfig } from '../shared/types';

interface RpcRequest {
  id?: number;
  method?: string;
  params?: {
    arguments?: {
      text?: string;
    };
  };
}

interface MockHttpServer {
  endpoint: string;
  close: () => Promise<void>;
}

async function readJsonBody(req: IncomingMessage): Promise<RpcRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) as RpcRequest : {};
}

function writeJson(res: ServerResponse, body: unknown, statusCode = 200): void {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(payload);
}

function buildMockRpcResponse(request: RpcRequest): unknown {
  if (request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-http', version: '1.0.0' }
      }
    };
  }

  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes arguments',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' }
              },
              required: ['text']
            }
          }
        ]
      }
    };
  }

  if (request.method === 'tools/call') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: String(request.params?.arguments?.text ?? '')
          }
        ],
        isError: false
      }
    };
  }

  return {
    jsonrpc: '2.0',
    id: request.id,
    error: { code: -32601, message: 'Method not found' }
  };
}

/** Local JSON-RPC fixture; optional observer validates headers for every request phase. */
async function createMockHttpMcpServer(observe?: (req: IncomingMessage, rpc: RpcRequest) => void): Promise<MockHttpServer> {
  const server = createServer(async (req, res) => {
    if (req.url !== '/mcp' || req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const request = await readJsonBody(req);
    observe?.(req, request);
    writeJson(res, buildMockRpcResponse(request));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind HTTP MCP mock server.');
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}

async function createMockSseMcpServer(): Promise<MockHttpServer> {
  let sseResponse: ServerResponse | null = null;

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/sse') {
      sseResponse = res;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      res.write('event: endpoint\n');
      res.write('data: /messages\n\n');
      return;
    }

    if (req.method === 'POST' && req.url === '/messages') {
      const request = await readJsonBody(req);
      const responseBody = buildMockRpcResponse(request);
      if (typeof request.id === 'number' && sseResponse) {
        sseResponse.write('event: message\n');
        sseResponse.write(`data: ${JSON.stringify(responseBody)}\n\n`);
      }
      res.statusCode = 202;
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind SSE MCP mock server.');
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/sse`,
    close: () => new Promise<void>(resolve => {
      if (sseResponse) {
        sseResponse.end();
      }
      server.close(() => resolve());
    })
  };
}

function buildMockMcpServerScript(): string {
  return `
let buffer = Buffer.alloc(0);

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write('Content-Length: ' + payload.length + '\\r\\n\\r\\n');
  process.stdout.write(payload);
}

function handle(message) {
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp', version: '1.0.0' }
      }
    });
    return;
  }

  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes arguments',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' }
              },
              required: ['text']
            }
          }
        ]
      }
    });
    return;
  }

  if (message.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: String(message.params?.arguments?.text ?? '')
          }
        ],
        isError: false
      }
    });
    return;
  }

  if (typeof message.id === 'number') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not found' }
    });
  }
}

function parse() {
  while (true) {
    const sep = buffer.indexOf('\\r\\n\\r\\n');
    if (sep < 0) return;
    const header = buffer.slice(0, sep).toString('utf8');
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(sep + 4);
      continue;
    }
    const bodyLength = Number(match[1]);
    const total = sep + 4 + bodyLength;
    if (buffer.length < total) return;
    const body = buffer.slice(sep + 4, total).toString('utf8');
    buffer = buffer.slice(total);
    const message = JSON.parse(body);
    handle(message);
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  parse();
});
`;
}

test('MCPServerManager connects stdio server, discovers tools, and invokes tool calls', async () => {
  const manager = new MCPServerManager();
  const script = buildMockMcpServerScript();

  await manager.configure([
    {
      id: 'mock-server',
      label: 'Mock Server',
      transport: 'stdio',
      enabledForChat: true,
      enabledForOrchestration: true,
      command: process.execPath,
      args: ['-e', script]
    }
  ]);

  await manager.refreshAll();

  const runtime = manager.getRuntimeStatus();
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0].lifecycle, 'connected');
  assert.equal(runtime[0].healthy, true);
  assert.equal(runtime[0].discoveredToolCount, 1);

  const defs = manager.getToolDefinitionsForTarget('chat');
  assert.equal(defs.length, 1);
  assert.match(defs[0].function.name, /^mcp_mock_server__echo$/);

  const output = await manager.invokeTool(defs[0].function.name, { text: 'hello' }) as {
    result?: {
      content?: Array<{ text?: string }>;
    };
  };

  const contentText = output.result?.content?.[0]?.text;
  assert.equal(contentText, 'hello');

  await manager.dispose();
});

test('MCPServerManager connects HTTP transport, discovers tools, and invokes tool calls', async () => {
  const manager = new MCPServerManager();
  const mock = await createMockHttpMcpServer();

  try {
    await manager.configure([
      {
        id: 'remote-http',
        label: 'Remote HTTP',
        transport: 'http',
        enabledForChat: true,
        enabledForOrchestration: true,
        endpoint: mock.endpoint
      }
    ]);

    await manager.refreshAll();

    const runtime = manager.getRuntimeStatus();
    assert.equal(runtime.length, 1);
    assert.equal(runtime[0].lifecycle, 'connected');
    assert.equal(runtime[0].healthy, true);
    assert.equal(runtime[0].discoveredToolCount, 1);

    const defs = manager.getToolDefinitionsForTarget('chat');
    assert.equal(defs.length, 1);
    assert.equal(defs[0].function.name, 'mcp_remote_http__echo');

    const output = await manager.invokeTool(defs[0].function.name, { text: 'hello-http' }) as {
      result?: {
        content?: Array<{ text?: string }>;
      };
    };

    assert.equal(output.result?.content?.[0]?.text, 'hello-http');
  } finally {
    await manager.dispose();
    await mock.close();
  }
});

test('MCPServerManager connects SSE transport, discovers tools, and invokes tool calls', async () => {
  const manager = new MCPServerManager();
  const mock = await createMockSseMcpServer();

  try {
    await manager.configure([
      {
        id: 'remote-sse',
        label: 'Remote SSE',
        transport: 'sse',
        enabledForChat: true,
        enabledForOrchestration: true,
        endpoint: mock.endpoint
      }
    ]);

    await manager.refreshAll();

    const runtime = manager.getRuntimeStatus();
    assert.equal(runtime.length, 1);
    assert.equal(runtime[0].lifecycle, 'connected');
    assert.equal(runtime[0].healthy, true);
    assert.equal(runtime[0].discoveredToolCount, 1);

    const defs = manager.getToolDefinitionsForTarget('chat');
    assert.equal(defs.length, 1);
    assert.equal(defs[0].function.name, 'mcp_remote_sse__echo');

    const output = await manager.invokeTool(defs[0].function.name, { text: 'hello-sse' }) as {
      result?: {
        content?: Array<{ text?: string }>;
      };
    };

    assert.equal(output.result?.content?.[0]?.text, 'hello-sse');
  } finally {
    await manager.dispose();
    await mock.close();
  }
});

/** Verify authenticated request/notification phases, reconfiguration, clearing, and workflow targeting. */
test('HTTP custom headers reach every RPC phase and change or clear after settings refresh', async () => {
  const observed: Array<{ method?: string; authorization?: string; tenant?: string; accept?: string; contentType?: string }> = [];
  const mock = await createMockHttpMcpServer((req, rpc) => observed.push({
    method: rpc.method,
    authorization: req.headers.authorization,
    tenant: req.headers['x-tenant'] as string | undefined,
    accept: req.headers.accept,
    contentType: req.headers['content-type']
  }));
  const manager = new MCPServerManager();
  const config: MCPServerConfig = {
    id: 'headers-http', label: 'Headers HTTP', transport: 'http', endpoint: mock.endpoint,
    enabledForChat: true, enabledForOrchestration: true,
    headers: { Authorization: 'Bearer test-token', 'X-Tenant': 'test-tenant', Accept: 'application/json' }
  };
  try {
    await manager.configure([config]);
    await manager.refreshAll();
    assert.equal(manager.getRuntimeStatus()[0].lifecycle, 'connected');
    const tool = manager.getToolDefinitionsForTarget('chat')[0].function.name;
    assert.equal(manager.getToolDefinitionsForTarget('orchestration')[0].function.name, tool);
    await manager.invokeTool(tool, { text: 'authenticated' });
    assert.deepEqual(observed.map(item => item.method), [
      'initialize', 'notifications/initialized', 'tools/list', 'tools/call'
    ]);
    for (const item of observed) {
      assert.equal(item.authorization, 'Bearer test-token');
      assert.equal(item.tenant, 'test-tenant');
      assert.equal(item.accept, 'application/json');
      assert.equal(item.contentType, 'application/json');
    }
    observed.length = 0;
    await manager.configure([{ ...config, headers: { Authorization: 'Bearer rotated-token' } }]);
    await manager.refreshAll();
    await manager.invokeTool(tool, { text: 'rotated' });
    assert.equal(observed.length, 4);
    assert.ok(observed.every(item => item.authorization === 'Bearer rotated-token' && !item.tenant));
    observed.length = 0;
    await manager.configure([{ ...config, headers: {} }]);
    await manager.refreshAll();
    await manager.invokeTool(tool, { text: 'cleared' });
    assert.equal(observed.length, 4);
    assert.ok(observed.every(item => !item.authorization && !item.tenant));
    assert.ok(observed.every(item => item.accept === 'application/json, text/event-stream'));
  } finally {
    await manager.dispose();
    await mock.close();
  }
});

/** Exercise validation before I/O and value-free status errors with a deliberately invalid test token. */
test('HTTP invalid headers fail safely before sending a request', async () => {
  let requests = 0;
  const mock = await createMockHttpMcpServer(() => { requests += 1; });
  const manager = new MCPServerManager();
  try {
    await manager.configure([{
      id: 'invalid', label: 'Invalid', transport: 'http', endpoint: mock.endpoint,
      enabledForChat: true, enabledForOrchestration: true,
      headers: { Authorization: 'test-secret\r\nX-Injected: yes' }
    }]);
    await manager.refreshAll();
    const status = manager.getRuntimeStatus()[0];
    assert.equal(status.lifecycle, 'error');
    assert.match(status.lastError || '', /invalid name or value/);
    assert.doesNotMatch(JSON.stringify(status), /test-secret|X-Injected/);
    assert.equal(requests, 0);
  } finally {
    await manager.dispose();
    await mock.close();
  }
});

/** Local hostile endpoint fixture; ensure credential echoes/redirects do not escape into status or another origin. */
test('HTTP credential headers block redirects and keep remote error bodies out of runtime status', async () => {
  let mode: 'http-error' | 'rpc-error' | 'invalid-json' | 'redirect' = 'http-error';
  let forwarded = 0;
  const destination = createServer((_req, res) => { forwarded += 1; res.end(); });
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve));
  const destAddress = destination.address();
  assert.ok(destAddress && typeof destAddress !== 'string');
  const server = createServer(async (req, res) => {
    const rpc = await readJsonBody(req);
    const secret = String(req.headers['x-api-key']);
    if (mode === 'redirect') {
      res.writeHead(307, { location: `http://127.0.0.1:${destAddress.port}/leak` });
      res.end();
    } else if (mode === 'rpc-error') {
      writeJson(res, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: secret } });
    } else if (mode === 'invalid-json') {
      res.setHeader('content-type', 'application/json');
      res.end(`invalid-json ${secret}`);
    } else {
      res.statusCode = 401;
      res.end(secret);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const manager = new MCPServerManager();
  try {
    await manager.configure([{
      id: 'private', label: 'Private', transport: 'http', endpoint: `http://127.0.0.1:${address.port}/mcp`,
      enabledForChat: true, enabledForOrchestration: true, headers: { 'X-API-Key': 'test-private-key' }
    }]);
    for (const nextMode of ['http-error', 'rpc-error', 'invalid-json', 'redirect'] as const) {
      mode = nextMode;
      await manager.refreshAll();
      assert.equal(manager.getRuntimeStatus()[0].lifecycle, 'error');
      assert.doesNotMatch(JSON.stringify(manager.getRuntimeStatus()), /test-private-key/);
    }
    assert.equal(forwarded, 0);
  } finally {
    await manager.dispose();
    await Promise.all([
      new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => destination.close(() => resolve()))
    ]);
  }
});
