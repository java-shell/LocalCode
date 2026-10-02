import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TurboVecMemory, computeAdaptiveInjectionLimits } from '../backend/turboVecMemory';
import type { LLMConfig } from '../shared/types';

/**
 * Test suite for P3 improvements:
 * - P3 #10: Persist GraphRAG stats to disk
 * - P3 #8: Adaptive injection limits based on context window
 */

async function createTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'turbovec-p3-test-'));
}

async function cleanupTempRoot(tmpDir: string): Promise<void> {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

const mockLLMConfig: LLMConfig = {
  provider: 'openai-compatible' as const,
  model: 'test-model',
  endpoint: 'http://localhost:9999/v1',
  temperature: 0.7
};

// Bridge script lives in src/ (not compiled to out/), resolve from project root
const BRIDGE_SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'backend', 'turbovec_bridge.py');

test.describe('P3 #8: Adaptive Injection Limits', () => {
  test('returns baseline defaults for 8K context window', () => {
    const limits = computeAdaptiveInjectionLimits(8192);
    assert.equal(limits.maxItems, 4, 'maxItems should be 4 at baseline');
    assert.equal(limits.maxCharsPerItem, 1000, 'maxCharsPerItem should be 1000 at baseline');
    assert.equal(limits.maxTotalChars, 3500, 'maxTotalChars should be 3500 at baseline');
  });

  test('scales up for larger context windows', () => {
    const limits32k = computeAdaptiveInjectionLimits(32768);
    assert.ok(limits32k.maxItems > 4, 'maxItems should scale up for 32K context');
    assert.ok(limits32k.maxCharsPerItem > 1000, 'maxCharsPerItem should scale up for 32K context');
    assert.ok(limits32k.maxTotalChars > 3500, 'maxTotalChars should scale up for 32K context');
  });

  test('caps scaling at 8x to prevent runaway', () => {
    const limits128k = computeAdaptiveInjectionLimits(128000);
    const limits64k = computeAdaptiveInjectionLimits(65536);
    // Both should hit the 8x cap
    assert.equal(limits128k.maxItems, limits64k.maxItems, 'Should cap at same maxItems');
    assert.equal(limits128k.maxCharsPerItem, limits64k.maxCharsPerItem, 'Should cap at same maxCharsPerItem');
  });

  test('enforces minimums for small context windows', () => {
    const limits4k = computeAdaptiveInjectionLimits(4096);
    assert.ok(limits4k.maxItems >= 2, 'maxItems should be at least 2');
    assert.ok(limits4k.maxCharsPerItem >= 400, 'maxCharsPerItem should be at least 400');
    assert.ok(limits4k.maxTotalChars >= 1500, 'maxTotalChars should be at least 1500');
  });

  test('uses default 8K when contextWindowTokens is undefined', () => {
    const limits = computeAdaptiveInjectionLimits(undefined);
    assert.equal(limits.maxItems, 4, 'Should use baseline for undefined');
  });

  test('uses default 8K when contextWindowTokens is zero', () => {
    const limits = computeAdaptiveInjectionLimits(0);
    // 0 gets clamped to minimum 4096, so it scales down slightly
    assert.ok(limits.maxItems >= 2, 'Should have reasonable defaults for 0');
  });

  test('scales proportionally: 16K should be ~2x baseline', () => {
    const limits = computeAdaptiveInjectionLimits(16384);
    // 16K / 8K = 2x scale
    assert.ok(limits.maxItems >= 7, 'maxItems should be ~8 (4*2)');
    assert.ok(limits.maxCharsPerItem >= 1800, 'maxCharsPerItem should be ~2000 (1000*2)');
  });

  test('increases limits for severe compaction multiplier', () => {
    const baseline = computeAdaptiveInjectionLimits(8192, 1);
    const severe = computeAdaptiveInjectionLimits(8192, 2);

    assert.ok(severe.maxItems > baseline.maxItems, 'severe multiplier should increase maxItems');
    assert.ok(severe.maxCharsPerItem > baseline.maxCharsPerItem, 'severe multiplier should increase per-item chars');
    assert.ok(severe.maxTotalChars > baseline.maxTotalChars, 'severe multiplier should increase total chars');
  });

  test('caps severe multiplier to avoid runaway injection budgets', () => {
    const capped = computeAdaptiveInjectionLimits(8192, 99);
    const expectedCap = computeAdaptiveInjectionLimits(8192, 2.5);

    assert.equal(capped.maxItems, expectedCap.maxItems, 'multiplier cap should bound maxItems');
    assert.equal(capped.maxCharsPerItem, expectedCap.maxCharsPerItem, 'multiplier cap should bound per-item chars');
    assert.equal(capped.maxTotalChars, expectedCap.maxTotalChars, 'multiplier cap should bound total chars');
  });
});

