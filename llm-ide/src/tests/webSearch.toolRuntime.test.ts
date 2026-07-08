import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { executeTool } from '../backend/toolRuntime';

interface MockSearchResponse {
  status: number;
  data: string;
}

/**
 * Build a minimal Axios-like response object for the web_search parser.
 * Inputs: status code and HTML payload.
 * Outputs: object with status/data fields consumed by tool runtime.
 */
function makeSearchResponse(status: number, data: string): MockSearchResponse {
  return { status, data };
}

/**
 * Replace axios.get for a single test and restore afterward.
 * Side effects: mutates axios.get during callback execution only.
 */
async function withMockedAxiosGet(
  impl: (...args: unknown[]) => Promise<MockSearchResponse>,
  callback: () => Promise<void>
): Promise<void> {
  const axiosRef = axios as unknown as { get: (...args: unknown[]) => Promise<MockSearchResponse> };
  const originalGet = axiosRef.get;
  axiosRef.get = impl;
  try {
    await callback();
  } finally {
    axiosRef.get = originalGet;
  }
}

test('web_search calls DuckDuckGo HTML endpoint and returns parsed results', async () => {
  let capturedUrl = '';
  let capturedOptions: Record<string, unknown> | undefined;

  await withMockedAxiosGet(async (...args) => {
    capturedUrl = String(args[0]);
    capturedOptions = args[1] as Record<string, unknown>;
    const html = [
      '<a class="result__a" href="https://example.com/a">Example Result</a>',
      '<div class="result__snippet">Useful snippet text.</div>'
    ].join('');
    return makeSearchResponse(200, html);
  }, async () => {
    const result = await executeTool('web_search', { query: 'localcode test', maxResults: 1 });
    const typedResult = result as {
      engine: string;
      query: string;
      resultCount: number;
      results: Array<{ title: string; url: string; snippet: string }>;
    };

    assert.equal(typedResult.engine, 'duckduckgo');
    assert.equal(typedResult.query, 'localcode test');
    assert.equal(typedResult.resultCount, 1);
    assert.equal(typedResult.results[0]?.title, 'Example Result');
    assert.equal(typedResult.results[0]?.url, 'https://example.com/a');
    assert.equal(typedResult.results[0]?.snippet, 'Useful snippet text.');
  });

  assert.equal(capturedUrl, 'https://duckduckgo.com/html/');
  assert.equal((capturedOptions?.params as Record<string, unknown>)?.q, 'localcode test');
});

test('web_search surfaces DuckDuckGo HTTP failures clearly', async () => {
  await withMockedAxiosGet(async () => makeSearchResponse(503, 'service unavailable'), async () => {
    await assert.rejects(
      () => executeTool('web_search', { query: 'status failure case' }),
      /DuckDuckGo search failed with status 503/
    );
  });
});
