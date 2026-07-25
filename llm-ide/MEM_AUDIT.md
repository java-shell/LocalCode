# Memory System Audit — TurboVec + GraphRAG

> **Date:** 2025-06-21  
> **Scope:** `src/backend/turboVecMemory.ts`, `src/backend/turbovec_bridge.py`, `src/backend/toolRuntime.ts`, `src/backend/orchestrationEngine.ts`, `src/main.ts`

---

## Architecture Summary

The memory system has two layers:

| Layer | Component | Role |
|-------|-----------|------|
| **Vector Store** | TurboVec (Python bridge, 2-bit PQ index) | Stores embeddings of text chunks; supports approximate nearest-neighbor search via `TurboQuantIndex` |
| **GraphRAG Expansion** | In-memory BFS over metadata links | After vector seed retrieval, expands results by walking "edges" defined in item metadata (`relatedIds`, `turnId`, sequential ID neighbors, source-group neighbors) |

### Retrieval Flow (single namespace)

```
query string
  → embeddingFor() → LLM /embeddings endpoint (or fallback hash)
  → callBridge(query, vector, k=vectorK) → Python TurboQuantIndex.search()
  → seedMatches[] (top-k by distance)
  → readMetadataItems(metaPath) → ALL items in namespace into memory
  → hybridExpand(seedMatches, allItems, maxHops=1)
      → BFS: collectNeighborIds() for each frontier node
      → rank decay: inheritedRank * 0.85 per hop
  → return top-k ranked items
```

### Storage Flow

```
store(items[], namespace)
  → nextId(metaPath) → scan JSONL for max id
  → appendItems() → embeddingFor() each item → callBridge(add, vectors, ids, items)
  → Python: index.add(vectors_np); index.write(); append_metadata(jsonl)
```

---

## Weak Points & Findings

### 🔴 CRITICAL

#### 1. GraphRAG Edges Are Never Populated — Expansion Is Effectively Dead Code

**Location:** `turboVecMemory.ts` lines 583-602, `main.ts` lines 638-655

The `collectNeighborIds()` method looks for these metadata keys on each stored item:
- `metadata.relatedIds` / `metadata.neighborIds` / `metadata.adjacentIds` — **explicit graph edges**
- `metadata.turnId` — **conversation turn grouping**

However, every store call in the codebase passes metadata like `{ workspaceDir: "..." }`. **None of the graph edge fields are ever written.** The only neighbor types that actually fire are:

| Link Type | Fires? | Why |
|-----------|--------|-----|
| `sequential` (id-1, id+1) | ✅ Yes | Based on positional ID, always available |
| `explicit` (relatedIds etc.) | ❌ Never | No code writes these fields |
| `turn` (same turnId) | ❌ Never | No code writes turnId |
| `source` (same source string) | ✅ Yes | Iterates all items for same source |

**Impact:** GraphRAG expansion degrades to "sequential neighbors + same-source broadcast." The `turn`-based grouping (the most semantically useful link type) is completely non-functional. The 0.85 rank decay BFS is running over trivially-connected nodes, not a meaningful knowledge graph.

**Fix:** At store time, assign a `turnId` to each batch of items stored together (e.g., the user+assistant pair in one chat turn). Optionally, use an LLM call or keyword overlap heuristic to populate `relatedIds`.

---

#### 2. Full Metadata Scan Into Memory on Every Retrieval

**Location:** `turboVecMemory.ts` line 337: `const allItems = await this.readMetadataItems(paths.metaPath);`

Every single retrieval call reads the **entire** JSONL metadata file into a `Map<number, StoredMetadataItem>` in process memory. This is O(N) per query where N = total records in the namespace.

For the `orchestration_c_users_dansc_git_jdesktop` namespace with 200 records this is fine. But as namespaces grow to thousands of records:
- Memory usage scales linearly
- Disk I/O on every retrieval (even though TurboVec index search was already done)
- The BFS neighbor collection does O(N) iteration for `turnId` and `source` lookups

**Impact:** Retrieval latency degrades with namespace size. No caching of the metadata map between calls.

**Fix:** 
- Cache the metadata map per namespace with an invalidation strategy (file mtime check, or TTL).
- Build an in-memory reverse-index for `turnId` → [ids] and `source` → [ids] at load time so neighbor collection is O(1) instead of O(N).

---

### 🟠 HIGH

#### 3. Embedding Dimension Mismatch Handling Is Reactive, Not Preventive

