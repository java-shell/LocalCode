# AI Rules - Decision Reference Guide

> **Purpose**: Quick reference for AIs to determine which AI Rules sections apply to a specific task, what to do first, and how to execute with maximum efficiency.

**Last Updated**: April 14, 2026  
**Version**: 1.3.0

---

## 🚀 Quick Start: Task Classification

Before starting ANY task, classify it into one of these categories to determine applicable rules:

### Task Type Matrix

| Task Category | Task Type | Applicable Sections | Complexity | Checklist |
|---------------|-----------|-------------------|-----------|-----------|
| **Code** | New Function/Feature | §0.5, §3, §4, §5, §6, §7, §8, §9, §10 | Low-Medium | Function notes ✓, Tests ✓, Docs ✓ |
| | Bug Fix | §0.5, §3, §5, §6, §9 | Low | No breaking ✓, Tests ✓ |
| | Refactoring | §0.5, §5, §13, §6 | Medium | Tests first ✓, Backward compat ✓ |
| | Performance Tuning | §21, §6, §3 | High | Profile first ✓, Measure ✓ |
| **Security** | Auth/Security Feature | §19, §3, §6, §22 | High | Security review ✓, Tests ✓, Input validation ✓ |
| | Vulnerability Fix | §19, §5, §6 | High | No breaking ✓, Audit ✓ |
| **UI/Frontend** | New UI Component | §18, §14, §20, §3, §6 | Medium | UI baseline ✓, A11y audit ✓, Tests ✓ |
| | UI Refactor | §18, §20, §13, §6 | Medium | Tests first ✓, A11y ✓ |
| | User-Facing Feature | §0.5, §18, §14, §20, §8, §4 | Medium-High | Version tracking ✓, Release notes ✓ |
| **Infrastructure** | Docker/DevOps Setup | §15, §23 | Medium | Deterministic builds ✓, Env vars ✓ |
| | CI/CD Pipeline | §23, §9 | Medium | Automated checks ✓, Tests included ✓ |
| **Database** | Schema/Migration | §0.5, §5, §6, §4 | Medium | Backward compat ✓, Migration plan ✓, Tests ✓ |
| **Documentation** | Function/API Docs | §3, §8 | Low | Purpose ✓, Inputs/Outputs ✓, Errors ✓ |
| | README/Guide | §8, §11 | Low | Clear examples ✓, Use cases ✓ |
| | Changelog | §8, §9 | Low | Conventional format ✓, What changed ✓ |
| **Testing** | Unit Tests | §6, §3 | Low-Medium | Edge cases ✓, Happy path ✓ |
| | Integration Tests | §6, §5 | Medium | Non-regression ✓ |
| | Performance Tests | §21, §6 | Medium | Baselines ✓, Measurable ✓ |
| **Ethics/Compliance** | Bias Review | §24, §19 | High | Audit ✓, Documentation ✓ |
| | AI Response Safety | §24, §19, §22, §23 | High | Moderation ✓, Fallbacks ✓, Logging ✓ |
| | Privacy Implementation | §24, §19 | High | Data minimization ✓, Consent ✓ |
| | Accessibility | §20, §14, §6 | Medium | WCAG AA ✓, Testing ✓ |
| **Internationalization** | i18n Setup | §25 | Medium | String extraction ✓, Locale handling ✓ |
| **Multi-Step Project** | Feature with Multiple Tasks | §0.5, §4, §2, §11 | High | TODO Ledger ✓, Tracking ✓ |

---

## 📋 Task Start Protocol (§0.5) - ALWAYS DO THIS FIRST

Before implementing anything, complete this checklist in order:

```markdown
### Task Start Declaration
- **Task**: [Brief 1-line description]
- **Type**: [Single-step / Multi-step with TODO Ledger]
- **Task Category**: [From Matrix above]
- **Applicable Sections**: [List by number, e.g., §3, §5, §6]
- **Breaking Changes**: [None / Explicitly approved]
- **Clarifications**: [None / List questions]
- **Context Strategy**: [How you'll gather info efficiently]
```

