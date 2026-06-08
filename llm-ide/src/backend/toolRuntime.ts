import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit from 'simple-git';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { ToolDefinition } from '../shared/types';

interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
  onTerminalOutput?: (payload: { source: 'stdout' | 'stderr'; text: string }) => void;
  onTerminalEvent?: (payload: { type: 'start' | 'end'; command: string; cwd: string; code?: number | null; signal?: string | null }) => void;
  setActiveTerminalProcess?: (child: ChildProcessWithoutNullStreams | null) => void;
  requestOutsideWorkspaceApproval?: (payload: {
    tool: string;
    summary: string;
    targets: string[];
  }) => Promise<boolean>;
}

type ToolScope = 'workspace' | 'root';

function defaultRootDir(): string {
  return process.cwd();
}

function effectiveContext(context?: RuntimeContext): RuntimeContext {
  const root = context?.rootDir || defaultRootDir();
  return {
    workspaceDir: context?.workspaceDir || root,
    rootDir: root
  };
}

function parseScope(args: Record<string, unknown>): ToolScope {
  return String(args.scope ?? 'workspace').toLowerCase() === 'root' ? 'root' : 'workspace';
}

function scopeBaseDir(scope: ToolScope, context?: RuntimeContext): string {
  const ctx = effectiveContext(context);
  return scope === 'root' ? ctx.rootDir : ctx.workspaceDir;
}