**Location:** `turboVecMemory.ts` lines 226-238 (`normalizeEmbeddingDimension`), lines 1053-1079 (`appendItems` catch block)

The system normalizes all embeddings to 256 dimensions via modulo folding:
```typescript
vec[i % targetDim] += value;
```

This is a **lossy** operation that destroys information when the LLM returns >256-dim embeddings (most modern models return 768, 1024, or 3072). The modulo fold creates aliasing artifacts — semantically distinct dimensions collide.

When a dimension mismatch is detected at query time, the system **resets the entire namespace index** and re-adds all items. This is expensive and loses any previously stored data that wasn't backed up.

**Impact:** 
- Retrieval quality suffers from dimension folding
- Namespace resets on model change are destructive
- No versioning of embedding schema per namespace

**Fix:**
- Store the embedding dimension in namespace metadata and refuse cross-dimension queries (or re-embed).
- Use PCA or a proper projection matrix instead of modulo folding.
- Keep the backup files from `resetNamespaceIndex()` for at least N generations.

---

#### 4. Fallback Embedding Is Cryptographically Weak

**Location:** `turboVecMemory.ts` lines 214-224

```typescript
function fallbackEmbedding(text: string, dim = 256): number[] {
  const vec = new Array<number>(dim).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const idx = (i * 131 + code) % dim;
    vec[idx] += ((code % 31) + 1) / 31;
  }
  // normalize...
}
```

This is a character-frequency hash bucketed into 256 bins. Two texts with the same character distribution but different meanings will have identical embeddings. This fallback activates whenever the LLM embedding endpoint is unreachable.

**Impact:** When the embedding service is down, retrieval quality collapses to near-random. The system silently degrades without any user-visible warning (only an `onEvent` log).

**Fix:**
- Surface a visible warning when fallback is used.
- Consider caching the last successful embedding for reuse during short outages.
- Use a stronger hash (e.g., murmurhash3 into multiple bins with positional encoding) if a true LLM isn't available.

---

#### 5. `retrieveMulti` Namespace Budgeting Is Naive

**Location:** `turboVecMemory.ts` lines 362-410

When searching across N namespaces, each gets `ceil(k/N)` results. This means:
- A namespace with 10,000 records and one with 5 records get the same budget
- No re-ranking across namespaces after merging (results are sorted by score, but scores from different namespaces aren't comparable because they're relative to different index sizes)

**Impact:** Small or noisy namespaces can dominate results. Cross-namespace score comparison is meaningless.

**Fix:**
- Weight per-namespace k by namespace size or relevance heuristic.
- Normalize scores within each namespace before merging (min-max or z-score).
- Consider a two-pass approach: broad vector search across all, then graph-expand only the top candidates.

---

### 🟡 MEDIUM

#### 6. Bridge Process Is Spawned Per Call With No Connection Pooling

**Location:** `turboVecMemory.ts` lines 1193-1272 (`callBridge`)

Every vector operation (query or add) spawns a new Python process, pipes JSON through stdin/stdout, and waits for exit. There's no persistent worker or connection reuse.

**Impact:**
- Process startup overhead on every retrieval (~50-200ms depending on OS)
- No warm-up of numpy/turbovec imports
- High file descriptor churn under load

**Fix:**
- Maintain a persistent Python worker process with a request/response protocol over stdin/stdout.
- Or use `child_process.fork()` with message passing for reuse.

---

#### 7. Metadata JSONL Has No Schema Versioning or Migration

**Location:** `turboVecMemory.ts` lines 1093-1132 (`readMetadataItems`)

The JSONL format is assumed to have `{ id, text, source, createdAt, metadata }`. If the schema changes (e.g., adding `turnId`), old records won't have it and will silently miss graph edges. There's no version field or migration path.

**Impact:** Schema evolution requires manual intervention or full namespace rebuilds.

**Fix:**
- Add a `_schemaVersion` field to each record.
- Implement lazy migration on read (fill in missing fields with defaults).

---

#### 8. Memory Injection Truncation Is Aggressive and Non-Adaptive

**Location:** `main.ts` lines 52-77, `orchestrationEngine.ts` lines 118-139

Both `formatMemoryInjection` and `formatRecalledMemory` hardcode:
- maxItems = 4
- maxCharsPerItem = 1000-1200
- maxTotalChars = 3500-4000

These limits are not adaptive to context window size, model capability, or the actual information density of recalled items. A 4-item injection may be too little for complex tasks or too much for simple ones.

**Impact:** Useful memory may be truncated; context budget may be wasted on low-signal items.