### Pre-Task Checklist (Copy & Complete)

- [ ] **§0.5 Read**: Understood Task Start Protocol
- [ ] **Task Type**: Classified task using Matrix above
- [ ] **Scope**: Clear on what in vs. out
- [ ] **Non-Breaking**: Confirmed §5 applies (backward compat by default)
- [ ] **Applicable Rules**: Identified all sections for this task type
- [ ] **Token Efficiency**: Planned how to minimize redundant reads (§26)
- [ ] **Ready to Build**: All clarifications answered

---

## 🎯 By Task Type: Quick Decision Tree

### I'm Writing a New Function

**Sections**: §0.5 → §3 (Function Notes) → §7 (Clean Code) → §6 (Tests)

**Steps**:

1. ✅ Task Start Declaration (§0.5)
2. ✅ Write function with purpose, inputs, outputs
3. ✅ Add comprehensive notes/docstring (§3) - scale to complexity per §26.5
4. ✅ Write unit tests covering happy path + edge cases (§6)
5. ✅ Verify existing tests still pass (§5)
6. ✅ Update README/docs if public API (§8)
7. ✅ Commit with conventional format (§9)

**Checklist**:

- [ ] Function notes include: purpose, inputs, outputs, errors, side effects
- [ ] Tests cover happy path and edge cases
- [ ] No breaking changes
- [ ] Docs updated if user-facing

---

### I'm Fixing a Bug

**Sections**: §0.5 → §5 (Non-Breaking) → §6 (Tests) → §9 (Commits)

**Steps**:

1. ✅ Task Start Declaration (§0.5)
2. ✅ Write test that reproduces bug (§6)
3. ✅ Fix the bug - minimal change
4. ✅ Verify test now passes
5. ✅ Verify NO regressions in related tests (§5)
6. ✅ Commit with `fix:` prefix (§9)

**Checklist**:

- [ ] Bug reproduced in test first
- [ ] Fix is minimal change
- [ ] No regressions
- [ ] Commit message is clear

---

### I'm Refactoring Code

**Sections**: §0.5 → §5 (Backward Compat) → §13 (Refactoring) → §6 (Tests)

**Steps**:
1. ✅ Task Start Declaration (§0.5)
2. ✅ Add/extend tests to lock current behavior (§6)
3. ✅ Analyze responsibilities, variable ownership, and coupling points (§13.4)
4. ✅ Apply Modularize Code flow: extract small functions/classes, clarify names, remove duplication, create clean boundaries (§13.4 + `ModularizeCode.md`)
5. ✅ Refactor incrementally - small atomic steps (§13.4)
6. ✅ Run tests after each step (§6)
7. ✅ Verify non-regression throughout
8. ✅ Update function notes explaining rationale (§3 + §13)
9. ✅ Document refactoring in commit (§13)

**Checklist**:
- [ ] Tests green before refactor (§6)
- [ ] Responsibilities and coupling analyzed before extraction (§13.4)
- [ ] Incremental changes only
- [ ] Modularize Code flow followed for structural refactors
- [ ] All tests pass after each change
- [ ] Function notes explain rationale (§13.5)
- [ ] No public API changes (unless approved §5)

---

### I'm Building a Security Feature

**Sections**: §0.5 → §19 (Security) → §3 (Function Notes) → §6 (Tests) → §4 (Multi-step)

**Steps**:
1. ✅ Task Start Declaration (§0.5)
2. ✅ Create TODO Ledger if multi-step (§4)
3. ✅ Design security approach - OWASP, input validation (§19.1-2)
4. ✅ Implement with security-focused function notes (§3 + §19.2)
5. ✅ Write security tests - injection, boundary, error cases (§6)
6. ✅ Security review before merge (§19.3)
7. ✅ Update docs with security considerations (§8)

**Checklist**:
- [ ] OWASP Top 10 mitigations addressed
- [ ] Input validation + sanitization
- [ ] Function notes include security section (§19.2)
- [ ] Security tests pass
- [ ] No secrets in code/logs
- [ ] Security reviewed before release

