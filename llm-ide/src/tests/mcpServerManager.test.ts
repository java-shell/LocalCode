import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { MCPServerManager } from '../backend/mcpServerManager';

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

async function createMockHttpMcpServer(): Promise<MockHttpServer> {
  const server = createServer(async (req, res) => {
    if (req.url !== '/mcp' || req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const request = await readJsonBody(req);
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
