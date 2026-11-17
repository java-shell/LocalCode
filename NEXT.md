# NEXT — Review Findings and Prioritized Next Steps

Generated from the 2026-11-17 application review of LocalCode.
Status legend: `[x]` done in this pass, `[ ]` still open.

## Task Start Declaration

- **Task**: Review the application, record findings, and land the P0 cleanup items
- **Type**: Multi-step with TODO Ledger (AI-011 … AI-023)
- **Applicable Rules**: Change Safety Protocol (§5), Testing Requirements (§6), Documentation Deliverables (§8), CI/CD Best Practices (§23), Token Optimization and Efficiency (§26)
- **Breaking Changes**: None. `llm-ide/dist/` is removed from version control (build output moves to release assets); no runtime or API behavior changes.
- **Clarifications Needed**: None

## What the application is

[llm-ide/](llm-ide) is the product: a standalone Electron desktop "local LLM IDE" (not a VS Code
extension) — streaming chat with 23+ tools, simple and advanced orchestration plans, TurboVec /
GraphRAG memory, MCP servers, ntfy notifications, an embedded browser, session continuity, and
native crash diagnostics. Supporting pieces: [namespace_creator/](namespace_creator) (RAG ingest
CLI), [.ai-rules/](.ai-rules) (rules framework), [markdown-reference/](markdown-reference)
(roadmap and design docs).

Largest files: [llm-ide/renderer/app.js](llm-ide/renderer/app.js) (8,281 lines),
[llm-ide/src/backend/llmClient.ts](llm-ide/src/backend/llmClient.ts) (3,198),
[llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts) (2,967),
[llm-ide/src/main.ts](llm-ide/src/main.ts) (2,930).

## Verified baseline before this pass

- `npm test` in [llm-ide/](llm-ide): **269 tests, 266 passed, 1 failed, 2 skipped**.
- The single failure was a stale test, not a product defect (see AI-011).
- Two finished-but-uncommitted features were sitting in the working tree, 10 commits after the
  last commit (`ea407bb`): the shared tool-call budget and the Ollama capability-compatibility fix.
- Version drift: `package.json` said 1.0.1, [llm-ide/README.md](llm-ide/README.md) advertised
  "feature v1.1.0", the newest tag was `v1.0`, and the newest packaged AppImage (Oct 7) predated
  10 commits. No PRs had ever been opened; all work landed directly on `main`.
- Repo weight: `llm-ide/dist/` was tracked through Git LFS — 176 files, ~2.6 GB — and `.git/`
  measured ~8.2 GB.

## P0 — Land the in-flight work

- [x] **AI-011 — Fix the stale contract test.** (`effdafa`)
  [llm-ide/src/tests/renderer.referenceWorkspace.test.ts](llm-ide/src/tests/renderer.referenceWorkspace.test.ts)
  asserted a hardcoded `toolNames: ['list_reference_workspaces', 'list_mcp_servers'` literal in
  `renderer/app.js`, while commit `e1bf313` deliberately moved chat tool names to the backend IPC
  (`toolNames: chatToolNames`) and
  [llm-ide/src/tests/renderer.chatToolRegistrationSync.test.ts](llm-ide/src/tests/renderer.chatToolRegistrationSync.test.ts)
  asserts the opposite (`doesNotMatch /toolNames\s*:\s*\[/`). The two tests contradicted each other.
  The assertion now verifies the real source of truth: `getDefaultChatToolNames()` exposes both
  discovery tools. Suite result: **269 tests, 267 passed, 0 failed, 2 skipped**.

- [x] **AI-012 — Commit the tool-call budget work.** (`4a8fcf2`)
  Ceiling raised 200 → 1000 for chat, orchestration steps and `spawn_sub_agent` children; chat
  default 40 → 250; sub-agent ceiling 50 → 1000 with the narrow default of 8 preserved. One module,
  [llm-ide/src/shared/toolBudget.ts](llm-ide/src/shared/toolBudget.ts), is now consumed by the
  renderer settings clamp, the chat IPC handler, `chatWithTools`, the orchestration step clamp, the
  plan schema validator and the sub-agent runtime, so a value accepted in the UI is no longer
  silently re-clamped downstream. Orchestration preset defaults (40/60/10) are unchanged, so
  existing plans behave exactly as before.

- [x] **AI-013 — Commit the Ollama capability-compatibility work.** (`36bd080`)
  One shared `requestOllamaNative` adapter in
  [llm-ide/src/backend/llmClient.ts](llm-ide/src/backend/llmClient.ts) replaces three duplicated
  transport branches. An explicit HTTP 400 `does not support thinking` is retried once without
  `think`; `does not support tools` is retried once without tools, clears the active tool allowlist
  and announces text-only mode. HTTP 500, unrelated HTTP 400 and cancellations never downgrade a
  model. Streaming HTTP error bodies are decoded as text, bounded to 64 KiB and two seconds, instead
  of serializing socket internals. Saved settings are not rewritten.

- [x] **AI-014 — Stop versioning build artifacts.** (`7ac32b7`)
  `llm-ide/dist/` is now ignored and removed from the index (176 LFS-tracked files, ~2.6 GB).
  Installers should be published as GitHub Release assets instead of committed binaries.

- [ ] **AI-017 — Open PRs and tag a release.** (commits `effdafa`…`90a1c6b` are local on `main`)
  The commits on `main` are local; `origin` could not be reached from this environment (no
  credentials). Push `main`, open PRs per feature if branch-based review is preferred, cut
  `v1.0.2` (or `v1.1.0`) and attach the AppImage/NSIS artifacts as release assets so
  `package.json`, the README version claims and shipped installers agree.

