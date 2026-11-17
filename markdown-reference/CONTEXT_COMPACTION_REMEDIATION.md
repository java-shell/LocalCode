# Context Compaction Remediation Plan

Owner: LocalCode
Date initialized: 2026-10-02
Status: Active

## Goal
Stabilize context compaction so models retain task continuity, tool reasoning coherence, and latest user intent under pressure.

## How To Use This Plan
- Check items off as work lands.
- Add implementation notes under each completed item.
- Keep the completion criteria and validation evidence up to date.

## Priority 0 (Critical Correctness)
- [x] P0.1 Preserve latest user intent in final fallback selection
  - Problem: extreme fallback can keep an older message instead of the newest request.
  - Region: llm-ide/src/backend/llmClient.ts (bounded slice and latest-message fallback path).
  - Completion criteria: compaction invariants guarantee newest user message always survives.
  - Validation: unit tests for "latest user request preserved" in worst-case overflow.
  - Implementation notes (2026-10-02): fixed fallback handling by enforcing latest-user preservation during aggressive compaction and final fallback selection.

- [x] P0.2 Add hard compaction invariants before request dispatch
  - Must preserve:
  - latest user message content (non-empty)
  - at least one system policy message
  - assistant-tool and tool-result pairing where present
  - Region: llm-ide/src/backend/llmClient.ts (request path before provider call).
  - Validation: invariant tests and runtime assertion logging (non-fatal in release).
  - Implementation notes (2026-10-02): added invariant enforcement in the shared compaction path (system preservation, latest-user preservation, orphan tool message cleanup, orphan assistant tool-call cleanup).

## Priority 1 (Aggressiveness Tuning)
- [x] P1.1 Replace early forced proactive compaction with staged thresholds
  - Current behavior is effectively aggressive at ~80% estimated usage plus forced margin.
  - Change to staged policy:
  - stage A soft trim near upper band
  - stage B semantic summarize older context only when needed
  - stage C hard truncate as last resort
  - Region: llm-ide/src/backend/llmClient.ts proactive and retry compaction entrypoints.
  - Validation: A/B traces show fewer context-loss events and fewer confusion responses.
  - Implementation notes (2026-10-02): added feature-flagged staged proactive compaction helper (`LOCALCODE_CONTEXT_COMPACTION_V2`) with soft/medium/hard flow and v2 telemetry labels.

- [x] P1.2 Make safety margin adaptive instead of fixed 30% in forced mode
  - Use overflow severity and confidence in context-window value.
  - Keep larger margin only when provider reports hard overflow repeatedly.
  - Region: llm-ide/src/backend/llmClient.ts margin/safeLimit logic.
  - Validation: lower unnecessary compactions without increased overflow retries.
  - Implementation notes (2026-10-02): forced margin now uses adaptive factor in v2 mode based on stage, severity, overflow count, and reported-vs-configured window confidence.

- [ ] P1.3 Improve unknown context-window defaults
  - Avoid defaulting to overly small assumptions for models with unknown windows.
  - Persist provider-reported limits per model/provider after first overflow hint.
  - Regions:
  - llm-ide/renderer/app.js context window estimation and persistence
  - llm-ide/src/backend/llmClient.ts resolveCompactionWindow usage path
  - Validation: fewer premature compactions on large-window models.

## Priority 2 (Semantic Fidelity)
- [x] P2.1 Preserve tool graph coherence during compaction
  - Keep tool-call and tool-result adjacency atomic.
  - Prefer truncating oversized tool payload bodies before dropping conversation structure.
  - Region: llm-ide/src/backend/llmClient.ts compaction transform and tool payload handling.
  - Validation: tests for tool sequence integrity across compacted turns.
  - Implementation notes (2026-10-02): aggressive compaction now applies role-aware payload shrinking with JSON-preserving tool-output truncation, so tool-call/tool-result structure is retained while oversized tool content is compacted first.

