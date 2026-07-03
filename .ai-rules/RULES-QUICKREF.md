# Rules — Quick Reference (underscore copy)

Use this condensed checklist at task start. For full guidance, see `rules.md` (primary source of truth).

Reference style: prefer named rules with optional section numbers, for example `Task Start Protocol (§0.5)`.

## For AI: Task Start (do before any work)

- Read: confirm familiarity with `rules.md` and the Task Start Protocol (§0.5).
- Identify: single-step vs multi-step (create TODO Ledger if multi-step).
- Scope & Safety: confirm non-breaking-by-default and list applicable rule sections.
- Clarify: ask focused questions once if scope ambiguous.
- Context Plan: state files to read and search strategy (minimize redundant reads).
- Retrieval Plan: for large code or document sets, decide whether semantic retrieval/vector search is worth enabling and keep the provider choice explicit.
- Ethics Plan: if AI-visible output or automated decisions are involved, define bias detection, moderation, fallback behavior, logging, and latency checks up front.
- Refactor Work: when restructuring code, follow the Refactoring & Code Quality Standards process (§13.4) and `ModularizeCode.md`.

## Minimal Task Start Declaration (copy into notes/PR)

```text

### Task Start Declaration
- Task: [brief description]
- Type: [Single-step / Multi-step with TODO Ledger]
- Applicable Rules: [e.g., Function Notes & Documentation Requirements (§3), Change Safety Protocol (§5), Testing Requirements (§6), Token Optimization and Efficiency (§26)]
- Breaking Changes: [None / Approved]
- Clarifications Needed: [None / list questions]
- Context Strategy: [which files/search plan]

```

## Debugging Protocol (when fixing bugs — Systematic Debugging Protocol (§6.5))

### Iron Law: No Fixes Without Root Cause Investigation

1. **Phase 1: Investigate** — Read errors, reproduce, check changes, gather evidence, trace data flow
2. **Phase 2: Analyze** — Find working examples, compare, identify differences
3. **Phase 3: Hypothesize** — Form single hypothesis, test minimally, verify
4. **Phase 4: Implement** — Create failing test, fix root cause, verify

**STOP after 3 failed fixes** → Question architecture, discuss with user

**Red Flags** (return to Phase 1):

- "Quick fix for now" / "Just try X" / "I don't fully understand but..."
- Multiple changes at once / Skip the test / One more attempt (after 2+)

See: `debugging.md` for full protocol

## PR Checklist (include in PR description)

- [ ] Function notes/docstrings added/updated
- [ ] README/API/CHANGELOG updated as needed
- [ ] Tests added/updated and pass locally/CI
- [ ] Existing functionality verified intact (no regressions)
- [ ] TODO Ledger updated; completed items checked with commit/PR refs
- [ ] No new unnecessary dependencies introduced
- [ ] Security/privacy considerations evaluated and documented
- [ ] Ethics, bias controls, and moderation behavior reviewed when AI output or automated decisions are involved
- [ ] Token efficiency maintained (minimal re-reads, batched operations, concise responses per §26)
- [ ] **If bug fix**: Root cause documented with evidence
- [ ] **If bug fix**: Failing test created before fix
- [ ] **If bug fix**: No other tests broken

## Where to look

- Canonical rules: `rules.md`
- Short, actionable checklist: `RULES-QUICKREF.md` (dash)
- Enforcement wrapper: `.github/copilot-instructions.md`

## Notes

- Keep this file concise — update `rules.md` first, then sync this quickref.
- Prefer named rule references over bare section numbers so renumbering causes less churn.
