# Prompt Spec v2 Redline Mapping

Status: Design mapping only (no runtime changes)
Date: 2026-09-02
Related draft: PROMPT_SPEC_V2_DRAFT.md

### Task Start Declaration
- Task: Create a redline-style mapping from current prompt text to Prompt Spec v2
- Type: Single-step
- Applicable Rules: Task Start Protocol (0.5), Change Safety Protocol (5), Documentation Deliverables (8), Token Optimization and Efficiency (26)
- Breaking Changes: None
- Clarifications Needed: None
- Context Strategy: Parallel reads of prompt assembly files and v2 draft, then targeted section-by-section mapping

## Scope

This redline maps current prompt text in three runtime surfaces to the v2 canonical section model.

Current prompt surfaces reviewed:
- src/main.ts (chat system prompt assembly)
- src/backend/orchestrationEngine.ts (stage system prompt assembly)
- src/backend/toolRuntime.ts (sub-agent prompt)
- src/shared/environment.ts (shared environment guidance block)

## Redline Legend

- Keep: Current text already aligns with v2 intent
- Modify: Keep intent, revise wording/order/specificity
- Add: New v2 section or policy not currently present
- Move: Keep text but relocate within canonical ordering

## Canonical Section Mapping (Current -> v2)

| v2 Section | Current Text Source | Current Text Excerpt | Redline Action | v2 Target Wording |
|---|---|---|---|---|
| 1. Identity and mission | None (chat/orch/sub-agent have partial role cues only) | Sub-agent only: "You are a focused sub-agent..." | Add | "You are an agentic coding assistant for a local IDE runtime. Solve the user request end-to-end while preserving safety and correctness. Be concise, evidence-driven, and avoid speculation." |
| 2. Behavioral policy | Distributed and implicit | Chat: tools enabled; retry notes; concise cues. Sub-agent: do not expand scope. | Add | "Prefer the smallest sufficient change. Preserve existing behavior unless explicitly asked to break it. Surface blockers immediately when they occur." |
| 3. Tool decision policy | src/main.ts formatToolAvailabilityGuidance; src/backend/orchestrationEngine.ts formatStageToolAvailabilityGuidance; src/backend/toolRuntime.ts sub-agent system prompt | "Tools are enabled..." + exact function/JSON guidance; sub-agent says "Use tools only when necessary." | Modify | "Tools are optional, not mandatory. Use tools when external evidence or state mutation is required. For conceptual-only requests, respond directly without tools. When tools are needed, choose the least risky option first." |
| 4. Loop and retry policy | src/main.ts formatToolAvailabilityGuidance; src/backend/orchestrationEngine.ts formatStageToolAvailabilityGuidance; src/backend/toolRuntime.ts sub-agent prompt; retry notes in chat and stage attempts | "Never retry a failed tool call with identical arguments." and stall guidance already present | Keep + Modify | Keep existing anti-loop rule. Add explicit bounded retry rule: "After repeated failures on the same objective, stop and report blocker with attempted changes." Keep retry-note mechanism but avoid language that can be interpreted as a mandate to re-run identical calls. |
| 5. Ambiguity and escalation policy | Not explicit in shared system sections | None | Add | "If required parameters are missing, ask a targeted clarification. If assumptions are low-risk and reversible, proceed and state assumptions. For destructive/high-impact actions, request explicit confirmation." |
| 6. Output contract | Partially present in sub-agent user prompt and retry text | Sub-agent: "Return concise findings... key observations, evidence, recommended next step." | Add | "Final response includes: what was done, current state, and next step if unresolved. Keep concise unless user asks for depth. Provide decision summary, not hidden reasoning." |
| 7. Environment and scope context | src/shared/environment.ts; src/main.ts formatReferenceWorkspaceGuidance; src/backend/orchestrationEngine.ts formatReferenceWorkspaceGuidance | OS/platform and working directory; reference workspace IDs/scopes | Keep + Move | Keep content largely as-is. Place this block after policy sections and before dynamic context blocks in all modes. |
| 8. Dynamic context blocks | Memory injection in src/main.ts and src/backend/orchestrationEngine.ts; prior messages and step input assembly in chat/orch | "Relevant long-term memory... use when helpful and ignore stale items." plus prior messages and step input | Keep + Move | Keep wording with minor compression. Ensure dynamic blocks are appended near the end so policy/contract instructions retain highest salience. |

