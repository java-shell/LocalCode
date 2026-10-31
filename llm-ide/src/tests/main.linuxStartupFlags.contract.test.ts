import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

test('native diagnostics preserves Electron graphics backend selection in source and build', async () => {
  // Source and compiled output must both be checked: npm start does not rebuild.
  const files = [
    path.resolve(__dirname, '../../src/main.ts'),
    path.resolve(__dirname, '../main.js')
  ];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(source, /\.disableHardwareAcceleration\s*\(/, file);
    assert.doesNotMatch(source, /\.appendSwitch\s*\(\s*['"](?:disable-gpu|disable-vulkan|ozone-platform)['"]/, file);
    assert.match(source, /crashReportingStartup/, file);
  }
});