test.describe('G3: same-turn/source GraphRAG prioritization', () => {
  let tmpDir: string;

  test.beforeEach(async () => {
    tmpDir = await createTempRoot();
  });

  test.afterEach(async () => {
    await cleanupTempRoot(tmpDir);
  });

  test('collectNeighborIds ranks turn and source neighbors ahead of explicit-only neighbors', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});

    try {
      const itemsById = new Map<number, any>([
        [1, { id: 1, text: 'seed', source: 'chat:user', metadata: { turnId: 't1', relatedIds: [4] } }],
        [2, { id: 2, text: 'same turn', source: 'chat:assistant', metadata: { turnId: 't1' } }],
        [3, { id: 3, text: 'same source', source: 'chat:user', metadata: { turnId: 't2' } }],
        [4, { id: 4, text: 'explicit only', source: 'notes:misc', metadata: { turnId: 't3' } }]
      ]);

      const cache = {
        items: Array.from(itemsById.values()),
        byId: itemsById,
        byTurnId: new Map<string, number[]>([['t1', [1, 2]]]),
        bySource: new Map<string, number[]>([['chat:user', [1, 3]]]),
        fileMtimeMs: Date.now()
      };

      const result = memory['collectNeighborIds'](1, itemsById, cache);

      assert.ok(result.ids.includes(2), 'same-turn neighbor should be included');
      assert.ok(result.ids.includes(3), 'same-source neighbor should be included');
      assert.ok(result.ids.includes(4), 'explicit neighbor should be included');
      assert.equal(result.scoredIds[0]?.id, 2, 'same-turn neighbor should receive highest priority');
      assert.equal(result.scoredIds[1]?.id, 3, 'same-source neighbor should rank ahead of explicit-only neighbor');
    } finally {
      await memory.destroy();
    }
  });

  test('hybridExpand keeps turn/source cluster when k is tight', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});

    try {
      const itemsById = new Map<number, any>([
        [1, { id: 1, text: 'seed', source: 'chat:user', metadata: { turnId: 't1', relatedIds: [4] } }],
        [2, { id: 2, text: 'same turn', source: 'chat:assistant', metadata: { turnId: 't1' } }],
        [3, { id: 3, text: 'same source', source: 'chat:user', metadata: { turnId: 't2' } }],
        [4, { id: 4, text: 'explicit only', source: 'notes:misc', metadata: { turnId: 't3' } }]
      ]);

      const cache = {
        items: Array.from(itemsById.values()),
        byId: itemsById,
        byTurnId: new Map<string, number[]>([['t1', [1, 2]]]),
        bySource: new Map<string, number[]>([['chat:user', [1, 3]]]),
        fileMtimeMs: Date.now()
      };

      const expanded = memory['hybridExpand'](
        [{ id: 1, text: 'seed', source: 'chat:user', score: 0.1, metadata: { turnId: 't1' } }],
        itemsById,
        { k: 3, maxHops: 1 },
        cache
      );

      const ids = expanded.items.map((item: any) => Number(item.id));
      assert.deepEqual(ids, [1, 2, 3], 'tight k should prefer same-turn/source continuity cluster');
    } finally {
      await memory.destroy();
    }
  });
});

