import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read renderer markup and behavior for lightweight preset UI regression contracts.
 *
 * Purpose: verify that preset naming is provided by the app instead of a browser prompt.
 * Inputs: none; paths are resolved relative to the compiled test location.
 * Outputs: the renderer HTML and JavaScript source strings.
 * Side effects: reads local source files only.
 * Errors: propagates file-read errors so missing renderer assets fail the test.
 * Performance: reads two small source files once per test.
 * Security/privacy: does not access user settings or secrets.
 * Concurrency: tests are read-only and safe to run concurrently.
 * Rationale: a DOM harness is not currently configured for renderer contract tests.
 */
async function readRendererSources(): Promise<{ html: string; app: string }> {
  const rendererDir = path.resolve(__dirname, '..', '..', 'renderer');
  const [html, app] = await Promise.all([
    fs.readFile(path.join(rendererDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(rendererDir, 'app.js'), 'utf8')
  ]);
  return { html, app };
}

test('chat quick preset save exposes an in-app preset name dialog', async () => {
  const { html, app } = await readRendererSources();

  assert.match(html, /<dialog[^>]*id="chatPresetNameDialog"/);
  assert.match(html, /<input[^>]*id="chatPresetNameInput"[^>]*required/);
  assert.match(html, /id="chatPresetNameCancel"/);
  assert.match(html, /id="chatPresetNameSave"/);
  assert.match(app, /chatPresetNameDialog\.showModal\(\)/);
  assert.match(app, /chatPresetNameForm\.addEventListener\('submit'/);

  const saveHandler = app.match(/if \(chatSavePresetButton\) \{[\s\S]*?(?=\n  if \(chatDeletePresetButton\))/)?.[0];
  assert.ok(saveHandler, 'Expected a quick preset save handler.');
  assert.doesNotMatch(saveHandler, /window\.prompt\(/, 'Preset naming must not depend on window.prompt().');
});
