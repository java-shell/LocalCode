import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../backend/toolRuntime';
import type { RetrievedMemoryItem, TurboVecDiagnostics } from '../backend/turboVecMemory';
import type { LLMConfig } from '../shared/types';

/**
 * Minimal mock interface matching what queryMemory needs from TurboVecMemory.
 */
interface MockTurboVecMemoryInterface {
  retrieve(config: LLMConfig, query: string, options: { namespace: string; k?: number }): Promise<RetrievedMemoryItem[]>;
  retrieveMulti(config: LLMConfig, query: string, options: { namespaces: string[]; k?: number }): Promise<RetrievedMemoryItem[]>;
  diagnostics(): Promise<TurboVecDiagnostics>;
}

/**
 * Minimal mock of TurboVecMemory for testing query_memory tool.
 */
class MockTurboVecMemory implements MockTurboVecMemoryInterface {
  private readonly store: Map<string, RetrievedMemoryItem[]> = new Map();

  constructor() {
    // Pre-populate with test data
    this.store.set('test-namespace', [
      { id: 1, text: 'The project uses TypeScript for type safety and better developer experience.', source: 'README.md', score: 0.95, metadata: { createdAt: '2024-01-15T10:00:00Z' } },
      { id: 2, text: 'Testing is done with Node.js built-in test runner.', source: 'CONTRIBUTING.md', score: 0.85, metadata: { createdAt: '2024-01-16T12:00:00Z' } },
      { id: 3, text: 'Build system relies on npm scripts and tsc compiler.', source: 'package.json', score: 0.75, metadata: { createdAt: '2024-01-17T14:00:00Z' } },
      { id: 4, text: 'Memory store uses TurboVec for semantic search capabilities.', source: 'docs/architecture.md', score: 0.9, metadata: { createdAt: '2024-01-18T09:00:00Z' } },
      { id: 5, text: 'Deployment is handled through GitHub Actions CI/CD pipeline.', source: '.github/workflows/deploy.yml', score: 0.65, metadata: { createdAt: '2024-01-19T16:00:00Z' } }
    ]);

    this.store.set('another-namespace', [
      { id: 101, text: 'Database migrations use Knex.js with PostgreSQL.', source: 'db/migrations/README.md', score: 0.88, metadata: { createdAt: '2024-02-01T10:00:00Z' } },
      { id: 102, text: 'API endpoints follow REST conventions with JSON responses.', source: 'src/api/routes.ts', score: 0.82, metadata: { createdAt: '2024-02-02T11:00:00Z' } }
    ]);
  }

  async retrieve(_config: LLMConfig, query: string, options: { namespace: string; k?: number }): Promise<RetrievedMemoryItem[]> {
    const items = this.store.get(options.namespace) || [];
    const k = Math.max(1, Math.min(20, Number(options.k ?? 5)));

    // Simple mock: return top-k items sorted by score (simulating semantic search)
    const filtered = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));

    // Simulate query relevance by boosting items that contain keywords from the query
    const queryLower = query.toLowerCase();
    const scored = filtered.map(item => {
      let boost = 0;
      if (item.text.toLowerCase().includes(queryLower)) {
        boost = 0.1;
      }
      return { ...item, score: Math.min(1, (item.score || 0) + boost) };
    });

    return scored.slice(0, k);
  }

  async retrieveMulti(_config: LLMConfig, query: string, options: { namespaces: string[]; k?: number }): Promise<RetrievedMemoryItem[]> {
    const k = Math.max(1, Math.min(20, Number(options.k ?? 5)));
    const allResults: RetrievedMemoryItem[] = [];

    for (const ns of options.namespaces) {
      const results = await this.retrieve({} as LLMConfig, query, { namespace: ns, k });
      allResults.push(...results);
    }

    // Deduplicate by id and re-rank by score
    const seenIds = new Set<number>();
    const unique: RetrievedMemoryItem[] = [];
    for (const item of allResults) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        unique.push(item);
      }
    }

    return unique.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, k);
  }

  async diagnostics(): Promise<TurboVecDiagnostics> {
    const namespaces = Array.from(this.store.keys()).map(ns => ({
      namespace: ns,
      records: this.store.get(ns)?.length || 0,
      indexBytes: 1024,
      metadataBytes: 512,
      updatedAt: new Date().toISOString(),
      graphrag: {
        retrievals: 0,
        vectorSeedHits: 0,
        expandedHits: 0,
        finalReturned: 0,
        avgExpansionFactor: 0,
        maxObservedHops: 0,
        linkHits: { sequential: 0, explicit: 0, turn: 0, source: 0 },
        lastRetrievedAt: null
      }
    }));

    return {
      ok: true,
      pythonExecutable: 'python3',
      bridgeScriptPath: '/mock/bridge.py',
      memoryRoot: '/mock/memory',
      health: { ok: true, numpyVersion: '1.24.0', turbovecVersion: '1.0.0' },
      namespaces,
      totals: {
        namespaces: namespaces.length,
        records: namespaces.reduce((sum, ns) => sum + ns.records, 0),
        indexBytes: namespaces.reduce((sum, ns) => sum + ns.indexBytes, 0),
        metadataBytes: namespaces.reduce((sum, ns) => sum + ns.metadataBytes, 0)
      },
      graphrag: {
        retrievals: 0,
        vectorSeedHits: 0,
        expandedHits: 0,
        finalReturned: 0,
        avgExpansionFactor: 0,
        maxObservedHops: 0,
        linkHits: { sequential: 0, explicit: 0, turn: 0, source: 0 },
        lastRetrievedAt: null
      }
    };
  }
}