- [x] P2.2 Replace naive character summary with structured digest
  - Capture: objective, decisions, files touched, errors, pending actions, unresolved questions.
  - Inject as system-context digest rather than user-role synthetic text.
  - Region: llm-ide/src/backend/llmClient.ts summarizeConversationForContext + injection role.
  - Validation: long-run conversations retain continuity and fewer repeated investigations.
  - Implementation notes (2026-10-02): replaced flat role-line clipping with a structured continuity digest (objective, latest outcome, tool evidence, decisions, unresolved signals) and switched digest injection to system-role messages.

- [x] P2.3 Improve orchestration handoff truncation strategy
  - Avoid compounded truncation across iterations.
  - Preserve invariant fields in stage handoff even when body is truncated.
  - Region: llm-ide/src/backend/orchestrationEngine.ts originalPrompt/stepInput/iterationPrompt truncation paths.
  - Validation: multi-loop workflows keep objective continuity.
  - Implementation notes (2026-10-02): stage prompts now use a structured handoff envelope with invariant sections (original request, step input, continuity invariants), and loop continuation prompts carry summarized output plus unresolved-signal extraction across iterations.

## Priority 3 (Observability + Safety Nets)
- [x] P3.1 Emit detailed compaction telemetry
  - Include: pre/post estimated tokens, dropped by role, dropped by message type, compaction stage used.
  - Regions:
  - llm-ide/src/backend/llmClient.ts events
  - llm-ide/src/main.ts debug dump payload
  - Validation: context-loss investigations can be diagnosed from one dump.
  - Implementation notes (2026-10-02): llmClient now emits structured compaction telemetry (pre/post estimated tokens, dropped counts by role/type, compaction stage/source/confidence) and exposes it in debug payloads. Main process persists telemetry into chat context dump JSON and keeps raw metrics events out of user-visible chat logs.

- [ ] P3.2 Expand tests to enforce context integrity
  - Add:
  - latest-user-survives tests
  - system-message-survives tests
  - tool-pair-preservation tests
  - unknown-window behavior tests
  - regression test for repeated compaction across turns
  - Region: llm-ide/src/tests/llmClient.contextCompaction.test.ts plus new focused test files.

## TurboVec/GraphRAG-Assisted Compaction Opportunities

### Why This Helps
TurboVec and GraphRAG already maintain semantically relevant memory and relationship expansion. Instead of shrinking context blindly, compaction can externalize older context into retrievable memory and then rehydrate only task-critical pieces.

### Priority Integration Track
- [x] G1 Integrate "compaction snapshot" writes into TurboVec on compaction events
  - Store structured snapshots when compaction occurs:
  - current objective
  - decisions made
  - active file/symbol focus
  - unresolved blockers
  - recent tool outcomes
  - Namespace strategy:
  - workspace namespace for run-local continuity
  - optional global namespace for reusable generalized patterns
  - Regions:
  - llm-ide/src/backend/llmClient.ts compaction event branch
  - llm-ide/src/main.ts memory store pipeline
  - Implementation notes (2026-10-02): chat runtime now captures `context:compacted*` events and stores a structured capsule as `chat:compaction-summary` in workspace chat namespace when compaction occurs.

- [x] G2 Add GraphRAG-aware rehydration prompt section after compaction
  - On compaction, query top-k + graph-expanded neighbors for the latest objective.
  - Inject small structured "continuity capsule" as system content.
  - Regions:
  - llm-ide/src/main.ts memory retrieval assembly
  - llm-ide/src/backend/turboVecMemory.ts retrieve/retrieveMulti maxHops tuning
  - Implementation notes (2026-10-02): chat request assembly now performs compaction-aware continuity retrieval (k=4, maxHops=2), filters `chat:compaction-summary` capsules, and injects a dedicated continuity system section.

- [x] G3 Prioritize same-turn and same-source neighbors during rehydration
  - Leverage existing turnId/source links to recover user+assistant+tool context clusters.
  - Region: llm-ide/src/backend/turboVecMemory.ts hybridExpand / collectNeighborIds.
  - Validation: improved recovery of missing local context after compaction.
  - Implementation notes (2026-10-02): Graph expansion now ranks neighbor candidates by link priority (turn > source > explicit > sequential) and propagates weighted ranks so same-turn/source context clusters are retained under tight k limits.

