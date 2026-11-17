import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkspaceTreeNode } from '../shared/types';

const MAX_NODES = 12000;

export async function buildWorkspaceTree(workspaceDir: string): Promise<WorkspaceTreeNode> {
  let nodeCount = 0;

  async function walk(absoluteDir: string, relativeDir: string): Promise<WorkspaceTreeNode> {
    nodeCount += 1;
    if (nodeCount > MAX_NODES) {
      return {
        name: path.basename(absoluteDir),
        path: relativeDir,
        type: 'directory',
        children: [
          {
            name: '__truncated__',
            path: path.posix.join(relativeDir, '__truncated__'),
            type: 'file'
          }
        ]
      };
    }

    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const children: WorkspaceTreeNode[] = [];
    for (const entry of entries) {
      const abs = path.join(absoluteDir, entry.name);
      const rel = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        children.push(await walk(abs, rel));
      } else {
        children.push({
          name: entry.name,
          path: rel,
          type: 'file'
        });
      }
    }

    return {
      name: relativeDir ? path.basename(relativeDir) : path.basename(workspaceDir),
      path: relativeDir,
      type: 'directory',
      children
    };
  }

  return walk(workspaceDir, '');
}

export async function readWorkspaceFile(workspaceDir: string, relativePath: string): Promise<string> {
  const absolute = path.resolve(workspaceDir, relativePath);
  const relative = path.relative(workspaceDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('File must be inside selected workspace directory.');
  }

  return fs.readFile(absolute, 'utf8');
}

export async function writeWorkspaceFile(
  workspaceDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  const absolute = path.resolve(workspaceDir, relativePath);
  const relative = path.relative(workspaceDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('File must be inside selected workspace directory.');
  }

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
}

/** Folder inside a workspace whose Markdown files are auto-injected as system context. */
export const AI_RULES_DIR = '.ai-rules';

/** Hard ceiling on the combined guidance block sent to the model. */
export const AI_RULES_MAX_CHARS = 8000;

/**
 * Ceiling applied to each individual rules file before concatenation. Without it a single
 * large file (rules.md is >100KB in this repo) would consume the whole budget and crowd
 * out the smaller overview files.
 */
export const AI_RULES_PER_FILE_MAX_CHARS = 4000;

/** Files that establish context for the rest of the folder, in the order they should be read. */
const AI_RULES_PRIORITY = ['readme.md', 'rules-quickref.md'];

export interface AiRules {
  /** Combined guidance block, ready to append to a system prompt. */
  content: string;
  /** Rules file names included, in injection order. */
  files: string[];
  /** True when the budget cut off at least one file or trimmed the combined block. */
  truncated: boolean;
}

function compareAiRulesFiles(a: string, b: string): number {
  const ai = AI_RULES_PRIORITY.indexOf(a.toLowerCase());
  const bi = AI_RULES_PRIORITY.indexOf(b.toLowerCase());
  if (ai !== bi) {
    // Priority files first, in priority order; everything else after them.
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.localeCompare(b);
}

/**
 * Load `.ai-rules/*.md` from a workspace so the model can follow the workspace's own coding rules.
 *
 * Purpose: give every chat, orchestration and sub-agent request the workspace guidance without the
 * user having to attach it manually.
 * Inputs: workspaceDir - absolute path of the currently selected workspace.
 * Outputs: an AiRules block, or null when the workspace has no `.ai-rules` folder, no readable
 * Markdown files, or only whitespace content (so callers can skip injection entirely).
 * Side effects: reads files from disk. Never throws - an unreadable folder or file is treated as
 * absent/empty, because missing guidance must not fail the user's request.
 * Performance: one readdir plus one read per Markdown file, capped by AI_RULES_MAX_CHARS output.
 * Security: only direct `.md` children of `.ai-rules` are read; symlinks and nested paths are not
 * followed, and no file outside the rules folder is touched.
 * Concurrency: safe to call concurrently; no shared state is mutated.
 * Rationale: README.md and RULES-QUICKREF.md are ordered first and each file is capped separately
 * so the short overview files always survive the total budget.
 */
export async function loadAiRules(workspaceDir: string): Promise<AiRules | null> {
  const rulesDir = path.join(workspaceDir, AI_RULES_DIR);

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(rulesDir, { withFileTypes: true });
  } catch {
    // No .ai-rules folder (or not readable) -> behave exactly as before this feature existed.
    return null;
  }

  const candidates = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map(entry => entry.name)
    .sort(compareAiRulesFiles);

  if (candidates.length === 0) {
    return null;
  }

  const sections: string[] = [];
  const includedFiles: string[] = [];
  let used = 0;
  let truncated = false;

  for (const fileName of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(rulesDir, fileName), 'utf8');
    } catch {
      continue;
    }

    const body = raw.trim();
    if (!body) {
      continue;
    }

    // Headers and the blank-line separators between sections count against the budget, so the
    // injected block never exceeds AI_RULES_MAX_CHARS.
    const header = `## ${AI_RULES_DIR}/${fileName}\n\n`;
    const separator = sections.length > 0 ? 2 : 0;
    const remaining = AI_RULES_MAX_CHARS - used - separator - header.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const text = body.slice(0, Math.min(AI_RULES_PER_FILE_MAX_CHARS, remaining));
    if (text.length < body.length) {
      truncated = true;
    }

    sections.push(`${header}${text}`);
    includedFiles.push(fileName);
    used += separator + header.length + text.length;
  }

  if (sections.length === 0) {
    return null;
  }

  return {
    content: sections.join('\n\n'),
    files: includedFiles,
    truncated
  };
}

/**
 * Wrap loaded `.ai-rules` content in the instruction the model must follow.
 *
 * Purpose: keep the exact wording identical across chat, orchestration stages and sub-agents.
 * Inputs: content - the combined rules block from loadAiRules(), or null/empty when absent.
 * Outputs: a system-prompt section string, or '' when there is nothing to inject.
 * Side effects: none.
 * Performance: O(1) string work.
 * Security: the rules text is workspace-authored content; it is presented as workspace guidance
 * rather than elevated system policy.
 * Rationale: callers only need to know whether the result is empty, so no flag is returned.
 */
export function formatAiRulesGuidance(content?: string | null): string {
  const trimmed = String(content ?? '').trim();
  if (!trimmed) {
    return '';
  }

  return (
    'Workspace coding rules loaded from the .ai-rules/ folder of the selected workspace:\n\n' +
    `${trimmed}\n\n` +
    'Follow these workspace rules when making changes. They refine, but never override, the ' +
    'assistant safety and tool policies above them.'
  );
}