---

### I'm Building a UI Component

**Sections**: §0.5 → §18 (UI Baseline) → §20 (A11y) → §14 (Versioning) → §6 (Tests)

**Steps**:
1. ✅ Task Start Declaration (§0.5)
2. ✅ Follow Assistant Coach baseline design (§18)
3. ✅ Build component with semantic HTML + ARIA (§20)
4. ✅ Test accessibility (keyboard nav, screen reader, contrast) (§20.3)
5. ✅ Test responsive design (mobile/tablet/desktop)
6. ✅ If user-facing: add version badge + release notes (§14)
7. ✅ Document in code (purpose, customization points)
8. ✅ Add UI tests (screenshot/snapshot tests if framework supports)

**Checklist**:
- [ ] Semantic HTML + ARIA used correctly
- [ ] WCAG AA compliant (contrast, keyboard nav)
- [ ] Responsive tested
- [ ] User-facing? Version badge + release notes (§14)
- [ ] Component documented

---

### I'm Optimizing Performance

**Sections**: §0.5 → §21 (Performance) → §6 (Tests) → §3 (Function Notes)

**Steps**:
1. ✅ Task Start Declaration (§0.5)
2. ✅ Measure CURRENT performance - profile, don't assume (§21.1-3)
3. ✅ Identify bottleneck (CPU, memory, I/O, network)
4. ✅ Apply targeted optimization (caching, algorithm, batching) (§21.4)
5. ✅ Measure AFTER optimization - verify improvement
6. ✅ Update function notes with performance trade-offs (§3, §21.5)
7. ✅ Add performance tests to prevent regression (§6)

**Checklist**:
- [ ] Baseline performance measured
- [ ] Bottleneck identified (not assumed)
- [ ] Optimization applied
- [ ] Performance improved (measured)
- [ ] Trade-offs documented in function notes
- [ ] Regression tests added

---

### I'm Setting up CI/CD

**Sections**: §0.5 → §23 (CI/CD) → §9 (Commits)

**Steps**:
1. ✅ Task Start Declaration (§0.5)
2. ✅ Start from the provided template if it fits: `templates/github-actions/ai-rules-checks.yml`
3. ✅ If the project uses Jest, Pytest, `dotnet test`, or `go test`, prefer the matching strict testing template under `templates/github-actions/` before inventing custom enforcement logic
4. ✅ Design pipeline stages: Build → Test → Deploy (§23.1)
5. ✅ Add quality gates: linting, tests, security scans (§23.2)
6. ✅ Automate deployment with proper strategy (§23.4)
7. ✅ Add health checks + rollback capability (§23.5)
8. ✅ Document pipeline in repo (§23.6)

**Checklist**:
- [ ] Pipeline stages defined
- [ ] Tests automated (unit + integration)
- [ ] Linting/security scanning enabled
- [ ] Deployment strategy chosen (blue-green/canary)
- [ ] Rollback plan documented

---

## Testing Enforcement Templates

Use the packaged testing starters when the project matches one of these stacks. They are stricter than the generic `ai-rules-checks.yml` workflow and are designed to reinforce Testing Requirements (§6).

| Stack | GitHub Actions Template | Local Validator | Expected Layout |
|-------|-------------------------|-----------------|-----------------|
| Jest | `templates/github-actions/jest-testing-enforcement.yml` | `templates/pre-commit/validate-jest-tests.ps1` | `tests/unit` and `tests/integration`, plus `test:unit` and `test:integration` scripts |
| Pytest | `templates/github-actions/pytest-testing-enforcement.yml` | `templates/pre-commit/validate-pytest-tests.ps1` | `tests/unit` and `tests/integration` with Pytest file naming |
| .NET | `templates/github-actions/dotnet-testing-enforcement.yml` | `templates/pre-commit/validate-dotnet-tests.ps1` | `tests/unit` and `tests/integration` containing test `.csproj` files |
| Go | `templates/github-actions/go-testing-enforcement.yml` | `templates/pre-commit/validate-go-tests.ps1` | `tests/unit` and `tests/integration` containing `*_test.go` files |