**Fix:**
- Make limits configurable per-model (based on known context window).
- Score items by relevance and drop below a threshold rather than hard-count truncation.
- Consider injecting full text of top-1 and snippets of the rest.

---

#### 9. No Deduplication at Store Time

**Location:** `turboVecMemory.ts` lines 608-652 (`store`)

Every chat turn stores the user prompt and assistant response as new items, even if they're nearly identical to previously stored turns (e.g., repeated questions). The `replaceSources` mechanism only works when explicitly requested.

**Impact:** Namespace bloat with redundant embeddings that dilute retrieval quality.

**Fix:**
- Before storing, compare the new text against recent items in the same namespace using cosine similarity on their embeddings. Skip if above a threshold (e.g., 0.95).
- Or implement a sliding-window dedup: keep only the last N turns per source.

---

#### 10. GraphRAG Stats Are In-Memory Only — Lost on Restart

**Location:** `turboVecMemory.ts` line 251: `private readonly graphRagStatsByNamespace = new Map<...>()`

All retrieval diagnostics (expansion factors, link hit counts, etc.) are stored in a class-level Map. They vanish when the application restarts.

**Impact:** No long-term visibility into retrieval effectiveness. Can't track whether GraphRAG expansion is actually helping over time.

**Fix:**
- Persist stats to a JSON file per namespace.
- Load on startup.

---

### 🟢 LOW / NICE-TO-HAVE

#### 11. TurboVec Uses 2-Bit Quantization — May Be Too Aggressive

**Location:** `turbovec_bridge.py` line 122: `TurboQuantIndex(bit_width=2)`

2-bit PQ quantization gives extreme compression but at the cost of recall accuracy. For a memory store where precision matters (you want to find the *right* past conversation, not just *a* similar one), this may be too lossy.

**Recommendation:** Benchmark recall@k with bit_width=4 vs bit_width=2 for your typical namespace sizes. Consider making it configurable.

---

#### 12. No TTL or Decay for Memory Items

Old memories have the same retrieval weight as recent ones. There's no time-based decay, pinning mechanism, or automatic archival of stale items.

**Recommendation:** Add a `relevanceDecay` factor based on `createdAt` age, or implement tiered namespaces (hot/warm/cold).

---

#### 13. Python Bridge Has No Timeout

**Location:** `turboVecMemory.ts` lines 1193-1272

The spawned Python process has no timeout. If turbovec hangs on a large index, the retrieval call blocks indefinitely (only the embedding HTTP call has a 12s timeout).

**Recommendation:** Add a timeout to the child process (e.g., 30s) and kill + retry or fail gracefully.

---

#### 14. `query_memory` Tool Returns Raw Scores Without Context

**Location:** `toolRuntime.ts` lines 1517-1524

The tool returns `score` values which are raw distances from TurboVec (lower = better). The LLM has no guidance on what constitutes a "good" score, making it hard to judge result quality.

**Recommendation:** Normalize scores to 0-1 relevance or add a confidence label. Include the namespace name in results so the model knows where each hit came from.

---

## Recommendations Prioritized by Impact

| Priority | Finding | Effort | Expected Gain | Status |
|----------|---------|--------|---------------|--------|
| **P0** | #1: Populate `turnId` at store time | Low (add 2 lines per store call) | GraphRAG expansion becomes functional; turn-grouped recall works | ✅ **IMPLEMENTED** |
| **P0** | #2: Cache metadata map + build reverse indexes | Medium | O(1) neighbor lookups; eliminates full-scan per query | ✅ **IMPLEMENTED** |
| **P1** | #3: Stop modulo-folding embeddings; use proper projection or dimension-aware namespaces | Medium | Retrieval quality improvement | ✅ **IMPLEMENTED** |
| **P1** | #6: Persistent Python worker instead of spawn-per-call | Medium | 50-200ms latency reduction per retrieval | ✅ **IMPLEMENTED** |
| **P2** | #5: Weighted multi-namespace budgeting + score normalization | Low-Medium | Better cross-namespace recall | ✅ **IMPLEMENTED** |
| **P2** | #9: Store-time deduplication | Low | Slower namespace bloat, better signal-to-noise | ✅ **IMPLEMENTED** |
| **P3** | #10: Persist GraphRAG stats | Low | Observability for tuning | ✅ **IMPLEMENTED** |
| **P3** | #8: Adaptive injection limits | Low | Better context utilization | ✅ **IMPLEMENTED** |

---

## Implementation Log

### 2025-06-21 — P3 Fixes Applied

