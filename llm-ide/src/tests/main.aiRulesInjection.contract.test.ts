import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Contract test for the .ai-rules auto-injection wiring in the chat pipeline.
 *
 * Purpose: the chat handler assembles its system prompt inline in main.ts, which cannot be
 * imported by a test. Asserting the wiring in both source and compiled output keeps the
 * injection in place (npm start does not always rebuild, so both are checked).
 * Inputs: none - reads src/main.ts and out/main.js.
 * Outputs: none; throws on assertion failure.
 * Side effects: none.
 */
test('chat flow loads .ai-rules once per request and injects it before the user prompt', async () => {
  const files = [
    path.resolve(__dirname, '../../src/main.ts'),
    path.resolve(__dirname, '../main.js')
  ];

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');

    // Tolerant of both the TypeScript source form and the compiled `(0, ns.fn)(...)` form.
    assert.match(source, /loadAiRules\)?\(?selectedWorkspaceDir/, file);
    assert.match(source, /formatAiRulesGuidance\)?\(?aiRules\?\.content\)/, file);
    assert.match(source, /systemPromptSections\.push\(aiRulesGuidance\)/, file);
    assert.match(source, /\[ai-rules\] injected workspace guidance\./, file);

    // The cached copy must be handed to sub-agents instead of re-reading per spawn.
    assert.match(source, /aiRulesContent:\s*aiRules\?\.content\s*\?\?\s*null/, file);

    // The settings toggle must gate the read itself, not just the injection, and must default
    // to enabled (only an explicit false disables it).
    assert.match(source, /payload\.aiRulesInjectionEnabled\s*!==\s*false/, file);
    assert.match(source, /aiRulesInjectionEnabled\s*\?\s*await\s*(\(0, workspaceFs_1\.)?loadAiRules\)?/, file);

    // Orchestration must forward the disabled state as an explicit null so the engine and its
    // sub-agents skip their own fallback read.
    assert.match(
      source,
      /payload\.aiRulesInjectionEnabled === false \? \{ aiRulesContent: null \}/,
      file
    );

    // Injection must happen before the single joined system message.
    const pushIndex = source.indexOf('systemPromptSections.push(aiRulesGuidance)');
    const joinIndex = source.indexOf("systemPromptSections.join('\\n\\n')");
    assert.ok(pushIndex >= 0 && joinIndex >= 0, file);
    assert.ok(pushIndex < joinIndex, 'rules must be part of the joined system message');
  }
});
