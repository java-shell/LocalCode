import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit from 'simple-git';
import axios from 'axios';
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

function splitFileIntoLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split(/\r?\n/);
  if (/\r?\n$/.test(content)) {
    lines.pop();
  }
  return lines;
}

function joinLinesForFile(lines: string[], hadTrailingNewline: boolean): string {
  const next = lines.join('\n');
  if (hadTrailingNewline) {
    return `${next}\n`;
  }
  return next;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
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

const binaryExtensions = new Set([
  '.7z', '.a', '.bin', '.bmp', '.class', '.dll', '.dylib', '.exe', '.gif', '.gz', '.ico', '.jar',
  '.jpeg', '.jpg', '.lock', '.mp3', '.mp4', '.o', '.obj', '.pdf', '.png', '.pyc', '.so', '.tar',
  '.ttf', '.wav', '.webp', '.woff', '.woff2', '.zip'
]);

const DEFAULT_READ_FILE_MAX_CHARS = 24000;
const MAX_READ_FILE_MAX_CHARS = 100000;
const TERMINAL_CAPTURE_MAX_CHARS = 24000;

function likelyBinaryByExtension(filePath: string): boolean {
  return binaryExtensions.has(path.extname(filePath).toLowerCase());
}

function likelyBinaryBuffer(content: Buffer): boolean {
  if (content.length === 0) {
    return false;
  }

  let suspicious = 0;
  const sampleSize = Math.min(content.length, 4096);
  for (let i = 0; i < sampleSize; i += 1) {
    const byte = content[i];
    if (byte === 0) {
      return true;
    }
    const isControl = byte < 7 || (byte > 13 && byte < 32);
    if (isControl) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.2;
}

function truncateText(raw: string, maxChars: number): { text: string; truncated: boolean; originalChars: number } {
  if (raw.length <= maxChars) {
    return {
      text: raw,
      truncated: false,
      originalChars: raw.length
    };
  }

  const headChars = Math.floor(maxChars * 0.75);
  const tailChars = Math.max(0, maxChars - headChars);
  const head = raw.slice(0, headChars);
  const tail = tailChars > 0 ? raw.slice(-tailChars) : '';

  return {
    text: `${head}\n\n...[truncated ${raw.length - (head.length + tail.length)} chars]...\n\n${tail}`,
    truncated: true,
    originalChars: raw.length
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'browser_fetch',
      description: 'Fetch a web page and return title, text content, and links for model browsing.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          maxChars: { type: 'number' },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' }
          },
          followRedirects: { type: 'boolean' },
          maxRedirects: { type: 'number' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo and return top organic results without requiring an API key.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          maxResults: { type: 'number' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_repo_tree',
      description:
        'Return a full repository directory tree as text (tracked files and optional untracked files).',
      parameters: {
        type: 'object',
        properties: {
          scope: scopeProperty,
          includeUntracked: { type: 'boolean' },
          maxEntries: { type: 'number' },
          offset: { type: 'number' }
        }
      }
    }
  },
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
      description: 'Read file contents by relative path and optional 1-based line range. Response includes numberedContent for exact line references.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          maxChars: { type: 'number' },
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
      description: 'Create a new file only if it does not already exist. Content is optional; prefer creating an empty file and then using small insert_in_file calls for large files.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string', maxLength: 2000 }, scope: scopeProperty },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write full content to a file in selected scope. Use only for short files; prefer replace_in_file or insert_in_file for large files.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string', maxLength: 4000 }, scope: scopeProperty },
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
          oldText: { type: 'string', maxLength: 4000 },
          newText: { type: 'string', maxLength: 4000 },
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
      description: 'Insert text before a specific 1-based line number. Use totalLines + 1 to append at end of file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line: { type: 'number' },
          text: { type: 'string', maxLength: 3000 },
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
        properties: {
          query: { type: 'string' },
          maxResults: { type: 'number' },
          includeBinary: { type: 'boolean' },
          scope: scopeProperty
        },
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
  },
  {
    type: 'function',
    function: {
      name: 'complete_orchestration_task',
      description:
        'Signal that the orchestration task is fully complete and no further steps or iterations are needed. ' +
        'Call this tool once all objectives from the original request have been achieved.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of what was accomplished and why the task is complete.'
          }
        },
        required: []
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
      return `insert text into ${String(args.path ?? '')} before line ${String(args.line ?? 1)}`;
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