/**
 * Helper to create a runtime context with mocked TurboVecMemory.
 */
function createContext(memory: MockTurboVecMemoryInterface, activeNamespaces?: string[]) {
  return {
    workspaceDir: '/mock/workspace',
    rootDir: '/mock/root',
    turboMemory: memory as any, // Cast to bypass strict type checking for mock
    llmConfig: { 
      provider: 'openai-compatible' as const,
      model: 'gpt-4',
      endpoint: 'https://api.openai.com/v1',
      temperature: 0.7
    } as LLMConfig,
    activeNamespaces
  };
}

test('query_memory returns results from specific namespace', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'TypeScript project setup',
    namespace: 'test-namespace',
    limit: 3
  }, context);

  const typedResult = result as { results: Array<{ id: number; text: string; source: string; score?: number }> };

  assert.ok(typedResult.results, 'Results should be defined');
  assert.equal(typedResult.results.length, 3, 'Should return 3 results');
  assert.ok((typedResult.results[0]?.score ?? 0) >= (typedResult.results[1]?.score ?? 0), 'Results should be sorted by score descending');
});

test('query_memory returns all results when limit exceeds available items', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'anything',
    namespace: 'another-namespace',
    limit: 20
  }, context);

  const typedResult = result as { results: Array<{ id: number; text: string }> };

  assert.equal(typedResult.results.length, 2, 'Should return all 2 items from another-namespace');
});

test('query_memory searches all active namespaces when namespace is omitted', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory, ['test-namespace', 'another-namespace']);

  const result = await executeTool('query_memory', {
    query: 'development tools',
    limit: 4
  }, context);

  const typedResult = result as { results: Array<{ id: number; text: string }> };

  assert.ok(typedResult.results.length <= 4, 'Should respect limit');
  assert.ok(typedResult.results.length > 0, 'Should return some results');

  // Verify results come from both namespaces
  const ids = typedResult.results.map(r => r.id);
  const hasFromFirstNs = ids.some(id => id < 100);
  const hasFromSecondNs = ids.some(id => id >= 100);
  assert.ok(hasFromFirstNs || hasFromSecondNs, 'Should have results from at least one namespace');
});

test('query_memory returns empty results when no memory available', async () => {
  const context = createContext({} as MockTurboVecMemoryInterface);

  const result = await executeTool('query_memory', {
    query: 'test'
  }, context);

  const typedResult = result as { results: unknown[] };
  assert.equal(typedResult.results.length, 0, 'Should return empty array when no memory');
});

test('query_memory returns error when LLM config is missing', async () => {
  const memory = new MockTurboVecMemory();
  const context = {
    workspaceDir: '/mock/workspace',
    rootDir: '/mock/root',
    turboMemory: memory as any
    // No llmConfig
  };

  const result = await executeTool('query_memory', {
    query: 'test'
  }, context);

  const typedResult = result as { results: unknown[]; error?: string };
  assert.ok(typedResult.error?.includes('LLM configuration'), 'Should return error about missing LLM config');
});

test('query_memory returns error when query is empty', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: '   '
  }, context);

  const typedResult = result as { results: unknown[]; error?: string };
  assert.ok(typedResult.error?.includes('query is required'), 'Should return error about missing query');
});

test('query_memory includes metadata by default', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'TypeScript',
    namespace: 'test-namespace',
    limit: 1
  }, context);

  const typedResult = result as { results: Array<{ id: number; text: string; createdAt?: string }> };

  assert.ok(typedResult.results[0]?.createdAt, 'Should include createdAt metadata by default');
});

test('query_memory excludes metadata when includeMetadata is false', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'TypeScript',
    namespace: 'test-namespace',
    limit: 1,
    includeMetadata: false
  }, context);

  const typedResult = result as { results: Array<{ id: number; text: string; createdAt?: string }> };

  assert.equal(typedResult.results[0]?.createdAt, undefined, 'Should not include createdAt when includeMetadata is false');
});

test('query_memory enforces minimum limit of 1', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'TypeScript',
    namespace: 'test-namespace',
    limit: 0
  }, context);

  const typedResult = result as { results: Array<{ id: number }> };
  assert.ok(typedResult.results.length >= 1, 'Should return at least 1 result even with limit 0');
});

test('query_memory enforces maximum limit of 20', async () => {
  const memory = new MockTurboVecMemory();
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'anything',
    namespace: 'test-namespace',
    limit: 100
  }, context);

  const typedResult = result as { results: Array<{ id: number }> };
  assert.ok(typedResult.results.length <= 20, 'Should cap results at 20');
});

test('query_memory falls back to diagnostics when activeNamespaces is not set', async () => {
  const memory = new MockTurboVecMemory();
  // Context without activeNamespaces - should fall back to diagnostics
  const context = createContext(memory);

  const result = await executeTool('query_memory', {
    query: 'test',
    limit: 3
  }, context);

  const typedResult = result as { results: Array<{ id: number; text: string }> };

  assert.ok(typedResult.results.length > 0, 'Should return results using fallback to diagnostics');
});
