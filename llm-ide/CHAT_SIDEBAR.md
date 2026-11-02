# Chat Side-Bar v1.0.0

Released in source: 2026-11-02T00:00:00Z (uncommitted working-tree feature).
AI-assisted implementation; maintainer review required before release.

## Decision / non-breaking contract

Keep the original `chatWithTools` invocation alive, paused cooperatively at a
coherent history boundary. An optional runtime hook receives a text-only reply
callback over that invocation's live history. The default path has no pause gate;
orchestration/sub-agent callers need no changes.

`ChatSideBar` is a per-run state machine: running → pending → paused → running.
Pending can be cancelled before the boundary. Completion/stop closes the gate.
Boundaries exist before a model request, after all results in a tool batch, and
before final text/budget-summary returns. No unmatched tool-call/result batch is
exposed to Side-Bar. Pausing never interrupts a tool, shell command, approval, or
sub-agent batch already in flight. Autonomous background processes already
started by tools are not suspended.

The original loop counter is not advanced for Side-Bar messages. The existing
tool-free provider request path handles OpenAI-compatible and Ollama transports,
usage, timeouts, streaming transport fallback, and context-overflow compaction.
No tool definitions are sent; legacy OpenAI function settings are stripped and
unsolicited provider tool calls are rejected without execution. A temporary
instruction requests conversation only. Successful user/assistant pairs enter
the live history; after resume, an instruction reorients the model to the original
work while respecting user corrections or a direction to stop.

The controller retains successful pairs for the existing internal-server retry
path. The renderer saves each pair immediately through normal session storage,
including `sideBar` labels; labels are never provider wire parameters. Normal
session reload and future turns include their text. The current task's tool
results remain in its live context, subject to existing compaction. As before,
saved visible chat history is not a full provider/tool execution checkpoint.

## UI / API

- Start Side-Bar is next to Send and enabled during active work.
- Pending: Cancel Side-Bar; composer sends are blocked to avoid guidance races.
- Paused: Send Side-Bar and Resume Work; replies are strictly serial.
- Stop remains available, including while waiting for a reply or paused.
- Status uses `role=status` / polite live announcements; native buttons retain
  keyboard and focus styling. Controls wrap inside the existing themed composer.
- `chat:sidebar` accepts `{sessionId, action: start|resume|message, content?}`.
- `chat:sidebar-state` publishes only `{sessionId, mode, busy}`, not prompt data.
- Requests validate the active sender/session and reject parallel replies and
  resume-during-reply. Text must be nonempty and at most 100,000 characters.
- A provider failure rejects only the Side-Bar message, retaining the pause and
  draft for retry/resume/stop. A persistence error is reported to the user; the
  successful pair remains in memory and will be included in the next normal save.

## Change risk / security / scope

Affected seams: renderer ↔ preload ↔ chat IPC ↔ LLM runtime hook; session metadata.
Primary risks are tool/history incoherence, unintended turn-budget consumption,
concurrent requests, cancellation deadlocks, and stale renderer assistant blocks.
Tests cover these boundaries; the pause gate uses promises and abort listeners,
not polling. It does not introduce recurring IPC traffic. No provider credentials,
new network endpoints, dependencies, background workers, or permission grants are
added. Model content uses existing sanitized Markdown rendering and existing
local history privacy controls. Side-Bar is user-controlled, never model-callable;
it makes no new automated decisions about people or changes to moderation policy.

Known limits and trade-offs: active Chat only; no new run-restoration engine;
completed-message display rather than token display; configured context limits
still apply. Retain the existing Electron theme and layout instead of replacing
it with the rules' different-stack UI scaffold. Existing generated distribution
artifacts were not modified by this task and have not been rebuilt for Side-Bar.

## Verification / TODO Ledger

Completion references are this working-tree change set; no commit/PR was created.

- [x] AI-001: Trace chat lifecycle, provider transports, counters, persistence,
  and UI seams; select optional safe-boundary hook.
- [x] AI-002: Add cooperative pause/reply/resume, ownership checks, abort cleanup,
  no-tool enforcement, labeled history, and accessible composer controls.
- [x] AI-003: Add controller unit tests, both-provider loop integration tests,
  last-budget-turn/final-text/stop coverage, and renderer/IPC/storage contracts.
- [x] AI-004: Complete regression/browser checks and record final evidence below.

Final verification (2026-11-02):

- TypeScript build, renderer syntax, editor diagnostics, and diff whitespace pass.
- Focused chat/client/continuity suite: **53/53 passed**, including **10 new
  Side-Bar tests**. Tests use deterministic mocked provider responses, not a
  live model endpoint.
- Full suite: **224 tests; 221 passed, 1 failed, 2 skipped**. The remaining
  failure is `chat and advanced orchestration expose reference workspace
  discovery tool`, whose old hardcoded `toolNames` source assertion also fails
  against unchanged HEAD. The existing dynamic backend-default registration
  tests pass. No unrelated test rewrite was included.
- Integrated browser, actual renderer with isolated mocked desktop bridge:
  verified Send/Start adjacency, pending → paused → busy → reply → resume,
  disabled Send/Resume during reply, persisted labeled pairs, and session locks.
  Metadata calls were exactly work/start/message/resume (no accidental new
  work run). Checked controls at 1280×900 and 980×680, existing focus/status
  semantics, hidden guidance while paused, and stop-to-idle cleanup. This is
  not a live Electron/model end-to-end or a complete WCAG audit.
- Structural quality comparison against HEAD: **0 gating regressions**;
  `chatWithTools` contract check: unchanged, 0 incompatible callers. Remaining
  informational findings include existing-large-function growth, a 73-line
  controller, similar start/resume guards, and an accessor reported as dead by
  the name-based analyzer despite runtime use/test coverage. Kept explicit
  transitions and the small controller rather than abstracting two guards.

Release history: v1.0.0 adds Side-Bar without changing normal chat turn semantics.
No further features are committed to this release.