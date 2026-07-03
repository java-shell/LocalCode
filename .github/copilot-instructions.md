# GitHub Copilot Custom Instructions

## 🎯 MANDATORY: Task Start Protocol

**Before starting ANY coding task, you MUST:**

1. **Read and follow the rules** in `rules.md` located at the workspace root
2. **Complete the Task Start Protocol (§0.5)** in `rules.md`
3. **Create a TODO Ledger** for multi-step tasks with stable `AI-###` IDs
4. **Confirm non-breaking changes** unless explicitly instructed otherwise
5. **Document all functions** per Function Notes & Documentation Requirements (§3) (purpose, inputs, outputs, side effects, errors, performance, security, ethics/fairness when applicable, concurrency, rationale)
6. **For refactors, apply Modularize Code flow** from Refactoring & Code Quality Standards (§13.4) and `ModularizeCode.md`

## 📂 Rule Files Location

- **Primary Rules**: `.ai-rules/rules.md` (or `rules.md` if at workspace root)
- **Quick Reference**: `.ai-rules/RULES-QUICKREF.md` (or `RULES-QUICKREF.md` if at workspace root)

## ✅ Task Start Declaration

Provide this at the start of every task:

```markdown
### Task Start Declaration
- **Task**: [Brief description]
- **Type**: [Single-step / Multi-step with TODO Ledger]
- **Applicable Rules**: [e.g., Function Notes & Documentation Requirements (§3), Change Safety Protocol (§5), Testing Requirements (§6)]
- **Breaking Changes**: [None / Explicitly approved with migration plan]
- **Clarifications Needed**: [None / List specific questions]
```

Use named rule references first and section numbers second throughout derivative docs, for example `Change Safety Protocol (§5)`.

## 🔒 Golden Rules (Always Enforce)

1. **Always make notes for every function** — Include rationale, assumptions, side effects, error behavior (scale to complexity per Token Optimization and Efficiency (§26))
2. **Document and provide context** — Update README/API, inline comments, design notes
3. **Create and maintain TODOs** — Use TODO Ledger with checkboxes, mark complete with commit refs
4. **Prefer the cleanest, simplest solution** — KISS, YAGNI, minimal dependencies, favor stdlib
5. **Do not break existing functionality** — Non-breaking by default; breaking changes require explicit approval + migration plan
6. **Use Assistant Coach UI Setup as baseline** — For UI development, start with this framework unless explicitly told otherwise under UI Development Guidelines (§18)
7. **Optimize token usage (40-80% reduction target)** — Use RAG principles, provider-agnostic semantic retrieval/vector search for large code or document sets when helpful, caching (75-90% on repeats), model cascading, batch operations, parallelize reads, scale docs to complexity, and respond concisely under Token Optimization and Efficiency (§26)
8. **Modularize structural refactors intentionally** — Analyze responsibilities first, then extract functions/classes/modules, remove duplication, and create clean boundaries without changing behavior under Refactoring & Code Quality Standards (§13.4)

## 📋 Core Workflow: Plan → Build → Verify → Document → Deliver

1. **Plan**: Identify goals, constraints, risks; create TODO Ledger for multi-step tasks
2. **Build**: Implement incrementally, minimal changes, dependency-light; for refactors, follow the Modularize Code flow
3. **Verify**: Run tests, validate existing behavior remains intact
4. **Document**: Update function notes, README, CHANGELOG, ADR
5. **Deliver**: Provide summary (what, why, how tested, TODO status)

## 🚨 Non-Negotiable Requirements

- **Every function**: Comprehensive docstring/notes using Function Notes & Documentation Requirements (§3), scaled proportionally under Token Optimization and Efficiency (§26)
- **Multi-step tasks**: TODO Ledger with `AI-###` IDs under TODO Management (§4)
- **Tests required**: Unit + integration tests for all changes under Testing Requirements (§6)
- **Backward compatibility**: Default mode; breaking changes need approval under the Change Safety Protocol (§5)
- **Documentation updates**: README/API/CHANGELOG for every change under Documentation Deliverables (§8)
- **Browser/UI testing**: Use Chrome DevTools MCP, no manual browser commands under Browser & UI Testing (§6.1)
- **Bug fixes**: Follow the Systematic Debugging Protocol (§6.5); no fixes without root cause investigation
- **Refactoring**: Follow Refactoring & Code Quality Standards (§13) and `refactoring.md`
- **Structural refactoring/modularization**: Follow `ModularizeCode.md` as part of Refactoring & Code Quality Standards (§13)
- **User-facing modules**: Implement version tracking with release notes under UI/UX Documentation Standards (§14)
- **UI Development**: Use Assistant Coach UI Setup as baseline under UI Development Guidelines (§18)
- **Security**: Follow Security Best Practices (§19); validate inputs, secure auth
- **Accessibility**: Follow Accessibility Standards (§20) at WCAG 2.1 AA minimum
- **Performance**: Measure before optimizing under Performance Optimization Guidelines (§21)
- **Error Handling**: Use robust patterns with retries under Error Handling and Resilience Patterns (§22)
- **CI/CD**: Automate pipelines with scans under Continuous Integration and Deployment (CI/CD) Best Practices (§23)
- **Ethics**: Avoid biases, apply moderation and safe fallbacks, protect privacy, and ensure transparency under Ethical AI Coding Considerations (§24)
- **Token Efficiency**: Batch operations, parallelize reads, proportional docs, concise responses, and explicit semantic retrieval configuration when used under Token Optimization and Efficiency (§26)

## 📦 Delivery Checklist (Complete Before Marking Done)

- [ ] Function notes/docstrings added or updated for all changes (scaled to complexity under Token Optimization and Efficiency (§26))
- [ ] README/API/CHANGELOG updated as needed
- [ ] Tests added/updated (unit + integration) and pass locally/CI
- [ ] Existing functionality verified intact (no regressions)
- [ ] TODO Ledger updated; completed items checked with commit/PR refs
- [ ] No new unnecessary dependencies introduced
- [ ] Security/privacy considerations evaluated and documented
- [ ] Ethics, bias controls, moderation thresholds, and fallback behavior reviewed when AI output or automated decisions are involved
- [ ] Refactoring changes documented with rationale and tests under Refactoring & Code Quality Standards (§13)
- [ ] User-facing modules have version tracking and release notes under UI/UX Documentation Standards (§14)
- [ ] UI changes follow Assistant Coach baseline under UI Development Guidelines (§18)
- [ ] Accessibility audited under Accessibility Standards (§20)
- [ ] Performance measured and documented under Performance Optimization Guidelines (§21)
- [ ] Error handling tested under Error Handling and Resilience Patterns (§22)
- [ ] Ethical implications reviewed under Ethical AI Coding Considerations (§24)
- [ ] Token efficiency maintained (batched operations, minimal re-reads, concise responses under Token Optimization and Efficiency (§26))
- [ ] **If bug fix**: Root cause investigation completed and documented under the Systematic Debugging Protocol (§6.5)
- [ ] **If bug fix**: Failing test created before fix implementation under the Systematic Debugging Protocol (§6.5)

## ⚠️ Failure to Comply

**Work that does not follow these rules is invalid and must be revised.**

If you notice the AI has not completed the Task Start Protocol or is violating any core rule, immediately request compliance before proceeding.

---

**Rule Version**: 1.10.0  
**Enforcement**: MANDATORY for all AI-assisted coding tasks
