import { validateHeaderName, validateHeaderValue } from 'node:http';

/**
 * Validate an optional JSON header map and return a detached, lowercase copy.
 * Undefined/empty maps retain legacy defaults; invalid maps, non-string values,
 * duplicate case-insensitive names, and invalid HTTP characters throw value-free
 * errors. Pure O(total input length), with no logging or shared state; validating
 * before persistence/network I/O prevents header injection and secret-bearing errors.
 */
export function normalizeMcpHttpHeaders(input: unknown): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('MCP HTTP headers must be a JSON object of string values.');
  }
  const headers: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    try {
      validateHeaderName(name);
      if (typeof value !== 'string') throw new Error();
      validateHeaderValue(name, value);
    } catch {
      throw new Error('MCP HTTP headers contain an invalid name or value.');
    }
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      throw new Error('MCP HTTP headers contain duplicate case-insensitive names.');
    }
    headers[key] = value as string;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * Build HTTP JSON-RPC headers without mutating configuration. Validated custom
 * names override defaults case-insensitively. Pure O(input length); throws safe
 * validation errors and never logs credentials. Shared by requests/notifications
 * so authentication is applied to every phase of an HTTP MCP connection.
 */
export function buildMcpHttpHeaders(input: unknown): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...normalizeMcpHttpHeaders(input)
  };
}