- [x] G4 Add dedicated memory source tags for compaction capsules
  - Example sources:
  - chat:compaction-summary
  - chat:compaction-tool-state
  - orch:compaction-handoff
  - Regions:
  - llm-ide/src/main.ts and llm-ide/src/backend/orchestrationEngine.ts store calls.
  - Benefit: targeted retrieval filters and better debugging.
  - Implementation notes (2026-10-02): chat runtime now stores dual compaction capsules (`chat:compaction-summary`, `chat:compaction-tool-state`) with telemetry metadata, and orchestration writes a dedicated `orch:compaction-handoff` capsule alongside per-step output.

- [x] G5 Adaptive memory injection budget tied to compaction severity
  - Reuse computeAdaptiveInjectionLimits with severity multiplier.
  - Increase memory injection only when recent compaction was severe.
  - Regions:
  - llm-ide/src/backend/turboVecMemory.ts limit policy
  - llm-ide/src/main.ts memory injection path
  - Implementation notes (2026-10-02): `computeAdaptiveInjectionLimits` now accepts a bounded severity multiplier (1.0-2.5). Continuity capsule injection computes severity from recent compaction telemetry and scales injection limits only when prior compaction pressure was high.

- [x] G6 Compaction-aware retrieval query construction
  - Build retrieval query from:
  - latest user request
  - retained system constraints
  - recent tool intents/errors
  - Benefit: retrieves continuity-relevant memories, not generic topical memories.
  - Implementation notes (2026-10-02): continuity retrieval queries now include structured system-constraint and tool intent/outcome signals from normalized history, improving precision for post-compaction rehydration.

### G3-G6 Delivery Sequence (Low-Risk Order)

1) G4 first: source tags and write-path discipline
- Why first: this creates clean data channels before retrieval behavior is changed.
- Implementation scope:
- Tag all compaction artifacts at write time (`chat:compaction-summary`, `chat:compaction-tool-state`, `orch:compaction-handoff`).
- Keep backward compatibility by continuing to read legacy `chat:compaction-summary` records.
- Checkpoints:
- 100% of newly written compaction artifacts have a valid source tag.
- No retrieval regression for existing records.
- Telemetry gate:
- Add/verify counts by source in debug dump review; require non-zero counts for new source classes before moving to G3.

2) G6 second: compaction-aware query construction
- Why second: better query targeting improves precision before graph-neighbor expansion increases breadth.
- Implementation scope:
- Build a structured retrieval query object/text from latest user objective + retained system constraints + recent tool intents/errors.
- Enforce bounded query size and deterministic field ordering.
- Checkpoints:
- Retrieval hit precision improves in manual trace review (fewer generic/topic-only memories).
- No increase in overflow-retry rate from larger query payloads.
- Telemetry gate:
- Compare two trace windows (before/after G6):
- overflow-retry event share should not increase.
- droppedEstimatedTokensPerCompaction should not increase materially.

3) G3 third: prioritize same-turn/same-source graph neighbors
- Why third: apply structural recovery only after query seed quality is improved.
- Implementation scope:
- In graph expansion, score same-turn and same-source neighbors higher than unrelated neighbors at the same hop distance.
- Keep semantic score as a co-signal to avoid overfitting to local adjacency.
- Checkpoints:
- Higher recovery of coherent user-assistant-tool clusters after compaction.
- Reduced repeated investigation/tool loops in post-compaction turns.
- Telemetry gate:
- dropped tool-result continuity symptoms trend down in sampled traces.
- Hard-compaction follow-up confusion events trend down.