async function browserFetch(args: Record<string, unknown>) {
  const rawUrl = String(args.url ?? '').trim();
  if (!rawUrl) {
    throw new Error('url is required');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid absolute URL.');
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  const maxChars = Math.max(500, Math.min(200000, Number(args.maxChars ?? 12000)));
  const rawHeaders = args.headers;
  const requestHeaders: Record<string, string> = {};
  if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (!key) {
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        requestHeaders[key] = String(value);
      }
    }
  }

  const followRedirects = Boolean(args.followRedirects ?? true);
  const maxRedirects = followRedirects
    ? Math.max(0, Math.min(10, Number(args.maxRedirects ?? 5)))
    : 0;

  const redirects: Array<{ from: string; to: string; status: number }> = [];
  let currentUrl = url.toString();
  let response = await axios.get<string>(currentUrl, {
    responseType: 'text',
    timeout: 15000,
    maxContentLength: 2_000_000,
    validateStatus: () => true,
    maxRedirects: 0,
    headers: requestHeaders
  });

  while (
    followRedirects &&
    response.status >= 300 &&
    response.status < 400 &&
    typeof response.headers.location === 'string' &&
    redirects.length < maxRedirects
  ) {
    const nextUrl = new URL(response.headers.location, currentUrl).toString();
    redirects.push({ from: currentUrl, to: nextUrl, status: response.status });
    currentUrl = nextUrl;
    response = await axios.get<string>(currentUrl, {
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 2_000_000,
      validateStatus: () => true,
      maxRedirects: 0,
      headers: requestHeaders
    });
  }

  const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const links = Array.from(html.matchAll(/href=["']([^"']+)["']/gi))
    .map(match => match[1])
    .filter(value => value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/'))
    .slice(0, 60);

  return {
    url: url.toString(),
    finalUrl: currentUrl,
    status: response.status,
    title,
    content: textContent.slice(0, maxChars),
    truncated: textContent.length > maxChars,
    links,
    redirects,
    redirected: redirects.length > 0,
    redirectLimitReached:
      followRedirects &&
      response.status >= 300 &&
      response.status < 400 &&
      typeof response.headers.location === 'string' &&
      redirects.length >= maxRedirects,
    location: typeof response.headers.location === 'string' ? response.headers.location : null
  };
}

async function webSearch(args: Record<string, unknown>) {
  const query = String(args.query ?? '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const maxResults = Math.max(1, Math.min(20, Number(args.maxResults ?? 8)));
  const response = await axios.get<string>('https://duckduckgo.com/html/', {
    params: { q: query },
    responseType: 'text',
    timeout: 15000,
    maxContentLength: 2_000_000,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LocalCode/1.0; +https://duckduckgo.com/)'
    }
  });

  if (response.status >= 400) {
    throw new Error(`DuckDuckGo search failed with status ${response.status}`);
  }

  const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
  const resultRegex = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>)?/gi;

  const stripHtml = (value: string) => value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  const results: Array<{ title: string; url: string; snippet: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) && results.length < maxResults) {
    const rawUrl = match[1] || '';
    const title = stripHtml(match[2] || '');
    const snippet = stripHtml(match[3] || match[4] || '');
    if (!rawUrl || !title) {
      continue;
    }
    results.push({ title, url: rawUrl, snippet });
  }

  return {
    engine: 'duckduckgo',
    query,
    resultCount: results.length,
    results
  };
}

function renderTreeFromFilePaths(paths: string[], rootLabel: string): string {
  interface TreeNode {
    children: Map<string, TreeNode>;
    isFile: boolean;
  }

  const root: TreeNode = { children: new Map(), isFile: false };

  for (const rawPath of paths) {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
    if (!normalized) {
      continue;
    }

    const parts = normalized.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      let next = current.children.get(part);
      if (!next) {
        next = { children: new Map(), isFile: isLeaf };
        current.children.set(part, next);
      }
      if (isLeaf) {
        next.isFile = true;
      }
      current = next;
    }
  }

  function sortedEntries(node: TreeNode): Array<[string, TreeNode]> {
    return Array.from(node.children.entries()).sort((a, b) => {
      const aDir = a[1].children.size > 0 && !a[1].isFile;
      const bDir = b[1].children.size > 0 && !b[1].isFile;
      if (aDir !== bDir) {
        return aDir ? -1 : 1;
      }
      return a[0].localeCompare(b[0]);
    });
  }

  const lines: string[] = [rootLabel];

  function walk(node: TreeNode, prefix: string): void {
    const entries = sortedEntries(node);
    entries.forEach(([name, child], index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? '`-- ' : '|-- ';
      const isDir = child.children.size > 0 && !child.isFile;
      lines.push(`${prefix}${connector}${name}${isDir ? '/' : ''}`);
      if (isDir) {
        walk(child, `${prefix}${isLast ? '    ' : '|   '}`);
      }
    });
  }

  walk(root, '');
  return lines.join('\n');
}