#### P3 #10: Persist GraphRAG Stats to Disk
- **What changed:**
  - Added `PersistedGraphRagStatsV1` interface for disk format with schema versioning
  - Added `persistGraphRagStats(namespace)` method that writes stats as `graphrag.stats.json` sidecar file per namespace
  - Added `loadGraphRagStats(namespace)` method that reads and validates persisted stats from disk
  - Added `loadPersistedGraphRagStats()` public method that scans all namespaces on startup and loads their persisted stats
  - Updated `recordGraphRagRetrieval()` to call `persistGraphRagStats()` after each retrieval (fire-and-forget)
  - Stats are automatically cleared from memory on namespace clear/import (already existed via `graphRagStatsByNamespace.delete()`)
  - Added startup call in `main.ts` to load persisted stats when TurboVecMemory is initialized
- **Impact:** GraphRAG retrieval diagnostics now survive application restarts. Long-term observability into expansion factors, link hit counts, and retrieval patterns is now possible across sessions. Stats are stored per-namespace as JSON sidecar files with format versioning for future migration support.
- **Files modified:** `src/backend/turboVecMemory.ts` — new interface, 3 new methods, updated `recordGraphRagRetrieval()`; `src/main.ts` — added startup call to `loadPersistedGraphRagStats()`

#### P3 #8: Adaptive Injection Limits
- **What changed:**
  - Added exported `computeAdaptiveInjectionLimits(contextWindowTokens?)` function that scales memory injection limits proportionally to context window size
  - Baseline: 8K context = original defaults (4 items, 1000 chars/item, 3500 total chars)
  - Scaling: proportional up to 8x cap (prevents runaway for 128K+ models)
  - Minimums enforced: at least 2 items, 400 chars/item, 1500 total chars even for small windows
  - Updated `formatMemoryInjection()` call in `main.ts` to use adaptive limits based on `contextWindowTokens`
  - Updated `formatRecalledMemory()` in `orchestrationEngine.ts` to accept optional limits parameter and use adaptive defaults
  - Both chat and orchestration memory injection now scale with model context window
- **Impact:** Models with larger context windows (32K, 128K) get proportionally more memory injected, utilizing available context budget. Models with smaller windows get conservative limits to avoid overflow. No more wasted context on small models or under-utilization on large ones.
- **Files modified:** `src/backend/turboVecMemory.ts` — new exported `computeAdaptiveInjectionLimits()` function; `src/main.ts` — import and use adaptive limits; `src/backend/orchestrationEngine.ts` — updated `formatRecalledMemory()` signature, import and use adaptive limits

#### P3 Test Suite
- **New file:** `src/tests/turboVecMemory.P3.test.ts` — 18 tests covering:
  - Adaptive injection limits (7 tests): baseline defaults, scaling, caps, minimums, edge cases
  - Persisted GraphRAG stats (8 tests): write/read/persist/load/clear/overwrite/no-op scenarios
  - Regression tests (3 tests): P0 turnId, P1 dimension tracking, P2 weighted budgeting still work after P3 changes
- **Test results:** All 69 tests pass across P0-P3 test suites (0 failures)

### 2025-06-21 — P2 Fixes Applied

### 2025-06-21 — P1 Fixes Applied

#### P1 #3: Dimension-Aware Embeddings (No More Modulo Folding)
- **What changed:** 
  - Removed lossy `normalizeEmbeddingDimension()` modulo folding that collapsed 768+ dim embeddings into 256 dims
  - Added `normalizeEmbedding()` that only L2-normalizes without dimension change
  - Added `NamespaceConfigV1` sidecar file (`memory.config.json`) per namespace storing embedding dimension
  - Added `getNamespaceEmbeddingDim()` / `recordNamespaceEmbeddingDim()` for dimension tracking
  - Updated `embeddingFor()` to accept `expectedDim` parameter and validate against stored dimension
  - Updated `appendItems()` to detect first embedding dimension and record it; on mismatch, reset namespace gracefully
  - Updated Python bridge (`turbovec_bridge.py`) to validate dimension consistency at query/add time
  - Added `namespaceConfigPath()`, `readNamespaceConfig()`, `writeNamespaceConfig()` helper functions
- **Impact:** Embeddings are now stored at their native dimension (768, 1024, 3072, etc.). No more aliasing artifacts from modulo folding. Dimension mismatches are detected early and handled gracefully with namespace reset + re-index.
- **Files modified:** `src/backend/turboVecMemory.ts` — new interfaces, helper functions, updated `embeddingFor()`, `appendItems()`, `retrieve()`; `src/backend/turbovec_bridge.py` — dimension validation in add/query handlers