## Mode Overlay Redline

### Chat Mode

Current
- Uses a composed system block from tool guidance, environment guidance, reference workspace guidance, and optional memory injection.
- Accepts direct assistant completion when no tool calls are needed.

Redline
- Keep direct-completion behavior.
- Add explicit chat overlay sentence: "Prefer direct response when no repository mutation or verification is required."
- Move tool guidance under section 3 (tool decision policy), then loop policy under section 4.

### Orchestration Stage Mode

Current
- Stage prompt starts with optional step.systemPrompt, then environment, retry note, memory, tools, references, and user payload.
- Stage tool guidance includes anti-loop instructions.

Redline
- Keep stage-local specialization.
- Add explicit stage overlay: "Honor stage objective and constraints; emit completion-oriented output for handoff."
- Keep retry note but refine to emphasize strategy change over repeated invocation.

### Sub-Agent Mode

Current
- Strong scoped prompt: no scope expansion, tool-use minimization, anti-loop, blocker reporting, concise handoff.

Redline
- Keep most wording with minimal edits.
- Add explicit confidence threshold line: "If confidence is low or progress stalls, stop early and return blocker + best partial findings."

## String-Level Redline Proposals (High-Impact Rewrites)

1. Replace broad tool-enabled opener in chat/stage
- Current: "Tools are enabled for this turn/stage."
- Proposed: "Tools are available but optional for this turn/stage."

2. Strengthen decision gate before tool use
- Current: "Use the exact function name and valid JSON arguments only."
- Proposed: "Use tools only when external evidence or state change is required; otherwise answer directly. If using a tool, use exact function name and valid JSON arguments."

3. Keep anti-loop core line unchanged
- Current: "Never retry a failed tool call with identical arguments."
- Proposed: Keep unchanged.

4. Add bounded retry escalation rule
- Current: "If progress stalls after a few attempts..."
- Proposed: "If two attempts on the same objective fail to make progress, stop, summarize blocker, and ask for direction."

5. Add explicit ambiguity handling
- Current: None
- Proposed: "When required details are missing, ask one targeted clarification before proceeding."

6. Add output contract globally
- Current: Mostly localized to sub-agent reporting instruction.
- Proposed: "In your final response, include what you did, current state, and the next step if unresolved."

## Assembly Order Redline (Implementation Target)

Target ordering for each top-level system prompt build:
1. Identity and mission
2. Behavioral policy
3. Tool decision policy
4. Loop and retry policy
5. Ambiguity and escalation policy
6. Output contract
7. Environment and scope context
8. Dynamic context blocks (memory/references/state)

Current gap summary:
- Missing globally: identity/mission, ambiguity/escalation, output contract.
- Present but should move/refine: tool and loop guidance.
- Strong and should keep: anti-loop identical-args ban, environment context, scoped sub-agent behavior.

## Minimal-Risk Implementation Slice (No Code Yet)

1. Introduce reusable core prompt section builder for sections 1-6.
2. Reuse existing environment and reference blocks as section 7.
3. Append memory and run-state blocks as section 8.
4. Keep existing deterministic runtime loop guards unchanged.
5. Gate rollout behind promptSpecVersion=v2.

## Review Checklist for Wording Approval

1. Confirm strictness of retry bound (2 attempts vs "few attempts").
2. Confirm whether destructive-action confirmation applies to chat mode only or all modes.
3. Confirm desired verbosity default for final response contract.
4. Confirm whether sub-agent handoff should remain freeform or move to a compact schema.