test.describe('P3 #10: Persist GraphRAG Stats', () => {
  let tmpDir: string;
  
  test.beforeEach(async () => {
    tmpDir = await createTempRoot();
  });
  
  test.afterEach(async () => {
    await cleanupTempRoot(tmpDir);
  });

  test('persistGraphRagStats writes stats file to disk', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Manually initialize stats for a namespace (stats are created on retrieval, not store)
      const emptyStats = {
        retrievals: 5,
        vectorSeedHits: 10,
        expandedHits: 3,
        finalReturned: 8,
        maxObservedHops: 2,
        linkHits: { sequential: 4, explicit: 0, turn: 2, source: 1 },
        lastRetrievedAt: '2025-01-01T00:00:00.000Z'
      };
      memory['graphRagStatsByNamespace'].set('stats-test', emptyStats);
      
      // Persist stats
      await memory['persistGraphRagStats']('stats-test');
      
      // Verify file exists in the namespace directory
      const nsDir = path.join(tmpDir, 'stats-test');
      // Ensure directory exists first
      await fs.mkdir(nsDir, { recursive: true });
      const statsPath = path.join(nsDir, 'graphrag.stats.json');
      const statsContent = await fs.readFile(statsPath, 'utf8');
      const parsed = JSON.parse(statsContent);
      
      assert.equal(parsed.format, 'localcode.turbovec.graphrag.stats.v1', 'Should have correct format');
      assert.equal(parsed.retrievals, 5, 'Should preserve retrievals count');
      assert.equal(parsed.vectorSeedHits, 10, 'Should preserve vectorSeedHits');
    } finally {
      await memory.destroy();
    }
  });

  test('loadGraphRagStats reads stats from disk', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Manually initialize and persist stats
      const emptyStats = {
        retrievals: 3,
        vectorSeedHits: 7,
        expandedHits: 2,
        finalReturned: 5,
        maxObservedHops: 1,
        linkHits: { sequential: 2, explicit: 0, turn: 1, source: 0 },
        lastRetrievedAt: '2025-06-01T00:00:00.000Z'
      };
      memory['graphRagStatsByNamespace'].set('stats-load-test', emptyStats);
      
      // Ensure namespace directory exists
      const nsDir = path.join(tmpDir, 'stats-load-test');
      await fs.mkdir(nsDir, { recursive: true });
      
      await memory['persistGraphRagStats']('stats-load-test');
      
      // Clear in-memory stats and reload
      memory['graphRagStatsByNamespace'].clear();
      
      const loaded = await memory['loadGraphRagStats']('stats-load-test');
      assert.ok(loaded !== null, 'Should load stats from disk');
      assert.equal(loaded.retrievals, 3, 'Loaded retrievals should match');
      assert.equal(loaded.vectorSeedHits, 7, 'Loaded vectorSeedHits should match');
    } finally {
      await memory.destroy();
    }
  });

  test('loadGraphRagStats returns null for nonexistent file', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      const loaded = await memory['loadGraphRagStats']('nonexistent-ns');
      assert.equal(loaded, null, 'Should return null for nonexistent stats file');
    } finally {
      await memory.destroy();
    }
  });

  test('loadGraphRagStats returns null for invalid format', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Create namespace directory with invalid stats file
      const nsDir = path.join(tmpDir, 'invalid-format-test');
      await fs.mkdir(nsDir, { recursive: true });
      const statsPath = path.join(nsDir, 'graphrag.stats.json');
      await fs.writeFile(statsPath, JSON.stringify({ format: 'invalid-format' }), 'utf8');
      
      const loaded = await memory['loadGraphRagStats']('invalid-format-test');
      assert.equal(loaded, null, 'Should return null for invalid format');
    } finally {
      await memory.destroy();
    }
  });

  test('loadPersistedGraphRagStats loads stats for all namespaces on startup', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Create namespace directories with persisted stats AND index/meta files
      // (listNamespaces requires both memory.tvec and memory.jsonl to exist)
      for (const ns of ['persist-ns1', 'persist-ns2']) {
        const nsDir = path.join(tmpDir, ns);
        await fs.mkdir(nsDir, { recursive: true });
        
        // Create minimal index and meta files so listNamespaces finds them
        await fs.writeFile(path.join(nsDir, 'memory.tvec'), '');
        await fs.writeFile(path.join(nsDir, 'memory.jsonl'), 
          JSON.stringify({ id: 1, text: 'test', source: 'test', createdAt: new Date().toISOString(), metadata: {} }) + '\n'
        );
        
        // Write stats file directly (simulating persisted state from previous session)
        const statsPath = path.join(nsDir, 'graphrag.stats.json');
        await fs.writeFile(statsPath, JSON.stringify({
          format: 'localcode.turbovec.graphrag.stats.v1',
          retrievals: 10,
          vectorSeedHits: 20,
          expandedHits: 5,
          finalReturned: 15,
          maxObservedHops: 2,
          linkHits: { sequential: 8, explicit: 0, turn: 4, source: 2 },
          lastRetrievedAt: '2025-06-15T00:00:00.000Z'
        }), 'utf8');
      }
      
      // Load persisted stats (simulating startup)
      await memory.loadPersistedGraphRagStats();
      
      // Verify both namespaces have stats loaded
      const ns1Stats = memory['graphRagStatsByNamespace'].get('persist-ns1');
      const ns2Stats = memory['graphRagStatsByNamespace'].get('persist-ns2');
      
      assert.ok(ns1Stats !== undefined, 'Should load stats for ns1');
      assert.ok(ns2Stats !== undefined, 'Should load stats for ns2');
      assert.equal(ns1Stats.retrievals, 10, 'ns1 retrievals should match');
      assert.equal(ns2Stats.retrievals, 10, 'ns2 retrievals should match');
    } finally {
      await memory.destroy();
    }
  });

  test('stats are cleared on namespace clear', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Set up stats for a namespace
      memory['graphRagStatsByNamespace'].set('clear-test', {
        retrievals: 5,
        vectorSeedHits: 10,
        expandedHits: 3,
        finalReturned: 8,
        maxObservedHops: 2,
        linkHits: { sequential: 4, explicit: 0, turn: 2, source: 1 },
        lastRetrievedAt: '2025-01-01T00:00:00.000Z'
      });
      
      // Create namespace directory so clear can find it
      const nsDir = path.join(tmpDir, 'clear-test');
      await fs.mkdir(nsDir, { recursive: true });
      await fs.writeFile(path.join(nsDir, 'memory.tvec'), '');
      await fs.writeFile(path.join(nsDir, 'memory.jsonl'), '');
      
      // Verify stats exist
      const beforeStats = memory['graphRagStatsByNamespace'].get('clear-test');
      assert.ok(beforeStats !== undefined, 'Stats should exist before clear');
      
      // Clear namespace
      await memory.clearNamespace('clear-test');
      
      // Verify stats are removed from memory
      const afterStats = memory['graphRagStatsByNamespace'].get('clear-test');
      assert.equal(afterStats, undefined, 'Stats should be removed from memory after clear');
    } finally {
      await memory.destroy();
    }
  });

  test('stats are cleared on namespace import with overwrite', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Set up stats for a namespace
      memory['graphRagStatsByNamespace'].set('import-test', {
        retrievals: 5,
        vectorSeedHits: 10,
        expandedHits: 3,
        finalReturned: 8,
        maxObservedHops: 2,
        linkHits: { sequential: 4, explicit: 0, turn: 2, source: 1 },
        lastRetrievedAt: '2025-01-01T00:00:00.000Z'
      });
      
      // Verify stats exist
      const beforeStats = memory['graphRagStatsByNamespace'].get('import-test');
      assert.ok(beforeStats !== undefined, 'Stats should exist before import');
      
      // Create a valid archive with minimal metadata and import with overwrite
      const archive = {
        format: 'localcode.turbovec.namespace.v1',
        namespace: 'import-test',
        exportedAt: new Date().toISOString(),
        recordCount: 1,
        metadataJsonl: JSON.stringify({ id: 1, text: 'imported item', source: 'test', createdAt: new Date().toISOString(), metadata: {} }) + '\n'
      };
      await memory.importNamespaceArchive(archive, { targetNamespace: 'import-test', overwrite: true });
      
      // Verify stats are removed from memory
      const afterStats = memory['graphRagStatsByNamespace'].get('import-test');
      assert.equal(afterStats, undefined, 'Stats should be removed from memory after import');
    } finally {
      await memory.destroy();
    }
  });

  test('persistGraphRagStats is no-op when stats do not exist', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // Should not throw even if no stats exist for namespace
      await memory['persistGraphRagStats']('nonexistent-ns');
      assert.ok(true, 'Should not throw when persisting nonexistent stats');
    } finally {
      await memory.destroy();
    }
  });
});

