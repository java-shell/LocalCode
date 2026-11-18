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

/**
 * Build a runtime context whose workspace directory is *separate* from the reference
 * workspace path, recording every approval prompt the tool runtime raises.
 *
 * Purpose: exercise the real topology (a reference always lives outside the workspace)
 * so out-of-workspace gating cannot be masked by a conflated fixture path.
 * Inputs: reference path, allowWrite flag, optional decisions for each approval type.
 * Outputs: runtime context plus the recorded approval event lists.
 * Side effects: none; callbacks only append to the returned arrays.
 * Errors: none.
 * Performance: O(1).
 * Security: asserts which gate fires, which is the behaviour under test.
 * Concurrency: callbacks resolve immediately.
 * Rationale: the existing fixture uses workspaceDir === reference path, which made the
 * double-gating bug invisible.
 */
function contextWithSeparateReference(
  referencePath: string,
  allowWrite: boolean,
  decisions: { outside?: boolean; reference?: boolean } = {}
) {
  const outsideApprovals: Array<{ tool: string; targets: string[] }> = [];
  const referenceApprovals: Array<{ tool: string; referenceLabel: string; targets: string[] }> = [];

  const context = {
    workspaceDir: path.join(referencePath, '..', 'workspace-side'),
    rootDir: path.join(referencePath, '..', 'workspace-side'),
    referenceWorkspaces: [
      {
        id: 'ref_rw',
        label: allowWrite ? 'Writable Reference' : 'Read-Only Reference',
        path: referencePath,
        allowWrite
      }
    ],
    requestOutsideWorkspaceApproval: async (payload: { tool: string; targets: string[] }) => {
      outsideApprovals.push({ tool: payload.tool, targets: [...payload.targets] });
      return decisions.outside ?? true;
    },
    requestReferenceWriteApproval: async (payload: {
      tool: string;
      referenceLabel: string;
      targets: string[];
    }) => {
      referenceApprovals.push({
        tool: payload.tool,
        referenceLabel: payload.referenceLabel,
        targets: [...payload.targets]
      });
      return decisions.reference ?? true;
    }
  };

  return { context, outsideApprovals, referenceApprovals };
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

test('writable reference workspace mutations are not gated as out-of-workspace writes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-rw-'));
  const { context, outsideApprovals, referenceApprovals } = contextWithSeparateReference(base, true);

  await fs.writeFile(path.join(base, 'seed.txt'), 'hello world\n', 'utf8');

  const replace = await executeTool(
    'replace_in_file',
    { path: 'seed.txt', oldText: 'hello', newText: 'goodbye', scope: 'ref:ref_rw' },
    context as any
  ) as { replacements?: number };

  const write = await executeTool(
    'write_file',
    { path: 'notes/written.txt', content: 'written', scope: 'ref:ref_rw' },
    context as any
  ) as { written?: boolean };

  const create = await executeTool(
    'create_file',
    { path: 'created.txt', content: 'created', scope: 'ref:ref_rw' },
    context as any
  ) as { created?: boolean };

  const insert = await executeTool(
    'insert_in_file',
    { path: 'seed.txt', line: 1, text: 'inserted', scope: 'ref:ref_rw' },
    context as any
  ) as { inserted?: boolean };

  const dir = await executeTool(
    'create_directory',
    { path: 'new-dir', scope: 'ref:ref_rw' },
    context as any
  ) as { created?: boolean };

  const move = await executeTool(
    'move_path',
    { from: 'created.txt', to: 'moved.txt', scope: 'ref:ref_rw' },
    context as any
  ) as { moved?: boolean };

  const remove = await executeTool(
    'delete_path',
    { path: 'moved.txt', scope: 'ref:ref_rw' },
    context as any
  ) as { deleted?: boolean };

  assert.equal(replace.replacements, 1);
  assert.equal(write.written, true);
  assert.equal(create.created, true);
  assert.equal(insert.inserted, true);
  assert.equal(dir.created, true);
  assert.equal(move.moved, true);
  assert.equal(remove.deleted, true);

  assert.deepEqual(outsideApprovals, []);
  assert.deepEqual(referenceApprovals, []);

  assert.equal(await fs.readFile(path.join(base, 'seed.txt'), 'utf8'), 'inserted\ngoodbye world\n');
  assert.equal(await fs.readFile(path.join(base, 'notes', 'written.txt'), 'utf8'), 'written');
  assert.ok(await fs.stat(path.join(base, 'new-dir')));
  assert.equal(await fs.stat(path.join(base, 'moved.txt')).catch(() => null), null);
});

test('writable reference workspace writes succeed with no approval callbacks configured', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-rw-silent-'));
  const context = {
    workspaceDir: path.join(base, '..', 'workspace-side'),
    rootDir: path.join(base, '..', 'workspace-side'),
    referenceWorkspaces: [{ id: 'ref_rw', label: 'Writable Reference', path: base, allowWrite: true }]
  };

  await fs.writeFile(path.join(base, 'seed.txt'), 'hello world\n', 'utf8');

  const result = await executeTool(
    'replace_in_file',
    { path: 'seed.txt', oldText: 'hello', newText: 'goodbye', scope: 'ref:ref_rw' },
    context as any
  ).catch((error: unknown) => error);

  assert.equal(
    result instanceof Error,
    false,
    `writable reference write must not require approval: ${String(result)}`
  );
});

