import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Execute the real compiled store in an isolated process/profile, mocking only Electron's userData path. */
test('MCP settings persist headers, preserve legacy servers, reject invalid saves, and clear headers', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-mcp-store-'));
  try {
    const modulePath = path.resolve(__dirname, '../backend/mcpServerStore.js');
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const Module = require('node:module');
      const profile = ${JSON.stringify(profile)};
      const original = Module._load;
      Module._load = function(name, ...args) {
        if (name === 'electron') return { app: { getPath() { return profile; } } };
        return original.call(this, name, ...args);
      };
      const store = require(${JSON.stringify(modulePath)});
      (async () => {
        const legacy = { id: 'legacy', label: 'Legacy', transport: 'stdio', command: 'node',
          enabledForChat: true, enabledForOrchestration: false };
        const remote = { id: 'remote', label: 'Remote', transport: 'http', endpoint: 'https://example.invalid/mcp',
          enabledForChat: true, enabledForOrchestration: true,
          headers: { Authorization: 'Bearer test-token', 'X-Tenant': 'tenant' } };
        const saved = await store.saveMcpServers([legacy, remote]);
        assert.deepEqual(await store.listMcpServers(), saved);
        assert.equal(saved[0].headers, undefined);
        assert.equal(saved[1].headers.authorization, 'Bearer test-token');
        assert.equal((await store.listMcpServersForTarget('orchestration')).length, 1);
        const file = path.join(profile, 'mcp-servers.json');
        const before = fs.readFileSync(file, 'utf8');
        await assert.rejects(store.saveMcpServers([{ ...remote, headers: { Authorization: 42 } }]), /string|invalid/);
        assert.equal(fs.readFileSync(file, 'utf8'), before);
        await store.saveMcpServers([legacy, { ...remote, headers: {} }]);
        const cleared = await store.listMcpServers();
        assert.equal(cleared[1].headers, undefined);
        assert.ok(!fs.readFileSync(file, 'utf8').includes('test-token'));
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});