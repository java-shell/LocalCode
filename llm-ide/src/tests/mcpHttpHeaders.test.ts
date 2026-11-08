import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMcpHttpHeaders, normalizeMcpHttpHeaders } from '../backend/mcpHttpHeaders';

/** Preserve no-header defaults and case-insensitive overrides without mutating source maps. */
test('MCP HTTP header normalization and defaults are additive and detached', () => {
  assert.equal(normalizeMcpHttpHeaders(undefined), undefined);
  assert.equal(normalizeMcpHttpHeaders({}), undefined);
  assert.deepEqual(buildMcpHttpHeaders(undefined), {
    'content-type': 'application/json', accept: 'application/json, text/event-stream'
  });
  const input = { Authorization: 'Bearer test', Accept: 'application/json', 'X-Empty': '' };
  const headers = buildMcpHttpHeaders(input);
  assert.deepEqual(headers, {
    'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer test', 'x-empty': ''
  });
  headers.authorization = 'changed';
  assert.equal(input.Authorization, 'Bearer test');
  const special = normalizeMcpHttpHeaders(JSON.parse('{"__proto__":"safe"}'))!;
  assert.equal(special.__proto__, 'safe');
  assert.equal(Object.getPrototypeOf(special), null);
});

/** Invalid JSON shapes, injection/control chars, Unicode, and duplicate names fail without disclosing values. */
test('MCP HTTP header validation rejects unsafe input with value-free errors', () => {
  for (const input of [
    null, [], 'test-secret', { Authorization: 42 }, { Authorization: null },
    { 'Bad Name': 'test-secret' }, { '': 'test-secret' },
    { Authorization: 'test-secret\r\nInjected: true' },
    { Authorization: 'test-secret\0' }, { Authorization: 'test-secret\u0100' },
    { Authorization: 'test-secret', authorization: 'other' }
  ]) {
    assert.throws(() => normalizeMcpHttpHeaders(input), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /MCP HTTP headers/);
      assert.doesNotMatch(error.message, /test-secret|Injected/);
      return true;
    });
  }
});