test('read-only reference workspace writes prompt once, never as out-of-workspace writes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-ro-'));
  const { context, outsideApprovals, referenceApprovals } = contextWithSeparateReference(base, false);

  await fs.writeFile(path.join(base, 'seed.txt'), 'hello world\n', 'utf8');

  const result = await executeTool(
    'replace_in_file',
    { path: 'seed.txt', oldText: 'hello', newText: 'goodbye', scope: 'ref:ref_rw' },
    context as any
  ) as { replacements?: number };

  assert.equal(result.replacements, 1);
  assert.deepEqual(outsideApprovals, []);
  assert.equal(referenceApprovals.length, 1);
  assert.equal(referenceApprovals[0].tool, 'replace_in_file');
  assert.equal(referenceApprovals[0].referenceLabel, 'Read-Only Reference');
});

test('read-only reference workspace denial still blocks the write', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-ro-deny-'));
  const { context, outsideApprovals, referenceApprovals } = contextWithSeparateReference(
    base,
    false,
    { reference: false }
  );

  await assert.rejects(
    executeTool(
      'write_file',
      { path: 'denied.txt', content: 'x', scope: 'ref:ref_rw' },
      context as any
    ),
    /write to read-only reference workspace/i
  );

  assert.equal(referenceApprovals.length, 1);
  assert.deepEqual(outsideApprovals, []);
  assert.equal(await fs.stat(path.join(base, 'denied.txt')).catch(() => null), null);
});

test('reference scoped paths escaping the reference base are still rejected', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-escape-'));
  const { context, outsideApprovals, referenceApprovals } = contextWithSeparateReference(base, true);

  await assert.rejects(
    executeTool(
      'write_file',
      { path: '../escaped.txt', content: 'x', scope: 'ref:ref_rw' },
      context as any
    ),
    /must stay inside ref:ref_rw scope/i
  );

  assert.deepEqual(outsideApprovals, []);
  assert.deepEqual(referenceApprovals, []);
  assert.equal(await fs.stat(path.join(base, '..', 'escaped.txt')).catch(() => null), null);
});

test('mutations that escape the workspace still require out-of-workspace approval', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-outside-'));
  const workspaceDir = path.join(base, 'workspace');
  await fs.mkdir(workspaceDir, { recursive: true });

  const outsideApprovals: Array<{ tool: string; targets: string[] }> = [];
  const context = {
    workspaceDir,
    rootDir: base,
    requestOutsideWorkspaceApproval: async (payload: { tool: string; targets: string[] }) => {
      outsideApprovals.push({ tool: payload.tool, targets: [...payload.targets] });
      return true;
    }
  };

  // root scope resolves against rootDir, so this target sits outside workspaceDir.
  const result = await executeTool(
    'write_file',
    { path: 'outside.txt', content: 'x', scope: 'root' },
    context as any
  ) as { written?: boolean };

  assert.equal(result.written, true);
  assert.equal(outsideApprovals.length, 1);
  assert.equal(outsideApprovals[0].tool, 'write_file');
  assert.equal(await fs.readFile(path.join(base, 'outside.txt'), 'utf8'), 'x');
});

test('mutations inside the workspace need no approval', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-inside-'));
  const workspaceDir = path.join(base, 'workspace');
  await fs.mkdir(workspaceDir, { recursive: true });

  let outsideApprovalCount = 0;
  const context = {
    workspaceDir,
    rootDir: base,
    requestOutsideWorkspaceApproval: async () => {
      outsideApprovalCount += 1;
      return true;
    }
  };

  const result = await executeTool(
    'write_file',
    { path: 'inside.txt', content: 'x', scope: 'workspace' },
    context as any
  ) as { written?: boolean };

  assert.equal(result.written, true);
  assert.equal(outsideApprovalCount, 0);
  assert.equal(await fs.readFile(path.join(workspaceDir, 'inside.txt'), 'utf8'), 'x');
});

test('workspace scoped escapes are blocked when the user denies approval', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-outside-deny-'));
  const workspaceDir = path.join(base, 'workspace');
  await fs.mkdir(workspaceDir, { recursive: true });

  const context = {
    workspaceDir,
    rootDir: base,
    requestOutsideWorkspaceApproval: async () => false
  };

  await assert.rejects(
    executeTool(
      'write_file',
      { path: '../outside.txt', content: 'x', scope: 'workspace' },
      context as any
    ),
    /file mutation outside workspace requires user approval/i
  );

  assert.equal(await fs.stat(path.join(base, 'outside.txt')).catch(() => null), null);
});

test('unknown reference scope is still rejected for mutations', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'localcode-ref-unknown-'));
  const { context, outsideApprovals } = contextWithSeparateReference(base, true);

  await assert.rejects(
    executeTool(
      'write_file',
      { path: 'file.txt', content: 'x', scope: 'ref:does_not_exist' },
      context as any
    ),
    /unknown scope/i
  );

  assert.deepEqual(outsideApprovals, []);
});