async function listRepoTree(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const base = scopeBaseDir(scope, context);
  const includeUntracked = Boolean(args.includeUntracked ?? true);
  const maxEntries = Math.max(1, Math.min(100000, Number(args.maxEntries ?? 30000)));
  const offset = Math.max(0, Math.trunc(Number(args.offset ?? 0)));

  try {
    const git = simpleGit(base);
    const isRepo = await git.checkIsRepo();
    if (isRepo) {
      const trackedRaw = await git.raw(['ls-files']);
      const tracked = trackedRaw.split(/\r?\n/).filter(Boolean);

      const untracked = includeUntracked
        ? (await git.raw(['ls-files', '--others', '--exclude-standard'])).split(/\r?\n/).filter(Boolean)
        : [];

      const files = Array.from(new Set([...tracked, ...untracked])).sort((a, b) => a.localeCompare(b));
      const start = Math.min(offset, files.length);
      const end = Math.min(files.length, start + maxEntries);
      const page = files.slice(start, end);
      const nextOffset = end < files.length ? end : null;

      return {
        scope,
        root: path.basename(base),
        fileCount: files.length,
        offset: start,
        returnedCount: page.length,
        nextOffset,
        truncated: nextOffset !== null,
        tree: renderTreeFromFilePaths(page, path.basename(base) || '.')
      };
    }
  } catch {
    // Fallback to filesystem traversal below when git metadata is unavailable.
  }

  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') {
        continue;
      }

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(path.relative(base, full).replace(/\\/g, '/'));
      }
    }
  }

  await walk(base);
  files.sort((a, b) => a.localeCompare(b));
  const start = Math.min(offset, files.length);
  const end = Math.min(files.length, start + maxEntries);
  const page = files.slice(start, end);
  const nextOffset = end < files.length ? end : null;

  return {
    scope,
    root: path.basename(base),
    fileCount: files.length,
    offset: start,
    returnedCount: page.length,
    nextOffset,
    truncated: nextOffset !== null,
    tree: renderTreeFromFilePaths(page, path.basename(base) || '.')
  };
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
  const lines = splitFileIntoLines(content);
  const totalLines = lines.length;
  const requestedStart = toPositiveInteger(args.startLine, 1);
  const start = totalLines === 0 ? 1 : Math.min(totalLines, requestedStart);
  const defaultEnd = totalLines === 0 ? 1 : Math.min(totalLines, start + 300);
  const requestedEnd = Math.max(start, toPositiveInteger(args.endLine, defaultEnd));
  const end = totalLines === 0 ? 1 : Math.min(totalLines, requestedEnd);
  const slice = totalLines === 0 ? [] : lines.slice(start - 1, end);
  const requestedMaxChars = toPositiveInteger(args.maxChars, DEFAULT_READ_FILE_MAX_CHARS);
  const maxChars = Math.min(MAX_READ_FILE_MAX_CHARS, Math.max(500, requestedMaxChars));
  const contentRaw = slice.join('\n');
  const numberedRaw = slice.map((line, index) => `${start + index}: ${line}`).join('\n');
  const contentView = truncateText(contentRaw, maxChars);
  const numberedView = truncateText(numberedRaw, Math.max(500, Math.floor(maxChars / 2)));

  return {
    path: String(args.path ?? ''),
    startLine: start,
    endLine: end,
    totalLines,
    maxChars,
    content: contentView.text,
    numberedContent: numberedView.text,
    contentTruncated: contentView.truncated,
    numberedContentTruncated: numberedView.truncated,
    contentOriginalChars: contentView.originalChars,
    numberedContentOriginalChars: numberedView.originalChars
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
  const requestedLine = toPositiveInteger(args.line, 1);
  const text = String(args.text ?? '');
  const content = await fs.readFile(target, 'utf8');
  const hadTrailingNewline = /\r?\n$/.test(content);
  const lines = splitFileIntoLines(content);
  const index = Math.min(lines.length, requestedLine - 1);
  lines.splice(index, 0, text);
  await fs.writeFile(target, joinLinesForFile(lines, hadTrailingNewline), 'utf8');
  return { path: workspacePath, line: index + 1, inserted: true };
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
  const includeBinary = Boolean(args.includeBinary ?? false);
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

      if (!includeBinary && likelyBinaryByExtension(full)) {
        continue;
      }

      const rawBuffer = await fs.readFile(full).catch(() => null);
      if (!rawBuffer) {
        continue;
      }
      if (!includeBinary && likelyBinaryBuffer(rawBuffer)) {
        continue;
      }

      const raw = rawBuffer.toString('utf8');
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
  const base = scopeBaseDir(scope, context);
  const git = simpleGit(base);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    return {
      isRepo: false,
      path: base,
      branch: null,
      modified: [],
      created: [],
      deleted: [],
      staged: [],
      not_added: [],
      message: 'Not a git repository at selected scope base.'
    };
  }

  const status = await git.status();
  return {
    isRepo: true,
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

export async function runTerminalCommand(args: Record<string, unknown>, context?: RuntimeContext) {
  const scope = parseScope(args);
  const command = String(args.command ?? '').trim();
  if (!command) {
    throw new Error('command is required');
  }

  const scopeBase = scopeBaseDir(scope, context);
  const cwd = args.cwd ? resolveScopedPath(String(args.cwd), scope, context) : scopeBase;
  const rawTimeoutMs = Number(args.timeoutMs ?? 30000);
  const timeoutMs = rawTimeoutMs <= 0 ? 0 : Math.max(1000, Math.min(120000, rawTimeoutMs));
  const shellConfig = process.platform === 'win32'
    ? {
        executable: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', command]
      }
    : {
        executable: process.env.SHELL || '/bin/sh',
        args: ['-lc', command]
      };
  const terminalCwd = path.relative(scopeBase, cwd) || '.';

  // Validate the cwd exists before spawning — Node.js reports ENOENT on the
  // shell binary when the cwd is missing, which is very confusing to debug.
  if (!(await pathExists(cwd))) {
    const errMsg = `Directory does not exist: ${cwd}`;
    context?.onTerminalEvent?.({
      type: 'start', command, cwd: terminalCwd
    });
    context?.onTerminalOutput?.({ source: 'stderr', text: errMsg + '\n' });
    context?.onTerminalEvent?.({
      type: 'end', command, cwd: terminalCwd, code: 1, signal: null
    });
    return { command, scope, cwd: terminalCwd, success: false, code: 1, signal: null, stdout: '', stderr: errMsg };
  }

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
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
    maxCaptureChars?: number;
  }>(resolve => {
    const child = spawn(shellConfig.executable, shellConfig.args, {
      cwd,
      env: process.env
    });

    context?.setActiveTerminalProcess?.(child);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
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
        stderr,
        stdoutTruncated,
        stderrTruncated,
        maxCaptureChars: TERMINAL_CAPTURE_MAX_CHARS
      });
    };

    const timeoutHandle = timeoutMs > 0
      ? setTimeout(() => {
          if (!completed) {
            child.kill('SIGTERM');
          }
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (!stdoutTruncated) {
        const next = stdout.length + text.length;
        if (next <= TERMINAL_CAPTURE_MAX_CHARS) {
          stdout += text;
        } else {
          const remaining = Math.max(0, TERMINAL_CAPTURE_MAX_CHARS - stdout.length);
          stdout += text.slice(0, remaining);
          stdoutTruncated = true;
          const notice = '\n...[stdout truncated for context safety]...\n';
          stdout += notice;
          context?.onTerminalOutput?.({ source: 'stdout', text: notice });
        }
      }
      context?.onTerminalOutput?.({ source: 'stdout', text });
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (!stderrTruncated) {
        const next = stderr.length + text.length;
        if (next <= TERMINAL_CAPTURE_MAX_CHARS) {
          stderr += text;
        } else {
          const remaining = Math.max(0, TERMINAL_CAPTURE_MAX_CHARS - stderr.length);
          stderr += text.slice(0, remaining);
          stderrTruncated = true;
          const notice = '\n...[stderr truncated for context safety]...\n';
          stderr += notice;
          context?.onTerminalOutput?.({ source: 'stderr', text: notice });
        }
      }
      context?.onTerminalOutput?.({ source: 'stderr', text });
    });

    child.on('error', err => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      const detail = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? `${err.message} (shell: ${shellConfig.executable}, cwd: ${cwd})`
        : err.message;
      finish({ success: false, code: null, signal: null, stderrExtra: detail });
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
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
    case 'browser_fetch':
      return browserFetch(safeArgs);
    case 'web_search':
      return webSearch(safeArgs);
    case 'list_repo_tree':
      return listRepoTree(safeArgs, context);
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
    case 'complete_orchestration_task':
      // Intercepted by the orchestration engine; this fallback handles unexpected direct calls.
      return { ok: true, message: 'Task completion acknowledged.' };
    default:
      throw new Error(`Unsupported tool: ${name}`);
  }
}