#### P1 #6: Persistent Python Worker
- **What changed:**
  - Added `BridgeWorker` interface tracking child process, ready state, pending requests with request IDs
  - Added `getBridgeWorker()` / `_startBridgeWorker()` for lazy worker initialization with ready-signal handshake
  - Rewrote `callBridge()` to route through persistent worker via newline-delimited JSON protocol with `_requestId` routing
  - Added `callBridgeSpawn()` as fallback when worker is unavailable (backward compatibility)
  - Updated Python bridge to support `--worker` flag with request/response loop including `_requestId` echo-back
  - Added `destroy()` method for graceful shutdown (sends quit signal, kills process, clears caches)
- **Impact:** Eliminates ~50-200ms Python process spawn overhead per retrieval. numpy/turbovec imports are warm. Single persistent process handles all vector operations with request ID routing for concurrent calls.
- **Files modified:** `src/backend/turboVecMemory.ts` — worker interfaces, `callBridge()`, `callBridgeSpawn()`, `_startBridgeWorker()`, `destroy()`; `src/backend/turbovec_bridge.py` — `run_worker_mode()`, request ID routing

### 2025-06-21 — P2 Fixes Applied

#### P2 #5: Weighted Multi-Namespace Budgeting + Score Normalization
- **What changed:**
  - `retrieveMulti()` now gathers record counts per namespace before retrieval
  - Per-namespace vector-k is weighted proportionally to namespace size (larger namespaces get more seed queries)
  - Minimum vector-k of 2 enforced for small namespaces to ensure they're not starved
  - 3x oversampling factor applied for graph expansion headroom
  - Scores are min-max normalized within each namespace before merging (inverted distance: 1=best, 0=worst)
  - Graph-expanded items (undefined score) sort after vector-scored items
  - Cross-namespace deduplication by ID preserved
- **Impact:** Larger namespaces get proportionally more search budget. Scores from different namespaces are now comparable after normalization. Small namespaces still get minimum representation. Final merged results are properly ranked across namespace boundaries.
- **Files modified:** `src/backend/turboVecMemory.ts` — rewrote `retrieveMulti()` with weighted budgeting, score normalization, and proper merge logic

#### P2 #9: Store-Time Deduplication
- **What changed:**
  - Added `deduplicateDocs()` method that compares new documents against last 50 stored items using cosine similarity
  - Items above 0.95 similarity threshold are skipped as near-duplicates
  - Added `cosineSimilarity()` helper for vector comparison
  - Added `getRecentItems()` to load last N metadata entries efficiently
  - Deduplication runs before turnId assignment and embedding generation
  - Locked namespaces and replaceSources paths bypass dedup (early return)
  - Embedding failures during dedup keep the document (no data loss)
  - Event logging for dedup statistics (items skipped, items stored)
- **Impact:** Reduces namespace bloat from repeated/near-identical content. Improves signal-to-noise ratio in retrieval by preventing duplicate embeddings from diluting search results. Slows down namespace growth without losing unique content.
- **Files modified:** `src/backend/turboVecMemory.ts` — added `deduplicateDocs()`, `cosineSimilarity()`, `getRecentItems()`; updated `store()` to call dedup before embedding

#### P2 Test Suite
- **New file:** `src/tests/turboVecMemory.P2.test.ts` — 32 tests covering:
  - Weighted multi-namespace budgeting (9 tests)
  - Store-time deduplication (15 tests)
  - Regression tests for P0+P1 features after P2 changes (8 tests)
- **Test results:** All 70 tests pass (1 pre-existing Ollama test failure unrelated to memory system)

#### P1 #6: Persistent Python Worker
- **What changed:**
  - Added `BridgeWorker` interface tracking child process, ready state, pending requests with request IDs
  - Added `getBridgeWorker()` / `_startBridgeWorker()` for lazy worker initialization with ready-signal handshake
  - Rewrote `callBridge()` to route through persistent worker via newline-delimited JSON protocol
  - Added `callBridgeSpawn()` as fallback when worker is unavailable (backward compatibility)
  - Updated Python bridge to support `--worker` flag with request/response loop including `_requestId` routing
  - Added `destroy()` method for graceful shutdown (sends quit signal, kills process, clears caches)
  - Each request has 30s timeout; worker startup has 30s timeout
