import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { LLMConfig } from '../shared/types';

interface StoredMemoryItem {
  text: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievedMemoryItem {
  id: number;
  text: string;
  source: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface RetrieveOptions {
  namespace: string;
  k?: number;
}

interface StoreOptions {
  namespace: string;
}

interface MemoryPathPair {
  indexPath: string;
  metaPath: string;
}

export interface TurboVecNamespaceDiagnostics {
  namespace: string;
  records: number;
  indexBytes: number;
  metadataBytes: number;
  updatedAt: string | null;
}

export interface TurboVecDiagnostics {
  ok: boolean;
  pythonExecutable: string;
  bridgeScriptPath: string;
  memoryRoot: string;
  health: {
    ok: boolean;
    numpyVersion?: string;
    turbovecVersion?: string;
    error?: string;
  };
  namespaces: TurboVecNamespaceDiagnostics[];
  totals: {
    namespaces: number;
    records: number;
    indexBytes: number;
    metadataBytes: number;
  };
}

function deriveEmbeddingsEndpoint(chatEndpoint: string): string {
  const normalized = chatEndpoint.trim();
  if (!normalized) {
    throw new Error('Endpoint is required.');
  }

  try {
    const url = new URL(normalized);
    if (url.pathname.endsWith('/chat/completions')) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '/embeddings');
      return url.toString();
    }
    if (url.pathname.endsWith('/v1')) {
      url.pathname = `${url.pathname}/embeddings`;
      return url.toString();
    }
    if (!url.pathname.endsWith('/embeddings')) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/embeddings`;
    }
    return url.toString();
  } catch {
    if (normalized.endsWith('/chat/completions')) {
      return normalized.replace(/\/chat\/completions$/, '/embeddings');
    }
    if (normalized.endsWith('/v1')) {
      return `${normalized}/embeddings`;
    }
    return `${normalized.replace(/\/$/, '')}/embeddings`;
  }
}

function sanitizeNamespace(namespace: string): string {
  const compact = namespace.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
  return compact || 'default';
}

function fallbackEmbedding(text: string, dim = 256): number[] {
  const vec = new Array<number>(dim).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const idx = (i * 131 + code) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map(value => value / norm);
}

export class TurboVecMemory {
  private readonly rootDir: string;
  private readonly bridgeScriptPath: string;
  private readonly onEvent?: (event: string) => void;
  private readonly pythonExecutableCandidates: string[];
  private resolvedPythonExecutable: string | null = null;

  constructor(rootDir: string, bridgeScriptPath: string, onEvent?: (event: string) => void) {
    this.rootDir = rootDir;
    this.bridgeScriptPath = bridgeScriptPath;
    this.onEvent = onEvent;

    const explicit = process.env.TURBOVEC_PYTHON?.trim();
    const projectVenvPython = path.resolve(process.cwd(), '.turbovec-venv', 'bin', 'python');
    const candidates = [
      explicit,
      projectVenvPython,
      'python3',
      'python',
      '/usr/bin/python3'
    ].filter((value): value is string => Boolean(value));

    this.pythonExecutableCandidates = Array.from(new Set(candidates));
  }

  async retrieve(config: LLMConfig, query: string, options: RetrieveOptions): Promise<RetrievedMemoryItem[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const paths = await this.memoryPaths(options.namespace);
    const vector = await this.embeddingFor(config, trimmedQuery);

    try {
      const result = await this.callBridge(paths, {
        action: 'query',
        vector,
        k: Math.max(1, Math.min(20, Number(options.k ?? 6)))
      });
      const matches = Array.isArray(result?.matches) ? result.matches : [];
      return matches
        .filter((match: unknown) => Boolean(match) && typeof match === 'object')
        .map((match: unknown) => match as RetrievedMemoryItem);
    } catch (error) {
      this.onEvent?.(`[memory] retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async store(config: LLMConfig, items: StoredMemoryItem[], options: StoreOptions): Promise<void> {
    const docs = items.map(item => ({
      ...item,
      text: item.text.trim()
    })).filter(item => item.text.length > 0);

    if (!docs.length) {
      return;
    }

    const paths = await this.memoryPaths(options.namespace);
    const nextId = await this.nextId(paths.metaPath);

    const vectors = await Promise.all(
      docs.map(doc => this.embeddingFor(config, doc.text))
    );

    const payloadItems = docs.map((doc, index) => ({
      id: nextId + index,
      text: doc.text,
      source: doc.source,
      createdAt: new Date().toISOString(),
      metadata: doc.metadata ?? {}
    }));

    await this.callBridge(paths, {
      action: 'add',
      ids: payloadItems.map(item => item.id),
      vectors,
      items: payloadItems
    });
  }

  async diagnostics(namespaceFilter?: string): Promise<TurboVecDiagnostics> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    const filtered = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => !namespaceFilter || name.includes(sanitizeNamespace(namespaceFilter)));

    const namespaces: TurboVecNamespaceDiagnostics[] = [];

    for (const namespace of filtered) {
      const dir = path.join(this.rootDir, namespace);
      const indexPath = path.join(dir, 'memory.tvec');
      const metaPath = path.join(dir, 'memory.jsonl');
      const indexStat = await fs.stat(indexPath).catch(() => null);
      const metaStat = await fs.stat(metaPath).catch(() => null);
      const metadataRaw = await fs.readFile(metaPath, 'utf8').catch(() => '');
      const records = metadataRaw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean).length;
      const updatedMs = Math.max(indexStat?.mtimeMs ?? 0, metaStat?.mtimeMs ?? 0);

