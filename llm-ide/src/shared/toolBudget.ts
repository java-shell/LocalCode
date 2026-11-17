/**
 * Single source of truth for tool-call (tool-turn) budgets.
 *
 * A "tool turn" is one model exchange inside `chatWithTools` that may emit tool
 * calls; the budget caps how many such exchanges one chat run or one orchestration
 * step may spend before the run is summarized and returned. The same ceiling is
 * reused by the renderer settings clamp, the plan schema validator, the
 * orchestration step clamp and the `spawn_sub_agent` child clamp so that a value
 * accepted in the UI is never silently re-clamped to a smaller number downstream.
 *
 * Rationale for the 1000 ceiling: long agentic coding runs (many read/edit/verify
 * cycles, sub-agent fan-out) routinely outgrow the original 200 cap, which forced
 * premature "tool-call budget reached" summaries. 1000 is a deliberate safety
 * ceiling rather than an unbounded loop: the identical-argument repeat guard
 * (`MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS`) and context compaction still stop
 * runaway sessions well before the ceiling is reached.
 *
 * Security/performance note: a larger ceiling increases worst-case wall time,
 * provider request count and context pressure. It grants no new tool permissions
 * and does not change which tools a model may call.
 */

/** Upper bound for chat and orchestration-step tool-turn budgets. */
export const MAX_TOOL_TURNS = 1000;

/** Budget applied when a chat request omits `maxToolTurns`. */
export const DEFAULT_CHAT_TOOL_TURNS = 250;

/** Upper bound for a single `spawn_sub_agent` child run. */
export const MAX_SUB_AGENT_TOOL_TURNS = 1000;

/** Budget applied when a `spawn_sub_agent` call omits `maxToolTurns`. */
export const DEFAULT_SUB_AGENT_TOOL_TURNS = 8;

/**
 * Clamp a requested tool-turn budget into the supported range.
 *
 * Purpose: normalize untrusted UI/IPC/tool-argument values into a safe integer
 * budget so every layer (renderer, IPC handler, engine, tool runtime) agrees.
 * Inputs: `value` any user- or model-supplied number; `fallback` value used when
 * `value` is not a finite positive number (defaults to the chat default).
 * Outputs: integer in `1..MAX_TOOL_TURNS`.
 * Side effects: none. Errors: none (invalid input falls back instead of throwing).
 * Performance: O(1).
 * Rationale: truncation toward zero via `Math.floor` matches the historical
 * behavior of every clamp site this helper replaces, so valid values are unchanged.
 */
export function clampToolTurns(value: unknown, fallback: number = DEFAULT_CHAT_TOOL_TURNS): number {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
  return Math.max(1, Math.min(MAX_TOOL_TURNS, Math.floor(safeFallback || fallback)));
}

/**
 * Clamp a requested sub-agent tool-turn budget into the supported range.
 *
 * Purpose: same normalization as `clampToolTurns` for `spawn_sub_agent`, where a
 * smaller default (8) is intentional so delegation stays narrow by default.
 * Inputs: `value` requested budget; `fallback` default when invalid (8).
 * Outputs: integer in `1..MAX_SUB_AGENT_TOOL_TURNS`.
 * Side effects: none. Errors: none. Performance: O(1).
 */
export function clampSubAgentToolTurns(
  value: unknown,
  fallback: number = DEFAULT_SUB_AGENT_TOOL_TURNS
): number {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
  return Math.max(1, Math.min(MAX_SUB_AGENT_TOOL_TURNS, Math.floor(safeFallback || fallback)));
}