4) G5 fourth: adaptive injection budget from compaction severity
- Why last: budget adaptation should use stabilized retrieval quality from G4/G6/G3.
- Implementation scope:
- Map severity bands from compaction telemetry (`stage`, dropped token ratio, overflow retries).
- Scale memory injection limits upward only for severe compaction; keep mild compaction injections conservative.
- Add hysteresis to avoid turn-to-turn budget oscillation.
- Checkpoints:
- Fewer compaction/injection oscillation loops.
- Better continuity retention without raising token overflow failures.
- Telemetry gate:
- Stage distribution shifts toward fewer repeated hard retries.
- droppedMessagesPerCompaction does not regress.

### Cross-Step Validation Protocol (Run After Each G Item)
- Build: `npm run build`
- Regression tests:
- `node --test out/tests/llmClient.contextCompaction.test.js`
- `node --test out/tests/orchestrationEngine.queryMemory.test.js`
- Trace analysis:
- `npm run analyze:compaction`
- Promotion rule:
- Advance to the next G item only if tests are green and no telemetry risk metric regresses by more than 10% in matched trace windows.

## Execution Order
- [x] E1 Land P0.1 and P0.2 first with tests.
- [x] E2 Land P1.1 and P1.2 behind a feature flag for safe rollout.
- [x] E3 Land G1 and G2 to recover continuity via TurboVec/GraphRAG.
- [x] E4 Land P2 series and broaden tests.
- [ ] E5 Enable telemetry and tune thresholds from observed traces.

### E5 Telemetry-Driven Tuning Playbook
- [ ] E5.1 Gather baseline traces over representative workloads
  - Run at least 30 chat turns spanning short, medium, and long contexts.
  - Ensure both normal completion and overflow-retry paths are represented.
  - Artifacts: chat debug dumps containing compactionTelemetry entries.

- [ ] E5.2 Compute aggregate compaction metrics
  - Command: npm run analyze:compaction
  - Outputs to review:
  - compactionEvents volume
  - stage distribution (soft/medium/hard/legacy)
  - droppedEstimatedTokensPerCompaction
  - droppedMessagesPerCompaction
  - risk flags: dropped user/system/tool-result counts

- [ ] E5.3 Tune staged thresholds and margins using evidence
  - If hard stage dominates without overflows decreasing, reduce proactive aggressiveness.
  - If overflow-retry events remain high, increase hard-stage margin and/or earlier medium trigger.
  - If user/system/tool-result drops are non-zero, strengthen invariants before threshold changes.

- [ ] E5.4 Validate post-tune behavior
  - Compare before/after aggregate metrics from two equal-size trace windows.
  - Re-run focused tests:
  - node --test out/tests/llmClient.contextCompaction.test.js
  - node --test out/tests/orchestrationEngine.queryMemory.test.js
  - Confirm no regression in continuity digest and tool-pair integrity tests.

- [ ] E5.5 Lock rollout defaults
  - Promote tuned values from feature-flagged v2 path once metrics stabilize.
  - Document final threshold policy and expected telemetry ranges in this file.

## Proposed Initial Acceptance Metrics
- [ ] M1 Reduce context-overflow retry loops by at least 30%.
- [ ] M2 Reduce user-visible "lost context/confused model" incidents by at least 40%.
- [ ] M3 Preserve latest user ask in 100% of compaction test scenarios.
- [ ] M4 Preserve tool-call/result pairing in 100% of tool-compaction tests.

## Implementation Notes Log
- 2026-10-02: Plan initialized with prioritized defects and TurboVec/GraphRAG integration path.
- 2026-10-02: Completed E4 (P2.1/P2.2/P2.3). Added compaction tests for system-role digest injection and tool payload truncation metadata, plus orchestration loop test for structured continuation envelope and unresolved-signal carry-forward.
- 2026-10-02: Completed P3.1. Added structured compaction telemetry emission and debug-dump persistence; added compaction telemetry analyzer script (`npm run analyze:compaction`) and E5 tuning playbook.
- 2026-10-02: Completed G3/G4/G5/G6 implementation across TurboVec retrieval ranking, compaction capsule source tagging, severity-aware continuity injection limits, and compaction-aware query construction. Added TurboVec tests for neighbor prioritization and severe budget scaling; targeted suites pass.
