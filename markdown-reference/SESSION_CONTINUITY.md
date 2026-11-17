# SESSION_CONTINUITY

## Task Start Declaration
- Task: Document a prioritized plan for session continuity across application restarts.
- Type: Single-step.
- Applicable Rules: Task Start Protocol (§0.5), Change Safety Protocol (§5), Documentation Deliverables (§8), Token Optimization and Efficiency (§26).
- Breaking Changes: None (all proposals are additive and non-breaking by default).
- Clarifications Needed: None.
- Context Strategy: Verified existing persistence/startup paths in main process and renderer before writing this plan.

## Executive Summary
Session continuity partially exists today. The app already persists chat sessions, orchestration plans, MCP server configuration, and key UI settings. The largest user-visible gap is that restart behavior does not explicitly restore the exact active session/draft/in-flight context.

This document prioritizes suggested edits from highest practical benefit to lowest:
1. P0: Fast continuity wins (restore exactly where user left off).
2. P1: Interrupted-turn recovery (safe replay/retry after restart).
3. P2: Durable resumable execution engine (full run-level continuity).

The recommended sequence is P0 -> P1 -> P2 with stage gates after each phase.

## Current State (What Already Persists)

### Persisted today
- Chat history and session metadata are persisted in a userData JSON store.
- Orchestration plans are persisted.
- MCP server definitions are persisted, then reconfigured/reconnected on startup.
- Last selected workspace and reference workspaces are persisted.
- Renderer settings are persisted in localStorage.

### Not fully persisted today
- Exact active chat session choice per workspace is not explicitly persisted as a pointer.
- Draft prompt text and some transient UI context are not guaranteed to restore.
- In-flight chat/orchestration runs are not restart-resumable.
- Active terminal process state is runtime-only.

## Prioritized Edit Plan

## P0: Restore Exact Working Context (Highest Benefit)

### Why this is highest value
This delivers immediate daily UX improvement with low implementation risk. Most restart friction comes from losing "where I was" rather than losing raw data.

### User outcomes
- Restart opens the same workspace and same active chat session.
- Prompt draft text is restored.
- Chat settings and panel context rehydrate to the last working view.
- User can continue with near-zero reorientation cost.

### Proposed edits

#### 1) Persist active session pointer and view state in main state
- Extend main state payload to include:
  - activeChatSessionIdByWorkspace: Record<string, string>
  - activeTab: string
  - lastVisitedPanel: string
- Keep this additive and optional for backward compatibility.

Likely edit points:
- llm-ide/src/main.ts
  - main state load/save helpers.
  - IPC handlers for updating active session pointer.

#### 2) Persist draft prompt and selected UI scope in renderer settings
- Extend settings payload with:
  - chatDraftText
  - activeSessionIdHint
  - optional: orchestrationDraftPrompt
- Save on input debounce and on unload.

Likely edit points:
- llm-ide/renderer/app.js
  - loadSettings()/saveSettings() state shape.
  - initChat() startup selection logic.
  - prompt input listeners.

#### 3) Deterministic startup selection flow
- Startup restore order:
  1. load chat sessions
  2. try activeSessionIdHint for current workspace
  3. fallback to most recently updated in current workspace
  4. fallback to global most recent
  5. create new session only if none exist

Likely edit points:
- llm-ide/renderer/app.js
  - refreshChatSessions()
  - initChat() post-refresh load decision

### Data model sketch
```ts
interface MainStateV2 {
  lastWorkspaceDir?: string;
  referenceWorkspaces?: Array<{ id: string; label: string; path: string; allowWrite?: boolean }>;
  activeChatSessionIdByWorkspace?: Record<string, string>;
  activeTab?: string;
  lastVisitedPanel?: string;
}

interface RendererSettingsV2 {
  // existing fields...
  activeSessionIdHint?: string;
  chatDraftText?: string;
  orchestrationDraftPrompt?: string;
}
```

### Migration and compatibility
- Keep existing behavior when new keys are missing.
- Write new keys lazily as user interacts.
- No data conversion required beyond safe defaults.

### Effort estimate
- 0.5 to 1.0 day including tests.

### Risks
- Minimal; mostly stale pointer edge cases.

### Acceptance criteria
- Restart returns user to previous active session in >=95% of normal cases.
- Draft prompt is restored unless user cleared it.
- No regression in new session creation behavior.

## P1: Interrupted-Turn Recovery (Medium Benefit)

### Why this is next
After P0, the next pain point is interrupted in-progress responses or tool activity. Users lose confidence when a restart erases work-in-progress context.

### User outcomes
- If restart happens during a run, UI shows an interrupted marker.
- User can recover the pre-interruption state and choose retry/regenerate.
- Partial assistant output can be preserved for inspection.

### Proposed edits

#### 1) Add lightweight checkpoint records
- Create append-only checkpoint entries for active turn lifecycle:
  - queued
  - streaming
  - tool_call_started/completed
  - completed
  - interrupted
- Each record keyed by:
  - sessionId
  - turnId
  - timestamp

Likely edit points:
- llm-ide/src/backend/chatSessionStore.ts (or new adjacent store file)
- llm-ide/src/main.ts (chat IPC stream lifecycle hooks)
- llm-ide/renderer/app.js (render interrupted state)

