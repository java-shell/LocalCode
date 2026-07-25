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

interface MultiRetrieveOptions {
  namespaces: string[];
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

/** Cached metadata state per namespace for O(1) neighbor lookups */
interface MetadataCacheEntry {
  items: StoredMetadataItem[];
  byId: Map<number, StoredMetadataItem>;
  byTurnId: Map<string, number[]>;
  bySource: Map<string, number[]>;
  fileMtimeMs: number;
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

/** P3 #10: Persistent GraphRAG stats stored per namespace on disk */
interface PersistedGraphRagStatsV1 {
  format: 'localcode.turbovec.graphrag.stats.v1';
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

/** Default embedding dimension for new namespaces (used only when LLM endpoint is unavailable) */
/**
 * P3 #8: Adaptive memory injection limits based on context window size.
 * 
 * Scales max items and character limits proportionally to the model's context window.
 * Uses a baseline of 8K context = default limits, scaling up for larger windows.
 * 
 * @param contextWindowTokens - The model's context window in tokens (defaults to 8192)
 * @returns Object with maxItems, maxCharsPerItem, and maxTotalChars
 */
export function computeAdaptiveInjectionLimits(contextWindowTokens?: number): {
  maxItems: number;
  maxCharsPerItem: number;
  maxTotalChars: number;
} {
  // Baseline: 8K context window gets the original defaults
  const baselineContext = 8192;
  const effectiveContext = Math.max(4096, Number(contextWindowTokens ?? baselineContext));
  
  // Scale factor: how many times larger than baseline?
  const scale = Math.min(effectiveContext / baselineContext, 8); // Cap at 8x to prevent runaway
  
  // Base limits (original hardcoded values)
  const baseMaxItems = 4;
  const baseMaxCharsPerItem = 1000;
  const baseMaxTotalChars = 3500;
  
  // Scale proportionally, with minimums to ensure at least some memory is injected
  const maxItems = Math.max(2, Math.round(baseMaxItems * scale));
  const maxCharsPerItem = Math.max(400, Math.round(baseMaxCharsPerItem * scale));
  const maxTotalChars = Math.max(1500, Math.round(baseMaxTotalChars * scale));
  
  return { maxItems, maxCharsPerItem, maxTotalChars };
}

const DEFAULT_EMBEDDING_DIM = 256;
const MAX_BRIDGE_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_BRIDGE_STDERR_BYTES = 1 * 1024 * 1024;

/** Namespace config sidecar stores embedding dimension and schema version */
interface NamespaceConfigV1 {
  format: 'localcode.turbovec.namespace.config.v1';
  embeddingDim: number;
  createdAt: string;
  updatedAt: string;
}

/** Persistent Python worker state for P1 #6 */
interface BridgeWorker {
  child: ReturnType<typeof spawn>;
  ready: boolean;
  resolveReady?: () => void;
  rejectReady?: (err: Error) => void;
  pendingRequests: Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }>;
  nextRequestId: number;
}

export interface TurboVecNamespaceDiagnostics {
  namespace: string;
  records: number;
  indexBytes: number;
  metadataBytes: number;
  updatedAt: string | null;
  graphrag: GraphRagNamespaceDiagnostics;
  scope?: 'global' | 'workspace';
  locked?: boolean;
}

export interface TurboVecDiagnostics {
  ok: boolean;
  pythonExecutable: string;
  bridgeScriptPath: string;
  memoryRoot: string;
  globalMemoryRoot?: string;
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

export interface TurboVecNamespaceArchiveV1 {
  format: 'localcode.turbovec.namespace.v1';
  namespace: string;
  exportedAt: string;
  recordCount: number;
  metadataJsonl: string;
  indexBase64?: string;
}

export interface TurboVecImportNamespaceOptions {
  targetNamespace?: string;
  overwrite?: boolean;
}

export interface TurboVecImportNamespaceResult {
  namespace: string;
  replaced: boolean;
  recordCount: number;
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

function fallbackEmbedding(text: string, dim = DEFAULT_EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const idx = (i * 131 + code) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map(value => value / norm);
}

/**
 * P1 #3: Normalize embedding to unit length WITHOUT dimension folding.
 * Returns the embedding at its native dimension. The caller is responsible
 * for ensuring dimension consistency via namespace config sidecar.
 */
function normalizeEmbedding(embedding: number[]): number[] {
  // Filter out non-finite values but preserve native dimension
  const vec = embedding.map(value => Number.isFinite(Number(value)) ? Number(value) : 0);

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map(value => value / norm);
}

/**
 * P1 #3: Read namespace config sidecar to get stored embedding dimension.
 * Returns undefined if no config exists yet (new namespace).
 */
async function readNamespaceConfig(configPath: string): Promise<NamespaceConfigV1 | null> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as NamespaceConfigV1;
    if (parsed.format === 'localcode.turbovec.namespace.config.v1' && Number.isFinite(parsed.embeddingDim)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * P1 #3: Write namespace config sidecar with embedding dimension.
 */
async function writeNamespaceConfig(configPath: string, embeddingDim: number): Promise<void> {
  const parent = path.dirname(configPath);
  await fs.mkdir(parent, { recursive: true });
  const config: NamespaceConfigV1 = {
    format: 'localcode.turbovec.namespace.config.v1',
    embeddingDim,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(configPath, JSON.stringify(config), 'utf8');
}

/**
 * P1 #3: Get the config path for a namespace (sidecar file next to index/meta).
 */
function namespaceConfigPath(indexPath: string): string {
  return indexPath.replace(/\.tvec$/, '.config.json');
}

export class TurboVecMemory {
  private readonly rootDir: string;
  private readonly globalMemoryRoot: string;
  private readonly bridgeScriptPath: string;
  private readonly onEvent?: (event: string) => void;
  private readonly pythonExecutableCandidates: string[];
  private readonly projectVenvDir: string;
  private readonly projectVenvPythonCandidates: string[];
  private resolvedPythonExecutable: string | null = null;
  private bootstrapAttempted = false;
  private bootstrapInFlight: Promise<void> | null = null;
  private readonly graphRagStatsByNamespace = new Map<string, GraphRagMutableNamespaceStats>();
  private readonly lockedNamespaces = new Set<string>();
  /** Cached metadata per namespace with reverse indexes for O(1) neighbor lookups */
  private readonly metadataCache = new Map<string, MetadataCacheEntry>();
  /** Monotonically increasing turn counter for assigning turnIds at store time */
  private turnCounter = 0;
  /** P1 #3: Cached embedding dimension per namespace (read from namespace config sidecar) */
  private readonly embeddingDimByNamespace = new Map<string, number>();
  /** P1 #6: Persistent Python worker for bridge calls (eliminates spawn-per-call overhead) */
  private bridgeWorker: BridgeWorker | null = null;
  private bridgeWorkerInFlight: Promise<BridgeWorker> | null = null;

  constructor(rootDir: string, bridgeScriptPath: string, onEvent?: (event: string) => void, projectVenvDir?: string, globalMemoryRoot?: string) {
    this.rootDir = rootDir;
    this.globalMemoryRoot = globalMemoryRoot || path.join(rootDir, '..', 'turbovec-global-memory');
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

  /**
   * Set which global namespaces are locked (immutable).
   */
  setLockedNamespaces(namespaces: string[]): void {
    this.lockedNamespaces.clear();
    for (const ns of namespaces) {
      const sanitized = sanitizeNamespace(ns);
      if (sanitized) {
        this.lockedNamespaces.add(sanitized);
      }
    }
  }

  /**
   * Get the list of locked namespace names.
   */
  getLockedNamespaces(): string[] {
    return Array.from(this.lockedNamespaces);
  }

  /**
   * Check if a namespace is locked.
   */
  isNamespaceLocked(namespace: string): boolean {
    return this.lockedNamespaces.has(sanitizeNamespace(namespace));
  }

  async retrieve(config: LLMConfig, query: string, options: RetrieveOptions): Promise<RetrievedMemoryItem[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const paths = await this.memoryPaths(options.namespace);
    
    // P1 #3: Get expected embedding dimension for this namespace
    const namespace = sanitizeNamespace(options.namespace);
    const expectedDim = await this.getNamespaceEmbeddingDim(namespace, paths.indexPath);
    const vector = await this.embeddingFor(config, trimmedQuery, expectedDim);

    try {
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

      // P0 #2: Use cached metadata with reverse indexes for O(1) neighbor lookups
      const cache = await this.getCachedMetadata(namespace, paths.metaPath);
      const expanded = this.hybridExpand(seedMatches, cache.byId, {
        k: targetK,
        maxHops: Math.max(1, Math.min(3, Number(options.maxHops ?? 1)))
      }, cache);

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

  /**
   * Retrieve from multiple namespaces and merge results.
   *
   * P2 #5: Weighted multi-namespace budgeting + score normalization.
   * - Each namespace gets a vector-k proportional to its record count (larger namespaces get more seed queries)
   * - Scores are min-max normalized within each namespace before merging so cross-namespace comparison is meaningful
   * - Graph expansion still uses the per-namespace target k
   */
  async retrieveMulti(config: LLMConfig, query: string, options: MultiRetrieveOptions): Promise<RetrievedMemoryItem[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const namespaces = options.namespaces
      .map(ns => ns.trim())
      .filter(Boolean);

    if (namespaces.length === 0) {
      return [];
    }

    // If only one namespace, delegate to single retrieve
    if (namespaces.length === 1) {
      return this.retrieve(config, query, {
        namespace: namespaces[0],
        k: options.k,
        vectorK: options.vectorK,
        maxHops: options.maxHops
      });
    }

    const targetK = Math.max(1, Math.min(20, Number(options.k ?? 6)));

    // P2 #5: Gather record counts per namespace for weighted budgeting
    const recordCounts = await Promise.all(
      namespaces.map(async (ns) => {
        try {
          const paths = await this.memoryPaths(ns);
          const raw = await fs.readFile(paths.metaPath, 'utf8').catch(() => '');
          const count = raw.trim()
            ? raw.split(/\r?\n/).filter(line => line.trim()).length
            : 0;
          return { ns, count };
        } catch {
          return { ns, count: 0 };
        }
      })
    );

    const totalRecords = recordCounts.reduce((sum, r) => sum + Math.max(r.count, 1), 0);

    // P2 #5: Weighted per-namespace vector-k (proportional to size, minimum 2 for small namespaces)
    const perNamespaceVectorKs = recordCounts.map(({ count }) => {
      const weight = Math.max(count, 1) / totalRecords;
      return Math.max(2, Math.round(weight * targetK * 3)); // 3x oversampling for graph expansion headroom
    });

    // Retrieve from each namespace in parallel with weighted k
    const results = await Promise.all(
      namespaces.map(async (ns, idx) => {
        try {
          return await this.retrieve(config, query, {
            namespace: ns,
            k: targetK, // graph expansion still targets final k per namespace
            vectorK: perNamespaceVectorKs[idx],
            maxHops: options.maxHops
          });
        } catch (error) {
          this.onEvent?.(`[memory] retrieval from namespace '${ns}' skipped: ${error instanceof Error ? error.message : String(error)}`);
          return [];
        }
      })
    );

    // P2 #5: Min-max normalize scores within each namespace before merging
    const normalizedResults = results.map((items, nsIdx) => {
      if (items.length === 0) return [];
      // Only normalize items that have vector scores (graph-expanded items have undefined score)
      const scoredItems = items.filter(i => i.score !== undefined && Number.isFinite(i.score!));
      if (scoredItems.length === 0) return items;

      const minScore = Math.min(...scoredItems.map(i => i.score!));
      const maxScore = Math.max(...scoredItems.map(i => i.score!));
      const range = maxScore - minScore || 1; // avoid division by zero

      return items.map(item => {
        if (item.score === undefined || !Number.isFinite(item.score!)) {
          return item; // graph-expanded items keep undefined score (they'll sort last)
        }
        // Normalize: lower distance → higher normalized score. Invert so 1=best, 0=worst.
        const normalized = 1 - ((item.score! - minScore) / range);
        return { ...item, score: normalized };
      });
    });

    // Merge all results, removing duplicates by id, and re-rank by normalized score
    const seenIds = new Set<number>();
    const merged: RetrievedMemoryItem[] = [];

    for (const items of normalizedResults) {
      for (const item of items) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          merged.push(item);
        }
      }
    }

    // Sort by score: normalized scores (higher=better), graph-expanded (undefined) sort last
    merged.sort((a, b) => {
      const hasScoreA = a.score !== undefined && Number.isFinite(a.score!);
      const hasScoreB = b.score !== undefined && Number.isFinite(b.score!);

      if (hasScoreA && hasScoreB) {
        // Higher normalized score first (inverted distance)
        return Number(b.score!) - Number(a.score!);
      }
      if (hasScoreA) return -1;
      if (hasScoreB) return 1;
      return 0; // both graph-expanded, keep original order
    });

    return merged.slice(0, targetK);
  }

  private hybridExpand(
    seedMatches: RetrievedMemoryItem[],
    itemsById: Map<number, StoredMetadataItem>,
    options: { k: number; maxHops: number },
    cache?: MetadataCacheEntry
  ): HybridExpandResult {
    if (seedMatches.length === 0) {
      return {
        items: [],
        expandedHits: 0,
        maxObservedHops: 0,
        linkHits: cloneLinkHits(ZERO_LINK_HITS)
      };
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

      const neighbors = this.collectNeighborIds(current.id, itemsById, cache);
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

  private collectNeighborIds(currentId: number, itemsById: Map<number, StoredMetadataItem>, cache?: MetadataCacheEntry): NeighborCollectionResult {
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

    // P0 #2: Use reverse indexes for O(1) turn/source neighbor lookups when cache is available
    const turnId = metadata['turnId'];
    if (turnId !== undefined && turnId !== null && turnId !== '') {
      if (cache?.byTurnId.has(String(turnId))) {
        for (const neighborId of cache.byTurnId.get(String(turnId))!) {
          addNeighbor(neighborId, 'turn');
        }
      } else {
        // Fallback: O(N) scan when cache unavailable (shouldn't happen in normal flow)
        for (const candidate of Array.from(itemsById.values())) {
          const candidateMeta = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
          if (candidate.id !== currentId && candidateMeta['turnId'] === turnId) {
            addNeighbor(candidate.id, 'turn');
          }
        }
      }
    }

    if (cache?.bySource.has(item.source)) {
      for (const neighborId of cache.bySource.get(item.source)!) {
        addNeighbor(neighborId, 'source');
      }
    } else {
      // Fallback: O(N) scan when cache unavailable
      for (const candidate of Array.from(itemsById.values())) {
        if (candidate.id !== currentId && candidate.source === item.source) {
          addNeighbor(candidate.id, 'source');
        }
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
      // Check if namespace is locked - mutations not allowed on locked namespaces
      if (this.isNamespaceLocked(options.namespace)) {
        this.onEvent?.(`[memory] cannot modify locked namespace: ${options.namespace}`);
        return;
      }
      await this.replaceNamespaceSources(config, paths, docs, replaceSources);
      return;
    }

    // P2 #9: Store-time deduplication — skip items that are too similar to recent items
    const uniqueDocs = await this.deduplicateDocs(config, paths, docs);
    if (uniqueDocs.length === 0) {
      this.onEvent?.(`[memory] all ${docs.length} item(s) skipped: duplicates of existing content`);
      return;
    }
    if (uniqueDocs.length < docs.length) {
      this.onEvent?.(`[memory] deduplication: skipped ${docs.length - uniqueDocs.length} duplicate(s), storing ${uniqueDocs.length}`);
    }

    const nextId = await this.nextId(paths.metaPath);
    
    // P0 #1: Assign a shared turnId to all items stored together in this batch.
    // This enables GraphRAG turn-based expansion so user+assistant pairs from the
    // same conversation turn become graph neighbors.
    this.turnCounter += 1;
    const turnId = `turn_${this.turnCounter}_${Date.now()}`;
    
    const payloadItems = uniqueDocs.map((doc, index) => {
      const baseMeta = (doc.metadata && typeof doc.metadata === 'object') ? { ...doc.metadata } : {};
      return {
        id: nextId + index,
        text: doc.text,
        source: doc.source,
        createdAt: new Date().toISOString(),
        metadata: { ...baseMeta, turnId }
      };
    });

    await this.appendItems(config, paths, payloadItems);
    
    // P0 #2: Invalidate cache so next retrieval picks up new turnId/source indexes
    const namespace = sanitizeNamespace(options.namespace);
    this.invalidateMetadataCache(namespace);
  }

  /**
   * P2 #9: Deduplicate documents against recent items in the same namespace.
   * Compares each new document's embedding against the last N stored items using
   * cosine similarity. Items above the threshold are skipped as duplicates.
   */
  private async deduplicateDocs(
    config: LLMConfig,
    paths: MemoryPathPair,
    docs: Array<{ text: string; source: string; metadata?: Record<string, unknown> }>
  ): Promise<typeof docs> {
    // Load recent items for comparison (last 50 items to keep it fast)
    const recentItems = await this.getRecentItems(paths.metaPath, 50);
    if (recentItems.length === 0) {
      return docs; // Nothing to compare against, store everything
    }

    // Get embeddings for recent items and new docs
    const expectedDim = await this.getNamespaceEmbeddingDim(
      path.basename(path.dirname(paths.indexPath)),
      paths.indexPath
    );

    const recentEmbeddings = await Promise.all(
      recentItems.map(item => this.embeddingFor(config, item.text, expectedDim))
    );

    const uniqueDocs: typeof docs = [];

    for (const doc of docs) {
      try {
        const docEmbedding = await this.embeddingFor(config, doc.text, expectedDim);
        let maxSimilarity = 0;

        // Compare against all recent embeddings
        for (const recentEmbedding of recentEmbeddings) {
          const similarity = this.cosineSimilarity(docEmbedding, recentEmbedding);
          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
          }
        }

        // P2 #9: Skip if too similar (threshold 0.95 for near-duplicates)
        if (maxSimilarity < 0.95) {
          uniqueDocs.push(doc);
        }
      } catch {
        // If embedding fails, keep the doc to avoid data loss
        uniqueDocs.push(doc);
      }
    }

    return uniqueDocs;
  }

  /**
   * Get the last N items from metadata for deduplication comparison.
   */
  private async getRecentItems(metaPath: string, limit: number): Promise<StoredMetadataItem[]> {
    const allItems = await this.readMetadataItems(metaPath);
    if (allItems.length <= limit) {
      return allItems;
    }
    return allItems.slice(-limit);
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  /**
   * Scan a root directory for namespaces and build diagnostics entries.
   */
  private async scanNamespacesInRoot(root: string, scope: 'global' | 'workspace', namespaceFilter?: string): Promise<TurboVecNamespaceDiagnostics[]> {
    const namespaces: TurboVecNamespaceDiagnostics[] = [];
    
    try {
      await fs.mkdir(root, { recursive: true });
      const entries = await fs.readdir(root, { withFileTypes: true });
      const filtered = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => !namespaceFilter || name.includes(sanitizeNamespace(namespaceFilter)));

      for (const namespace of filtered) {
        const dir = path.join(root, namespace);
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
          graphrag: this.getGraphRagStats(namespace),
          scope,
          locked: this.isNamespaceLocked(namespace)
        });
      }
    } catch {
      // Root directory may not exist yet, which is fine
    }
    
    return namespaces;
  }

  async diagnostics(namespaceFilter?: string): Promise<TurboVecDiagnostics> {
    await fs.mkdir(this.rootDir, { recursive: true });
    
    // Scan both workspace and global roots
    const workspaceNamespaces = await this.scanNamespacesInRoot(this.rootDir, 'workspace', namespaceFilter);
    const globalNamespaces = await this.scanNamespacesInRoot(this.globalMemoryRoot, 'global');
    
    // Merge all namespaces (global ones always shown regardless of filter)
    const allNamespaces = [...globalNamespaces, ...workspaceNamespaces];
    allNamespaces.sort((a, b) => {
      // Global namespaces first, then alphabetically
      if (a.scope === 'global' && b.scope !== 'global') return -1;
      if (a.scope !== 'global' && b.scope === 'global') return 1;
      return a.namespace.localeCompare(b.namespace);
    });

    const health = await this.bridgeHealth();

    return {
      ok: health.ok,
      pythonExecutable: this.resolvedPythonExecutable || this.pythonExecutableCandidates[0] || 'python3',
      bridgeScriptPath: this.bridgeScriptPath,
      memoryRoot: this.rootDir,
      globalMemoryRoot: this.globalMemoryRoot,
      health,
      namespaces: allNamespaces,
      totals: {
        namespaces: allNamespaces.length,
        records: allNamespaces.reduce((sum, item) => sum + item.records, 0),
        indexBytes: allNamespaces.reduce((sum, item) => sum + item.indexBytes, 0),
        metadataBytes: allNamespaces.reduce((sum, item) => sum + item.metadataBytes, 0)
      },
      graphrag: this.aggregateGraphRagStats(allNamespaces.map(item => item.namespace))
    };
  }

  async clearNamespace(namespace: string): Promise<{ namespace: string; cleared: boolean }> {
    const sanitized = sanitizeNamespace(namespace);
    
    // Check if namespace is locked - only global namespaces can be locked
    if (this.isNamespaceLocked(sanitized)) {
      this.onEvent?.(`[memory] cannot clear locked namespace: ${sanitized}`);
      return { namespace: sanitized, cleared: false };
    }
    
    // Check both roots and clear from whichever has it
    for (const root of [this.globalMemoryRoot, this.rootDir]) {
      const dir = path.join(root, sanitized);
      const exists = await fs.stat(dir).then(() => true).catch(() => false);
      if (exists) {
        await fs.rm(dir, { recursive: true, force: true });
        this.graphRagStatsByNamespace.delete(sanitized);
        this.invalidateMetadataCache(sanitized);
        return { namespace: sanitized, cleared: true };
      }
    }
    
    return { namespace: sanitized, cleared: false };
  }

  async exportNamespaceArchive(namespace: string): Promise<TurboVecNamespaceArchiveV1> {
    const sanitized = sanitizeNamespace(namespace);
    const paths = await this.memoryPaths(sanitized);
    const metadataRaw = await fs.readFile(paths.metaPath, 'utf8').catch(() => '');
    if (!metadataRaw.trim()) {
      throw new Error(`Namespace ${sanitized} has no metadata to export.`);
    }

    const metadataJsonl = this.normalizeMetadataJsonl(metadataRaw);
    const indexBuffer = await fs.readFile(paths.indexPath).catch(() => null as Buffer | null);

    return {
      format: 'localcode.turbovec.namespace.v1',
      namespace: sanitized,
      exportedAt: new Date().toISOString(),
      recordCount: this.countMetadataLines(metadataJsonl),
      metadataJsonl,
      indexBase64: indexBuffer && indexBuffer.length > 0 ? indexBuffer.toString('base64') : undefined
    };
  }

  async importNamespaceArchive(
    archive: unknown,
    options: TurboVecImportNamespaceOptions = {}
  ): Promise<TurboVecImportNamespaceResult> {
    const normalized = this.normalizeArchivePayload(archive);
    const targetNamespace = sanitizeNamespace(options.targetNamespace || normalized.namespace);
    const overwrite = Boolean(options.overwrite);
    const targetDir = path.join(this.rootDir, targetNamespace);
    const existed = await fs.stat(targetDir).then(() => true).catch(() => false);

    if (existed && !overwrite) {
      throw new Error(`Namespace ${targetNamespace} already exists. Enable overwrite to replace it.`);
    }

    if (existed) {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
    await fs.mkdir(targetDir, { recursive: true });

    const indexPath = path.join(targetDir, 'memory.tvec');
    const metaPath = path.join(targetDir, 'memory.jsonl');

    await fs.writeFile(metaPath, normalized.metadataJsonl, 'utf8');
    if (normalized.indexBase64) {
      const decoded = Buffer.from(normalized.indexBase64, 'base64');
      if (decoded.length > 0) {
        await fs.writeFile(indexPath, decoded);
      }
    }

    this.graphRagStatsByNamespace.delete(targetNamespace);
    this.invalidateMetadataCache(targetNamespace);

    return {
      namespace: targetNamespace,
      replaced: existed,
      recordCount: this.countMetadataLines(normalized.metadataJsonl)
    };
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
    
    // P3 #10: Persist stats to disk after each retrieval (fire-and-forget)
    this.persistGraphRagStats(namespace).catch(() => {});
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
  /**
   * P3 #10: Persist GraphRAG stats to disk per namespace so they survive restarts.
   * Stats are stored as a JSON sidecar file next to the index.
   */
  private async persistGraphRagStats(namespace: string): Promise<void> {
    const stats = this.graphRagStatsByNamespace.get(namespace);
    if (!stats) {
      return;
    }
    
    try {
      const paths = await this.memoryPaths(namespace);
      const dir = path.dirname(paths.indexPath);
      const statsPath = path.join(dir, 'graphrag.stats.json');
      
      const persisted: PersistedGraphRagStatsV1 = {
        format: 'localcode.turbovec.graphrag.stats.v1',
        retrievals: stats.retrievals,
        vectorSeedHits: stats.vectorSeedHits,
        expandedHits: stats.expandedHits,
        finalReturned: stats.finalReturned,
        maxObservedHops: stats.maxObservedHops,
        linkHits: cloneLinkHits(stats.linkHits),
        lastRetrievedAt: stats.lastRetrievedAt
      };
      
      await fs.writeFile(statsPath, JSON.stringify(persisted), 'utf8');
    } catch (error) {
      // Non-fatal: stats persistence failure should not break retrieval
      this.onEvent?.(`[memory] failed to persist GraphRAG stats for ${namespace}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * P3 #10: Load persisted GraphRag stats from disk for a namespace.
   * Returns null if no stats file exists or format is invalid.
   */
  private async loadGraphRagStats(namespace: string): Promise<GraphRagMutableNamespaceStats | null> {
    try {
      const paths = await this.memoryPaths(namespace);
      const dir = path.dirname(paths.indexPath);
      const statsPath = path.join(dir, 'graphrag.stats.json');
      
      const raw = await fs.readFile(statsPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedGraphRagStatsV1;
      
      if (parsed.format !== 'localcode.turbovec.graphrag.stats.v1') {
        return null;
      }
      
      return {
        retrievals: Math.max(0, Number(parsed.retrievals ?? 0)),
        vectorSeedHits: Math.max(0, Number(parsed.vectorSeedHits ?? 0)),
        expandedHits: Math.max(0, Number(parsed.expandedHits ?? 0)),
        finalReturned: Math.max(0, Number(parsed.finalReturned ?? 0)),
        maxObservedHops: Math.max(0, Number(parsed.maxObservedHops ?? 0)),
        linkHits: cloneLinkHits(parsed.linkHits),
        lastRetrievedAt: parsed.lastRetrievedAt ?? null
      };
    } catch {
      return null;
    }
  }
  
  /**
   * P3 #10: Load all persisted GraphRAG stats for known namespaces on startup.
   */
  async loadPersistedGraphRagStats(): Promise<void> {
    try {
      // Scan both workspace and global roots for namespace directories
      const allNamespaceDirs: string[] = [];
      
      for (const root of [this.rootDir, this.globalMemoryRoot]) {
        try {
          await fs.mkdir(root, { recursive: true });
          const entries = await fs.readdir(root, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const indexPath = path.join(root, entry.name, 'memory.tvec');
              try {
                await fs.stat(indexPath);
                allNamespaceDirs.push(entry.name);
              } catch { /* no index file, skip */ }
            }
          }
        } catch { /* root may not exist yet */ }
      }
      
      // Deduplicate namespace names
      const uniqueNamespaces = Array.from(new Set(allNamespaceDirs));
      
      for (const ns of uniqueNamespaces) {
        const stats = await this.loadGraphRagStats(ns);
        if (stats) {
          this.graphRagStatsByNamespace.set(ns, stats);
        }
      }
    } catch (error) {
      // Non-fatal: startup stats loading failure should not block operation
      this.onEvent?.(`[memory] failed to load persisted GraphRAG stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Check if a namespace exists in the given root directory.
   */
  private async namespaceExistsInRoot(namespace: string, root: string): Promise<boolean> {
    const name = sanitizeNamespace(namespace);
    const dir = path.join(root, name);
    const indexPath = path.join(dir, 'memory.tvec');
    const metaPath = path.join(dir, 'memory.jsonl');
    
    try {
      await fs.stat(indexPath);
      await fs.stat(metaPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve memory paths for a namespace, checking both global and workspace roots.
   * Global namespaces (without workspace path prefix) are stored in globalMemoryRoot.
   * Workspace-scoped namespaces are stored in rootDir.
   */
  private async memoryPaths(namespace: string): Promise<MemoryPathPair> {
    const name = sanitizeNamespace(namespace);
    
    // Check if namespace exists in global root first
    if (await this.namespaceExistsInRoot(name, this.globalMemoryRoot)) {
      const dir = path.join(this.globalMemoryRoot, name);
      return {
        indexPath: path.join(dir, 'memory.tvec'),
        metaPath: path.join(dir, 'memory.jsonl')
      };
    }
    
    // Otherwise use workspace root
    const dir = path.join(this.rootDir, name);
    await fs.mkdir(dir, { recursive: true });
    return {
      indexPath: path.join(dir, 'memory.tvec'),
      metaPath: path.join(dir, 'memory.jsonl')
    };
  }

  /**
   * Get the root directory for a namespace (for diagnostics and management).
   */
  private async getNamespaceRoot(namespace: string): Promise<string> {
    const name = sanitizeNamespace(namespace);
    if (await this.namespaceExistsInRoot(name, this.globalMemoryRoot)) {
      return this.globalMemoryRoot;
    }
    return this.rootDir;
  }

  /**
   * P1 #3: Get the expected embedding dimension for a namespace.
   * Reads from cached value or namespace config sidecar.
   * Returns undefined if namespace is new (no prior embeddings).
   */
  private async getNamespaceEmbeddingDim(namespace: string, indexPath: string): Promise<number | undefined> {
    const sanitized = sanitizeNamespace(namespace);
    
    // Check cache first
    const cached = this.embeddingDimByNamespace.get(sanitized);
    if (cached) {
      return cached;
    }
    
    // Read from config sidecar
    const configPath = namespaceConfigPath(indexPath);
    const config = await readNamespaceConfig(configPath);
    if (config) {
      this.embeddingDimByNamespace.set(sanitized, config.embeddingDim);
      return config.embeddingDim;
    }
    
    return undefined;
  }

  /**
   * P1 #3: Record the embedding dimension for a namespace.
   */
  private async recordNamespaceEmbeddingDim(namespace: string, indexPath: string, dim: number): Promise<void> {
    const sanitized = sanitizeNamespace(namespace);
    this.embeddingDimByNamespace.set(sanitized, dim);
    await writeNamespaceConfig(namespaceConfigPath(indexPath), dim);
  }

  /**
   * P1 #3: Get embedding for text at native dimension (no folding).
   * Optionally validates against expected namespace dimension.
   */
  private async embeddingFor(
    config: LLMConfig, 
    text: string, 
    expectedDim?: number
  ): Promise<number[]> {
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
      
      // P1 #3: Normalize to unit length but preserve native dimension
      const normalized = normalizeEmbedding(embedding);
      
      // Validate dimension matches expected (if known)
      if (expectedDim !== undefined && normalized.length !== expectedDim) {
        throw new Error(
          `dim mismatch: expected ${expectedDim}, got ${normalized.length}. ` +
          `Namespace must be re-indexed with the new embedding model.`
        );
      }
      
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onEvent?.(`[memory] embedding fallback used: ${message}`);
      // Use expected dimension if known, otherwise default
      const dim = expectedDim ?? DEFAULT_EMBEDDING_DIM;
      return fallbackEmbedding(text, dim);
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
    // P0 #1: Assign turnId to replacement items too
    this.turnCounter += 1;
    const turnId = `turn_${this.turnCounter}_${Date.now()}`;
    const additions = docs.map(doc => {
      const baseMeta = (doc.metadata && typeof doc.metadata === 'object') ? { ...doc.metadata } : {};
      return {
        text: doc.text,
        source: doc.source,
        createdAt: new Date().toISOString(),
        metadata: { ...baseMeta, turnId }
      };
    });

    await this.resetNamespaceIndex(paths);

    if (kept.length > 0) {
      await this.appendItems(config, paths, kept);
    }
    if (additions.length > 0) {
      await this.appendItems(config, paths, additions);
    }
    
    // P0 #2: Invalidate cache after namespace mutation
    for (const ns of Array.from(this.metadataCache.keys())) {
      this.invalidateMetadataCache(ns);
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

    // P1 #3: Check for existing embedding dimension in namespace
    const expectedDim = await this.getNamespaceEmbeddingDim(
      path.basename(path.dirname(paths.indexPath)), 
      paths.indexPath
    );
    
    const currentStartId = await this.nextId(paths.metaPath);
    const vectors = await Promise.all(
      items.map(item => this.embeddingFor(config, item.text, expectedDim))
    );
    
    // P1 #3: Record the embedding dimension for new namespaces
    if (expectedDim === undefined && vectors.length > 0) {
      const actualDim = vectors[0].length;
      await this.recordNamespaceEmbeddingDim(
        path.basename(path.dirname(paths.indexPath)),
        paths.indexPath,
        actualDim
      );
      this.onEvent?.(`[memory] namespace initialized with embedding dimension ${actualDim}`);
    }
    
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

      // P1 #3: On dimension mismatch, reset namespace and clear cached dimension
      this.onEvent?.('[memory] detected embedding dimension mismatch; resetting namespace index and retrying.');
      const nsName = path.basename(path.dirname(paths.indexPath));
      this.embeddingDimByNamespace.delete(nsName);
      await this.resetNamespaceIndex(paths);
      await this.callBridge(paths, {
        action: 'add',
        ids: items.map((_item, index) => index + 1),
        vectors,
        items
      });
      // Record new dimension after successful retry
      const newDim = vectors[0].length;
      await this.recordNamespaceEmbeddingDim(nsName, paths.indexPath, newDim);
    }
  }

  /**
   * P0 #2: Get cached metadata with reverse indexes for O(1) neighbor lookups.
   * Cache is invalidated by file mtime check - if the JSONL file changed since last load, reload.
   */
  private async getCachedMetadata(namespace: string, metaPath: string): Promise<MetadataCacheEntry> {
    const cached = this.metadataCache.get(namespace);

    // Check if cache is still valid by comparing file mtime
    let needsReload = !cached;
    if (cached) {
      try {
        const stat = await fs.stat(metaPath);
        if (stat.mtimeMs > cached.fileMtimeMs) {
          needsReload = true;
        }
      } catch {
        // File doesn't exist, cache is stale
        needsReload = true;
      }
    }

    if (needsReload) {
      const items = await this.readMetadataItems(metaPath);
      const byId = new Map<number, StoredMetadataItem>();
      const byTurnId = new Map<string, number[]>();
      const bySource = new Map<string, number[]>();

      for (const item of items) {
        byId.set(item.id, item);

        // Build turnId reverse index
        const turnId = item.metadata?.['turnId'];
        if (turnId && typeof turnId === 'string') {
          if (!byTurnId.has(turnId)) {
            byTurnId.set(turnId, []);
          }
          byTurnId.get(turnId)!.push(item.id);
        }

        // Build source reverse index
        if (!bySource.has(item.source)) {
          bySource.set(item.source, []);
        }
        bySource.get(item.source)!.push(item.id);
      }

      let fileMtimeMs = 0;
      try {
        const stat = await fs.stat(metaPath);
        fileMtimeMs = stat.mtimeMs;
      } catch {
        // Ignore if file doesn't exist yet
      }

      const entry: MetadataCacheEntry = { items, byId, byTurnId, bySource, fileMtimeMs };
      this.metadataCache.set(namespace, entry);
      return entry;
    }

    return cached!;
  }

  /**
   * Invalidate the metadata cache for a namespace (call after store operations).
   */
  private invalidateMetadataCache(namespace: string): void {
    this.metadataCache.delete(namespace);
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

  private countMetadataLines(raw: string): number {
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean).length;
  }

  private normalizeMetadataJsonl(raw: string): string {
    const lines = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new Error('Archive metadata is empty.');
    }

    const normalizedLines = lines.map((line, index) => {
      try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('metadata item must be a JSON object');
        }
        return JSON.stringify(parsed);
      } catch (error) {
        throw new Error(
          `Invalid metadata JSONL line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    return `${normalizedLines.join('\n')}\n`;
  }

  private normalizeArchivePayload(value: unknown): TurboVecNamespaceArchiveV1 {
    if (!value || typeof value !== 'object') {
      throw new Error('Namespace archive payload must be a JSON object.');
    }

    const archive = value as Record<string, unknown>;
    const format = String(archive.format || '').trim();
    if (format !== 'localcode.turbovec.namespace.v1') {
      throw new Error(`Unsupported namespace archive format: ${format || 'unknown'}`);
    }

    const namespace = sanitizeNamespace(String(archive.namespace || '').trim());
    const metadataJsonl = this.normalizeMetadataJsonl(String(archive.metadataJsonl || ''));
    const indexBase64 = typeof archive.indexBase64 === 'string' ? archive.indexBase64.trim() : '';

    return {
      format: 'localcode.turbovec.namespace.v1',
      namespace,
      exportedAt: String(archive.exportedAt || new Date().toISOString()),
      recordCount: this.countMetadataLines(metadataJsonl),
      metadataJsonl,
      indexBase64: indexBase64 || undefined
    };
  }

  /**
   * P1 #6: Get or create a persistent Python worker for bridge calls.
   * Eliminates spawn-per-call overhead (~50-200ms per retrieval).
   */
  private async getBridgeWorker(): Promise<BridgeWorker> {
    // Return existing worker if healthy
    if (this.bridgeWorker && !this.bridgeWorker.child.killed) {
      return this.bridgeWorker;
    }

    // If another caller is already starting a worker, wait for it
    if (this.bridgeWorkerInFlight) {
      return this.bridgeWorkerInFlight;
    }

    // Start a new worker
    this.bridgeWorkerInFlight = this._startBridgeWorker();
    try {
      const worker = await this.bridgeWorkerInFlight;
      this.bridgeWorker = worker;
      return worker;
    } finally {
      this.bridgeWorkerInFlight = null;
    }
  }

  private async _startBridgeWorker(): Promise<BridgeWorker> {
    const pythonExecutable = await this.resolvePythonExecutable();
    
    return new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, [this.bridgeScriptPath, '--worker'], {
        cwd: path.dirname(this.bridgeScriptPath),
        env: process.env
      });

      const worker: BridgeWorker = {
        child,
        ready: false,
        pendingRequests: new Map(),
        nextRequestId: 1
      };

      const stderrChunks: Buffer[] = [];
      let stderrBytes = 0;

      // Collect stderr for error reporting
      child.stderr.on('data', (chunk: Buffer | string) => {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (stderrBytes < MAX_BRIDGE_STDERR_BYTES) {
          stderrChunks.push(bufferChunk);
          stderrBytes += bufferChunk.length;
        }
      });

      // Parse stdout line by line for JSON responses
      let stdoutBuffer = '';
      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stdoutBuffer += text;
        
        // Process complete lines
        while (stdoutBuffer.includes('\n')) {
          const newlineIdx = stdoutBuffer.indexOf('\n');
          const line = stdoutBuffer.substring(0, newlineIdx).trim();
          stdoutBuffer = stdoutBuffer.substring(newlineIdx + 1);
          
          if (!line) continue;
          
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            
            // Handle ready signal
            if (parsed._ready === true && !worker.ready) {
              worker.ready = true;
              if (worker.resolveReady) {
                worker.resolveReady();
              }
              continue;
            }
            
            // Handle quit signal
            if (parsed._quit === true) {
              worker.ready = false;
              continue;
            }
            
            // Route response to pending request by id
            const requestId = parsed._requestId as number | undefined;
            if (requestId !== undefined && worker.pendingRequests.has(requestId)) {
              const handler = worker.pendingRequests.get(requestId)!;
              worker.pendingRequests.delete(requestId);
              
              if (!parsed.ok && parsed.error) {
                handler.reject(new Error(String(parsed.error)));
              } else {
                // Remove internal fields before returning
                delete parsed._requestId;
                handler.resolve(parsed);
              }
            }
          } catch {
            // Not valid JSON, ignore partial data
          }
        }
      });

      child.on('error', (err) => {
        if (worker.rejectReady) {
          worker.rejectReady(err);
        }
        // Reject all pending requests
        for (const [, handler] of worker.pendingRequests) {
          handler.reject(err);
        }
        worker.pendingRequests.clear();
      });

      child.on('close', (code) => {
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const error = code !== 0 
          ? new Error(stderr.trim() || `Bridge worker exited with code ${String(code)}`)
          : null;
        
        if (!worker.ready && worker.rejectReady) {
          worker.rejectReady(error || new Error('Worker failed to start'));
        }
        
        // Reject all pending requests
        for (const [, handler] of worker.pendingRequests) {
          handler.reject(error || new Error('Bridge worker closed'));
        }
        worker.pendingRequests.clear();
        worker.ready = false;
      });

      // Wait for ready signal with timeout
      const readyTimeout = setTimeout(() => {
        child.kill();
        reject(new Error('Bridge worker failed to start within 30s'));
      }, 30000);

      worker.resolveReady = () => {
        clearTimeout(readyTimeout);
        resolve(worker);
      };
      
      worker.rejectReady = (err: Error) => {
        clearTimeout(readyTimeout);
        reject(err);
      };
    });
  }

  /**
   * P1 #6: Call bridge via persistent worker (or fallback to spawn if worker unavailable).
   */
  private async callBridge(paths: MemoryPathPair, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Add index/meta paths to payload for worker mode
    const workerPayload: Record<string, unknown> = { ...payload, index: paths.indexPath, meta: paths.metaPath };
    
    try {
      const worker = await this.getBridgeWorker();
      
      return new Promise((resolve, reject) => {
        // Timeout for individual requests (30s)
        const timeout = setTimeout(() => {
          worker.pendingRequests.delete(worker.nextRequestId);
          reject(new Error('Bridge request timed out after 30s'));
        }, 30000);
        
        const requestId = worker.nextRequestId++;
        (workerPayload as Record<string, unknown>)._requestId = requestId;
        
        worker.pendingRequests.set(requestId, { resolve, reject });
        
        try {
          const stdin = worker.child.stdin;
          if (!stdin) {
            throw new Error('Worker stdin is not available');
          }
          stdin.write(JSON.stringify(workerPayload) + '\n');
        } catch (err) {
          worker.pendingRequests.delete(requestId);
          clearTimeout(timeout);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (workerError) {
      // Fallback to spawn-per-call if worker is unavailable
      this.onEvent?.(`[memory] bridge worker unavailable, falling back to spawn: ${workerError instanceof Error ? workerError.message : String(workerError)}`);
      return this.callBridgeSpawn(paths, payload);
    }
  }

  /**
   * Legacy spawn-per-call bridge (fallback when worker is unavailable).
   */
  private async callBridgeSpawn(paths: MemoryPathPair, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pythonExecutable = await this.resolvePythonExecutable();

    return await new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, [this.bridgeScriptPath, '--index', paths.indexPath, '--meta', paths.metaPath], {
        cwd: path.dirname(this.bridgeScriptPath),
        env: process.env
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutOverflowed = false;

      const appendChunk = (
        chunks: Buffer[],
        chunk: Buffer | string,
        currentBytes: number,
        maxBytes: number
      ): { nextBytes: number; overflowed: boolean } => {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (currentBytes >= maxBytes) {
          return { nextBytes: currentBytes, overflowed: true };
        }

        const available = maxBytes - currentBytes;
        if (bufferChunk.length <= available) {
          chunks.push(bufferChunk);
          return { nextBytes: currentBytes + bufferChunk.length, overflowed: false };
        }

        chunks.push(bufferChunk.subarray(0, available));
        return { nextBytes: maxBytes, overflowed: true };
      };

      child.stdout.on('data', (chunk: Buffer | string) => {
        const result = appendChunk(stdoutChunks, chunk, stdoutBytes, MAX_BRIDGE_STDOUT_BYTES);
        stdoutBytes = result.nextBytes;
        if (result.overflowed && !stdoutOverflowed) {
          stdoutOverflowed = true;
          child.kill();
        }
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        const result = appendChunk(stderrChunks, chunk, stderrBytes, MAX_BRIDGE_STDERR_BYTES);
        stderrBytes = result.nextBytes;
      });

      child.on('error', err => {
        reject(err);
      });

      child.on('close', code => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        if (stdoutOverflowed) {
          reject(new Error(`TurboVec bridge output exceeded ${MAX_BRIDGE_STDOUT_BYTES} bytes.`));
          return;
        }

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

  /**
   * P1 #6: Clean up resources including the persistent bridge worker.
   * Call this when shutting down the application.
   */
  async destroy(): Promise<void> {
    const worker = this.bridgeWorker;
    if (worker && !worker.child.killed) {
      try {
        // Send quit signal to worker
        const stdin = worker.child.stdin;
        if (stdin) {
          stdin.write(JSON.stringify({ action: 'quit' }) + '\n');
        }
        // Give it a moment to shut down gracefully
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch {
        // Ignore errors during cleanup
      }

      if (!worker.child.killed) {
        worker.child.kill();
      }
    }

    this.bridgeWorker = null;
    this.metadataCache.clear();
    this.embeddingDimByNamespace.clear();
  }
}