Choose the closest starter, then adapt runtime versions, commands, and any repo-specific test folders.

---

### I'm Working on a Multi-Step Task

**Sections**: §0.5 → §4 (TODO Ledger) → §2 (Workflow) → §11 (Session Conduct)

**Steps**:
1. ✅ Task Start Declaration (§0.5)
2. ✅ Create TODO Ledger with AI-### IDs (§4.1)
3. ✅ Plan: goals, constraints, risks (§2.1)
4. ✅ Build: incremental, one TODO at a time (§2.1)
5. ✅ After each item: mark complete + commit ref (§4.1-2)
6. ✅ Document decisions in working notes (§11)
7. ✅ Final delivery: summary + checklist (§2.1, §10)

**Checklist**:
- [ ] TODO Ledger created with AI-### IDs
- [ ] Items marked [x] with commit refs when complete
- [ ] Working notes document key decisions
- [ ] Final delivery summary provided
- [ ] All items completed or carried forward

---

## 📚 Sections at a Glance

### Core Sections (Apply to Almost Everything)

| Section | Title | When to Use | Key Takeaway |
|---------|-------|-----------|--------------|
| **§0** | Core Principles | Always | 5 mandatory principles: docs all functions, create TODOs, use clean code, preserve compat, document intent |
| **§0.5** | Task Start Protocol | Before ANY task | Complete checklist, declare task type, identify applicable rules |
| **§2** | Workflow | Multi-step tasks | Plan → Build → Verify → Document → Deliver |
| **§3** | Function Notes | Every function | Purpose, inputs, outputs, errors, side effects, perf, security, concurrency, rationale (scale per §26.5) |
| **§4** | TODO Management | Multi-step tasks | Create AI-### Ledger, track progress, mark complete with commits |
| **§5** | Non-Breaking Changes | All changes | Backward compat by default; breaking = explicit approval + migration plan |
| **§6** | Testing | All code changes | Unit + integration tests; edge cases; non-regression verification |
| **§7** | Clean Code | All code | KISS, YAGNI, minimal deps, small pure functions, early returns |
| **§8** | Documentation | Feature changes | Update README/API, inline comments, ADR for architectural choices |
| **§9** | Commits & PRs | All commits | Conventional format (feat:, fix:, docs:); footer Refs: AI-### |
| **§10** | PR Checklist | Before merge | Copy checklist; verify all items before marking done |
| **§11** | Session Conduct | All sessions | Working notes, delivery summary with outcomes + TODO status |

### Domain-Specific Sections

| Section | Title | When to Use | Key Takeaway |
|---------|-------|-----------|--------------|
| **§13** | Refactoring Standards | Refactoring | Tests first, DRY/YAGNI/SRP, small incremental steps, document rationale |
| **§14** | UI/UX Documentation | User-facing modules | Version tracking, release notes, semantic versioning |
| **§15** | Azure/Docker Defaults | Infrastructure | Deterministic builds, env vars, structured logging, observability baselines |
| **Guide** | Logging & Observability | Services and operations | Use `LOGGING-OBSERVABILITY.md` for log fields, metrics, and alerting baselines |
| **§18** | UI Development | Web UI | Use Assistant Coach baseline unless told otherwise |
| **§19** | Security Best Practices | Auth, data handling | OWASP Top 10, input validation, secure patterns |
| **§20** | Accessibility | User-facing UI | WCAG 2.1 AA, keyboard nav, semantic HTML, screen readers |
| **§21** | Performance Optimization | Performance work | Profile first, measure before/after, document trade-offs |
| **§22** | Error Handling | Resilient systems | Exceptions, retry logic, circuit breakers, graceful degradation |
| **§23** | CI/CD Best Practices | DevOps | Pipeline design, automated checks, deployment strategies |
| **§24** | Ethical AI Considerations | Bias/ethics concerns | Bias mitigation, moderation, fallback safety, transparency, privacy |
| **§25** | Internationalization | Multi-language | i18n libraries, locale-aware formatting, RTL support |
| **§26** | Token Optimization | Efficiency focus | Context management, caching, batch ops, concise responses |
| **§27** | Rule Maintenance | Long-term | Versioning, changelog, periodic reviews |

