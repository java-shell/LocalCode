import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Read the live renderer markup and behavior for the .ai-rules settings contract.
 *
 * Purpose: the renderer is a plain script that cannot import the TypeScript request types, so
 * the only cheap guard against drift is asserting the checkbox, its default and the payloads
 * that carry it to the main process.
 * Inputs: none; paths resolve relative to the compiled test location.
 * Outputs: the renderer HTML and JavaScript source strings.
 * Side effects: reads local source files only.
 * Errors: propagates file-read errors so missing renderer assets fail the test.
 * Performance: reads two small source files once per test.
 * Security/privacy: does not access user settings or secrets.
 * Concurrency: read-only and safe to run concurrently.
 * Rationale: a silent default flip (enabled -> disabled) would strip workspace rules from every
 * model request with no visible symptom, so the default is asserted explicitly.
 */
async function readRendererSources(): Promise<{ html: string; app: string }> {
  const rendererDir = path.resolve(__dirname, '..', '..', 'renderer');
  const [html, app] = await Promise.all([
    fs.readFile(path.join(rendererDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(rendererDir, 'app.js'), 'utf8')
  ]);
  return { html, app };
}

test('settings modal exposes an .ai-rules injection checkbox', async () => {
  const { html } = await readRendererSources();

  const checkbox = html.match(/<input[^>]*id="settingAiRulesInjectionEnabled"[^>]*>/)?.[0];
  assert.ok(checkbox, 'Expected a #settingAiRulesInjectionEnabled checkbox.');
  assert.match(checkbox, /type="checkbox"/);
  assert.match(
    html,
    /for="settingAiRulesInjectionEnabled"[\s\S]{0,200}\.ai-rules/,
    'Expected the checkbox label to name .ai-rules so users know what it controls.'
  );
});

test('renderer defaults .ai-rules injection to enabled', async () => {
  const { app } = await readRendererSources();

  assert.match(
    app,
    /aiRulesInjectionEnabled:\s*true/,
    'settingsState must default the setting to enabled.'
  );
  // Both the stored-settings restore and the corrupt-settings reset must default to enabled.
  const defaultOnLoads = [
    ...app.matchAll(/settingsState\.aiRulesInjectionEnabled\s*=\s*Boolean\(parsed\.aiRulesInjectionEnabled\s*\?\?\s*true\)/g)
  ];
  assert.equal(defaultOnLoads.length, 1, 'loading saved settings must default to enabled.');
  assert.match(
    app,
    /settingsState\.aiRulesInjectionEnabled = true;/,
    'the settings reset branch must restore the enabled default.'
  );
});

test('renderer sends the .ai-rules setting with chat and both orchestration runs', async () => {
  const { app } = await readRendererSources();

  const sends = [...app.matchAll(/aiRulesInjectionEnabled:\s*settingsState\.aiRulesInjectionEnabled/g)];
  assert.equal(sends.length, 3, 'Expected chat, simple orchestration and advanced orchestration payloads.');

  assert.match(
    app,
    /settingsState\.aiRulesInjectionEnabled = aiRulesInjectionInput\.checked/,
    'saving the modal must persist the checkbox state.'
  );
  assert.match(
    app,
    /aiRulesInjectionInput\.checked = settingsState\.aiRulesInjectionEnabled/,
    'opening the modal must reflect the stored state.'
  );
});