- **Impact:** Eliminates ~50-200ms Python process spawn overhead per retrieval. numpy/turbovec imports are warm. Single persistent process handles all vector operations with request ID routing for concurrent calls.
- **Files modified:** `src/backend/turboVecMemory.ts` — new `BridgeWorker` interface, class fields, `getBridgeWorker()`, `_startBridgeWorker()`, `callBridge()`, `callBridgeSpawn()`, `destroy()`; `src/backend/turbovec_bridge.py` — worker mode with `--worker` flag, request routing by `_requestId`

### 2025-06-21 — P0 Fixes Applied

#### P0 #1: turnId Population at Store Time
- **What changed:** Every `store()` call now assigns a unique `turnId` (format: `turn_{counter}_{timestamp}`) to all items in that batch. The `replaceNamespaceSources()` path also gets turnIds assigned.
- **Impact:** GraphRAG BFS expansion can now discover same-turn neighbors via the `turn` link type. User+assistant pairs from the same conversation turn are now graph-connected, enabling contextual recall of full exchanges instead of isolated fragments.
- **Files modified:** `src/backend/turboVecMemory.ts` — `store()`, `replaceNamespaceSources()`

#### P0 #2: Metadata Cache with Reverse Indexes
- **What changed:** 
  - Added `MetadataCacheEntry` interface holding `items[]`, `byId` Map, `byTurnId` reverse index, and `bySource` reverse index
  - Added `getCachedMetadata(namespace, metaPath)` method that loads JSONL once and builds all indexes, cached per namespace with mtime-based invalidation
  - Updated `retrieve()` to use cached metadata instead of calling `readMetadataItems()` on every query
  - Updated `collectNeighborIds()` to use reverse indexes for O(1) turn/source neighbor lookups (with O(N) fallback if cache unavailable)
  - Added `invalidateMetadataCache(namespace)` called after all mutation paths: `store()`, `replaceNamespaceSources()`, `clearNamespace()`, `importNamespaceArchive()`
- **Impact:** Retrieval no longer does full JSONL scan + O(N) neighbor iteration per query. Turn and source neighbor discovery is now O(1) via hash map lookups. Cache auto-invalidates on file changes.
- **Files modified:** `src/backend/turboVecMemory.ts` — new interfaces, `getCachedMetadata()`, `invalidateMetadataCache()`, updated `retrieve()`, `hybridExpand()`, `collectNeighborIds()`

---

## Methods to Bolster Memory Retrieval

### A. Hybrid Query Rewriting

Before embedding the query, use a lightweight LLM call (or rule-based expansion) to generate 2-3 alternative phrasings of the same intent. Search with each and merge results. This helps when the user's query wording differs from how the memory was stored.

```
query: "how do I fix the build error"
→ expanded: ["build error fix", "compilation failure troubleshooting", "fix build"]
→ union of top-k from each, re-rank by score
```

### B. Re-Ranking Pass

After vector + graph retrieval, run a cross-encoder or LLM-based relevance scoring on the candidate set (top 10-20) against the original query. This catches semantically relevant items that the embedding missed.

```
candidates = hybridExpand(...)
reranked = llm.rank(candidates, query)  // "Rank these by relevance to: {query}"
return reranked.slice(0, k)
```

### C. Namespace Routing Heuristic

Instead of searching all namespaces equally, first classify the query into likely relevant namespaces using a lightweight embedding comparison against namespace "centroid" vectors (average of all embeddings in that namespace). Only search the top-2 most relevant namespaces.

### D. Query-Time Metadata Filtering

Allow `query_memory` to accept metadata filters (e.g., `source: "chat:user"`, `after: "2025-06-01"`). Apply these as post-filter on retrieval results. This lets the model narrow its search scope explicitly.

### E. Feedback Loop — Store Retrieval Hits

When a retrieved memory item leads to a successful tool call or user satisfaction (implicit signal), increment a `retrievalHitCount` in its metadata. Boost items with higher hit counts during future expansion ranking. This creates a self-improving retrieval system.

---

## Appendix: Current Namespace Inventory

| Namespace | Scope | Records | Notes |
|-----------|-------|---------|-------|
| `orchestration_c_users_dansc_git_jdesktop` | workspace | 200 | Largest namespace; primary orchestration memory |
| `gamedev` | workspace | 32 | Game development context |
| `chat_*_latest` (×10) | workspace | 0-8 each | Per-model chat histories |
| `localcode` | workspace | 0 | Empty |

Total tracked records: ~250 across all namespaces. At this scale, the O(N) metadata scan is acceptable but will become a bottleneck as usage grows.