---

## 🔍 Decision Flowcharts

### "What Rules Apply to My Task?"

```
START: New Task
  │
  ├─ Is it CODE? (function, bug, refactor, perf)
  │   └─ §0.5 → §3 (Function Notes) → §7 (Clean Code)
  │       → §5 (Non-Breaking) → §6 (Tests)
  │       → §9 (Commits) → §10 (PR Checklist)
  │
  ├─ Is it SECURITY? (auth, vulnerability, encryption)
  │   └─ §19 (Security) + Code rules above
  │
  ├─ Is it UI? (component, page, design)
  │   └─ §18 (UI Baseline) → §20 (A11y)
  │       → §14 (Versioning if user-facing)
  │
  ├─ Is it PERFORMANCE? (optimization, tuning)
  │   └─ §21 (Profile first!) + Test rules
  │
  ├─ Is it INFRA? (Docker, CI/CD, deployment)
  │   └─ §15 or §23 + §9 (Commits)
  │
  ├─ Is it TESTING? (unit, integration, e2e)
  │   └─ §6 (Testing) + follow framework conventions
  │
  ├─ Is it DOCS? (README, API, Changelog)
  │   └─ §8 (Documentation)
  │
  └─ Is it MULTI-STEP? (feature spanning days/weeks)
      └─ §0.5 → §4 (TODO Ledger) → §2 (Workflow)
```

### "Should I Break Backward Compatibility?"

```
User asks for breaking change?
  │
  ├─ Did they say "explicitly approved" or "breaking OK"?
  │   ├─ NO → Default to §5: No breaking changes
  │   │         → Add flags/adapters/shims
  │   │         → Gate new behavior behind feature flag
  │   │
  │   └─ YES → Follow §5.5: Migration Plan Required
  │             ├─ Document impact + timeline
  │             ├─ Provide fallback paths
  │             ├─ Add deprecation warnings (§5.6)
  │             └─ Include in commit footer: BREAKING CHANGE:
```

### "What Tests Do I Need?"

```
Code change?
  │
  ├─ New function/logic?
  │   └─ Unit tests: happy path + edge cases (§6)
  │
  ├─ Changed existing function?
  │   └─ Unit tests + integration tests (§6)
  │       → Verify non-regression (§5)
  │
  ├─ Performance optimization?
  │   └─ Performance baseline tests (§21)
  │
  ├─ Security-sensitive?
  │   └─ Security tests: injection, boundaries (§19, §6)
  │
  ├─ UI component?
  │   └─ Visual regression (screenshot) (§6, §20)
  │       + accessibility tests (§20.3)
  │
  └─ Database migration?
      └─ Data integrity tests (§6)
          + rollback tests (§5)
```

---

## ⚡ Efficiency Checklist (§26)

Every task should optimize token usage. Before you start, plan:

- [ ] **Context Gathering**: Will you read entire files or use grep for overview? (§26.2)
- [ ] **Parallel Operations**: Can multiple file reads/searches happen together? (§26.5)
- [ ] **Batch Edits**: Will you use multi_replace_string_in_file for multiple changes? (§26.5)
- [ ] **Response Length**: Can you answer concisely or does this need detail? (§26.4)
- [ ] **Caching**: Have you re-read this file before in this session? (§26.3)
- [ ] **Documentation Scale**: Is this function simple/internal/critical? What doc level? (§26.5)

**Target**: 40-80% reduction in token usage vs. naive approach.

---

## 🚨 Delivery Checklist (§10 + §0)

Copy & complete before marking task done:

