import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../backend/toolRuntime';

/**
 * Validate list_mcp_servers tool with populated runtime context.
 *
 * Purpose: ensure MCP server settings are visible to model workflows.
 * Inputs: runtime context containing two MCP server records.
 * Outputs: structured MCP server list with expected count and IDs.
 */
test('list_mcp_servers returns configured runtime MCP servers', async () => {
  const result = await executeTool('list_mcp_servers', {}, {
    workspaceDir: '/mock/workspace',
    rootDir: '/mock/workspace',
    mcpServers: [
      {
        id: 'fs-server',
        label: 'Filesystem MCP',
        transport: 'stdio',
        enabledForChat: true,
        enabledForOrchestration: true,
        command: 'npx',
        args: ['@modelcontextprotocol/server-filesystem', '/mock/workspace']
      },
      {
        id: 'search-server',
        label: 'Search MCP',
        transport: 'sse',
        enabledForChat: true,
        enabledForOrchestration: false,
        endpoint: 'http://localhost:3123/sse'
      }
    ]
  } as any) as {
    count: number;
    servers: Array<{ id: string; transport: string }>;
  };

  assert.equal(result.count, 2);
  assert.equal(result.servers[0].id, 'fs-server');
  assert.equal(result.servers[1].id, 'search-server');
  assert.equal(result.servers[1].transport, 'sse');
});

/**
 * Validate list_mcp_servers tool with no configured servers.
 *
 * Purpose: ensure safe behavior when no MCP servers are configured.
 * Inputs: runtime context without `mcpServers`.
 * Outputs: empty list and zero count.
 */
test('list_mcp_servers returns an empty list when no servers are configured', async () => {
  const result = await executeTool('list_mcp_servers', {}, {
    workspaceDir: '/mock/workspace',
    rootDir: '/mock/workspace'
  } as any) as {
    count: number;
    servers: Array<unknown>;
  };

  assert.equal(result.count, 0);
  assert.deepEqual(result.servers, []);
});