## P1 — Real gaps in the roadmap

- [x] **AI-018 — `.ai-rules` auto-injection implemented (5/5).** (`026aa65`)
  [markdown-reference/TODO.md](markdown-reference/TODO.md) items 1.1–1.5 are now complete, and the
  root README claim that LocalCode injects `.ai-rules/` is finally true.
  `loadAiRules()` + `formatAiRulesGuidance()` live in
  [llm-ide/src/backend/workspaceFs.ts](llm-ide/src/backend/workspaceFs.ts): direct `.md` children
  only, `README.md` and `RULES-QUICKREF.md` first, `## .ai-rules/<file>` headers, a 4000-char
  per-file cap and an 8000-char total cap that includes headers and separators. It returns `null`
  when the folder is absent or holds no readable Markdown, and never throws.
  Injection points: chat (`main.ts`, appended to `systemPromptSections` before the single joined
  system message, plus a `[ai-rules] injected workspace guidance.` event), every orchestration
  stage (`orchestrationEngine.ts`, after `step.systemPrompt`/environment guidance), and sub-agents
  including `tasks[]` fan-out batches. The read happens once per chat request and once per
  orchestration run and is threaded down through `RuntimeContext.aiRulesContent`.
  Two refinements beyond the original plan: the per-file cap exists because this repo's
  `rules.md` is 105 KB and would otherwise crowd out the overview files; and sub-agents now
  inherit the rules, which the plan left unspecified. New coverage:
  `workspaceFs.aiRules.test.ts`, `aiRules.promptInjection.test.ts`,
  `main.aiRulesInjection.contract.test.ts`.

- [ ] **AI-019 — No CI and no linter.**
  [.github/](.github) contains only `copilot-instructions.md`; there is no `workflows/`, no
  ESLint/Prettier/Biome configuration and no `CHANGELOG.md`. Add a CI job running
  `npm run build && npm test` plus lint, and split the release history out of the 30 KB
  [llm-ide/README.md](llm-ide/README.md) into a CHANGELOG.

- [ ] **AI-020 — Context-compaction leftovers.**
  [markdown-reference/CONTEXT_COMPACTION_REMEDIATION.md](markdown-reference/CONTEXT_COMPACTION_REMEDIATION.md)
  still has P1.3 (unknown context-window defaults), P3.2 (tests enforcing context integrity) and
  E5 (tune thresholds from observed telemetry) unchecked. `npm run analyze:compaction` already
  exists to feed that tuning.

## P2 — Safety follow-up to the 1000-turn ceiling

- [ ] **AI-021 — Add a wall-clock or request-count guard.**
  The raised ceiling has no time bound. The only runaway protections are
  `MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS = 3` and context compaction, so the worst case is 1000
  requests × the 180 s (up to 3,600,000 ms) request timeout. Recommend a per-run deadline option
  alongside the existing turn budget, and consider surfacing elapsed time in the chat event stream.

## P3 — Hygiene

- [ ] **AI-022 — Remove strays.**
  `llm-ide/tmp_catalog_probe.js`, `llm-ide/tmp_chat_probe.js`, `llm-ide/tmp_ollama_probe.js`,
  `llm-ide/tmp_ollama_tools_probe.js`, `llm-ide/_s.js`, `tmp_linecount.js`, the empty
  `.ai-rules/str`, the 16 MB root `qa_pairs_sample.jsonl` and the root `package-lock.json` that has
  no matching root `package.json`.

- [ ] **AI-023 — Session-continuity P2 (gated).**
  [durableRunStore.ts](llm-ide/src/backend/durableRunStore.ts) is already wired at nine call sites
  in [main.ts](llm-ide/src/main.ts), and
  [markdown-reference/SESSION_CONTINUITY.md](markdown-reference/SESSION_CONTINUITY.md) gates the
  durable resumable execution engine behind an explicit product decision. Do not start it without
  that decision.

## Documentation layout after this pass

Root keeps [README.md](README.md) and this file. Long-form design and remediation notes now live in
[markdown-reference/](markdown-reference): `BROWSER.md`, `CONTEXT_COMPACTION_REMEDIATION.md`,
`NTFY.md`, `PORTRAIT.md`, `SESSION_CONTINUITY.md` alongside the pre-existing
`DPC_ADVANCED_ORCHESTRATION.md`, `EXTERNAL_TURBOVEC.md`, `ORCHESTRATION_ISSUES.md` and `TODO.md`.
App-local design notes stay beside the app: [llm-ide/CHAT_SIDEBAR.md](llm-ide/CHAT_SIDEBAR.md),
[llm-ide/MCP_HTTP_HEADERS.md](llm-ide/MCP_HTTP_HEADERS.md),
[llm-ide/MEM_AUDIT.md](llm-ide/MEM_AUDIT.md),
[llm-ide/NATIVE_CRASH_ANALYSIS.md](llm-ide/NATIVE_CRASH_ANALYSIS.md).

## Verification

- `cd llm-ide && npm test` → **285 tests, 283 passed, 0 failed, 2 skipped** (the two skips are the
  Electron-native crash minidump test and the context-isolation preload test, both environment-gated).
  The `.ai-rules` work added 16 tests across three files.
- `git status` after the commits is clean apart from ignored `dist/`, `out/` and `node_modules/`.
- No runtime source changed in this pass except the test assertion; behavior of chat, orchestration,
  tool runtime and packaging is unchanged.
