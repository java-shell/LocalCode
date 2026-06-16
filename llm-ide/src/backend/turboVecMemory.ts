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
  vectorK?: number;
  maxHops?: number;
}

interface StoreOptions {
  namespace: string;
  replaceSources?: string[];
}

interface MemoryPathPair {
  indexPath: string;
  metaPath: string;
}

interface StoredMetadataItem {
  id: number;
  text: string;
  source: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface GraphRagLinkHitCounters {
  sequential: number;
  explicit: number;
  turn: number;
  source: number;
}

interface GraphRagNamespaceDiagnostics {
  retrievals: number;
  vectorSeedHits: number;
  expandedHits: number;
  finalReturned: number;
  avgExpansionFactor: number;
  maxObservedHops: number;
  linkHits: GraphRagLinkHitCounters;
  lastRetrievedAt: string | null;
}

interface GraphRagMutableNamespaceStats {
  retrievals: number;
  vectorSeedHits: number;
  expandedHits: number;
  finalReturned: number;
  maxObservedHops: number;
  linkHits: GraphRagLinkHitCounters;
  lastRetrievedAt: string | null;
}

interface NeighborCollectionResult {
  ids: number[];
  linkHits: GraphRagLinkHitCounters;
}

interface HybridExpandResult {
  items: RetrievedMemoryItem[];
  expandedHits: number;
  maxObservedHops: number;
  linkHits: GraphRagLinkHitCounters;
}

const TARGET_EMBEDDING_DIM = 256;

export interface TurboVecNamespaceDiagnostics {
  namespace: string;
  records: number;
  indexBytes: number;
  metadataBytes: number;
  updatedAt: string | null;
  graphrag: GraphRagNamespaceDiagnostics;
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
  graphrag: GraphRagNamespaceDiagnostics;
}

const ZERO_LINK_HITS: GraphRagLinkHitCounters = {
  sequential: 0,
  explicit: 0,
  turn: 0,
  source: 0
};

function cloneLinkHits(value?: Partial<GraphRagLinkHitCounters>): GraphRagLinkHitCounters {
  return {
    sequential: Number(value?.sequential ?? 0) || 0,
    explicit: Number(value?.explicit ?? 0) || 0,
    turn: Number(value?.turn ?? 0) || 0,
    source: Number(value?.source ?? 0) || 0
  };
}

function createEmptyGraphRagStats(): GraphRagMutableNamespaceStats {
  return {
    retrievals: 0,
    vectorSeedHits: 0,
    expandedHits: 0,
    finalReturned: 0,
    maxObservedHops: 0,
    linkHits: cloneLinkHits(ZERO_LINK_HITS),
    lastRetrievedAt: null
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

function normalizeEmbeddingDimension(embedding: number[], targetDim = TARGET_EMBEDDING_DIM): number[] {
  const vec = new Array<number>(targetDim).fill(0);
  for (let i = 0; i < embedding.length; i += 1) {
    const value = Number(embedding[i]);
    if (!Number.isFinite(value)) {
      continue;
    }
    vec[i % targetDim] += value;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map(value => value / norm);
}

export class TurboVecMemory {
  private readonly rootDir: string;
  private readonly bridgeScriptPath: string;
  private readonly onEvent?: (event: string) => void;
  private readonly pythonExecutableCandidates: string[];
  private readonly projectVenvDir: string;
  private readonly projectVenvPythonCandidates: string[];
  private resolvedPythonExecutable: string | null = null;
  private bootstrapAttempted = false;
  private bootstrapInFlight: Promise<void> | null = null;
  private readonly graphRagStatsByNamespace = new Map<string, GraphRagMutableNamespaceStats>();

  constructor(rootDir: string, bridgeScriptPath: string, onEvent?: (event: string) => void, projectVenvDir?: string) {
    this.rootDir = rootDir;
    this.bridgeScriptPath = bridgeScriptPath;
    this.onEvent = onEvent;

    const explicit = process.env.TURBOVEC_PYTHON?.trim();
    this.projectVenvDir = path.resolve(projectVenvDir || path.join(this.rootDir, '..', '.turbovec-venv'));

    const projectVenvPythonCandidates = process.platform === 'win32'
      ? [
          path.join(this.projectVenvDir, 'Scripts', 'python.exe'),
          path.join(this.projectVenvDir, 'Scripts', 'python')
        ]
      : [
          path.join(this.projectVenvDir, 'bin', 'python3'),
          path.join(this.projectVenvDir, 'bin', 'python')
        ];

    this.projectVenvPythonCandidates = projectVenvPythonCandidates;

    const candidates = [
      explicit,
      ...projectVenvPythonCandidates,
      process.platform === 'win32' ? 'py' : undefined,
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
      const namespace = sanitizeNamespace(options.namespace);
      const targetK = Math.max(1, Math.min(20, Number(options.k ?? 6)));
      const vectorK = Math.max(targetK, Math.min(40, Number(options.vectorK ?? targetK * 2)));
      const result = await this.callBridge(paths, {
        action: 'query',
        vector,
        k: vectorK
      });
      const matches = Array.isArray(result?.matches) ? result.matches : [];
      const seedMatches = matches
        .filter((match: unknown) => Boolean(match) && typeof match === 'object')
        .map((match: unknown) => match as RetrievedMemoryItem);

      const allItems = await this.readMetadataItems(paths.metaPath);
      const expanded = this.hybridExpand(seedMatches, allItems, {
        k: targetK,
        maxHops: Math.max(1, Math.min(3, Number(options.maxHops ?? 1)))
      });

      this.recordGraphRagRetrieval(namespace, {
        vectorSeedHits: seedMatches.length,
        expandedHits: expanded.expandedHits,
        finalReturned: expanded.items.length,
        maxObservedHops: expanded.maxObservedHops,
        linkHits: expanded.linkHits
      });

      return expanded.items;
    } catch (error) {
      this.onEvent?.(`[memory] retrieval skipped: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private hybridExpand(
    seedMatches: RetrievedMemoryItem[],
    allItems: StoredMetadataItem[],
    options: { k: number; maxHops: number }
  ): HybridExpandResult {
    if (seedMatches.length === 0) {
      return {
        items: [],
        expandedHits: 0,
        maxObservedHops: 0,
        linkHits: cloneLinkHits(ZERO_LINK_HITS)
      };
    }

    const itemsById = new Map<number, StoredMetadataItem>();
    for (const item of allItems) {
      itemsById.set(item.id, item);
    }

    const maxDistance = seedMatches.reduce((max, match) => {
      const value = Number(match.score ?? 0);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);

    const toSimilarity = (score: number | undefined): number => {
      const distance = Number(score ?? maxDistance + 1);
      if (!Number.isFinite(distance)) {
        return 0;
      }
      return 1 / (1 + Math.max(0, distance));
    };

    const ranked = new Map<number, { item: RetrievedMemoryItem; rank: number; hops: number }>();
    const queue: Array<{ id: number; hops: number; inheritedRank: number }> = [];
    const linkHits = cloneLinkHits(ZERO_LINK_HITS);

    for (const seed of seedMatches) {
      const id = Number(seed.id);
      if (!Number.isFinite(id)) {
        continue;
      }

      const stored = itemsById.get(id);
      const normalized: RetrievedMemoryItem = {
        id,
        text: stored?.text ?? String(seed.text ?? ''),
        source: stored?.source ?? String(seed.source ?? 'unknown'),
        score: seed.score,
        metadata: stored?.metadata ?? (seed.metadata && typeof seed.metadata === 'object' ? seed.metadata : {})
      };

      const rank = toSimilarity(seed.score);
      ranked.set(id, { item: normalized, rank, hops: 0 });
      queue.push({ id, hops: 0, inheritedRank: rank });
    }

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      if (current.hops >= options.maxHops) {
        continue;
      }

      const neighbors = this.collectNeighborIds(current.id, itemsById);
      linkHits.sequential += neighbors.linkHits.sequential;
      linkHits.explicit += neighbors.linkHits.explicit;
      linkHits.turn += neighbors.linkHits.turn;
      linkHits.source += neighbors.linkHits.source;

      for (const neighborId of neighbors.ids) {
        const neighbor = itemsById.get(neighborId);
        if (!neighbor) {
          continue;
        }

        const nextHops = current.hops + 1;
        const nextRank = current.inheritedRank * 0.85;
        const existing = ranked.get(neighborId);

        if (existing && existing.rank >= nextRank) {
          continue;
        }

        ranked.set(neighborId, {
          item: {
            id: neighbor.id,
            text: neighbor.text,
            source: neighbor.source,
            score: undefined,
            metadata: {
              ...(neighbor.metadata || {}),
              _retrieval: {
                strategy: 'graph-expansion',
                hops: nextHops
              }
            }
          },
          rank: nextRank,
          hops: nextHops
        });

        queue.push({ id: neighborId, hops: nextHops, inheritedRank: nextRank });
      }
    }

    const ordered = Array.from(ranked.values())
      .sort((a, b) => {
        if (b.rank !== a.rank) {
          return b.rank - a.rank;
        }
        return a.hops - b.hops;
      })
      .slice(0, options.k)
      .map(entry => entry.item);

    const maxObservedHops = Array.from(ranked.values()).reduce((max, entry) => Math.max(max, entry.hops), 0);

    return {
      items: ordered,
      expandedHits: Math.max(0, ranked.size - seedMatches.length),
      maxObservedHops,
      linkHits
    };
  }

  private collectNeighborIds(currentId: number, itemsById: Map<number, StoredMetadataItem>): NeighborCollectionResult {
    const neighbors = new Set<number>();
    const linkHits = cloneLinkHits(ZERO_LINK_HITS);
    const item = itemsById.get(currentId);
    if (!item) {
      return { ids: [], linkHits };
    }

    const addNeighbor = (candidate: unknown, linkType: keyof GraphRagLinkHitCounters) => {
      const parsed = Number(candidate);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed === currentId) {
        return;
      }
      if (!itemsById.has(parsed)) {
        return;
      }
      if (neighbors.has(parsed)) {
        return;
      }
      neighbors.add(parsed);
      linkHits[linkType] += 1;
    };

    addNeighbor(currentId - 1, 'sequential');
    addNeighbor(currentId + 1, 'sequential');

    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const explicitNeighborIds = [metadata['relatedIds'], metadata['neighborIds'], metadata['adjacentIds']];
    for (const candidateSet of explicitNeighborIds) {
      if (Array.isArray(candidateSet)) {
        for (const candidate of candidateSet) {
          addNeighbor(candidate, 'explicit');
        }
      }
    }

    const turnId = metadata['turnId'];
    if (turnId !== undefined && turnId !== null && turnId !== '') {
      for (const candidate of itemsById.values()) {
        const candidateMeta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
        if (candidate.id !== currentId && candidateMeta['turnId'] === turnId) {
          addNeighbor(candidate.id, 'turn');
        }
      }
    }

    for (const candidate of itemsById.values()) {
      if (candidate.id !== currentId && candidate.source === item.source) {
        addNeighbor(candidate.id, 'source');
      }
    }

    return {
      ids: Array.from(neighbors.values()),
      linkHits
    };
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
    const replaceSources = new Set(
      (options.replaceSources || [])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );

    if (replaceSources.size > 0) {
      await this.replaceNamespaceSources(config, paths, docs, replaceSources);
      return;
    }

    const nextId = await this.nextId(paths.metaPath);
    const payloadItems = docs.map((doc, index) => ({
      id: nextId + index,
      text: doc.text,
      source: doc.source,
      createdAt: new Date().toISOString(),
      metadata: doc.metadata ?? {}
    }));

    await this.appendItems(config, paths, payloadItems);
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
        updatedAt: updatedMs > 0 ? new Date(updatedMs).toISOString() : null,
        graphrag: this.getGraphRagStats(namespace)
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
      },
      graphrag: this.aggregateGraphRagStats(namespaces.map(item => item.namespace))
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
    this.graphRagStatsByNamespace.delete(sanitized);
    return { namespace: sanitized, cleared: true };
  }

  private recordGraphRagRetrieval(
    namespace: string,
    payload: {
      vectorSeedHits: number;
      expandedHits: number;
      finalReturned: number;
      maxObservedHops: number;
      linkHits: GraphRagLinkHitCounters;
    }
  ): void {
    const stats = this.graphRagStatsByNamespace.get(namespace) ?? createEmptyGraphRagStats();
    stats.retrievals += 1;
    stats.vectorSeedHits += Math.max(0, Number(payload.vectorSeedHits ?? 0));
    stats.expandedHits += Math.max(0, Number(payload.expandedHits ?? 0));
    stats.finalReturned += Math.max(0, Number(payload.finalReturned ?? 0));
    stats.maxObservedHops = Math.max(stats.maxObservedHops, Math.max(0, Number(payload.maxObservedHops ?? 0)));
    stats.linkHits.sequential += Math.max(0, Number(payload.linkHits?.sequential ?? 0));
    stats.linkHits.explicit += Math.max(0, Number(payload.linkHits?.explicit ?? 0));
    stats.linkHits.turn += Math.max(0, Number(payload.linkHits?.turn ?? 0));
    stats.linkHits.source += Math.max(0, Number(payload.linkHits?.source ?? 0));
    stats.lastRetrievedAt = new Date().toISOString();
    this.graphRagStatsByNamespace.set(namespace, stats);
  }

  private getGraphRagStats(namespace: string): GraphRagNamespaceDiagnostics {
    const stats = this.graphRagStatsByNamespace.get(namespace) ?? createEmptyGraphRagStats();
    const retrievals = Math.max(0, Number(stats.retrievals ?? 0));
    const avgExpansionFactor = retrievals > 0
      ? Number((stats.finalReturned / Math.max(1, stats.vectorSeedHits)).toFixed(3))
      : 0;

    return {
      retrievals,
      vectorSeedHits: Math.max(0, Number(stats.vectorSeedHits ?? 0)),
      expandedHits: Math.max(0, Number(stats.expandedHits ?? 0)),
      finalReturned: Math.max(0, Number(stats.finalReturned ?? 0)),
      avgExpansionFactor,
      maxObservedHops: Math.max(0, Number(stats.maxObservedHops ?? 0)),
      linkHits: cloneLinkHits(stats.linkHits),
      lastRetrievedAt: stats.lastRetrievedAt ?? null
    };
  }

  private aggregateGraphRagStats(namespaces: string[]): GraphRagNamespaceDiagnostics {
    const aggregate = createEmptyGraphRagStats();
    for (const namespace of namespaces) {
      const current = this.graphRagStatsByNamespace.get(namespace);
      if (!current) {
        continue;
      }

      aggregate.retrievals += current.retrievals;
      aggregate.vectorSeedHits += current.vectorSeedHits;
      aggregate.expandedHits += current.expandedHits;
      aggregate.finalReturned += current.finalReturned;
      aggregate.maxObservedHops = Math.max(aggregate.maxObservedHops, current.maxObservedHops);
      aggregate.linkHits.sequential += current.linkHits.sequential;
      aggregate.linkHits.explicit += current.linkHits.explicit;
      aggregate.linkHits.turn += current.linkHits.turn;
      aggregate.linkHits.source += current.linkHits.source;

      const candidateMs = current.lastRetrievedAt ? new Date(current.lastRetrievedAt).getTime() : 0;
      const currentMs = aggregate.lastRetrievedAt ? new Date(aggregate.lastRetrievedAt).getTime() : 0;
      if (candidateMs > currentMs) {
        aggregate.lastRetrievedAt = current.lastRetrievedAt;
      }
    }

    const avgExpansionFactor = aggregate.retrievals > 0
      ? Number((aggregate.finalReturned / Math.max(1, aggregate.vectorSeedHits)).toFixed(3))
      : 0;

    return {
      retrievals: aggregate.retrievals,
      vectorSeedHits: aggregate.vectorSeedHits,
      expandedHits: aggregate.expandedHits,
      finalReturned: aggregate.finalReturned,
      avgExpansionFactor,
      maxObservedHops: aggregate.maxObservedHops,
      linkHits: cloneLinkHits(aggregate.linkHits),
      lastRetrievedAt: aggregate.lastRetrievedAt
    };
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
      return normalizeEmbeddingDimension(embedding);
    } catch (error) {
      this.onEvent?.(`[memory] embedding fallback used: ${error instanceof Error ? error.message : String(error)}`);
      return fallbackEmbedding(text, TARGET_EMBEDDING_DIM);
    }
  }

  private async resetNamespaceIndex(paths: MemoryPathPair): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');

    const rotate = async (sourcePath: string) => {
      const exists = await fs.stat(sourcePath).then(() => true).catch(() => false);
      if (!exists) {
        return;
      }
      const backupPath = `${sourcePath}.bak-${stamp}`;
      await fs.rename(sourcePath, backupPath);
    };

    await rotate(paths.indexPath);
    await rotate(paths.metaPath);
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

  private async replaceNamespaceSources(
    config: LLMConfig,
    paths: MemoryPathPair,
    docs: Array<{ text: string; source: string; metadata?: Record<string, unknown> }>,
    replaceSources: Set<string>
  ): Promise<void> {
    const existing = await this.readMetadataItems(paths.metaPath);
    const kept = existing.filter(item => !replaceSources.has(String(item.source || '').trim()));
    const additions = docs.map(doc => ({
      text: doc.text,
      source: doc.source,
      createdAt: new Date().toISOString(),
      metadata: doc.metadata ?? {}
    }));

    await this.resetNamespaceIndex(paths);

    if (kept.length > 0) {
      await this.appendItems(config, paths, kept);
    }
    if (additions.length > 0) {
      await this.appendItems(config, paths, additions);
    }
  }

  private async appendItems(
    config: LLMConfig,
    paths: MemoryPathPair,
    items: Array<{ text: string; source: string; createdAt: string; metadata: Record<string, unknown> }>
  ): Promise<void> {
    if (!items.length) {
      return;
    }

    const currentStartId = await this.nextId(paths.metaPath);
    const vectors = await Promise.all(items.map(item => this.embeddingFor(config, item.text)));
    const payload = {
      action: 'add',
      ids: items.map((_item, index) => currentStartId + index),
      vectors,
      items
    };

    try {
      await this.callBridge(paths, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/dim mismatch/i.test(message)) {
        throw error;
      }

      this.onEvent?.('[memory] detected legacy TurboVec dimension mismatch; resetting namespace index and retrying.');
      await this.resetNamespaceIndex(paths);
      await this.callBridge(paths, {
        action: 'add',
        ids: items.map((_item, index) => index + 1),
        vectors,
        items
      });
    }
  }

  private async readMetadataItems(
    metaPath: string
  ): Promise<StoredMetadataItem[]> {
    const raw = await fs.readFile(metaPath, 'utf8').catch(() => '');
    if (!raw.trim()) {
      return [];
    }

    const items: StoredMetadataItem[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as {
          id?: number;
          text?: string;
          source?: string;
          createdAt?: string;
          metadata?: Record<string, unknown>;
        };
        const id = Number(parsed.id ?? 0);
        const text = String(parsed.text ?? '').trim();
        const source = String(parsed.source ?? '').trim();
        if (!Number.isFinite(id) || id <= 0 || !text || !source) {
          continue;
        }

        items.push({
          id,
          text,
          source,
          createdAt: String(parsed.createdAt ?? new Date().toISOString()),
          metadata: parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}
        });
      } catch {
        // Ignore malformed lines and continue.
      }
    }

    return items;
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

    try {
      await this.ensureProjectVenvInitialized();
    } catch (error) {
      this.onEvent?.(`[memory] TurboVec venv initialization failed: ${error instanceof Error ? error.message : String(error)}`);
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
    if (this.looksLikeFilePath(executable) && !(await this.fileExists(executable))) {
      return false;
    }

    return await new Promise(resolve => {
      const child = spawn(executable, this.withPythonLauncherArgs(executable, ['-c', 'import numpy, turbovec']), {
        env: process.env
      });

      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    });
  }

  private async isPythonInterpreter(executable: string): Promise<boolean> {
    if (this.looksLikeFilePath(executable) && !(await this.fileExists(executable))) {
      return false;
    }

    return await new Promise(resolve => {
      const child = spawn(executable, this.withPythonLauncherArgs(executable, ['-c', 'import sys; print(sys.version)']), {
        env: process.env
      });
      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    });
  }

  private async ensureProjectVenvInitialized(): Promise<void> {
    if (this.bootstrapAttempted) {
      await this.bootstrapInFlight;
      return;
    }

    this.bootstrapAttempted = true;
    this.bootstrapInFlight = (async () => {
      const seedPython = await this.resolveSeedPythonExecutable();
      if (!seedPython) {
        throw new Error('No usable Python interpreter found to initialize .turbovec-venv');
      }

      await fs.mkdir(path.dirname(this.projectVenvDir), { recursive: true });

      const preferredVenvPython = this.projectVenvPythonCandidates[0];
      if (!(await this.fileExists(preferredVenvPython))) {
        this.onEvent?.('[memory] initializing TurboVec virtual environment...');
        await this.runProcess(seedPython, this.withPythonLauncherArgs(seedPython, ['-m', 'venv', this.projectVenvDir]));
      }

      const venvPython = await this.resolveProjectVenvPythonExecutable();
      if (!venvPython) {
        throw new Error('TurboVec virtual environment python executable is missing after venv creation');
      }

      await this.runProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
      await this.runProcess(venvPython, ['-m', 'pip', 'install', 'numpy', 'turbovec']);
    })();

    try {
      await this.bootstrapInFlight;
    } finally {
      this.bootstrapInFlight = null;
    }
  }

  private async resolveSeedPythonExecutable(): Promise<string | null> {
    const explicit = process.env.TURBOVEC_PYTHON?.trim();
    const candidates = [
      explicit,
      process.platform === 'win32' ? 'py' : undefined,
      'python3',
      'python',
      '/usr/bin/python3'
    ].filter((value): value is string => Boolean(value));

    for (const candidate of Array.from(new Set(candidates))) {
      if (await this.isPythonInterpreter(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async resolveProjectVenvPythonExecutable(): Promise<string | null> {
    for (const candidate of this.projectVenvPythonCandidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false);
  }

  private looksLikeFilePath(value: string): boolean {
    return value.includes('/') || value.includes('\\');
  }

  private withPythonLauncherArgs(executable: string, args: string[]): string[] {
    if (process.platform === 'win32' && executable.toLowerCase() === 'py') {
      return ['-3', ...args];
    }
    return args;
  }

  private async runProcess(executable: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        env: process.env
      });

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', err => reject(err));
      child.on('close', code => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `Command failed: ${executable} ${args.join(' ')}`));
      });
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
