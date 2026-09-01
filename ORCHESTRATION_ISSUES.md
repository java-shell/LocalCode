# Orchestration Issues

Tracking document for logic issues identified in the orchestration engine
(`llm-ide/src/backend/orchestrationEngine.ts`) and its design
(`DPC_ADVANCED_ORCHESTRATION.md`).

Status legend: `[ ]` open · `[~]` in progress · `[x]` fixed

---

## 🔴 Critical

### 1. Forward-only DAG constraint silently disables feedback loops
- **Status:** [x] fixed
- **Location:** `runAdvancedIteration` (L712–718)
- **Detail:** Links are filtered to only those where `targetIndex > currentStageIndex`,
  forcing the graph to be a DAG by array position. The design doc's own template has
  `qa_final` (index 6) → `impl_recovery_reasoning` (index 4) as a **backward** edge,
  which is filtered out. When QA emits `FAIL`, `nextLinks` is empty and the graph
  dead-ends at `qa_final`; the recovery loop never fires. Recovery is only reachable
  from impl-stage *errors*, never from QA failure.
- **Fix:** Allow backward edges with proper cycle detection (visited-set per run) and a
  per-run execution cap so the intended QA↔recovery loop works.

---

## 🟠 High

### 2. `completed` does not reflect actual success
- **Status:** [x] fixed
- **Location:** `runOrchestration` (L811)
- **Detail:** `let completed = !loopUntilComplete;` — a non-loop plan is always
  `completed: true` even if every step errored. In loop mode, `completed` is only
  `true` when the completion tool/marker fires. The flag means "ran to its configured
  limit," not "the task succeeded."
- **Fix:** Derive `completed` from actual step success (e.g., all steps succeeded, or
  completion marker fired) rather than from loop configuration.

### 3. Completion-marker detection is fragile and scans all step outputs
- **Status:** [x] fixed
- **Location:** `runOrchestration` (L844, L861) + `containsCompletionMarker` (L58)
- **Detail:** `iterationOutput` joins **every** step's output, then the matcher runs.
  The matcher is a permissive, case-insensitive, whitespace/hyphen/underscore-flexible
  **substring** regex with no word boundaries — `TASK_COMPLETE` also matches
  `task complete`, `task-complete`, `TASK_COMPLETELY`, etc. Any stage that merely
  *mentions* the marker triggers premature completion.
- **Fix:** Use word-boundary-anchored matching and/or require the marker as a standalone
  token; consider restricting the scan to the final step's output.

### 4. Loop mode re-runs the entire graph from the entry stage each iteration
- **Status:** [ ] deferred (architectural — see note)
- **Location:** `runOrchestration` loop + `runAdvancedIteration`
- **Detail:** Each loop iteration calls `runAdvancedIteration` fresh, re-executing the
  whole DAG and discarding which stages already ran. Partial progress isn't preserved.
  Combined with #1, a dead-ended graph re-runs identically every loop and always ends
  `completed: false`.
- **Fix:** Preserve per-run stage execution state across loop iterations (or restructure
  so the loop continues from the last reached stage rather than restarting).
- **Note (deferred):** Fixing #1 (backward edges) already lets a single iteration
  iterate QA↔recovery until it converges or hits the per-run execution budget (#11),
  so the common "keep fixing until it passes" case no longer needs cross-iteration
  state. True resume-from-last-stage is a larger architectural change (persisting
  stage outputs + re-entry points) and is deferred until there's a concrete need.

---

## 🟡 Medium

### 5. Basic-mode `passOutputToNext` is a silent footgun
- **Status:** [x] fixed
- **Location:** `runSingleIteration` (L631)
- **Detail:** `priorOutput` only updates when `passOutputToNext || error ||
  toolBudgetExhausted`. If a step has `passOutputToNext: false` and succeeds, the next
  step receives the **same** input as the current one (no chaining). A user who forgets
  the flag gets a pipeline where every step sees the original prompt, with no warning.
- **Fix:** Default to chaining (or emit a warning when `passOutputToNext: false` causes
  no chaining).

### 6. Retries have no backoff and re-run the whole step
- **Status:** [x] fixed
- **Location:** `runStepWithRetries` (L546–551)
- **Detail:** Immediately retries on any error, re-running all tool calls from scratch.
  For deterministic failures (auth, context overflow) this just burns `maxRetries`
  attempts; for transient network errors there's no delay.
- **Fix:** Add exponential backoff with jitter; distinguish deterministic vs transient
  errors (skip retry for deterministic failures).

### 7. Memory adapter stores every successful step's raw output
- **Status:** [x] fixed
- **Location:** `runStepWithRetries` (L516–522) + `runOrchestration` terminal store (L959–970)
- **Detail:** `memoryAdapter.store(config, rawOutput, step.name)` ran on each success,
  and each step also re-retrieved. Intermediate outputs accumulated in memory, adding
  retrieval noise and bloat across a multi-stage run.
- **Fix:** Per-step storage is now opt-in via `plan.storeIntermediateOutputs`
  (default off). By default only the terminal output is stored once, after the loop,
  using the last successful step's LLM config (`lastSuccessfulConfig`) so the embedding
  model matches the run. Store failures emit `memory:store-failed:<detail>` instead of
  aborting the run.

### 8. Fan-in merge truncates and jumbles inputs
- **Status:** [x] fixed
- **Location:** `runAdvancedIteration` (L720)
- **Detail:** All pending upstream outputs are joined with `\n\n---\n\n` and truncated
  to 12000 chars. When several upstream stages produce large outputs, the merged input
  is a lossy concatenation with no per-source structure.
- **Fix:** Add per-source labels/headers and a smarter truncation strategy (e.g.,
  per-source budget rather than a single global cut).

### 9. `matchPattern` is treated as a raw regex
- **Status:** [ ] deferred (documented contract)
- **Location:** `matchPattern` (L199)
- **Detail:** `new RegExp(pattern, 'i')` — users must escape special chars (the doc uses
  `c\\+\\+`). Unescaped patterns either throw (falling back to substring) or mis-match.
- **Fix:** Escape user patterns by default, or document/validate them; provide a safe
  substring mode.
- **Note (deferred):** The existing design-doc patterns rely on regex features
  (`\bjava\b`, `c\+\+`, `|` alternations), so escaping by default would break them.
  Regex-as-pattern is the intended contract; the safe fallback (substring on invalid
  regex) already prevents crashes. Deferred until a concrete mis-match is reported.

---

## ⚪ Low

### 10. Dead code in `runStepWithRetries`
- **Status:** [x] fixed
- **Location:** `runStepWithRetries` (L584–591)
- **Detail:** The fall-through `return` is unreachable — the `while (attempt <=
  maxRetries)` loop always returns internally (and `maxRetries >= 0` guarantees entry).
- **Fix:** Remove the dead code.

### 11. `maxStageExecutions` is per-iteration, not per-run
- **Status:** [x] fixed
- **Location:** `runAdvancedIteration`
- **Detail:** Total budget is `maxStageExecutions × maxLoops` (140×4 = 560 in the doc).
  Because the graph is a DAG, each iteration runs ~8 stages, so the limit is effectively
  never approached — it's a safety valve that does nothing.
- **Fix:** Make the execution cap per-run (shared across loop iterations).

### 12. Inconsistent event naming
- **Status:** [x] fixed
- **Location:** `runSingleIteration` vs `runAdvancedIteration`
- **Detail:** Basic emits `step:attempt:...`; advanced emits `graph:stage:start:...`.
  UI consumers must handle two schemes.
- **Fix:** Unify event naming across both modes.