function resolveScopedPath(inputPath: string, scope: ToolScope, context?: RuntimeContext): string {
  const base = scopeBaseDir(scope, context);
  const resolved = path.resolve(base, inputPath || '.');
  const relative = path.relative(base, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path must stay inside ${scope} scope.`);
  }
  return resolved;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

const scopeProperty = { type: 'string', enum: ['workspace', 'root'] };

const mutatingTools = new Set([
  'create_file',
  'write_file',
  'replace_in_file',
  'insert_in_file',
  'create_directory',
  'move_path',
  'delete_path'
]);

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders under a path in workspace or root scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: scopeProperty }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'file_search',
      description: 'Find files whose relative path includes query string in selected scope.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, maxResults: { type: 'number' }, scope: scopeProperty },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents by relative path and optional line range.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          scope: scopeProperty
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file only if it does not already exist.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' }, scope: scopeProperty },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write full content to a file in selected scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' }, scope: scopeProperty },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Replace text in file. Enforces single match unless allOccurrences=true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          oldText: { type: 'string' },
          newText: { type: 'string' },
          allOccurrences: { type: 'boolean' },
          scope: scopeProperty
        },
        required: ['path', 'oldText', 'newText']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'insert_in_file',
      description: 'Insert text at a specific 0-based line index.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          text: { type: 'string' },
          scope: scopeProperty
        },
        required: ['path', 'line', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create directory recursively in selected scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: scopeProperty },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_path',
      description: 'Move or rename a file/directory in selected scope.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, scope: scopeProperty },
        required: ['from', 'to']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Delete file or directory recursively in selected scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: scopeProperty },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Regex search across text files in selected scope.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, maxResults: { type: 'number' }, scope: scopeProperty },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Get git status in selected scope base directory.',
      parameters: {
        type: 'object',
        properties: { scope: scopeProperty }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Get git diff, optionally for path in selected scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, scope: scopeProperty }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_add',
      description: 'Stage one file or all changes in selected scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, all: { type: 'boolean' }, scope: scopeProperty }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Create git commit with message in selected scope.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' }, scope: scopeProperty },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: 'Execute a shell command inside selected scope (optionally in subdirectory).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          cwd: { type: 'string' },
          timeoutMs: { type: 'number' },
          scope: scopeProperty
        },
        required: ['command']
      }
    }
  }
];

export function getAllowedToolDefinitions(names: string[]): ToolDefinition[] {
  const allowed = new Set(names);
  return toolDefinitions.filter(tool => allowed.has(tool.function.name));
}

function insideDir(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return !(relative.startsWith('..') || path.isAbsolute(relative));
}

function toolTargetInputs(name: string, args: Record<string, unknown>): string[] {
  switch (name) {
    case 'create_file':
    case 'write_file':
    case 'replace_in_file':
    case 'insert_in_file':
    case 'create_directory':
    case 'delete_path':
      return [String(args.path ?? '')].filter(Boolean);
    case 'move_path':
      return [String(args.from ?? ''), String(args.to ?? '')].filter(Boolean);
    default:
      return [];
  }
}

function toolIntentSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'create_file':
      return `create file ${String(args.path ?? '')}`;
    case 'write_file':
      return `overwrite file ${String(args.path ?? '')}`;
    case 'replace_in_file':
      return `replace text in ${String(args.path ?? '')}`;
    case 'insert_in_file':
      return `insert text into ${String(args.path ?? '')} at line ${String(args.line ?? 0)}`;
    case 'create_directory':
      return `create directory ${String(args.path ?? '')}`;
    case 'move_path':
      return `move ${String(args.from ?? '')} to ${String(args.to ?? '')}`;
    case 'delete_path':
      return `delete ${String(args.path ?? '')}`;
    default:
      return name;
  }
}

async function enforceWorkspaceMutationApproval(
  name: string,
  args: Record<string, unknown>,
  context?: RuntimeContext
): Promise<Record<string, unknown>> {
  if (!mutatingTools.has(name) || !context) {
    return args;
  }

  const targetInputs = toolTargetInputs(name, args);
  if (!targetInputs.length) {
    return args;
  }

  const scope = parseScope(args);
  const scopeBase = scopeBaseDir(scope, context);
  const absoluteTargets = targetInputs.map(input => {
    try {
      return resolveScopedPath(input, scope, context);
    } catch {
      return path.resolve(scopeBase, input || '.');
    }
  });
  const outsideTargets = absoluteTargets.filter(target => !insideDir(context.workspaceDir, target));
  if (!outsideTargets.length) {
    return args;
  }

  const approved = await context.requestOutsideWorkspaceApproval?.({
    tool: name,
    summary: toolIntentSummary(name, args),
    targets: outsideTargets
  });

  if (!approved) {
    throw new Error('Blocked: file mutation outside workspace requires user approval.');
  }

  if (scope === 'workspace') {
    return { ...args, scope: 'root' };
  }

  return args;
}

async function listDir(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const target = resolveScopedPath(String(args.path ?? '.'), scope, context);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' }));
}

async function fileSearch(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const base = scopeBaseDir(scope, context);
  const query = String(args.query ?? '').toLowerCase();
  const maxResults = Math.max(1, Math.min(500, Number(args.maxResults ?? 100)));
  const matches: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        return;
      }
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'out') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const relative = path.relative(base, full);
      if (relative.toLowerCase().includes(query)) {
        matches.push(relative);
      }
    }
  }

  await walk(base);
  return matches;
}

async function readFile(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const target = resolveScopedPath(String(args.path ?? ''), scope, context);
  const content = await fs.readFile(target, 'utf8');
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, Number(args.startLine ?? 1));
  const end = Math.min(lines.length, Number(args.endLine ?? Math.min(lines.length, start + 300)));
  return {
    path: String(args.path ?? ''),
    startLine: start,
    endLine: end,
    content: lines.slice(start - 1, end).join('\n')
  };
}

async function writeFile(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const target = resolveScopedPath(String(args.path ?? ''), scope, context);
  const content = String(args.content ?? '');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return { path: String(args.path ?? ''), written: true, bytes: Buffer.byteLength(content, 'utf8') };
}

async function createFile(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const workspacePath = String(args.path ?? '');
  const target = resolveScopedPath(workspacePath, scope, context);
  if (await pathExists(target)) {
    throw new Error(`File already exists: ${workspacePath}`);
  }
  const content = String(args.content ?? '');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return { path: workspacePath, created: true, bytes: Buffer.byteLength(content, 'utf8') };
}

async function replaceInFile(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const workspacePath = String(args.path ?? '');
  const target = resolveScopedPath(workspacePath, scope, context);
  const oldText = String(args.oldText ?? '');
  const newText = String(args.newText ?? '');
  const allOccurrences = Boolean(args.allOccurrences ?? false);
  const content = await fs.readFile(target, 'utf8');

  if (!oldText) {
    throw new Error('oldText must not be empty.');
  }

  const count = content.split(oldText).length - 1;
  if (count === 0) {
    throw new Error('oldText not found in file.');
  }
  if (!allOccurrences && count !== 1) {
    throw new Error(`oldText matched ${count} times. Set allOccurrences=true to replace all.`);
  }

  const next = allOccurrences ? content.split(oldText).join(newText) : content.replace(oldText, newText);
  await fs.writeFile(target, next, 'utf8');
  return { path: workspacePath, replacements: allOccurrences ? count : 1 };
}

async function insertInFile(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const workspacePath = String(args.path ?? '');
  const target = resolveScopedPath(workspacePath, scope, context);
  const line = Math.max(0, Number(args.line ?? 0));
  const text = String(args.text ?? '');
  const content = await fs.readFile(target, 'utf8');
  const lines = content.split(/\r?\n/);
  const index = Math.min(lines.length, line);
  lines.splice(index, 0, text);
  await fs.writeFile(target, lines.join('\n'), 'utf8');
  return { path: workspacePath, line: index, inserted: true };
}

async function createDirectory(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const workspacePath = String(args.path ?? '');
  const target = resolveScopedPath(workspacePath, scope, context);
  await fs.mkdir(target, { recursive: true });
  return { path: workspacePath, created: true };
}

async function movePath(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const fromPath = String(args.from ?? '');
  const toPath = String(args.to ?? '');
  const from = resolveScopedPath(fromPath, scope, context);
  const to = resolveScopedPath(toPath, scope, context);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return { from: fromPath, to: toPath, moved: true };
}

async function deletePath(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const workspacePath = String(args.path ?? '');
  const target = resolveScopedPath(workspacePath, scope, context);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) {
    return { path: workspacePath, deleted: false, reason: 'not_found' };
  }
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
  } else {
    await fs.unlink(target);
  }
  return { path: workspacePath, deleted: true };
}

async function grepSearch(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const base = scopeBaseDir(scope, context);
  const query = String(args.query ?? '');
  const maxResults = Math.max(1, Math.min(200, Number(args.maxResults ?? 50)));
  const regex = new RegExp(query, 'i');
  const matches: Array<{ file: string; line: number; text: string }> = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= maxResults) {
        return;
      }
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'out') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const raw = await fs.readFile(full, 'utf8').catch(() => '');
      if (!raw) {
        continue;
      }
      const lines = raw.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i])) {
          matches.push({ file: path.relative(base, full), line: i + 1, text: lines[i] });
          if (matches.length >= maxResults) {
            return;
          }
        }
      }
    }
  }

  await walk(base);
  return matches;
}

async function gitStatus(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const git = simpleGit(scopeBaseDir(scope, context));
  const status = await git.status();
  return {
    branch: status.current,
    modified: status.modified,
    created: status.created,
    deleted: status.deleted,
    staged: status.staged,
    not_added: status.not_added
  };
}

async function gitDiff(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const git = simpleGit(scopeBaseDir(scope, context));
  const file = args.path ? String(args.path) : undefined;
  const diff = await git.diff(file ? [file] : undefined);
  return { path: file ?? null, diff: diff.slice(0, 30000) };
}

async function gitAdd(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const git = simpleGit(scopeBaseDir(scope, context));
  if (Boolean(args.all)) {
    await git.add('.');
    return { staged: 'all' };
  }
  const file = String(args.path ?? '').trim();
  if (!file) {
    throw new Error('path is required unless all=true');
  }
  await git.add(file);
  return { staged: file };
}

async function gitCommit(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const git = simpleGit(scopeBaseDir(scope, context));
  const message = String(args.message ?? '').trim();
  if (!message) {
    throw new Error('message is required');
  }
  const result = await git.commit(message);
  return { commit: result.commit, summary: result.summary };
}

async function runTerminalCommand(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const command = String(args.command ?? '').trim();
  if (!command) {
    throw new Error('command is required');
  }

  const scopeBase = scopeBaseDir(scope, context);
  const cwd = args.cwd ? resolveScopedPath(String(args.cwd), scope, context) : scopeBase;
  const timeoutMs = Math.max(1000, Math.min(120000, Number(args.timeoutMs ?? 30000)));
  const shell = process.env.SHELL || '/bin/zsh';
  const terminalCwd = path.relative(scopeBase, cwd) || '.';

  context?.onTerminalEvent?.({
    type: 'start',
    command,
    cwd: terminalCwd
  });

  return await new Promise<{
    command: string;
    scope: ToolScope;
    cwd: string;
    success: boolean;
    code?: number | null;
    signal?: string | null;
    stdout: string;
    stderr: string;
  }>(resolve => {
    const child = spawn(shell, ['-lc', command], {
      cwd,
      env: process.env
    });

    context?.setActiveTerminalProcess?.(child);

    let stdout = '';
    let stderr = '';
    let completed = false;

    const finish = (result: {
      success: boolean;
      code: number | null;
      signal: string | null;
      stderrExtra?: string;
    }) => {
      if (completed) {
        return;
      }
      completed = true;

      if (result.stderrExtra) {
        stderr += result.stderrExtra;
        context?.onTerminalOutput?.({ source: 'stderr', text: result.stderrExtra });
      }

      context?.onTerminalEvent?.({
        type: 'end',
        command,
        cwd: terminalCwd,
        code: result.code,
        signal: result.signal
      });
      context?.setActiveTerminalProcess?.(null);

      resolve({
        command,
        scope,
        cwd: terminalCwd,
        success: result.success,
        code: result.code,
        signal: result.signal,
        stdout,
        stderr
      });
    };

    const timeoutHandle = setTimeout(() => {
      if (!completed) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      context?.onTerminalOutput?.({ source: 'stdout', text });
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      context?.onTerminalOutput?.({ source: 'stderr', text });
    });

    child.on('error', err => {
      clearTimeout(timeoutHandle);
      finish({ success: false, code: null, signal: null, stderrExtra: err.message });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      finish({ success: code === 0, code, signal });
    });
  });
}

export async function executeTool(name: string, args: unknown, context?: RuntimeContext): Promise<unknown> {
  const rawArgs = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const safeArgs = await enforceWorkspaceMutationApproval(name, rawArgs, context);

  switch (name) {
    case 'list_dir':
      return listDir(safeArgs, context);
    case 'file_search':
      return fileSearch(safeArgs, context);
    case 'read_file':
      return readFile(safeArgs, context);
    case 'create_file':
      return createFile(safeArgs, context);
    case 'write_file':
      return writeFile(safeArgs, context);
    case 'replace_in_file':
      return replaceInFile(safeArgs, context);
    case 'insert_in_file':
      return insertInFile(safeArgs, context);
    case 'create_directory':
      return createDirectory(safeArgs, context);
    case 'move_path':
      return movePath(safeArgs, context);
    case 'delete_path':
      return deletePath(safeArgs, context);
    case 'grep_search':
      return grepSearch(safeArgs, context);
    case 'git_status':
      return gitStatus(safeArgs, context);
    case 'git_diff':
      return gitDiff(safeArgs, context);
    case 'git_add':
      return gitAdd(safeArgs, context);
    case 'git_commit':
      return gitCommit(safeArgs, context);
    case 'run_terminal_command':
      return runTerminalCommand(safeArgs, context);
    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}
