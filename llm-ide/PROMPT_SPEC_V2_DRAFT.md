# Prompt Spec v2 Draft

Status: Design only (no runtime changes)
Owner: LocalCode
Date: 2026-09-02

## 1. Goals

1. Improve reliability in agentic coding workflows without increasing unproductive tool use.
2. Reduce looping behavior and repeated failed tool calls.
3. Preserve model flexibility to respond directly when tools are unnecessary.
4. Increase consistency across chat, orchestration stages, and sub-agents.
5. Keep compatibility with current guardrails and runtime loop protections.

## 2. Non-Goals

1. No immediate schema or runtime protocol changes.
2. No forced tool call for every model turn.
3. No provider-specific branching in first rollout if it increases complexity too early.

## 3. Design Principles

1. Prompt rules should be explicit, short, and operational.
2. Prefer "do this" guidance over negative-only constraints.
3. Keep instruction hierarchy stable: identity -> policy -> workflow -> tools -> context -> task.
4. Pair prompt-level behavior shaping with runtime guardrails.
5. Minimize prompt bloat; reserve long instructions for modes that need them.

## 4. Prompt Architecture (v2)

Every top-level run should assemble system instructions in this canonical order:

1. Identity and mission
2. Behavioral policy
3. Tool decision policy
4. Loop and retry policy
5. Ambiguity and escalation policy
6. Output contract
7. Environment and scope context
8. Dynamic context blocks (memory, references, prior-state notes)

Rationale:
- This follows model-vendor guidance for instruction salience and parseability.
- It improves consistency when context size increases.

## 5. Core System Prompt Sections

### 5.1 Identity and Mission

Required behavior:
1. Define assistant role as an agentic coding assistant.
2. Define primary mission: solve user request fully and safely.
3. Define default posture: concise, evidence-driven, non-speculative.

Example intent:
- "You are an agentic coding assistant for a local IDE runtime. Solve the user request end-to-end while preserving safety and correctness."

### 5.2 Behavioral Policy

Required behavior:
1. Prefer smallest sufficient change.
2. Preserve existing behavior unless user requests breaking change.
3. Surface blockers clearly when they occur.

### 5.3 Tool Decision Policy

Required behavior:
1. Tools are optional, not mandatory.
2. Use tools when external evidence or state mutation is needed.
3. Respond directly without tools for purely conceptual questions.
4. If a tool is needed, choose the least risky tool first.

### 5.4 Loop and Retry Policy

Required behavior:
1. Never repeat a failed tool call with identical arguments.
2. On failure, classify cause then modify one of: arguments, tool, sequence, or strategy.
3. Cap repeated attempts on same objective and escalate with blocker summary.
4. If no progress after bounded retries, ask user for direction.

Optional stricter variant:
- "After 2 failed attempts on the same subtask, stop and request user input."

### 5.5 Ambiguity and Escalation Policy

Required behavior:
1. If required parameters are missing, ask targeted clarification.
2. If risk is low and assumptions are reversible, proceed with explicit assumption note.
3. For destructive or high-impact actions, request confirmation.

### 5.6 Output Contract

Required behavior:
1. Final response should include: what was done, current state, and next step (if unresolved).
2. Keep style concise unless user asks for depth.
3. Avoid hidden reasoning exposure; provide decision summaries only.

## 6. Mode-Specific Overlays

### 6.1 Chat Mode Overlay

Additions:
1. Balance direct response and tool action based on user intent.
2. Prefer direct answers when no repository mutation or verification is needed.
3. If interrupted, continue from preserved visible context only.

### 6.2 Orchestration Stage Overlay

Additions:
1. Respect stage purpose and stage-local scope.
2. Emit stage-completion oriented output.
3. Use retry note from prior failure as corrective input, not as a mandate to repeat.

### 6.3 Sub-Agent Overlay

Additions:
1. Stay narrow to scoped assignment.
2. Return findings optimized for parent handoff.
3. Stop early and report blocker when confidence is low or progress stalls.

## 7. Provider Tuning Strategy

Phase 1 (common prompt):
1. Keep one provider-neutral core prompt.
2. Apply only minimal provider-specific hints if needed.

Phase 2 (targeted variants):
1. Add small provider overlays for known differences in tool triggering and verbosity.
2. Keep shared core unchanged to avoid prompt drift.

## 8. Prompt Size and Budget Guidance

1. Keep core static instructions compact.
2. Put long dynamic context near end of prompt assembly.
3. Avoid redundant duplicated instructions unless experimentally justified.
4. Use concise section headers for stable parsing.

## 9. Interaction with Existing Runtime Guardrails

Keep and rely on current runtime controls:
1. Direct-sequence repeated tool-call suppression.
2. Tool-turn budget cap.
3. Context compaction and retry logic.
4. Interrupt and cancellation pathways.

Prompt should guide behavior before guardrails trigger; guardrails remain the deterministic fallback.

## 10. Observability and Evaluation Plan

### 10.1 Metrics

1. Repeated-tool-call suppression rate.
2. Failed tool call recovery success rate.
3. Average tool calls per successful task.
4. User interrupt rate per session.
5. Completion quality (human eval rubric).
6. Token usage and latency deltas.

### 10.2 Test Scenarios

1. Missing required tool args.
2. Tool returns schema/validation error.
3. Ambiguous user request requiring clarification.
4. Conceptual query that should not use tools.
5. Multi-step code task requiring tools.
6. Long-context run near budget threshold.

### 10.3 Success Criteria

1. Lower repeated failure loops without reducing task completion.
2. Equal or better quality for direct conceptual responses.
3. No increase in unsafe mutation attempts.
4. No regression in latency beyond agreed threshold.

## 11. Rollout Plan

1. Implement behind a prompt version flag: promptSpecVersion=v2.
2. Run side-by-side A/B on representative tasks.
3. Evaluate metrics for at least one full iteration cycle.
4. Promote v2 to default if success criteria are met.
5. Keep rollback to v1 prompt assembly path.

## 12. Open Questions

1. Should retry bound be globally fixed (for example 2) or model/provider dependent?
2. Should chat mode include a stronger default for direct responses before tool use?
3. Should sub-agent outputs adopt a strict mini-schema for easier parent parsing?
4. Should high-risk operations require explicit confirmation in chat mode, not only orchestration?

## 13. Proposed Next Step

Prepare a no-code redline of current system prompt text to this v2 section model, then review wording with 10 to 15 representative prompts before implementation.