- [ ] Function notes/docstrings added/updated (§3, scaled per §26.5)
- [ ] README/API/CHANGELOG updated (§8)
- [ ] Tests added/updated (unit + integration) (§6)
- [ ] Existing functionality verified intact (§5)
- [ ] TODO Ledger updated with completions + commit refs (§4)
- [ ] No unnecessary dependencies added (§7)
- [ ] Security/privacy evaluated + documented (§19, §24)
- [ ] Ethics, bias controls, moderation thresholds, and fallback behavior reviewed when AI output is user-visible (§24)
- [ ] Refactoring rationale documented if applicable (§13)
- [ ] User-facing modules have version tracking (§14)
- [ ] UI changes follow baseline (§18)
- [ ] Accessibility audited (§20)
- [ ] Performance measured (§21)
- [ ] Error handling tested (§22)
- [ ] Token efficiency maintained (§26)

---

## 📞 Quick Section Index (Searchable)

### A

- Accessibility (§20)
- API Documentation (§8, §14)
- Architecture (§8, §13)
- Async/Concurrency (§3, §22)
- Audit Trail (§11)

### B

- Backward Compatibility (§5)
- Batch Operations (§26)
- Bias Mitigation (§24)

### C

- Caching (§21, §26)
- Changelog (§8, §9)
- Circuit Breaker (§22)
- Commits (§9)
- Compliance (§24, §27)
- Concurrency (§3, §22)
- Configuration (§15)

### D

- Database (§5, §6)
- Decorators (§13)
- Deployment (§23)
- Deprecation (§5.6, §14)
- Design Decisions (§8)
- Documentation (§3, §8, §14)
- Docker (§15, §23)

### E

- Error Handling (§22)
- Ethics (§24)
- Exceptions (§22)

### F

- Feature Flags (§5, §18)
- Frontend (§18, §20)
- Function Notes (§3)

### G

- Governance (§16)

### H

- Hashing (§19, §24)

### I

- i18n/l10n (§25)
- Idempotency (§22)
- Infrastructure (§15, §23)
- Input Validation (§19)

### J

- JWT (§19)

### K

- KISS Principle (§7)

### L

- Labels/Tags (§27)
- Lazy Loading (§21)
- Linting (§23)
- Logging (§15, §22)
- Luna (optional semantic retrieval provider) (§26)

### M

- Metrics (§21, §26)
- Migrations (§5, §8)
- Module Versioning (§14)
- Monitoring (§23, §26)

### N

- Non-Breaking Changes (§5)

### O

- OAuth (§19)
- OWASP (§19)
- Optimization (§21, §26)

### P

- Performance (§21, §26)
- Profiling (§21)
- Privacy (§24)

### Q

- Quality Gates (§23)

### R

- RAG (Retrieval-Augmented Generation) (§26)
- Refactoring (§13)
- Release Notes (§8, §14)
- Resilience (§22)
- Retry Logic (§22)
- Rollback (§23)

### S

- Schema Changes (§5, §6)
- Search Strategies (§26)
- Security (§19)
- Semantic HTML (§20)
- SemVer (§5, §14)
- Session Conduct (§11)
- SPA (§18)

### T

- Task Start Protocol (§0.5)
- Testing (§6)
- Token Optimization (§26)
- TODO Ledger (§4)
- TypeScript (§3, §7)

### U

- UI Development (§18)
- Unit Tests (§6)
- User-Facing Modules (§14)

### V

- Versioning (§14, §27)
- Vulnerability Scanning (§23)

### W

- WCAG (§20)
- Workflow (§2)

### Y

- YAGNI Principle (§7)

---

## 🤔 Common Questions Answered

### Q: Do I need to document every single line of code?

**A**: No. Scale documentation to complexity per §26.5:

- **Simple helpers**: Purpose line + edge case notes
- **Internal utils**: Purpose, inputs, outputs, key assumptions
- **Critical public APIs**: Full §3 template

Goal is clarity, not word count.

### Q: What if I'm in a time crunch?

**A**: Follow Essential Tier from RULES-TIERS.md (5 rules):

