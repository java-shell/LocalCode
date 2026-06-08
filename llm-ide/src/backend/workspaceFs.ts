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
