import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DEFAULT_CHAT_TOOL_TURNS, MAX_TOOL_TURNS } from '../shared/toolBudget';

/**
 * Read the live renderer markup and behavior for tool-budget UI contracts.
 *
 * Purpose: verify the settings UI can express the same ceiling the backend accepts.
 * Inputs: none; paths resolve relative to the compiled test location.
 * Outputs: the renderer HTML and JavaScript source strings.
 * Side effects: reads local source files only.
 * Errors: propagates file-read errors so missing renderer assets fail the test.
 * Performance: reads two small source files once per test.
 * Security/privacy: does not access user settings or secrets.
 * Concurrency: read-only and safe to run concurrently.
 * Rationale: the renderer is a plain script that cannot import the TypeScript
 * budget module, so a source contract is the cheapest guard against drift.
 */
async function readRendererSources(): Promise<{ html: string; app: string }> {
  const rendererDir = path.resolve(__dirname, '..', '..', 'renderer');
  const [html, app] = await Promise.all([
    fs.readFile(path.join(rendererDir, 'index.html'), 'utf8'),
    fs.readFile(path.join(rendererDir, 'app.js'), 'utf8')
  ]);
  return { html, app };
}

test('renderer max tool turns input allows the shared 1000 ceiling', async () => {
  const { html } = await readRendererSources();

  const input = html.match(/<input[^>]*id="settingMaxToolTurns"[^>]*>/)?.[0];
  assert.ok(input, 'Expected a #settingMaxToolTurns number input.');
  assert.match(input, /min="1"/);
  assert.match(
    input,
    new RegExp(`max="${MAX_TOOL_TURNS}"`),
    `Expected the input max to be ${MAX_TOOL_TURNS}, got: ${input}`
  );
});

test('renderer settings help text states the shared default and ceiling', async () => {
  const { html } = await readRendererSources();

  assert.match(
    html,
    new RegExp(`Defaults: ${DEFAULT_CHAT_TOOL_TURNS} tool turns \\(max ${MAX_TOOL_TURNS}\\)`),
    'Expected the settings help text to name the shared default and ceiling.'
  );
});

test('renderer mirrors the shared tool budget constants', async () => {
  const { app } = await readRendererSources();

  assert.match(
    app,
    new RegExp(`const MAX_TOOL_TURNS_LIMIT = ${MAX_TOOL_TURNS};`),
    `Expected renderer ceiling to match shared MAX_TOOL_TURNS (${MAX_TOOL_TURNS}).`
  );
  assert.match(
    app,
    new RegExp(`const DEFAULT_MAX_TOOL_TURNS = ${DEFAULT_CHAT_TOOL_TURNS};`),
    `Expected renderer default to match shared DEFAULT_CHAT_TOOL_TURNS (${DEFAULT_CHAT_TOOL_TURNS}).`
  );
  assert.match(app, /Math\.min\(MAX_TOOL_TURNS_LIMIT, Math\.floor\(value\)\)/);
  assert.match(app, /maxToolTurns: DEFAULT_MAX_TOOL_TURNS/);
});
