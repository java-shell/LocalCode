import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

test('native crash reporting bootstrap is the first main-process import', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/main.ts'), 'utf8');
  assert.match(source, /^import '\.\/backend\/crashReportingStartup';/);
  const compiled = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
  assert.equal(compiled.match(/require\("([^"]+)"\)/)?.[1], './backend/crashReportingStartup');
});

test('compiled bootstrap starts local-only reporting without waiting for app readiness', () => {
  // Execute the real bootstrap in a separate Node process with only Electron mocked.
  const bootstrap = path.resolve(__dirname, '../backend/crashReportingStartup.js');
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    let started = false;
    Module._load = function(name, ...args) {
      if (name === 'electron') return {
        app: { getPath(name) { assert.equal(name, 'crashDumps'); return '/private/Crashpad'; } },
        crashReporter: { start(options) {
          assert.deepEqual(options, { uploadToServer: false, ignoreSystemCrashHandler: false });
          started = true;
        } }
      };
      return original.call(this, name, ...args);
    };
    require(${JSON.stringify(bootstrap)});
    assert.equal(started, true);
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Native crash dumps.*\/private\/Crashpad/);
});

test('reporter initialization failure is visible but does not abort application startup', () => {
  const { startNativeCrashReporter } = require('../backend/nativeCrashReporter');
  const messages: string[] = [];
  const result = startNativeCrashReporter(
    { getPath: () => '/private/Crashpad' },
    { start: () => { throw new Error('handler unavailable'); } },
    { info: (message: string) => messages.push(message), error: (message: string) => messages.push(message) }
  );
  assert.equal(result, null);
  assert.match(messages.join('\n'), /initialization failed/);
  assert.doesNotMatch(messages.join('\n'), /Native crash dumps/);
});

test('isolated Electron native crash produces a nonempty minidump', {
  skip: process.env.LOCALCODE_TEST_NATIVE_CRASH !== '1'
}, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localcode-crash-test-'));
  try {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [
      path.resolve(__dirname, 'fixtures/nativeCrashReporter.fixture.js'), profile
    ], { cwd: profile, env: environment, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.ok(result.signal || result.status !== 0, 'Fixture should terminate abnormally');
    if (process.platform === 'linux') assert.equal(result.signal, 'SIGTRAP');
    assert.match(result.stdout, /Native crash dumps/, result.stderr);
    // Crashpad runs out-of-process and may finish writing shortly after its target exits.
    let dumps: string[] = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      dumps = fs.readdirSync(path.join(profile, 'Crashpad'), { recursive: true })
        .map(entry => String(entry)).filter(entry => entry.endsWith('.dmp'));
      if (dumps.length) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(dumps.length > 0, `No native dump was produced. stderr: ${result.stderr}`);
    const dump = fs.readFileSync(path.join(profile, 'Crashpad', dumps[0]));
    assert.ok(dump.length > 32);
    assert.equal(dump.subarray(0, 4).toString(), 'MDMP');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});