#### 2) Atomic writes for continuity metadata
- Use temp file + rename strategy for checkpoint durability.
- Keep checkpoint payload bounded (truncate giant tool payloads).

Likely edit points:
- storage helpers in backend files under llm-ide/src/backend

#### 3) Recovery UX
- On startup, detect unfinished turn and show:
  - "Previous response was interrupted"
  - actions: Retry, Regenerate, Dismiss
- Maintain existing session message history untouched.

Likely edit points:
- llm-ide/renderer/app.js
- optional small UI additions in renderer/index.html and renderer/styles.css

### Data model sketch
```ts
interface TurnCheckpoint {
  sessionId: string;
  turnId: string;
  state: 'queued' | 'streaming' | 'tool_call_started' | 'tool_call_completed' | 'completed' | 'interrupted';
  partialAssistantText?: string;
  toolName?: string;
  createdAt: string;
}
```

### Migration and compatibility
- Feature can be fully optional.
- If checkpoints are absent/corrupt, fallback to current startup behavior.

### Effort estimate
- 1 to 2 days including UI and tests.

### Risks
- Checkpoint bloat without retention policy.
- Misclassification of "interrupted" vs "completed" under abrupt process exits.

### Acceptance criteria
- Forced app close during streaming results in recoverable interrupted state on next launch.
- Retry produces a valid new assistant turn without corrupting old messages.
- Checkpoint files remain bounded via retention/pruning.

## P2: Durable Resumable Execution Engine (Lower ROI, Highest Complexity)

### Why this is lower priority
True automatic resume across process restarts is difficult and not always correct because many tool calls are side-effecting or non-idempotent.

### User outcomes
- Long orchestrations can continue from durable stage boundaries.
- Restart does not always require rerunning entire plan.

### Proposed edits

#### 1) Introduce persistent run ledger
- Track orchestration/chat jobs as explicit finite states:
  - pending, running, waiting_input, waiting_tool, completed, failed, canceled
- Persist stage boundary snapshots.

Likely edit points:
- llm-ide/src/backend/orchestrationEngine.ts
- llm-ide/src/main.ts
- new run ledger store under llm-ide/src/backend

#### 2) Idempotency and replay contracts
- Classify tools:
  - safe-to-replay
  - requires-confirmation
  - never-auto-replay
- Persist enough tool metadata to support policy-gated resume.

Likely edit points:
- llm-ide/src/backend/toolRuntime.ts
- shared types for tool replay policy

#### 3) Resume manager at startup
- Detect incomplete jobs.
- Offer explicit UI choices:
  - Resume from checkpoint
  - Restart from stage N
  - Abort and keep logs

Likely edit points:
- llm-ide/src/main.ts startup flow
- llm-ide/renderer/app.js orchestration/chat controls

### Data model sketch
```ts
interface DurableRun {
  runId: string;
  kind: 'chat' | 'orchestration';
  status: 'pending' | 'running' | 'waiting_input' | 'waiting_tool' | 'completed' | 'failed' | 'canceled';
  sessionId?: string;
  stageId?: string;
  replayPolicyVersion: number;
  checkpointRef?: string;
  updatedAt: string;
}
```

### Migration and compatibility
- Entirely additive behind a feature flag (recommended).
- Keep legacy transient runtime path as default until proven stable.

### Effort estimate
- 3 to 7 days initial implementation plus hardening.

### Risks
- Incorrect automatic replay could duplicate side effects.
- Larger maintenance and testing burden.
- Potential user confusion without clear resume controls.

### Acceptance criteria
- Resume success rate target established and measured.
- No duplicate side effects in protected tool classes.
- Clear operator-visible run timeline for auditability.

## Cross-Cutting Requirements for All Phases

### Testing
- Unit tests for store serialization/deserialization and migration defaults.
- Integration tests for startup hydration paths.
- Crash simulation tests for P1/P2 continuity behavior.

### Observability
- Add continuity telemetry counters:
  - restore_attempted
  - restore_succeeded
  - restore_fallback_reason
  - interrupted_turn_detected
  - resume_attempted/resume_succeeded

### Security and privacy
- Avoid persisting secrets in new continuity fields.
- If prompt drafts can contain sensitive content, document and optionally gate draft persistence.

### Performance
- Prefer small JSON payloads and bounded histories.
- Add pruning strategy for checkpoint/run ledger files.

## Recommended Delivery Sequence
1. Ship P0 in one focused PR.
2. Measure restart friction reduction and startup success telemetry.
3. Ship P1 if interruption pain remains significant.
4. Gate P2 behind explicit product requirement for long-running resilient execution.

## Suggested PR Breakdown

### PR-1 (P0)
- Main state schema extension.
- Renderer settings extension for draft/session hints.
- Startup selection policy update.
- Tests for fallback logic.

### PR-2 (P1)
- Checkpoint store and lifecycle hooks.
- Interrupted-state UI and retry path.
- Retention/pruning and crash tests.

### PR-3 (P2, optional)
- Durable run ledger + replay policy model.
- Resume manager and UI controls.
- Feature flag and staged rollout telemetry.

## Definition of Done
- Users consistently return to meaningful context after restart.
- No regressions in current chat/orchestration workflows.
- Persistence behavior is documented and test-covered.
- Additive schema changes remain backward-compatible.