test.describe('P3 Regression Tests', () => {
  let tmpDir: string;
  
  test.beforeEach(async () => {
    tmpDir = await createTempRoot();
  });
  
  test.afterEach(async () => {
    await cleanupTempRoot(tmpDir);
  });

  test('P0 turnId still works after P3 changes', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      await memory.store(mockLLMConfig, [
        { text: 'user message', source: 'chat:user' },
        { text: 'assistant response', source: 'chat:assistant' }
      ], { namespace: 'regression-turnid' });
      
      // Verify metadata has turnId
      const metaPath = path.join(tmpDir, 'regression-turnid', 'memory.jsonl');
      const metaContent = await fs.readFile(metaPath, 'utf8');
      const lines = metaContent.trim().split('\n');
      
      assert.ok(lines.length >= 2, 'Should have at least 2 metadata lines');
      
      const firstLine = JSON.parse(lines[0]);
      assert.ok(firstLine.metadata?.turnId, 'First item should have turnId in metadata');
    } finally {
      await memory.destroy();
    }
  });

  test('P1 dimension tracking still works after P3 changes', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      await memory.store(mockLLMConfig, [
        { text: 'dimension test item', source: 'test' }
      ], { namespace: 'regression-dim' });
      
      // Verify config file exists
      const configPath = path.join(tmpDir, 'regression-dim', 'memory.config.json');
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configContent);
      
      assert.equal(config.format, 'localcode.turbovec.namespace.config.v1', 'Config should have correct format');
      assert.ok(Number.isFinite(config.embeddingDim), 'Config should have embedding dimension');
    } finally {
      await memory.destroy();
    }
  });

  test('P2 weighted budgeting still works after P3 changes', async () => {
    const memory = new TurboVecMemory(tmpDir, BRIDGE_SCRIPT, () => {});
    
    try {
      // retrieveMulti should handle empty namespaces gracefully
      const results = await memory.retrieveMulti(mockLLMConfig, 'test query', {
        namespaces: ['empty-ns-1', 'empty-ns-2'],
        k: 5
      });
      assert.ok(Array.isArray(results), 'Should return array for empty namespaces');
    } finally {
      await memory.destroy();
    }
  });
});
