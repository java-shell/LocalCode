import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, getAllowedToolDefinitions } from '../backend/toolRuntime';
import type { ToolDefinition } from '../shared/types';

/**
 * Verify dynamic MCP tool definitions are included in allowlisted tool output.
 *
 * Purpose: ensure runtime-discovered MCP tools are surfaced to the model.
 * Inputs: synthetic MCP tool definition injected via runtime context.
 * Outputs: filtered tool definitions containing the injected MCP tool name.
 */
test('getAllowedToolDefinitions includes dynamic MCP tool definitions from runtime context', () => {
  const mcpToolDef: ToolDefinition = {
    type: 'function',
    function: {
      name: 'mcp_demo__inspect',
      description: 'Demo MCP tool',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      }
    }
  };

  const defs = getAllowedToolDefinitions(['mcp_demo__inspect'], {
    workspaceDir: '/mock/workspace',
    rootDir: '/mock/workspace',
    mcpToolDefinitions: [mcpToolDef]
  } as any);

  assert.equal(defs.length, 1);
  assert.equal(defs[0].function.name, 'mcp_demo__inspect');
});

/**
 * Verify unknown tool names are routed through MCP invocation callback.
 *
 * Purpose: ensure executeTool can dispatch dynamically discovered MCP tools.
 * Inputs: unknown tool name and runtime context with invokeMcpTool callback.
 * Outputs: callback result payload returned by executeTool.
 */
test('executeTool dispatches unknown tool names through invokeMcpTool callback', async () => {
  const result = await executeTool(
    'mcp_demo__inspect',
    { path: 'src/main.ts' },
    {
      workspaceDir: '/mock/workspace',
      rootDir: '/mock/workspace',
      invokeMcpTool: async (toolName: string, args: Record<string, unknown>) => ({
        ok: true,
        toolName,
        args
      })
    } as any
  ) as { ok: boolean; toolName: string; args: Record<string, unknown> };

  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'mcp_demo__inspect');
  assert.equal(result.args.path, 'src/main.ts');
});