      namespaces.push({
        namespace,
        records,
        indexBytes: indexStat?.size ?? 0,
        metadataBytes: metaStat?.size ?? 0,
        updatedAt: updatedMs > 0 ? new Date(updatedMs).toISOString() : null
      });
    }

    namespaces.sort((a, b) => a.namespace.localeCompare(b.namespace));

    const health = await this.bridgeHealth();

    return {
      ok: health.ok,
      pythonExecutable: this.resolvedPythonExecutable || this.pythonExecutableCandidates[0] || 'python3',
      bridgeScriptPath: this.bridgeScriptPath,
      memoryRoot: this.rootDir,
      health,
      namespaces,
      totals: {
        namespaces: namespaces.length,
        records: namespaces.reduce((sum, item) => sum + item.records, 0),
        indexBytes: namespaces.reduce((sum, item) => sum + item.indexBytes, 0),
        metadataBytes: namespaces.reduce((sum, item) => sum + item.metadataBytes, 0)
      }
    };
  }

  async clearNamespace(namespace: string): Promise<{ namespace: string; cleared: boolean }> {
    const sanitized = sanitizeNamespace(namespace);
    const dir = path.join(this.rootDir, sanitized);
    const exists = await fs.stat(dir).then(() => true).catch(() => false);
    if (!exists) {
      return { namespace: sanitized, cleared: false };
    }

    await fs.rm(dir, { recursive: true, force: true });
    return { namespace: sanitized, cleared: true };
  }

  private async memoryPaths(namespace: string): Promise<MemoryPathPair> {
    const name = sanitizeNamespace(namespace);
    const dir = path.join(this.rootDir, name);
    await fs.mkdir(dir, { recursive: true });
    return {
      indexPath: path.join(dir, 'memory.tvec'),
      metaPath: path.join(dir, 'memory.jsonl')
    };
  }

  private async embeddingFor(config: LLMConfig, text: string): Promise<number[]> {
    try {
      const endpoint = deriveEmbeddingsEndpoint(config.endpoint);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
      }

      const response = await axios.post<{ data?: Array<{ embedding?: number[] }> }>(
        endpoint,
        {
          model: config.model,
          input: text
        },
        {
          headers,
          timeout: 12000
        }
      );

      const embedding = response.data?.data?.[0]?.embedding;
      if (!embedding || !embedding.length) {
        throw new Error('Embedding endpoint returned empty embedding.');
      }
      return embedding;
    } catch (error) {
      this.onEvent?.(`[memory] embedding fallback used: ${error instanceof Error ? error.message : String(error)}`);
      return fallbackEmbedding(text);
    }
  }

  private async nextId(metaPath: string): Promise<number> {
    const raw = await fs.readFile(metaPath, 'utf8').catch(() => '');
    if (!raw.trim()) {
      return 1;
    }

    let maxId = 0;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as { id?: number };
        const id = Number(parsed.id ?? 0);
        if (Number.isFinite(id) && id > maxId) {
          maxId = id;
        }
      } catch {
        // Ignore malformed lines and continue.
      }
    }

    return maxId + 1;
  }

  private async callBridge(paths: MemoryPathPair, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pythonExecutable = await this.resolvePythonExecutable();

    return await new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, [this.bridgeScriptPath, '--index', paths.indexPath, '--meta', paths.metaPath], {
        cwd: path.dirname(this.bridgeScriptPath),
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', err => {
        reject(err);
      });

      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `TurboVec bridge failed with code ${String(code)}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout || '{}') as Record<string, unknown>;
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Invalid TurboVec bridge output: ${error instanceof Error ? error.message : String(error)}`));
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  private async resolvePythonExecutable(): Promise<string> {
    if (this.resolvedPythonExecutable) {
      return this.resolvedPythonExecutable;
    }

    for (const candidate of this.pythonExecutableCandidates) {
      const ok = await this.isPythonUsable(candidate);
      if (ok) {
        this.resolvedPythonExecutable = candidate;
        return candidate;
      }
    }

    this.resolvedPythonExecutable = this.pythonExecutableCandidates[0] || 'python3';
    return this.resolvedPythonExecutable;
  }

  private async isPythonUsable(executable: string): Promise<boolean> {
    return await new Promise(resolve => {
      const child = spawn(executable, ['-c', 'import numpy, turbovec'], {
        env: process.env
      });

      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    });
  }

  private async bridgeHealth(): Promise<{
    ok: boolean;
    numpyVersion?: string;
    turbovecVersion?: string;
    error?: string;
  }> {
    const tempPaths: MemoryPathPair = {
      indexPath: path.join(this.rootDir, '__health__', 'memory.tvec'),
      metaPath: path.join(this.rootDir, '__health__', 'memory.jsonl')
    };

    try {
      const result = await this.callBridge(tempPaths, { action: 'health' });
      return {
        ok: Boolean(result.ok),
        numpyVersion: typeof result.numpyVersion === 'string' ? result.numpyVersion : undefined,
        turbovecVersion: typeof result.turbovecVersion === 'string' ? result.turbovecVersion : undefined
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
