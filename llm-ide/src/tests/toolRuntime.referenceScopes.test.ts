import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { executeTool, getAllowedToolDefinitions } from '../backend/toolRuntime';

/**
 * Build a runtime context with a single reference workspace for scope-schema tests.
 *
 * Purpose: keep setup concise and deterministic across tests.
 * Inputs: absolute reference workspace path and optional write-approval callback.
 * Outputs: runtime context object accepted by tool runtime.
 */
function contextWithReference(
  referencePath: string,
  requestReferenceWriteApproval?: (payload: {
    tool: string;
    summary: string;
    referenceLabel: string;
    targets: string[];
  }) => Promise<boolean>
) {
  return {
    workspaceDir: referencePath,
    rootDir: referencePath,
    referenceWorkspaces: [
      {
        id: 'ref_test',
        label: 'Reference Fixture',
        path: referencePath,
        allowWrite: false
      }
    ],
    requestReferenceWriteApproval
  };
}

test('getAllowedToolDefinitions only rewrites workspace scope properties', () => {
  const context = {
    workspaceDir: '/tmp/workspace',
    rootDir: '/tmp/root',
    referenceWorkspaces: [
      {
        id: 'ref_123',
        label: 'Reference One',
        path: '/tmp/ref-one',
        allowWrite: false
      }
    ]
  };

  const defs = getAllowedToolDefinitions(['read_file', 'list_namespaces'], context as any);
  const readFile = defs.find(def => def.function.name === 'read_file');
  const listNamespaces = defs.find(def => def.function.name === 'list_namespaces');

  const readFileScopeEnum = (readFile?.function.parameters.properties as { scope?: { enum?: string[] } })
    .scope?.enum ?? [];
  const namespaceScopeEnum = (listNamespaces?.function.parameters.properties as { scope?: { enum?: string[] } })
    .scope?.enum ?? [];

  assert.deepEqual(readFileScopeEnum, ['workspace', 'root', 'ref:ref_123']);
  assert.deepEqual(namespaceScopeEnum, ['all', 'global', 'workspace']);
});

test('list_reference_workspaces returns scope IDs and metadata', async () => {
  const context = {
    workspaceDir: '/tmp/workspace',
    rootDir: '/tmp/root',
    referenceWorkspaces: [
      {
        id: 'ref_one',
        label: 'Reference One',
        path: '/tmp/reference-one',
        allowWrite: false
      },
      {
        id: 'ref_two',
        label: 'Reference Two',
        path: '/tmp/reference-two',
        allowWrite: true
      }
    ]
  };

  const result = await executeTool('list_reference_workspaces', {}, context as any) as {
    count: number;
    referenceWorkspaces: Array<{ scope: string; label: string; allowWrite: boolean }>;
  };

  assert.equal(result.count, 2);
  assert.deepEqual(
    result.referenceWorkspaces.map(item => item.scope),
    ['ref:ref_one', 'ref:ref_two']
  );
  assert.deepEqual(
    result.referenceWorkspaces.map(item => item.allowWrite),
    [false, true]
  );
});

test('executeTool blocks writes to read-only reference workspace without approval', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-deny-'));
  const approvals: Array<{ tool: string; referenceLabel: string; targets: string[] }> = [];

  const context = contextWithReference(base, async payload => {
    approvals.push({
      tool: payload.tool,
      referenceLabel: payload.referenceLabel,
      targets: [...payload.targets]
    });
    return false;
  });

  await assert.rejects(
    executeTool(
      'create_file',
      { path: 'denied.txt', content: 'x', scope: 'ref:ref_test' },
      context as any
    ),
    /write to read-only reference workspace/i
  );

  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].tool, 'create_file');
  assert.equal(approvals[0].referenceLabel, 'Reference Fixture');
  assert.ok(approvals[0].targets[0].endsWith(path.join(path.basename(base), 'denied.txt')) || approvals[0].targets[0].endsWith('denied.txt'));
});

test('executeTool allows writes to read-only reference workspace after approval', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-allow-'));
  let approvalCount = 0;

  const context = contextWithReference(base, async () => {
    approvalCount += 1;
    return true;
  });

  const result = await executeTool(
    'create_file',
    { path: 'approved.txt', content: 'ok', scope: 'ref:ref_test' },
    context as any
  ) as { created?: boolean };

  const createdPath = path.join(base, 'approved.txt');
  const content = await fs.readFile(createdPath, 'utf8');

  assert.equal(approvalCount, 1);
  assert.equal(result.created, true);
  assert.equal(content, 'ok');
});