1. Document functions (§3, simplified)
2. No breaking changes (§5)
3. Test changes (§6)
4. Keep it simple (§7)
5. Clean commits (§9)

Still covers ~80% of simple tasks. Add Standard Tier rules for production.

### Q: Can I skip tests?

**A**: No. §6 is mandatory. But scope appropriately:

- New feature: unit + integration
- Bug fix: test reproducing bug + existing regression tests
- Documentation: no test needed

No exceptions unless explicitly approved in a §16 governance note.

### Q: What if requirements are ambiguous?

**A**: §0.5 says ask focused questions ONCE upfront, not repeatedly. Ask all clarifications before building.

### Q: Should I optimize for performance from the start?

**A**: No. §7 (clean code) first, §21 (optimization) only when measurements show bottleneck. Follow Plan → Profile → Optimize workflow.

### Q: Do I need to update docs every time?

**A**: Yes. §8 is mandatory for feature changes:

- README/API: if user-facing
- Inline comments: if not obvious
- CHANGELOG: for notable changes

For trivial fixes, docstring updates are sufficient.

### Q: How do I handle breaking changes?

**A**: §5 default = no breaking. If approved:

1. Add migration plan
2. Provide fallback paths
3. Gate new behavior behind flags
4. Document impact + timeline
5. Use BREAKING CHANGE: footer

### Q: When should I create a TODO Ledger?

**A**: §4 says: Multi-step tasks. If it's >1 hour of work or spans multiple sessions, use AI-### IDs and track progress.

### Q: Token efficiency sounds complex. Where do I start?

**A**: §26 says start with 4 things:

1. Use grep_search to scan before detailed reads
2. Batch edits with multi_replace_string_in_file
3. Use semantic retrieval/vector search for large, concept-heavy code or document sets when it improves recall
4. Respond concisely (target: 1-3 sentences for simple tasks)

That's 40% reduction. Advanced stuff comes later.

### Q: Should I use Luna for RAG and vector search?

**A**: Use Luna when the project has a large or concept-heavy codebase, documentation set, or knowledge corpus where semantic recall matters more than pure string matching. Keep Luna optional in configuration rather than hard-coding it into the universal rules, and document the rationale, privacy/security constraints, retrieval quality benchmarks, fallback-to-keyword behavior, and cost/performance trade-offs before relying on it.

### Q: Can I skip the Task Start Protocol?

**A**: No. §0.5 is MANDATORY. 10-second checklist:

- [ ] Identified task type
- [ ] Listed applicable sections
- [ ] Checked for breaking changes
- [ ] Planned context gathering

Do this before any work.

---

## 📖 How to Use This Document

1. **New to AI Rules?** Start with "🚀 Quick Start" section above.
2. **Have a specific task?** Use "🎯 By Task Type" flowchart to find your checklist.
3. **Need deep dive?** Reference original section in `rules.md`.
4. **Want to find a topic?** Use "📞 Quick Section Index" to search.
5. **Before merging?** Copy "🚨 Delivery Checklist" and verify all items.

---

## 🔗 Cross-References

- **Full Rules**: See `rules.md` for complete details on all sections
- **Quick Reference**: See `RULES-QUICKREF.md` for condensed version
- **Tier System**: See `RULES-TIERS.md` for when to apply which rules by project maturity
- **Copilot Instructions**: See `.github/copilot-instructions.md` for GitHub Copilot setup

---

## 📝 Notes for Maintainers

**How to Update This Document**:

1. When rules.md is updated, sync applicable section numbers here
2. If a task type becomes common, add to "By Task Type" matrix
3. If a question is frequently asked, add to "Common Questions"
4. Maintain section order to match rules.md for consistency
5. Keep matrices scannable and decision trees simple

**Version Control**:

- Update version number (top of file) when sections change
- Reference updated-at date for context
- Track in rules-changelog.md if major changes

---

**Created**: December 6, 2025  
**Maintained by**: AI Rules Community  
**License**: Same as parent AI Rules repository
