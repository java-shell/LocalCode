# Coding with AI — Rules of Engagement - Metzger 11-25-2025 - (`rules.md`)

> **Purpose**: A clear, enforceable set of rules for collaborating with an AI on software tasks. These rules ensure the AI always documents intent and context, manages TODOs to completion, favors clean/simple solutions, and **never breaks existing functionality** unless explicitly instructed to do so.
>
> **Version**: 1.10.0
> **Last Updated**: April 14, 2026

---

## 0) Core Principles (Mandatory)

To ensure consistent, high-quality AI-assisted coding, the following requirements are **mandatory** and apply to every task:

1. **Function Notes for All Functions**
    - Every function **must** include detailed notes/docstrings covering: purpose, inputs, outputs, side effects, error handling, performance considerations, security/privacy concerns, concurrency assumptions, and rationale/trade-offs. AI-influenced functions should also document fairness, moderation, and human-override assumptions when those concerns materially affect behavior.

2. **Documentation & Context Creation**
    - All changes **must** be accompanied by updated docs. This includes README/API updates, inline comments where context matters, and a short design note (ADR) for non-trivial or architectural decisions.

3. **TODOs for Multi-Step Work (Create → Track → Complete)**
    - When multiple tasks are needed, create a **TODO Ledger** with stable IDs (e.g., `AI-###`).
    - Track progress with checkboxes; **mark items complete** when done and reference commits/PRs.
    - Keep the ledger current; carry forward any remaining items.

4. **Use the Cleanest & Simplest Method**
    - Favor straightforward, minimal solutions (KISS, YAGNI). Avoid unnecessary abstraction and external dependencies; prefer the standard library and composition.

5. **Preserve Existing Functionality by Default**
    - Treat backward compatibility as the default contract. Do **not** introduce breaking changes unless explicitly instructed. If breaking changes are approved, provide a migration plan, clearly document impact, and gate behavior via flags/adapters where possible.

## 27) Rule Set Maintenance, Versioning, and Continuous Improvement

### 27.1 Updating Rules for New AI Capabilities

- Review and update rules.md, `RULES-QUICKREF.md`, and `.github/copilot-instructions.md` when new AI models, tools, or workflows are adopted.
- Document rationale for changes in a CHANGELOG (rules-changelog.md) and ADRs.
- Announce major changes in README and reference version history.

### 27.2 Changelog and Versioning System

- Maintain a rules-changelog.md file with semantic versioning (vMajor.Minor.Patch), dates, and summary of changes.
- Tag major rule updates in the repository for traceability.

### 27.3 Cross-File References and Long-Term Maintainability

- Ensure all major rule sections are referenced in quickref, copilot-instructions.md, and config files.
- Use named references as the primary form, with the section number as a secondary navigation aid. Preferred format: `Task Start Protocol (§0.5)` rather than `§0.5` by itself.
- Treat section numbers as helpful pointers, not stable identifiers. The stable identifier is the section title.
- When renumbering sections, update `rules.md`, `RULES-QUICKREF.md`, `.github/copilot-instructions.md`, README summaries, config/schema descriptions, and changelog entries in the same change set.
- Prefer file-and-title references in derivative docs when the exact section number does not add value.
- Periodically audit for drift and redundancy.

### 27.5 Preferred Terminology

- **Non-breaking changes**: Preferred prose term for changes that preserve existing behavior for callers and users.
- **Backward compatibility (BWC)**: The compatibility property preserved by non-breaking changes. The config schema retains the key `backward_compatibility` for stability.
- **Change Safety Protocol**: The named rule section (§5) that operationalizes the non-breaking/BWC policy.
- **Observability**: The combined use of logs, metrics, traces, and alerts to understand system behavior in production.

See `GLOSSARY.md` for the canonical terminology list and preferred wording.

### 27.4 Periodic Review and Feedback Loop

- Schedule quarterly or milestone-based reviews of the rule set.
- Solicit feedback from users and contributors; document learnings in rules-changelog.md.
- Update token optimization strategies as new research emerges.

---

## 0.5) ⚡ TASK START PROTOCOL (MANDATORY - Execute Before Any Work)

**Before implementing ANY task, the AI MUST complete this checklist:**

### Pre-Task Checklist

- [ ] **Read Rules**: Confirm familiarity with `rules.md` (full read if first time or uncertain about any requirement)
- [ ] **Identify Task Type**: Determine if this is a multi-step task requiring a TODO Ledger (§4)
- [ ] **Understand Scope**: Clarify ambiguous requirements upfront with focused questions (ask once, not repeatedly)
- [ ] **Confirm Safety**: Acknowledge the Change Safety Protocol (§5) unless explicitly instructed otherwise
- [ ] **Identify Applicable Sections**: State which rule sections apply to this specific task
- [ ] **Debugging Strategy**: If task involves fixing bugs, acknowledge the Systematic Debugging Protocol (§6.5)
- [ ] **Token Efficiency**: Plan context gathering strategy to minimize redundant reads and maximize parallelization under Token Optimization and Efficiency (§26)

### Task Start Declaration Template

When starting a task, the AI should provide:

```text

### Task Start Declaration
- **Task**: [Brief description]
- **Type**: [Single-step / Multi-step with TODO Ledger]
- **Applicable Rules**: [e.g., Function Notes & Documentation Requirements (§3), Change Safety Protocol (§5), Testing Requirements (§6), Token Optimization and Efficiency (§26)]
- **Breaking Changes**: [None / Explicitly approved with migration plan]
- **Clarifications Needed**: [None / List specific questions]
- **Context Strategy**: [e.g., Parallel reads of 3 files, grep overview before detailed read, targeted search with regex alternation]

```

### Enforcement

**Failure to complete this protocol invalidates the work.** If you notice the AI has not completed this checklist at task start, immediately request it before proceeding.

### Quick Reference

For a condensed checklist, see `RULES-QUICKREF.md` in this directory.

---

## 1) Scope & Intent

These rules apply to all AI-assisted coding tasks: planning, implementation, refactors, tests, documentation, reviews, and releases. They standardize how the AI reasons, documents, and delivers work—prioritizing correctness, maintainability, and safety.

---

## 2) Workflow the AI Must Follow

### 2.1 Plan → Build → Verify → Document → Deliver

- **Plan**
  - Identify goals, constraints, risks, and assumptions.
  - Produce a short **Implementation Plan** and a **TODO Ledger** (see §4) when multiple steps are needed.
- **Build**
  - Implement incrementally with small, cohesive changes.
  - For refactors or structural cleanups, apply the Modularize Code flow in §13.4: analyze responsibilities, extract small functions/classes, reduce duplication, and create clear module boundaries without changing behavior.
  - Keep solutions minimal and dependency-light.
- **Verify**
  - Run or specify tests, static checks, and linters.
  - Validate that **existing behavior remains intact**.
- **Document**
  - Update function-level notes, README/API docs, and CHANGELOG (as needed).
  - Add an ADR/design note for noteworthy decisions.
- **Deliver**
  - Provide a concise **Delivery Summary**: what changed, why, how tested, and TODO status with checkboxes.

> **Clarifications**: If requirements are ambiguous, the AI may ask focused questions **once upfront**; do not repeatedly seek confirmation at every micro-step.

---

## 3) Function Notes & Documentation Requirements

For **every function/method**, the AI must include (adapt per language):

- **Purpose**: What this does and why it exists.
- **Inputs**: Parameters, types, units, constraints, default behaviors.
- **Outputs**: Return type/shape, units, invariants.
- **Side Effects**: I/O, network, DB, global state, logging.
- **Errors**: Exceptions/return codes, when/how they occur.
- **Performance**: Complexity notes if relevant (time/space, hot path?).
- **Security/Privacy**: Sensitive data, authZ/authN considerations.
- **AI/Ethics/Fairness**: Required for AI-facing logic that can affect people or user-visible content; document bias controls, moderation policy, review thresholds, and fallback behavior when applicable.
- **Concurrency**: Thread/process/async safety and locking assumptions.
- **Rationale/Trade-offs**: Why this approach; alternatives rejected.

> **Note on Scope (Token Optimization)**: The level of detail should be proportionate to the function's complexity, visibility, and criticality. Documentation is not a checkbox exercise—it exists to provide value to future maintainers.
>
> **Scale appropriately:**
>
> - **Critical public APIs**: Require the full template above; these are contracts that others depend on.
> - **Internal utilities**: Focus on purpose, inputs, outputs, and non-obvious logic or assumptions.
> - **Simple helpers**: A clear purpose line and notes on edge cases are often sufficient.
>
> **Avoid boilerplate**: If a section (e.g., "Concurrency") doesn't apply or adds no meaningful information, omit it. The goal is clarity and maintainability, not word count.
>
> See §26.5 for detailed examples of proportional documentation across complexity levels.

### 3.1 Docstring / Comment Templates

**Python (Google style):**

```python

def foo(bar: int, *, strict: bool = False) -> str:
    """Short purpose line.

    Longer context explaining *why* the function exists, key assumptions,
    and how it is intended to be used.

    Args:
        bar (int): Meaning and constraints.
        strict (bool, optional): Behavior toggle. Defaults to False.

    Returns:
        str: What is returned and any invariants.

    Raises:
        ValueError: When input is invalid.
        RuntimeError: On external system failure.

    Side Effects:
        - Writes to log.
        - Reads environment variable FOO_MODE.

    Performance:
        O(n) in size of bar; not on a hot path.

    Security/Privacy:
        No PII; uses least privilege; validate user input.

    AI/Ethics/Fairness:
      Not an AI-facing path; no model outputs or automated decisions.

    Concurrency:
        Not thread-safe. Caller must serialize access.

    Rationale:
        Kept simple; avoids extra deps; favors stdlib.
    """
    ...

```

**TypeScript (JSDoc):**

```ts

/**
 * Short purpose line.
 *
 * Longer context explaining why, assumptions, and usage.
 *
 * @param bar - Meaning and constraints.
 * @param strict - Behavior toggle (default: false).
 * @returns Description and invariants.
 * @throws RangeError When input invalid.
 * @throws Error On network/IO failures.
 * @sideEffects Logs, reads config.
 * @performance O(n) w.r.t. bar.
 * @security No PII; validate inputs.
 * @concurrency Not thread-safe.
 * @rationale Prefer stdlib, avoid over-engineering.
 */
export function foo(bar: number, strict = false): string {
  // ...
}

```

---

## 4) TODO Management (Create, Track, Complete)

When a task spans multiple steps, the AI **must** create and maintain a **TODO Ledger**.

### 4.1 TODO Ledger Format (in conversation & repo)

Add this to the top of the working note or PR description, and optionally keep a `/docs/todo-ledger.md` in the repo.

```md

### TODO Ledger
- [ ] AI-001: Define API shape and input validation rules
- [ ] AI-002: Implement core function and unit tests
- [ ] AI-003: Add integration test covering legacy path
- [ ] AI-004: Update README and inline docs
- [ ] AI-005: Add metrics + structured logs

```

**Rules:**

- Each item gets a stable ID (`AI-###`).
- Reference IDs in code comments and commits (e.g., `Refs: AI-002`).
- The AI **must** mark items as `[x]` when complete and link the commit/PR.
- If scope changes, add/edit items and carry forward remaining TODOs.

> **Integration Note**: If the project uses an issue tracker (e.g., Jira, GitHub Issues), the `AI-###` IDs should correspond to the ticket numbers (e.g., `PROJ-123`). This connects the AI's work directly to the team's established workflow.

### 4.2 Code Comment TODO Tags

```ts

// TODO[AI-002]: Implement input validation per spec (no breaking changes)
// TODO[AI-003]: Back-compat shim for legacy callers

```

**Completion policy:** On completion, update the ledger, and either remove the code TODO or convert to a `DONE[AI-###]` note with the commit reference.

---

## 5) Change Safety Protocol (Non-Breaking by Default)

**Objective:** Preserve existing behavior unless an explicit instruction authorizes breakage.

1. **Backwards Compatibility (BWC)**
   - Functions must keep signatures and semantics stable.
   - Additive changes preferred (new optional params, feature flags, adapters).
2. **Regression Safety**
   - Add/extend tests before refactors.
   - Keep a change small; verify with unit and integration tests.
3. **Feature Flags / Adapters**
   - Guard new behavior behind flags or shims.
   - Provide fallback paths for legacy consumers.
4. **SemVer Discipline**
   - No breaking changes in `patch`/`minor` releases.
   - Use `BREAKING CHANGE:` commit footer **only when explicitly instructed**.
5. **Migration Plan (if breaking is approved)**
   - Call out impact, migration steps, timelines, and deprecation notes.
6. **Deprecation & Code Removal**
   - **Announce Deprecation**: Mark code with `@deprecated` annotations and log warnings when it is used.
   - **Provide Alternatives**: Documentation and warnings must point to the new, preferred alternative.
   - **Establish a Waiting Period**: Do not remove deprecated code immediately. Allow for a clear migration period (e.g., one major version cycle).
   - **Remove Safely**: After the waiting period, remove the deprecated code and its related tests.

**Deliverable:** A short **Change Risk Assessment** for non-trivial edits: affected modules, risks, mitigations, test coverage.

---

## 6) Testing Requirements

- **Unit tests** for all new functions and branches (happy + edge cases).
- **Integration tests** for changed interfaces or IO boundaries.
- **Contracts**: Validate input/output contracts and error paths.
- **No flaky tests**: deterministic seeds, isolated resources.
- **Test Plan Summary** delivered with each change: what was tested and results.
- When the stack matches, start from the packaged enforcement templates for Jest, Pytest, `dotnet test`, or `go test` under `templates/` and adapt them intentionally rather than rebuilding strict test automation from scratch.

### 6.1) Browser & UI Testing

For **any browser-based testing, UI validation, or web application testing**, the AI should prefer the **Chrome DevTools MCP** toolset where available and suitable.

- **Activation**: Call `activate_chrome_devtools_*` tools as needed for the task.
- **Interaction**: Use DevTools interaction tools (click, fill, etc.).
- **Validation**: Capture screenshots, snapshots, and console messages.

If the project has an established framework like **Selenium** or **Playwright**, conform to the existing standard. The goal is to use integrated, reliable, and consistent browser automation. Avoid manual browser commands (e.g., `start chrome`) unless no other option exists.

**Rationale**: Using a consistent and automated toolset reduces dependencies and improves reproducibility. Prefer integrated tools like DevTools MCP first, but always adapt to the project's established conventions.

**Example Use Cases**:

- Testing responsive designs (resize, screenshot)
- Validating form submissions (fill, click, verify network requests)
- Performance analysis (trace recording, insights)
- Debugging JavaScript errors (console messages)
- Visual regression testing (snapshots, screenshots)

### 6.5) Systematic Debugging Protocol (MANDATORY)

### Iron Law: No Fixes Without Root Cause Investigation First

When encountering ANY bug, test failure, or unexpected behavior, the AI MUST complete these phases sequentially:

#### Phase 1: Root Cause Investigation (REQUIRED BEFORE ANY FIX)

- **Read error messages completely**: Stack traces, line numbers, error codes—they often contain the exact solution
- **Reproduce consistently**: Exact steps, reliable trigger; if not reproducible, gather more data first
- **Check recent changes**: Git diff, commits, config changes, environmental differences
- **Gather diagnostic evidence in multi-component systems**: Add instrumentation at each component boundary to identify where the failure occurs
- **Trace data flow backward**: Follow the bad value up the call stack to find its original source

#### Phase 2: Pattern Analysis

- **Find working examples**: Locate similar working code in the same codebase
- **Compare against references**: Read reference implementations COMPLETELY, understand the pattern fully
- **Identify all differences**: List every difference between working and broken, however small
- **Understand dependencies**: What other components, settings, config, environment does this need?

#### Phase 3: Hypothesis and Testing

- **Form single, specific hypothesis**: "I think X is the root cause because Y"—write it down
- **Test minimally**: Make the SMALLEST possible change to test hypothesis, one variable at a time
- **Verify before continuing**: If it worked → Phase 4; if not → form NEW hypothesis
- **When 3+ fixes fail**: STOP and question the architecture (see Phase 4 below)

#### Phase 4: Implementation

- **Create failing test case first**: Simplest possible reproduction (see §6 for TDD practices)
- **Implement single fix**: Address root cause only, ONE change at a time
- **Verify fix**: Test passes, no other tests broken, issue actually resolved
- **If 3+ fixes have failed**: STOP—this indicates an architectural problem, not a failed hypothesis. Discuss with user before attempting more fixes.

**Red Flags** (return to Phase 1 immediately):

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Each fix reveals new problem in different place

**Related References**:

- Full protocol with examples: `debugging.md`
- Backward tracing technique: `root-cause-tracing.md` (if available)
- Multi-layer validation: `defense-in-depth.md` (if available)

**Integration with Other Rules**:

- §3: Document root cause findings in function notes
- §4: Track debugging work in TODO Ledger for complex issues
- §6: Create failing test before implementing fix
- §8: Document debugging insights in CHANGELOG/ADR

---

## 7) Clean & Simple by Default

- **Principles**: KISS, YAGNI, minimize dependencies, prefer composition over inheritance, avoid over-generalization.
- **Patterns**: Small pure functions, early returns, clear names, explicit errors.
- **Avoid**: Premature optimization, deep abstraction layers, magic metaprogramming, hidden globals.
- **Performance**: Measure before optimizing; document trade-offs in function notes.

---

## 8) Documentation Deliverables

- **Inline**: Function docstrings/notes per §3.
- **README/API**: Update examples, usage, and configuration.
- **CHANGELOG**: Conventional commit summaries and notable changes.
- **Design Note (ADR)**: When choices affect architecture or constraints.

---

## 9) Commits & PRs

- **Conventional Commits**
  - `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` …
  - Footer `Refs: AI-###` to link TODOs.
  - Use `BREAKING CHANGE:` footer **only with explicit approval/instruction**.
- **PR Description Template**
  - **What**: Summary of changes.
  - **Why**: Problem/goal and rationale.
  - **How**: Approach taken; trade-offs.
  - **Safety**: BWC strategy, tests, flags.
  - **Docs**: What was updated.
  - **TODO Ledger**: Include and update checkboxes.

---

## 10) PR Checklist (copy into PRs)

- [ ] Function notes/docstrings added or updated for all changes
- [ ] README/API/CHANGELOG updated as needed
- [ ] Tests added/updated (unit + integration) and pass locally/CI
- [ ] Existing functionality verified intact (no regressions)
- [ ] TODO Ledger updated; completed items checked with commit/PR refs
- [ ] No new unnecessary dependencies introduced
- [ ] Security/privacy considerations evaluated and documented
- [ ] Ethical implications, bias controls, and moderation behavior reviewed when AI-generated content or automated decisions are involved
- [ ] Token efficiency maintained (minimal re-reads, batched operations, concise responses per §26)
- [ ] **If bug fix**: Root cause investigation documented with evidence (§6.5)
- [ ] **If bug fix**: Failing test case created before fix (§6.5)
- [ ] **If bug fix**: Verified no other tests broken by fix (§6.5)

---

## 11) Session Conduct for the AI

- **At start**: Summarize assumptions (if any) and create/update the **TODO Ledger**.
- **During**: Keep short **Working Notes** explaining decisions that affect design, performance, or safety.
- **At end**: Provide a **Delivery Summary** with:
  - What changed and why
  - How it was tested and results
  - Confirmed non-breaking status (or explicit approval for breaking)
  - Updated TODO Ledger with `[x]` marks and links

---

## 12) Examples

### 12.1 Minimal Python Example

```python

# --- TODO Ledger ---
# - [x] AI-001: Define sanitize_input and tests (commit abc1234)
# - [ ] AI-002: Add integration test for legacy callers

import re

def sanitize_input(text: str) -> str:
    """Normalize and validate user-provided text.

    Strips leading/trailing whitespace, collapses internal spaces, and
    rejects control characters. Intended for non-PII free-text fields.

    Args:
        text (str): Raw user input; may be empty.

    Returns:
        str: Cleaned text with single spaces and no control chars.

    Raises:
        ValueError: If control characters are detected.

    Side Effects:
        None.

    Performance:
        O(n) by input length; not a hot path.

    Security/Privacy:
        No PII stored; validation prevents control-char abuse.

    Concurrency:
        Pure and thread-safe.

    Rationale:
        Uses stdlib regex; avoids external deps.
    """
    if any(ord(ch) < 32 and ch not in ('\n', '\t') for ch in text):
        raise ValueError("Control characters not allowed")
    text = re.sub(r"\s+", " ", text.strip())
    return text

```

### 12.2 Minimal TypeScript Example

```ts

// --- TODO Ledger ---
// - [ ] AI-010: Implement retry with jitter behind a feature flag

/**
 * Normalize and validate user-provided text.
 *
 * @param text Raw user input; may be empty.
 * @returns Cleaned text with single spaces and no control chars.
 * @throws Error If control characters are detected.
 * @sideEffects None.
 * @rationale Stdlib only; simple and clear.
 */
export function sanitizeInput(text: string): string {
  for (const ch of text) {
    if (ch < " " && ch !== "\n" && ch !== "\t") throw new Error("Control chars not allowed");
  }
  return text.trim().replace(/\s+/g, " ");
}

```

---

## 13) Refactoring & Code Quality Standards

### 13.1 Core Philosophy

Refactoring is not an afterthought. Aim to produce clean, professional, and future‑proof code during initial creation. Assume your code will be read, maintained, and extended by senior engineers.

### 13.2 Guiding Principles

- DRY (Don't Repeat Yourself): eliminate duplication; extract shared logic into functions/modules.
- YAGNI (You Ain't Gonna Need It): avoid speculative features; implement only what is needed.
- SRP (Single Responsibility Principle): each function/class/module has one clear purpose.
- Legibility first: descriptive names; comment the why (context, rationale) not the obvious what.
- Consistent formatting: follow language idioms (e.g., PEP 8, Prettier). Keep indentation/whitespace consistent.
- Modularity: loose coupling via stable interfaces; high cohesion within modules.
- Parameterize, don't hardcode: extract magic numbers/strings to constants/config.
- Return early: prefer guard clauses to reduce nesting and improve clarity.

### 13.3 Safety Requirements

- Maintain backward compatibility (§5) unless an approved breaking change and migration plan exist.
- Expand or add tests first (or alongside) to lock current behavior before refactoring.
- Apply small, incremental steps; commit atomically; run full tests and static analysis.

### 13.4 Process

1. Create a TODO Ledger item (AI-###) with scope, risks, and success criteria.
2. Add/verify tests to pin current behavior (happy path + edge cases).
3. Before moving code, analyze responsibilities, map which functions use which variables, and identify coupling points.
4. Perform small, verifiable refactors using the Modularize Code flow:

    - Extract functions so each one does one thing well.
    - Extract cohesive classes/modules around shared state and responsibilities.
    - Rename functions, classes, and variables to be intention-revealing.
    - Remove textual and structural duplication.
    - Create clear boundaries and adapters around external systems or unstable dependencies.
    - Stop if the code is already well-structured; do not refactor for its own sake.

5. Run tests/linters; verify non-regression and performance/security neutrality.
6. Document rationale and outcomes (update function notes per §3, ADR if architectural).

### 13.5 Acceptance Checklist

- Tests green; no regressions detected.
- Public APIs unchanged (unless approved with migration plan).
- Complexity reduced; names clarified; duplication reduced.
- Security/privacy unaffected or improved.

### 13.6 Reference

See `refactoring.md` for techniques, examples, and detailed checklists to guide day‑to‑day refactoring decisions.

See `ModularizeCode.md` for the standard modularization execution flow to use during refactors that restructure responsibilities across functions, classes, or modules.

---

## 14) UI/UX Documentation Standards

### 14.1 Module Versioning Requirements

For user-facing modules/features, implement version tracking and release notes using the **Module Versioning Badge System**:

**Purpose**: Provide transparency to users about what's new, what's fixed, and what's coming. Builds trust and reduces support burden.

**Requirements**:

- [ ] **Every module must have version information** with semantic versioning (vMajor.Minor.Patch)
- [ ] **Maintain a complete release history** with dates, changes, and contributors
- [ ] **Categorize changes** as features, improvements, or fixes
- [ ] **Document known issues** and coming features to set expectations
- [ ] **Use timezone-aware timestamps** (ISO 8601 format with timezone offset)

### 14.2 Version Data Structure

All module versions must be tracked in a centralized data file:

```typescript

// Example: apps/prototype/data/modules/moduleVersions.ts
export const MODULE_VERSION_MAP: Record<string, ModuleVersionRecord> = {
  yourModule: {
    moduleKey: 'yourModule',
    displayName: 'Module Display Name',
    currentVersion: 'v1.00',
    releases: [
      {
        version: 'v1.00',
        releasedAt: '2025-11-07T15:00:00-05:00', // ISO 8601 with timezone
        summary: 'Brief one-line summary of this release.',
        highlights: [
          {
            type: 'feature', // or 'improvement' or 'fix'
            title: 'Feature Name',
            description: 'Clear description of what this does and why.',
            impactedAreas: ['Forms', 'API', 'Database'], // affected components
          },
        ],
        knownIssues: ['Issue 1', 'Issue 2'], // be honest about limitations
        comingSoon: ['Feature X', 'Feature Y'], // roadmap visibility
        contributors: ['Team Name', 'Developer Name'],
      },
    ],
  },
};

```

### 14.3 Version Numbering Standard

Follow semantic versioning:

- **Major (v2.0)**: Breaking changes, major rewrites, architecture changes
- **Minor (v1.1)**: New features, backwards compatible additions
- **Patch (v1.0.1)**: Bug fixes only, no new features

### 14.4 Release Notes Writing Standards

**DO:**

- ✅ Write clear, user-focused descriptions (not technical jargon)
- ✅ Explain the *why* and *benefit*, not just the *what*
- ✅ Include known issues and workarounds
- ✅ List what's coming next to set expectations
- ✅ Credit contributors and teams

**DON'T:**

- ❌ Use vague language ("improved stuff", "fixed things")
- ❌ Hide known issues or limitations
- ❌ Delete old release history
- ❌ Skip documentation for "minor" releases

**Example of good release note:**

```typescript

{
  type: 'feature',
  title: 'Budget Export to PDF',
  description: 'Export your budget calculations to a professional PDF document with company branding. Supports all line items, tax calculations, and project metadata.',
  impactedAreas: ['Export', 'PDF Generation', 'Branding'],
}

```

**Example of bad release note:**

```typescript

{
  type: 'feature',
  title: 'PDF',
  description: 'Added PDF thing.',
  impactedAreas: ['Stuff'],
}

```

### 14.5 Implementation Checklist

When adding version tracking to a module:

- [ ] Copy the Module Versioning Badge component files to your project
- [ ] Create version data entry in centralized data file
- [ ] Add version badge to module's page header
- [ ] Write complete release notes for current version
- [ ] Document known issues honestly
- [ ] List coming features to set expectations
- [ ] Test that badge displays and dialog opens correctly
- [ ] Verify timestamps show in correct timezone

### 14.6 Updating Versions

When releasing a new version:

1. **Add new release to the beginning of the releases array** (newest first)
2. **Update the `currentVersion` field** to match
3. **Use ISO 8601 timestamp** with timezone: `2025-11-15T14:30:00-05:00`
4. **Write complete release notes** following the standards above
5. **Update known issues** and coming features
6. **Keep all previous releases** in the array (never delete history)

### 14.7 Reference Implementation

See the attached guide `How_to_use_versioning_badge.md` for:

- Complete implementation steps
- File locations and structure
- Code examples
- Troubleshooting guide
- Best practices

**Files Required**:

- Component: `components/modules/ModuleVersionBadge.tsx`
- Data: `data/modules/moduleVersions.ts`
- Hook: `lib/modules/useModuleVersion.ts`

**Enforcement**: All user-facing modules must implement version tracking before going to production. This is non-negotiable for customer-facing features.

---

## 15) Azure/Docker Friendly Defaults (optional)

### 15.1 Platform Defaults

- Ship **Dockerfiles** that build deterministically; pin versions/lockfiles.
- Provide **environment variable** configuration with safe defaults.
- For cloud services, prefer **feature flags** and **arm's-length adapters** to avoid breaking callers.
- Expose **health/readiness** checks for deployed services when the platform supports them.

### 15.2 Logging and Observability Baseline

- Emit **structured logs** (JSON or consistent key-value format) with timestamp, severity, service/component name, and correlation/request ID.
- Use a **consistent level taxonomy**: `debug`, `info`, `warning`, `error`, `critical`.
- **Do not log secrets or raw sensitive data**. Redact or hash identifiers when operational visibility is needed.
- Track **core metrics** for latency, throughput, error rate, and resource saturation.
- Prefer **correlation IDs and trace IDs** across service boundaries so incidents can be followed end to end.
- Alerts should be **actionable**: tied to user impact, SLO drift, or repeated failures rather than noisy one-off events.

### 15.3 Runtime and Delivery Hygiene

- Keep runtime configuration **externalized** through environment variables or deployment config.
- Use **immutable build artifacts** where possible; avoid environment-specific rebuilds.
- Capture enough telemetry to debug failures without requiring ad hoc code changes during an incident.
- Document dashboards, log fields, and alert thresholds for operationally critical services.

### 15.4 Reference

See `LOGGING-OBSERVABILITY.md` for logging field conventions, alerting guidance, and template checklists.

---

## 16) Governance & Exceptions

- Exceptions to these rules require an explicit note: what rule is waived, why, and for how long.
- Breaking changes require explicit instruction and a migration plan (§5.5).
- The AI should default to **safety, clarity, and simplicity** when unsure.

---

## 17) (Section intentionally removed and merged with §0)

---

## 18) UI Development Guidelines

### 18.1 Baseline UI Framework

For all web UI development, use the **Assistant Coach UI Setup** as the starting point and baseline framework unless explicitly instructed otherwise. This ensures consistent, modern, and responsive design across projects.

**Key Features of the Baseline**:

- **Modern Design**: Dark theme, clean aesthetics, professional appearance.
- **Responsive Layout**: Mobile-first design with CSS Grid/Flexbox.
- **Shared Components**: Base template (`base.html`) for consistent navigation and footer.
- **Styling Standards**: CSS custom properties for colors, consistent button/form styling, surface cards with backdrop blur.
- **Interactive Elements**: Testimonial ticker animations, hover states, accessible icons (Remix Icon).
- **Project Structure**: Organized Flask app with `static/css/`, `templates/`, and modular routes.

### 18.2 Implementation Requirements

- **Start with the Guide**: Always begin UI tasks by referencing `UI-Setup-Instructions.md` for structure and patterns.
- **Customization Rules**: Modify colors, content, and features as needed, but maintain core design patterns (e.g., hero sections, plan cards, responsive grids).
- **Accessibility**: Ensure WCAG compliance (see §20 for details).
- **Testing**: Test on multiple screen sizes; verify animations and interactions.
- **Documentation**: Include UI component notes in code comments, explaining purpose and customization points.

### 18.3 When to Deviate

Only deviate from this baseline if:

- Explicitly instructed by the user for a different design direction.
- The project requires a different tech stack (e.g., not Flask/Python).
- Provide rationale and document the deviation in the TODO Ledger.

### 18.4 Reference

See `UI-Setup-Instructions.md` for complete setup guide, code examples, and customization tips.

---

## 19) Security Best Practices

### 19.1 Core Principles

- **Input Validation and Sanitization**: Always validate and sanitize user inputs to prevent injection attacks (SQL, XSS, CSRF, etc.). Use allowlists over blocklists; escape outputs appropriately.
- **Authentication and Authorization**: Implement secure auth patterns (e.g., OAuth, JWT with proper expiration). Avoid storing passwords in plain text; use strong hashing (e.g., bcrypt). Enforce least privilege and role-based access.
- **Data Protection**: Encrypt sensitive data at rest and in transit (TLS 1.3+). Follow privacy regulations (GDPR, CCPA). Avoid logging PII; use data minimization.
- **Common Vulnerabilities (OWASP Top 10)**: Mitigate SQL injection (parameterized queries), XSS (output encoding), CSRF (tokens), broken auth (secure sessions), insecure deserialization (validate inputs), etc.
- **Dependency Security**: Regularly scan dependencies for vulnerabilities (tools like OWASP Dependency-Check, Snyk). Update promptly; use lockfiles to pin versions. Avoid deprecated libraries.

### 19.2 Implementation Guidelines

- **Function-Level Security**: Include security considerations in every function note (§3), covering authZ, data handling, and potential vulnerabilities.
- **Testing for Security**: Add security-focused tests (§6), including penetration testing, fuzzing, and vulnerability scanning. Validate input boundaries and error paths.
- **Secure Coding Patterns**:
  - **Safe SQL Queries**: Use parameterized queries or ORMs to prevent injection.
  - **Secure API Design**: Implement rate limiting, input validation, and proper error messages (avoid leaking internals).
  - **Cryptography**: Use vetted libraries (e.g., cryptography in Python); avoid custom crypto.
- **Dependency Management**: Audit third-party code; prefer maintained, widely-used libraries. Document security assumptions.
- **Incident Response**: Plan for breaches; log security events; have a disclosure process.

### 19.3 Integration and Enforcement

- Reference security requirements in §3 (function notes), §6 (testing), and §10 (PR checklist).
- For user-facing features, conduct security reviews before release.
- Document security decisions in ADR/design notes (§8).

### 19.4 Examples

**Python (Secure Input Handling)**:

```python

import re
from werkzeug.security import check_password_hash, generate_password_hash

def authenticate_user(username: str, password: str) -> bool:
    """Authenticate user with secure password checking.

    Args:
        username (str): Username (alphanumeric only, max 50 chars).
        password (str): Raw password.

    Returns:
        bool: True if authenticated.

    Security:
        - Validates username format to prevent injection.
        - Uses secure hashing; no plain-text storage.
        - Rate limits attempts (not shown).
    """
    if not re.match(r'^[a-zA-Z0-9]{1,50}$', username):
        raise ValueError("Invalid username format")
    # Assume user_db.get_hashed_password(username) retrieves hashed password
    hashed = user_db.get_hashed_password(username)
    return check_password_hash(hashed, password)

```

**Secure API Endpoint**:

```python

from flask import request, jsonify
import jwt

@app.route('/api/user/<user_id>', methods=['GET'])
def get_user(user_id):
    # Validate user_id (integer, positive)
    try:
        user_id = int(user_id)
        if user_id <= 0:
            raise ValueError
    except ValueError:
        return jsonify({"error": "Invalid user ID"}), 400

    # Check authorization (JWT token)
    token = request.headers.get('Authorization')
    if not token or not validate_jwt(token):
        return jsonify({"error": "Unauthorized"}), 401

    # Fetch and return data (ensure no PII leakage)
    user = get_user_data(user_id)
    return jsonify({"username": user.username})  # Only non-sensitive fields

```

---

## 20) Accessibility Standards

### 20.1 WCAG Guidelines and Levels

- **WCAG 2.1 Overview**: Web Content Accessibility Guidelines ensure digital content is accessible to people with disabilities.
- **Conformance Levels**:
  - **A (Basic)**: Essential accessibility features; minimum legal requirement.
  - **AA (Acceptable)**: Most common standard; addresses major barriers.
  - **AAA (Enhanced)**: Highest level; optimal accessibility for specialized needs.
- **Principles**: POUR - Perceivable, Operable, Understandable, Robust.

### 20.2 Key Requirements for User-Facing Modules

- **Keyboard Navigation**: All interactive elements must be accessible via keyboard (Tab, Enter, Space, Arrow keys).
- **Screen Reader Support**: Use semantic HTML; provide alternative text for non-text content.
- **Color Contrast**: Minimum 4.5:1 ratio for normal text, 3:1 for large text (WCAG AA).
- **Focus Management**: Visible focus indicators; logical tab order; no keyboard traps.
- **Semantic HTML**: Use proper headings, lists, landmarks (`<main>`, `<nav>`, `<aside>`).
- **ARIA Attributes**: Use sparingly; prefer semantic HTML; include `role`, `aria-label`, `aria-describedby` when needed.

### 20.3 Testing Tools and Audits

- **Automated Tools**: WAVE, axe-core, Lighthouse Accessibility audit, pa11y.
- **Manual Testing**: Keyboard-only navigation, screen reader testing (NVDA, JAWS, VoiceOver).
- **User Testing**: Include users with disabilities in testing phases.
- **Regular Audits**: Conduct accessibility audits before releases; integrate into CI/CD (§23).

### 20.4 Integration and Enforcement

- Expand §14 (UI/UX) with accessibility requirements for user-facing modules.
- Add accessibility checks to delivery checklist (§10).
- Document accessibility decisions in ADR/design notes (§8).
- Test accessibility regressions in §6 (browser testing with Chrome DevTools MCP).

### 20.5 Examples

**Accessible Form with Labels and Validation**:

```html

<form action="/submit" method="post">
  <fieldset>
    <legend>Contact Information</legend>

    <div>
      <label for="name">Full Name:</label>
      <input type="text" id="name" name="name" required
             aria-describedby="name-help">
      <span id="name-help">Enter your first and last name</span>
    </div>

    <div>
      <label for="email">Email Address:</label>
      <input type="email" id="email" name="email" required
             aria-describedby="email-error">
      <span id="email-error" class="error" role="alert" style="display:none;">
        Please enter a valid email address
      </span>
    </div>

    <button type="submit">Submit</button>
  </fieldset>
</form>

```

**Accessible Images and Media**:

```html

<!-- Decorative image: hidden from screen readers -->
<img src="decorative-border.png" alt="" role="presentation">

<!-- Informative image: descriptive alt text -->
<img src="chart-sales-q4.png" alt="Bar chart showing 25% sales increase in Q4 2024 compared to Q3">

<!-- Complex image: detailed description -->
<img src="process-flow.png" alt="Process flow: Start → Validate Input → Process Data → Generate Report → End"
     longdesc="process-description.html">

<!-- Video with captions -->
<video controls>
  <source src="tutorial.mp4" type="video/mp4">
  <track kind="captions" src="tutorial-captions.vtt" srclang="en" label="English">
  Your browser does not support the video tag.
</video>

```

**Keyboard Navigation and Focus Management**:

```javascript

// Ensure custom components are keyboard accessible
class CustomDropdown extends HTMLElement {
  connectedCallback() {
    this.setAttribute('tabindex', '0');
    this.addEventListener('keydown', this.handleKeydown.bind(this));
  }

  handleKeydown(event) {
    switch(event.key) {
      case 'Enter':
      case ' ':
        this.toggle();
        event.preventDefault();
        break;
      case 'Escape':
        this.close();
        event.preventDefault();
        break;
      case 'ArrowDown':
        this.focusNextOption();
        event.preventDefault();
        break;
    }
  }
}

// CSS for visible focus indicators
.custom-button:focus {
  outline: 2px solid #007acc;
  outline-offset: 2px;
}

```

**Color Contrast and Visual Design**:

```css

/* Ensure sufficient contrast ratios */
.high-contrast-text {
  color: #000000; /* Black text on white background: 21:1 ratio */
  background-color: #ffffff;
}

.warning-text {
  color: #d32f2f; /* Dark red on white: 4.6:1 ratio (WCAG AA compliant) */
  background-color: #ffffff;
}

/* Don't rely on color alone for conveying information */
.status-indicator {
  /* Use both color and shape/pattern */
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #4caf50; /* Green for success */
}

.status-indicator.error {
  background-color: #f44336; /* Red for error */
  /* Also include text or icon for screen readers */
}

```

---

## 21) Performance Optimization Guidelines

### 21.1 Core Philosophy

- **Measure Before Optimizing**: Never optimize based on assumptions. Use profiling to identify actual bottlenecks (e.g., 80/20 rule: 80% of performance issues come from 20% of code).
- **Avoid Premature Optimization**: Focus on correctness and clarity first (§7). Optimize only when performance requirements aren't met, and document the trade-offs.
- **Holistic Approach**: Consider the full stack (CPU, memory, I/O, network). Performance issues often span multiple layers.

### 21.2 When to Optimize

- **Identify Requirements**: Define performance targets (response time, throughput, resource usage) upfront.
- **Profile First**: Use tools to measure current performance and pinpoint hotspots.
- **Optimize Iteratively**: Make small, measurable changes; re-profile after each.
- **Stop When Sufficient**: Meet requirements without over-engineering.

### 21.3 Profiling Tools and Techniques

- **Language-Specific Profilers**:
  - Python: `cProfile`, `line_profiler`, `memory_profiler`
  - JavaScript: Chrome DevTools Performance tab, Node.js `--prof`
  - General: System monitors (top, htop), APM tools (New Relic, Datadog)
- **Techniques**:
  - CPU profiling: Identify slow functions
  - Memory profiling: Detect leaks and excessive usage
  - I/O profiling: Check disk/network bottlenecks
  - Load testing: Simulate real-world usage

### 21.4 Common Optimization Patterns

- **Caching**: Store expensive computations (in-memory, Redis, CDNs). Use LRU or TTL strategies.
- **Lazy Loading**: Defer initialization until needed (e.g., images, modules).
- **Efficient Algorithms**: Choose O(n log n) over O(n²); use data structures wisely (hash maps vs. arrays).
- **Batching**: Group operations to reduce overhead (e.g., bulk DB inserts).
- **Async/Concurrency**: Use non-blocking I/O, threads/pools for CPU-bound tasks.
- **Database Optimizations**: Indexes, query optimization, connection pooling.

### 21.5 Trade-offs and Considerations

- **Memory vs. Speed**: Caching improves speed but increases memory usage.
- **Readability vs. Performance**: Optimized code may be harder to maintain; document trade-offs.
- **Scalability**: Optimize for growth (horizontal scaling, stateless design).
- **Resource Constraints**: Consider cloud costs, mobile battery life.

### 21.6 Monitoring and Alerting

- **Metrics**: Track response times, error rates, resource usage.
- **Alerts**: Set thresholds for performance degradation.
- **Logging**: Structured logs for performance debugging.
- **Continuous Monitoring**: Integrate into CI/CD (§23) for regression detection.

### 21.7 Integration and Documentation

- Expand performance notes in §3 (function notes) with complexity analysis.
- Reference in §7 (clean & simple) and §13 (refactoring).
- Document optimizations in ADR/design notes (§8).
- Test performance regressions in §6.

### 21.8 Examples

**Python (Optimizing a Loop with Profiling)**:

```python

import cProfile
import time

def slow_sum(numbers):
    """Sum numbers with inefficient nested loops.

    Performance:
        O(n²) - quadratic time; not suitable for large lists.
        Memory: O(1) extra space.
    """
    total = 0
    for i in range(len(numbers)):
        for j in range(i + 1):  # Redundant inner loop
            total += numbers[j]
    return total

def fast_sum(numbers):
    """Optimized sum using built-in functions.

    Performance:
        O(n) - linear time; efficient for large lists.
        Memory: O(1) extra space.
        Trade-off: Less readable than manual loop, but faster.
    """
    return sum(numbers)

# Profiling
numbers = list(range(1000))
cProfile.run('slow_sum(numbers)')  # Identify bottleneck
cProfile.run('fast_sum(numbers)')  # Verify optimization

```

**Database Query Optimization**:

```sql

-- Inefficient: Full table scan
SELECT * FROM users WHERE last_login < '2023-01-01';

-- Optimized: Use index on last_login
CREATE INDEX idx_users_last_login ON users(last_login);
SELECT * FROM users WHERE last_login < '2023-01-01';

-- Further optimization: Pagination for large results
SELECT * FROM users
WHERE last_login < '2023-01-01'
ORDER BY last_login DESC
LIMIT 100 OFFSET 0;

```

**JavaScript (Lazy Loading Images)**:

```javascript

// Before: Load all images immediately
const images = document.querySelectorAll('img[data-src]');
images.forEach(img => {
  img.src = img.dataset.src;  // Immediate load
});

// After: Lazy load on scroll
const lazyLoad = (entries, observer) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      observer.unobserve(img);
    }
  });
};

const observer = new IntersectionObserver(lazyLoad);
images.forEach(img => observer.observe(img));

```

---

## 22) Error Handling and Resilience Patterns

### 22.1 Exception Hierarchies and Error Codes

- **Consistent Error Types**: Define custom exception classes with clear inheritance hierarchies.
- **Standardized Error Codes**: Use HTTP status codes or custom codes for API responses.
- **Error Messages**: Provide user-friendly messages without exposing internal details.
- **Categorization**: Distinguish between recoverable (transient) and non-recoverable errors.

### 22.2 Retry Logic and Backoff Strategies

- **Exponential Backoff**: Increase delay between retries (e.g., 1s, 2s, 4s, 8s).
- **Jitter**: Add randomness to prevent thundering herd problems.
- **Max Retries**: Set reasonable limits to avoid infinite loops.
- **Circuit Breaker Pattern**: Temporarily stop calling failing services to allow recovery.

### 22.3 Graceful Degradation and Fallbacks

- **Degradation Strategies**: Reduce functionality when dependencies fail (e.g., cached data, simplified UI).
- **Fallback Values**: Provide sensible defaults when operations fail.
- **Partial Success**: Allow operations to succeed partially rather than failing completely.

### 22.4 Logging and Monitoring

- **Structured Logging**: Log errors with context, but avoid sensitive data.
- **Error Metrics**: Track error rates, types, and frequencies.
- **Alerting**: Set up alerts for critical errors or high error rates.

### 22.5 Integration and Testing

- Expand error handling in §3 (function notes) and §6 (testing edge cases).
- Test error scenarios, recovery mechanisms, and degradation modes.
- Document error handling strategies in ADR/design notes (§8).

### 22.6 Examples

**Python Retry with Exponential Backoff**:

```python

import time
import random
import requests
from requests.exceptions import RequestException

class RetryError(Exception):
    pass

def retry_with_backoff(func, max_retries=3, base_delay=1, max_delay=60):
    """Decorator for retrying functions with exponential backoff and jitter."""
    def wrapper(*args, **kwargs):
        last_exception = None
        for attempt in range(max_retries + 1):
            try:
                return func(*args, **kwargs)
            except (RequestException, TimeoutError) as e:
                last_exception = e
                if attempt == max_retries:
                    raise RetryError(f"Failed after {max_retries} retries") from e

                # Exponential backoff with jitter
                delay = min(base_delay * (2 ** attempt), max_delay)
                jitter = random.uniform(0, delay * 0.1)  # 10% jitter
                time.sleep(delay + jitter)
        raise last_exception
    return wrapper

@retry_with_backoff
def fetch_user_data(user_id):
    """Fetch user data from external API with retry logic."""
    response = requests.get(f"https://api.example.com/users/{user_id}", timeout=5)
    response.raise_for_status()
    return response.json()

# Usage
try:
    user = fetch_user_data(123)
    print(f"User: {user}")
except RetryError as e:
    print(f"Failed to fetch user after retries: {e}")
    # Graceful degradation: use cached data or show error message

```

**Circuit Breaker Pattern in JavaScript**:

```javascript

class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000, monitoringPeriod = 10000) {
    this.threshold = threshold;          // Failures before opening
    this.timeout = timeout;              // Time before attempting reset
    this.monitoringPeriod = monitoringPeriod; // Period to check for reset

    this.state = 'CLOSED';               // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}

// Usage
const breaker = new CircuitBreaker();

async function unreliableApiCall() {
  // Simulate API call that might fail
  if (Math.random() < 0.7) { // 70% failure rate
    throw new Error('API temporarily unavailable');
  }
  return { data: 'Success' };
}

async function safeApiCall() {
  try {
    return await breaker.execute(unreliableApiCall);
  } catch (error) {
    console.log('Circuit breaker prevented call or call failed:', error.message);
    // Graceful degradation: return cached data
    return { data: 'Cached result', fromCache: true };
  }
}

```

**Error Hierarchy in Python**:

```python

class ApplicationError(Exception):
    """Base exception for application-specific errors."""
    def __init__(self, message, error_code=None, status_code=500):
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code

class ValidationError(ApplicationError):
    """Raised when input validation fails."""
    def __init__(self, message, field=None):
        super().__init__(message, error_code='VALIDATION_ERROR', status_code=400)
        self.field = field

class NotFoundError(ApplicationError):
    """Raised when a resource is not found."""
    def __init__(self, resource_type, resource_id):
        message = f"{resource_type} with id {resource_id} not found"
        super().__init__(message, error_code='NOT_FOUND', status_code=404)
        self.resource_type = resource_type
        self.resource_id = resource_id

class ExternalServiceError(ApplicationError):
    """Raised when external service calls fail."""
    def __init__(self, service_name, original_error=None):
        message = f"External service '{service_name}' is unavailable"
        super().__init__(message, error_code='EXTERNAL_SERVICE_ERROR', status_code=502)
        self.service_name = service_name
        self.original_error = original_error

# Usage in Flask route
@app.route('/api/users/<int:user_id>')
def get_user(user_id):
    try:
        user = get_user_from_db(user_id)
        if not user:
            raise NotFoundError('User', user_id)
        return jsonify(user.to_dict())
    except ValidationError as e:
        app.logger.warning(f"Validation error: {e}, field: {e.field}")
        return jsonify({'error': str(e), 'code': e.error_code}), e.status_code
    except NotFoundError as e:
        app.logger.info(f"Resource not found: {e.resource_type} {e.resource_id}")
        return jsonify({'error': str(e), 'code': e.error_code}), e.status_code
    except ExternalServiceError as e:
        app.logger.error(f"External service error: {e.service_name}", exc_info=e.original_error)
        return jsonify({'error': str(e), 'code': e.error_code}), e.status_code
    except Exception as e:
        app.logger.error(f"Unexpected error: {e}", exc_info=True)
        return jsonify({'error': 'Internal server error', 'code': 'INTERNAL_ERROR'}), 500

```

**Graceful Degradation in React**:

```javascript

import { useState, useEffect } from 'react';

function UserDashboard({ userId }) {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/users/${userId}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setUserData(data);
      setDegraded(false);
    } catch (error) {
      console.error('Failed to fetch user data:', error);
      setError(error.message);

      // Graceful degradation: try to load cached data
      const cachedData = localStorage.getItem(`user_${userId}`);
      if (cachedData) {
        setUserData(JSON.parse(cachedData));
        setDegraded(true); // Indicate we're showing stale data
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error && !userData) return <div>Error: {error}</div>;

  return (
    <div>
      {degraded && <div className="warning">Showing cached data - please refresh</div>}
      <h1>Welcome, {userData.name}</h1>
      {/* Render dashboard with available data */}
    </div>
  );
}

```

---

## 23) Continuous Integration and Deployment (CI/CD) Best Practices

### 23.1 Pipeline Design Principles

- **Stages**: Build → Test → Deploy (with gates between stages).
- **Automation**: Eliminate manual steps; everything should be scripted and versioned.
- **Fast Feedback**: Fail fast; run quick checks first (linting, unit tests).
- **Parallelization**: Run independent jobs concurrently to reduce cycle time.
- **Immutable Artifacts**: Build once, deploy everywhere; avoid rebuilding.

### 23.2 Automated Checks and Quality Gates

- **Code Quality**: Linting, formatting, static analysis.
- **Security**: Vulnerability scanning, dependency checks, secret detection.
- **Testing**: Unit tests, integration tests, end-to-end tests.
- **Performance**: Load testing, performance regression checks.
- **Compliance**: License scanning, accessibility audits.

### 23.3 Environment Management

- **Staging Environments**: Mirror production for thorough testing.
- **Environment Parity**: Keep dev/staging/prod as similar as possible.
- **Configuration Management**: Use environment variables, config files; avoid hard-coded values.
- **Secrets Management**: Secure storage and rotation of credentials.

### 23.4 Deployment Strategies

- **Blue-Green**: Deploy to idle environment, switch traffic when ready.
- **Canary**: Roll out to subset of users, monitor, then full rollout.
- **Rolling**: Update instances gradually to minimize downtime.
- **Feature Flags**: Decouple deployment from feature release.

### 23.5 Rollback and Recovery

- **Automated Rollbacks**: Scripts to revert to previous version.
- **Health Checks**: Monitor application health post-deployment.
- **Backup Strategies**: Database backups, artifact versioning.
- **Incident Response**: Runbooks for deployment failures.

### 23.6 Monitoring and Observability

- **Metrics**: Deployment success rates, cycle time, failure rates.
- **Logging**: Centralized logs with correlation IDs.
- **Alerting**: Notifications for deployment failures or anomalies.

### 23.7 Reference Templates

- **GitHub Actions Template**: `templates/github-actions/ai-rules-checks.yml`
- **GitHub Actions Template (Jest)**: `templates/github-actions/jest-testing-enforcement.yml`
- **GitHub Actions Template (Pytest)**: `templates/github-actions/pytest-testing-enforcement.yml`
- **GitHub Actions Template (.NET)**: `templates/github-actions/dotnet-testing-enforcement.yml`
- **GitHub Actions Template (Go)**: `templates/github-actions/go-testing-enforcement.yml`
- **Pre-commit Hook Template**: `templates/pre-commit/pre-commit.sample`
- **Pre-commit Validator Script**: `templates/pre-commit/validate-ai-rules.ps1`
- **Pre-commit Validator Script (Jest)**: `templates/pre-commit/validate-jest-tests.ps1`
- **Pre-commit Validator Script (Pytest)**: `templates/pre-commit/validate-pytest-tests.ps1`
- **Pre-commit Validator Script (.NET)**: `templates/pre-commit/validate-dotnet-tests.ps1`
- **Pre-commit Validator Script (Go)**: `templates/pre-commit/validate-go-tests.ps1`
- Keep these as **starting points**. Adapt commands, runtimes, and project-specific checks before enabling them in production repositories.

### 23.8 Integration and Documentation

- Reference in §9 (commits) and §10 (PR checklist).
- Document pipeline configurations and deployment procedures.
- Include CI/CD considerations in ADR/design notes (§8).

### 23.9 Examples

**GitHub Actions Workflow**:

```yaml

name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [3.8, 3.9, "3.10"]

    steps:
    - uses: actions/checkout@v4

    - name: Set up Python ${{ matrix.python-version }}
      uses: actions/setup-python@v4
      with:
        python-version: ${{ matrix.python-version }}

    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -r requirements.txt
        pip install -r requirements-dev.txt

    - name: Lint with flake8
      run: flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics

    - name: Test with pytest
      run: pytest --cov=./ --cov-report=xml

    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage.xml

  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4

    - name: Run safety check
      run: safety check

    - name: Run bandit security linter
      run: bandit -r . -f json -o bandit-report.json

  deploy-staging:
    needs: [test, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'

    steps:
    - uses: actions/checkout@v4

    - name: Deploy to staging
      run: |
        echo "Deploying to staging environment"
        # Add deployment commands here

  deploy-production:
    needs: [test, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
    - uses: actions/checkout@v4

    - name: Deploy to production
      run: |
        echo "Deploying to production environment"
        # Add deployment commands here

```

**Jenkins Pipeline (Declarative)**:

```groovy

pipeline {
    agent any

    environment {
        DOCKER_IMAGE = 'myapp'
        DOCKER_TAG = "${env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build') {
            steps {
                script {
                    docker.build("${DOCKER_IMAGE}:${DOCKER_TAG}")
                }
            }
        }

        stage('Test') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        script {
                            docker.image("${DOCKER_IMAGE}:${DOCKER_TAG}").inside {
                                sh 'python -m pytest tests/unit/ -v'
                            }
                        }
                    }
                }

                stage('Integration Tests') {
                    steps {
                        script {
                            docker.image("${DOCKER_IMAGE}:${DOCKER_TAG}").inside {
                                sh 'python -m pytest tests/integration/ -v'
                            }
                        }
                    }
                }

                stage('Security Scan') {
                    steps {
                        script {
                            docker.image("${DOCKER_IMAGE}:${DOCKER_TAG}").inside {
                                sh 'safety check'
                            }
                        }
                    }
                }
            }
        }

        stage('Deploy to Staging') {
            when {
                branch 'develop'
            }
            steps {
                script {
                    // Blue-green deployment
                    sh """
                        docker tag ${DOCKER_IMAGE}:${DOCKER_TAG} ${DOCKER_IMAGE}:staging
                        docker-compose -f docker-compose.staging.yml up -d
                        # Health check
                        sleep 30
                        curl -f http://staging.example.com/health || exit 1
                    """
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                script {
                    // Canary deployment
                    sh """
                        # Deploy to 10% of traffic
                        kubectl set image deployment/myapp myapp=${DOCKER_IMAGE}:${DOCKER_TAG}
                        kubectl rollout status deployment/myapp

                        # Monitor for 5 minutes
                        sleep 300

                        # If successful, scale to 100%
                        kubectl scale deployment myapp --replicas=10
                    """
                }
            }
        }
    }

    post {
        always {
            // Cleanup
            sh 'docker rmi ${DOCKER_IMAGE}:${DOCKER_TAG} || true'
        }
        success {
            echo 'Pipeline succeeded!'
        }
        failure {
            echo 'Pipeline failed!'
            // Send notifications
            // slackSend channel: '#ci-cd', message: "Pipeline failed: ${env.JOB_NAME} ${env.BUILD_NUMBER}"
        }
    }
}

```

**Docker Multi-Stage Build for Efficient CI**:

```dockerfile

# Multi-stage build for efficient CI/CD
FROM node:18-alpine AS base

WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Development dependencies stage
FROM deps AS dev-deps
RUN npm ci

# Build stage
FROM dev-deps AS build
COPY . .
RUN npm run lint
RUN npm run test:unit
RUN npm run build

# Security scan stage
FROM build AS security
RUN npm audit --audit-level high
# Add additional security tools
# RUN trivy filesystem --no-progress --exit-code 1 --severity HIGH,CRITICAL .

# Production stage
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["npm", "start"]

```

**Feature Flag Implementation**:

```python

# Using Unleash for feature flags
from UnleashClient import UnleashClient

# Initialize client
unleash = UnleashClient(
    url="https://unleash.example.com/api",
    app_name="myapp",
    instance_id="instance-1"
)
unleash.initialize_client()

def process_payment(amount, user_id):
    # Feature flag for new payment processing
    if unleash.is_enabled("new_payment_processor", {"userId": user_id}):
        return new_payment_processor(amount, user_id)
    else:
        return legacy_payment_processor(amount, user_id)

# In CI/CD, enable flag gradually
# 1. Deploy code with flag disabled
# 2. Enable flag for 10% of users
# 3. Monitor metrics
# 4. Gradually increase to 100%
# 5. Remove old code and flag

```

---

## 24) Ethical AI Coding Considerations

### 24.1 Core Principles

- **Bias Mitigation**: Actively identify and reduce algorithmic bias in data selection, model training, and decision-making processes.
- **Harm Prevention**: Avoid generating code or content that promotes harm, discrimination, stereotypes, or unethical behavior.
- **Transparency**: Clearly document AI-generated code origins, assumptions, and limitations.
- **Privacy Protection**: Respect user data privacy, obtain consent for data usage, and implement appropriate security measures.
- **Accountability**: Take responsibility for AI outputs and provide mechanisms for human oversight and correction.

### 24.2 Bias Avoidance and Fairness

- **Data Diversity**: Ensure training data represents diverse populations; avoid skewed datasets that could lead to discriminatory outcomes.
- **Algorithm Auditing**: Regularly review algorithms for potential bias, especially in areas like hiring, lending, or content recommendation.
- **Protected-Attribute Coverage**: Bias reviews should explicitly consider gender, racial, cultural, age, disability, and socioeconomic impacts unless a documented scoping decision explains why a category is not relevant.
- **Pattern Libraries**: Maintain pattern-based detection for at least five bias categories and three stereotype categories so audits cover direct slurs, coded exclusion, stereotype framing, capability assumptions, and comparative inferiority language.
- **Fair ML Practices**: Implement fairness metrics (demographic parity, equal opportunity) and bias detection tools, and document thresholds that trigger mitigation work.
- **Severity and Confidence Scoring**: Bias findings should include severity, confidence, and configurable thresholds so teams can distinguish low-confidence hints from release-blocking issues.
- **Mitigation Guidance**: Each bias finding should produce an actionable recommendation such as rebalancing datasets, revising prompts, adjusting ranking logic, or adding human review.
- **Inclusive Design**: Consider accessibility, cultural sensitivity, and diverse user needs in all implementations.

### 24.3 Content and Output Guidelines

- **Multi-Layer Moderation**: Combine rule/pattern matching with advanced bias detection instead of relying on a single filter type.
- **Harmful Content Prevention**: Filter and moderate outputs to prevent generation of harmful, offensive, or inappropriate content, including hate speech, violence, sexual harassment, and discriminatory harassment.
- **Sensitive Topic Handling**: Use appropriate warnings, age restrictions, or content gating for sensitive subjects.
- **Cultural Respect**: Avoid stereotypes, cultural appropriation, or insensitive representations.
- **Truthfulness**: Prioritize accuracy and avoid generating misleading or false information.
- **Misinformation Controls**: Detect absolute claims, fabricated certainty, and unverified statements; require review or safer phrasing when evidence is missing.
- **Privacy Safeguards**: Detect personal information and precise location data in prompts and outputs, then redact, block, or route to approved secure handling paths.
- **Severity-Based Approval**: Low-severity issues may pass with logging, medium-severity issues should require review, and critical issues must be blocked with a safe alternative response.
- **Context-Aware Moderation**: Allow documented exceptions for legitimate technical, safety, debugging, or educational discussions while still blocking harmful intent.

### 24.4 Transparency and Documentation

- **Code Attribution**: Clearly mark AI-generated code with comments indicating AI assistance and review requirements.
- **Assumption Documentation**: Document assumptions, limitations, and potential edge cases in AI-generated solutions.
- **Decision Rationale**: Explain the reasoning behind algorithmic choices and design decisions.
- **User Communication**: Inform users when interacting with AI-generated systems or content.

### 24.5 Privacy and Consent

- **Data Minimization**: Collect only necessary data and minimize retention periods.
- **Consent Management**: Implement clear consent mechanisms for data collection and processing.
- **Privacy by Design**: Embed privacy considerations into system architecture from the beginning.
- **GDPR/CCPA Compliance**: Follow relevant privacy regulations and implement user rights (access, deletion, portability).
- **Moderation Privacy**: Do not log flagged prompts or responses verbatim when they contain PII, location data, or sensitive categories; log redacted evidence and decision metadata instead.

### 24.6 Implementation Guidelines

- **Ethical Review Process**: Include ethical impact assessment in development workflows.
- **Human Oversight**: Provide mechanisms for human review and override of AI decisions.
- **Real-Time Response Screening**: Moderate all AI-generated responses before display in user-facing chat or agent experiences.
- **Fallback Responses**: When content is blocked, return a safe fallback response that explains the limitation without repeating unsafe material.
- **Decision Logging**: Log moderation decisions, severity, confidence, triggered categories, and reviewer outcomes using structured telemetry.
- **Performance Monitoring**: Track moderation and bias-analysis processing time so safety checks remain visible in latency budgets.
- **Continuous Monitoring**: Monitor AI systems for unintended consequences, moderation drift, and bias drift over time.
- **Ethical Training**: Ensure development teams receive training on AI ethics and responsible practices.

### 24.7 Integration and Documentation

- Reference in §0 (golden rules) for fundamental ethical requirements and §17 (AI behaviors) for specific AI conduct guidelines.
- Document ethical considerations in function notes (§3) for AI-influenced functions.
- Include ethical impact assessment in project planning and risk analysis (§4).
- For user-visible AI systems, treat `bias_detector.py`, `moderator.py`, and chat-service integration points as first-class safety components with documented thresholds, override paths, and observability expectations.
- Update README/API docs, runbooks, and ADRs when moderation policy, fairness thresholds, or fallback behavior changes.
- Start from the packaged ethics starter templates under `templates/ethics-safety/` when a project needs bias detection, content moderation, or chat-response middleware.

### 24.8 Examples

**Advanced Bias Detector (`bias_detector.py`)**:

```python

import pandas as pd
from sklearn.metrics import confusion_matrix
from fairlearn.metrics import demographic_parity_difference
from fairlearn.metrics import equal_opportunity_difference

BIAS_PATTERN_CATEGORIES = [
  "exclusionary_language",
  "comparative_inferiority",
  "capability_assumptions",
  "coded_discrimination",
  "cultural_erasure",
]

STEREOTYPE_CATEGORIES = [
    "gender_stereotype",
    "racial_stereotype",
    "socioeconomic_stereotype",
]


def audit_model_bias(y_true, y_pred, sensitive_features, *, threshold=0.1):
    """
    Audit model outputs for bias across protected attributes.

    Args:
        y_true: True labels
        y_pred: Predicted labels
        sensitive_features: Protected attributes keyed by category
        threshold: Configurable fairness threshold for escalation

    Returns:
        dict: Bias metrics, severity, confidence, and recommendations
    """
    demographic_parity = demographic_parity_difference(
        y_true,
        y_pred,
        sensitive_features=sensitive_features,
    )
    equal_opportunity = equal_opportunity_difference(
        y_true,
        y_pred,
        sensitive_features=sensitive_features,
    )

    bias_report = {
        "protected_attributes_reviewed": [
            "gender",
            "racial",
            "cultural",
            "age",
            "disability",
            "socioeconomic",
        ],
        "pattern_categories": BIAS_PATTERN_CATEGORIES,
        "stereotype_categories": STEREOTYPE_CATEGORIES,
        "fairness_metrics": {
            "demographic_parity_difference": demographic_parity,
            "equal_opportunity_difference": equal_opportunity,
        },
        "confidence": "high",
        "severity": "low",
        "recommendations": [],
    }

    if max(abs(demographic_parity), abs(equal_opportunity)) >= threshold:
        bias_report["severity"] = "high"
        bias_report["recommendations"].append(
            "Rebalance training data, tighten prompts, or add human review before release."
        )

    return bias_report

# Usage:
# bias_report = audit_model_bias(y_test, y_pred, sensitive_features, threshold=0.08)

```

**Content Moderator (`moderator.py`)**:

```python

import re

from bias_detector import audit_model_bias


SEVERITY_RANK = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "critical": 3,
}


class ContentModerator:
    def __init__(self):
        self.harmful_patterns = {
            "hate_speech": [r"hate speech patterns"],
            "violence": [r"violent threats"],
            "sexual_harassment": [r"sexual coercion"],
            "discrimination": [r"discriminatory content"],
        }
        self.misinformation_patterns = [r"always guaranteed", r"unverified claim"]
        self.privacy_patterns = [r"\b\d{3}-\d{2}-\d{4}\b", r"exact home address"]

    def moderate_content(self, content, *, context="general"):
        issues = []

        for category, patterns in self.harmful_patterns.items():
            if any(re.search(pattern, content, re.IGNORECASE) for pattern in patterns):
                issues.append({"type": category, "severity": "critical"})

        if any(re.search(pattern, content, re.IGNORECASE) for pattern in self.misinformation_patterns):
            issues.append({"type": "misinformation", "severity": "medium"})

        if any(re.search(pattern, content, re.IGNORECASE) for pattern in self.privacy_patterns):
            issues.append({"type": "privacy", "severity": "high"})

        if context != "technical_review":
            bias_summary = audit_model_bias([], [], {}, threshold=0.08)
            if bias_summary["severity"] != "low":
                issues.append({"type": "bias", "severity": bias_summary["severity"]})

        highest_severity = max(
            (issue["severity"] for issue in issues),
            key=lambda severity: SEVERITY_RANK[severity],
            default="low",
        )

        return {
            "decision": "block" if highest_severity == "critical" else "review" if highest_severity in {"medium", "high"} else "allow",
            "issues": issues,
            "safe_fallback": "I can't provide that response, but I can help with a safer alternative.",
        }

```

**Chat Service Integration**:

```python

import logging
import time


logger = logging.getLogger(__name__)


def render_chat_response(chat_service, moderator, prompt):
    """Generate, moderate, and safely render an AI response."""
    started = time.perf_counter()
    raw_response = chat_service.generate(prompt)
    moderation = moderator.moderate_content(raw_response, context="technical_review")
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

    logger.info(
        "chat_response_moderated",
        extra={
            "decision": moderation["decision"],
            "issues": moderation["issues"],
            "processing_time_ms": elapsed_ms,
        },
    )

    if moderation["decision"] == "block":
        return moderation["safe_fallback"]

    return raw_response

```

**Privacy-Preserving Data Handling**:

```python

from cryptography.fernet import Fernet
import hashlib
import os

class PrivacyManager:
    def __init__(self):
        self.key = Fernet.generate_key()
        self.cipher = Fernet(self.key)

    def hash_sensitive_data(self, data, salt=None):
        """
        Hash sensitive data for privacy preservation.

        Args:
            data: Data to hash
            salt: Optional salt for additional security

        Returns:
            str: Hashed value
        """
        if salt is None:
            salt = os.urandom(16)

        # Use PBKDF2 for key derivation
        hashed = hashlib.pbkdf2_hmac(
            'sha256',
            data.encode(),
            salt,
            100000  # High iteration count for security
        )

        return hashed.hex()

    def encrypt_pii(self, personal_data):
        """
        Encrypt personally identifiable information.

        Args:
            personal_data: PII to encrypt

        Returns:
            bytes: Encrypted data
        """
        return self.cipher.encrypt(personal_data.encode())

    def decrypt_pii(self, encrypted_data):
        """
        Decrypt PII (use with caution).

        Args:
            encrypted_data: Encrypted PII

        Returns:
            str: Decrypted data
        """
        return self.cipher.decrypt(encrypted_data).decode()

    def anonymize_dataset(self, df, pii_columns):
        """
        Anonymize dataset by hashing or removing PII.

        Args:
            df: DataFrame to anonymize
            pii_columns: Columns containing PII

        Returns:
            DataFrame: Anonymized dataset
        """
        df_anonymized = df.copy()

        for col in pii_columns:
            if col in df_anonymized.columns:
                # Hash PII instead of removing
                df_anonymized[col] = df_anonymized[col].apply(
                    lambda x: self.hash_sensitive_data(str(x))
                )

        return df_anonymized

# Usage
privacy_mgr = PrivacyManager()

# Hash email for user identification without storing actual email
user_id = privacy_mgr.hash_sensitive_data("user@example.com")

# Encrypt sensitive data
encrypted_ssn = privacy_mgr.encrypt_pii("123-45-6789")

# Anonymize dataset
# df_anonymized = privacy_mgr.anonymize_dataset(df, ['email', 'phone', 'name'])

```

**Ethical Code Attribution**:

```python

def ai_generated_function(data):
    """
    Process user data with privacy considerations.

    AI-GENERATED: This function was created with AI assistance.
    REVIEW REQUIRED: Human review completed on [date] by [reviewer].
    ETHICAL CONSIDERATIONS:
    - Data privacy: Only processes provided data, no external storage
    - Bias check: Algorithm uses neutral criteria
    - Transparency: All decisions logged for audit

    Assumptions:
    - Input data is validated and sanitized
    - User consent obtained for processing
    - No discriminatory features in data

    Limitations:
    - May not handle edge cases in diverse datasets
    - Performance may vary with data complexity

    Args:
        data (dict): User data to process

    Returns:
        dict: Processed results

    Raises:
        ValueError: If data validation fails
    """
    # Implementation with ethical safeguards
    if not self._validate_consent(data):
        raise ValueError("User consent required for processing")

    # Log processing for transparency
    self._log_processing(data, "ai_generated_function")

    # Process with bias-aware algorithm
    result = self._fair_processing(data)

    return result

```

---

## 25) Internationalization and Localization (i18n/l10n)

### 25.1 Core Principles

- **Internationalization (i18n)**: Design software to support multiple languages and regions without code changes.
- **Localization (l10n)**: Adapt content for specific locales (languages, date formats, currencies).
- **Separation of Concerns**: Keep text strings separate from code; use external resource files.
- **Cultural Sensitivity**: Consider date formats, number separators, text direction, and cultural norms.

### 25.2 Implementation Guidelines

- **Text Externalization**: Use i18n libraries to manage translatable strings; avoid hard-coded text in UI.
- **Locale-Aware Formatting**: Handle dates, times, numbers, currencies, and measurements per locale.
- **RTL Language Support**: Support right-to-left languages (Arabic, Hebrew) with CSS and HTML direction attributes.
- **Pluralization**: Handle singular/plural forms correctly across languages.
- **Fallbacks**: Provide default (usually English) fallbacks for missing translations.

### 25.3 Technical Implementation

- **Libraries and Frameworks**:
  - **JavaScript/React**: react-i18next, react-intl, FormatJS
  - **Python**: gettext, Babel, Flask-Babel
  - **General**: ICU (International Components for Unicode)
- **File Organization**: Use JSON/YAML/MO files for translations; organize by locale (en, es, zh-CN).
- **Build Process**: Integrate translation extraction and compilation into CI/CD (§23).

### 25.4 Testing for Multiple Locales

- **Locale Testing**: Test with different language packs and regional settings.
- **Date/Number Formatting**: Verify correct formatting across locales.
- **UI Layout**: Check RTL layouts, text expansion/contraction, and cultural appropriateness.
- **Automation**: Use tools like Selenium with locale switching for UI testing.

### 25.5 Integration and Documentation

- Reference in §14 (UI/UX) for user-facing content and §13 (refactoring) for parameterization.
- Document supported locales and translation coverage.
- Include i18n considerations in function notes (§3) for locale-sensitive functions.

### 25.6 Examples

**React with react-i18next**:

```javascript

import { useTranslation } from 'react-i18next';

function WelcomeMessage() {
  const { t, i18n } = useTranslation();

  return (
    <div>
      <h1>{t('welcome.title', 'Welcome')}</h1>
      <p>{t('welcome.description', 'Welcome to our application')}</p>
      <button onClick={() => i18n.changeLanguage('es')}>
        {t('language.switch', 'Switch to Spanish')}
      </button>
    </div>
  );
}

// Translation files: public/locales/en/translation.json
{
  "welcome": {
    "title": "Welcome",
    "description": "Welcome to our application"
  },
  "language": {
    "switch": "Switch to Spanish"
  }
}

// public/locales/es/translation.json
{
  "welcome": {
    "title": "Bienvenido",
    "description": "Bienvenido a nuestra aplicación"
  },
  "language": {
    "switch": "Cambiar a inglés"
  }
}

```

**Python with Flask-Babel**:

```python

from flask import Flask, request, g
from flask_babel import Babel, gettext as _

app = Flask(__name__)
babel = Babel(app)

@babel.localeselector
def get_locale():
    # Get locale from user preference, URL, or Accept-Language header
    return request.accept_languages.best_match(['en', 'es', 'fr'])

@app.route('/')
def index():
    return _('Hello, World!')

@app.route('/date')
def current_date():
    from datetime import datetime
    # Format date according to locale
    return _('Today is %(date)s', date=babel.format_date(datetime.now()))

# Translation files: translations/es/LC_MESSAGES/messages.po
msgid "Hello, World!"
msgstr "¡Hola, Mundo!"

msgid "Today is %(date)s"
msgstr "Hoy es %(date)s"

```

**CSS for RTL Support**:

```css

/* Base styles */
.content {
  direction: ltr;
  text-align: left;
}

/* RTL overrides */
[dir="rtl"] .content {
  direction: rtl;
  text-align: right;
}

/* Logical properties for better RTL support */
.margin-start {
  margin-inline-start: 1rem; /* Replaces margin-left in LTR, margin-right in RTL */
}

.margin-end {
  margin-inline-end: 1rem;   /* Replaces margin-right in LTR, margin-left in RTL */
}

/* Icon flipping for RTL */
.icon-arrow {
  transform: scaleX(1); /* Normal in LTR */
}

[dir="rtl"] .icon-arrow {
  transform: scaleX(-1); /* Flipped in RTL */
}

```

**Date and Number Formatting**:

```javascript

// Using Intl API (built-in browser support)
const date = new Date('2024-11-13');

// Locale-specific formatting
console.log(date.toLocaleDateString('en-US')); // "11/13/2024"
console.log(date.toLocaleDateString('de-DE')); // "13.11.2024"
console.log(date.toLocaleDateString('ar-SA')); // "٠٤/١١/١٤٤٦" (Islamic calendar)

// Number formatting
const number = 1234567.89;
console.log(number.toLocaleString('en-US')); // "1,234,567.89"
console.log(number.toLocaleString('de-DE')); // "1.234.567,89"
console.log(number.toLocaleString('ar-SA')); // "١٬٢٣٤٬٥٦٧٫٨٩"

// Currency formatting
console.log(number.toLocaleString('en-US', {
  style: 'currency',
  currency: 'USD'
})); // "$1,234,567.89"

console.log(number.toLocaleString('eu-ES', {
  style: 'currency',
  currency: 'EUR'
})); // "1.234.567,89 €"

```

---

## 26) Token Optimization and Efficiency

### 26.1 Core Philosophy

- **Minimize Token Usage**: Efficient context gathering and response generation reduce costs and improve performance.
- **Balance Quality and Efficiency**: Maintain code quality while optimizing token consumption.
- **Strategic Context Loading**: Load only what's needed, when it's needed.
- **Batch Operations**: Group related operations to minimize overhead.

### 26.2 Context Management Strategies

#### Targeted File Reading

- **Use offset/limit parameters**: Read specific sections instead of entire large files.
- **Grep for overviews**: Use `grep_search` to scan file structure before detailed reads.
- **Parallel reads**: Load independent files simultaneously to reduce round trips.
- **Avoid re-reading**: Cache information from previous reads in working memory.
- **Semantic chunking**: Break large files into meaningful segments (functions, classes, modules) rather than arbitrary line ranges.

#### Retrieval-Augmented Generation (RAG)

- **Intelligent retrieval**: Fetch only relevant data using semantic search, reducing context by 70%.
- **Vector-based search**: When available, use semantic search to find conceptually related code without loading entire files.
- **Use it selectively**: Evaluate semantic retrieval for large, concept-heavy repositories or documentation sets where keyword search alone is noisy or incomplete.
- **Keep providers optional**: Prefer provider-agnostic retrieval interfaces. A specific provider or model, such as Luna, may be adopted when the project documents the rationale, privacy/security constraints, retrieval quality benchmarks, fallback behavior, and cost/performance trade-offs.
- **Preserve deterministic fallback**: Keep `grep_search`, file search, or keyword search available when semantic retrieval is unavailable, stale, or less precise for the task.
- **Hierarchical context loading**: Start with high-level overviews, drill down only where needed.
- **Context pruning**: Remove irrelevant sections from loaded context before processing.

#### Smart Search Patterns

- **Regex alternation**: Use `pattern1|pattern2|pattern3` instead of multiple searches.
- **Appropriate tool selection**:
  - `semantic_search`: For unknown patterns or conceptual searches (use RAG principles)
  - `grep_search`: For known strings or patterns
  - `file_search`: For filename patterns
- **Limit results strategically**: Set `maxResults` only when necessary; start small and expand if needed.

### 26.3 Caching and Reuse Strategies

#### Response Caching

- **Common patterns**: Recognize and reuse responses to frequent queries (75-90% savings on repetitive tasks).
- **Prefix caching**: Store common prompt prefixes to avoid re-processing.
- **Session memory**: Maintain working memory of file contents, decisions, and context across the conversation.
- **Template reuse**: Build library of code patterns and documentation templates for rapid deployment.

#### Context Caching

- **File content memory**: After reading a file, reference it from memory rather than re-reading.
- **Search results**: Cache grep/semantic search results for the session; reference instead of re-searching.
- **Decision logs**: Record architectural decisions once; reference by ID in future discussions.
- **Code snippets**: Store frequently referenced code sections for quick retrieval.

### 26.4 Response Efficiency Guidelines

#### Concise Communication

- **Brief answers for simple queries**: 1-3 sentences when appropriate (see examples in communication guidelines).
- **Skip redundant context**: Don't repeat information the user already has.
- **Avoid ceremony**: Omit unnecessary introductions like "I'll now...", "Here's the answer:", etc.
- **Code speaks**: Use comments in code instead of separate explanations for obvious changes.
- **Structured outputs**: Use schemas and constraints to control output length (30-40% reduction).
- **Stop sequences**: Limit outputs to essentials; avoid over-elaboration.

#### Progress Updates

- **Batch progress reports**: After completing parallel operations, provide one update.
- **Concise summaries**: Reference TODO IDs instead of restating full descriptions.
- **Essential details only**: Focus on outcomes, blockers, or decisions needed.

### 26.5 Batch Operations and Parallelization

#### Multi-File Edits

- **Use multi_replace_string_in_file**: Apply multiple edits in one call when possible.
- **Group related changes**: Combine logically connected modifications.
- **Sequential only when dependent**: Parallelize independent operations.
- **Bulk processing**: For non-urgent tasks, batch operations to leverage provider discounts (up to 50% savings).

#### Context Gathering

- **Parallel discovery**: Launch varied queries together (file search, grep, semantic search).
- **Read results, deduplicate paths**: Process results before making more calls.
- **Avoid over-searching**: One targeted batch is better than multiple sequential searches.
- **Async operations**: Use background processing for large-scale analyses or multi-file operations.

### 26.6 Adaptive Model Selection and Cascading

#### Task-Appropriate Complexity

- **Simple queries**: Route to lightweight processing for quick, cost-effective responses.
- **Complex tasks**: Reserve advanced analysis for architectural decisions, complex refactors, or novel problems.
- **Dynamic routing**: Assess task complexity upfront; escalate only when needed (20-35% cost savings).

#### Efficiency Tiers

- **Tier 1 - Simple**: Direct answers, file lookups, straightforward edits (minimal token usage).
- **Tier 2 - Moderate**: Multi-file changes, pattern matching, standard refactoring.
- **Tier 3 - Complex**: Architectural design, novel algorithms, security analysis, performance optimization.

#### Contextual Awareness

- **Progressive complexity**: Start simple; add sophistication only when initial approach insufficient.
- **Feedback loops**: Learn from task outcomes to improve routing over time (15-25% efficiency gains).

### 26.7 Documentation Proportionality

#### Scale to Complexity (Reinforcing §3)

- **Critical public APIs**: Full §3 template with all sections.
- **Internal utilities**: Purpose, inputs, outputs, key assumptions.
- **Simple helpers**: Purpose line and non-obvious logic notes.
- **Avoid boilerplate**: If a section adds no value, omit it.

#### Examples of Proportional Documentation

**Complex Public API** (Full documentation):

```python

def process_payment(amount: Decimal, user_id: str, payment_method: dict,
                   idempotency_key: str, metadata: dict = None) -> PaymentResult:
    """Process a payment transaction with full PCI compliance.

    Critical payment processing function that handles monetary transactions,
    validates payment methods, ensures idempotency, and integrates with
    external payment gateways. Used by checkout, subscriptions, and invoicing.

    Args:
        amount (Decimal): Payment amount in USD; must be positive, max 2 decimal places.
        user_id (str): UUID of the user initiating payment; must exist in database.
        payment_method (dict): Payment details {'type': 'card'|'bank', 'token': str}.
        idempotency_key (str): Unique key to prevent duplicate charges (max 64 chars).
        metadata (dict, optional): Additional context for reporting/audit trail.

    Returns:
        PaymentResult: Object containing {
            'transaction_id': str,
            'status': 'success'|'failed'|'pending',
            'amount_charged': Decimal,
            'timestamp': datetime
        }

    Raises:
        ValueError: If amount <= 0, invalid payment_method format, or invalid user_id.
        PaymentGatewayError: If external gateway rejects or times out (retries 3x).
        DuplicateTransactionError: If idempotency_key already used within 24h.

    Side Effects:
        - Creates transaction record in database (transactions table).
        - Charges external payment gateway (Stripe).
        - Sends receipt email to user (async job queued).
        - Logs to audit trail with PCI redaction.
        - Updates user balance/credits in real-time.

    Performance:
        O(1) database lookups with indexed queries.
        External API call: 200-500ms average, 3s timeout with retry.
        Hot path: called on every checkout; optimize for speed.

    Security/Privacy:
        - PCI DSS compliant: never logs full card numbers.
        - Payment tokens encrypted at rest (AES-256).
        - Requires authenticated user session.
        - Rate limited: 10 requests/minute per user.
        - Idempotency prevents double-charging.

    Concurrency:
        Thread-safe via database row locking on user balance.
        Idempotency key prevents race conditions on duplicate submissions.
        External gateway calls are idempotent.

    Rationale:
        Centralized payment processing ensures consistent PCI compliance,
        audit logging, and error handling. Alternative of distributed
        payment logic was rejected due to security/maintenance concerns.
        Stripe chosen over PayPal for better API reliability (99.99% SLA).
    """
    # Implementation...

```

**Internal Utility** (Moderate documentation):

```python

def normalize_phone(phone: str) -> str:
    """Normalize phone number to E.164 format (+1234567890).

    Args:
        phone (str): Phone in various formats (e.g., "(123) 456-7890", "123-456-7890").

    Returns:
        str: E.164 format with country code (+1 for US).

    Raises:
        ValueError: If phone invalid or not 10 digits after cleaning.

    Performance: O(n) where n is phone length; not on hot path.
    """
    # Implementation...

```

**Simple Helper** (Minimal documentation):

```python

def is_weekend(dt: datetime) -> bool:
    """Return True if datetime falls on Saturday or Sunday."""
    return dt.weekday() >= 5

```

### 26.8 Working Memory Management

#### TODO Ledger Efficiency

- **Concise descriptions**: "Add user auth" not "Implement comprehensive user authentication system with OAuth2 and JWT tokens"
- **Reference by ID**: "Complete AI-001" instead of restating the full task
- **Prune completed items**: Archive to separate section after milestones

#### Session Notes

- **Decision logs only**: Record why, not what (code shows what)
- **Link to commits**: Reference external context instead of duplicating
- **Compress history**: Summarize multiple steps into key outcomes

#### Hierarchical Memory (Advanced)

- **Short-term**: Current task context, active file contents, immediate decisions.
- **Medium-term**: Session patterns, recurring queries, established conventions.
- **Long-term**: Project architecture, team preferences, historical decisions (use ADRs, config files).
- **Tiered access**: Load short-term by default; pull medium/long-term only when relevant (40-50% context savings).

### 26.9 Tool Usage Patterns

#### Efficient File Operations

```python

# ❌ Inefficient: Multiple sequential reads
read_file("large_file.py")  # Reads all 5000 lines
read_file("large_file.py")  # Re-reads to find another section

# ✅ Efficient: Targeted reads or grep overview first
grep_search("class|function", includePattern="large_file.py")  # Overview
read_file("large_file.py", offset=100, limit=50)  # Specific section

```

#### Efficient Search Strategies

```python

# ❌ Inefficient: Multiple searches
grep_search("authentication")
grep_search("auth")
grep_search("login")

# ✅ Efficient: Single search with alternation
grep_search("authentication|auth|login|sign.?in", isRegexp=True)

```

#### Batch Edits

```python

# ❌ Inefficient: Sequential edits
replace_string_in_file(file1, old1, new1)
replace_string_in_file(file2, old2, new2)
replace_string_in_file(file3, old3, new3)

# ✅ Efficient: Parallel batch
multi_replace_string_in_file([
    {file: file1, old: old1, new: new1},
    {file: file2, old: old2, new: new2},
    {file: file3, old: old3, new: new3}
])

```

### 26.10 Anti-Patterns to Avoid

- **Repeated file reads**: Cache information from first read
- **Over-documentation**: Don't write novels for trivial functions
- **Sequential independent ops**: Parallelize when possible
- **Verbose progress updates**: "Working on X..." adds no value
- **Redundant explanations**: Code + comments often sufficient
- **Over-searching**: One good search beats many partial ones
- **Full file reads for small changes**: Use offset/limit or grep

### 26.11 Integration and Enforcement

- Reference in §0.5 (Task Start Protocol) for awareness at task initiation
- Apply in §3 (Function Notes) for proportional documentation
- Use in §11 (Session Conduct) for efficient working notes
- Monitor token usage and adjust strategies accordingly

### 26.12 Metrics and Monitoring

#### Track Efficiency

- **Token usage per task**: Monitor trends over time (target: 40-80% reduction with optimizations)
- **Tool calls per outcome**: Measure efficiency of approach (<5 for simple, <15 for complex)
- **Context reuse**: How often is information re-fetched? (target: >90% reuse rate)
- **Response length**: Are answers appropriately concise? (target: 30-40% shorter while maintaining clarity)
- **Caching hit rate**: Track frequency of reused responses/contexts (target: 75-90% on repetitive tasks)

#### Cost Tracking

- **Per-task cost**: Monitor token costs relative to value delivered
- **Batch efficiency**: Measure savings from grouped operations (target: 50-60% on bulk tasks)
- **Model selection accuracy**: How often is the right complexity tier chosen? (target: 85-95%)

#### Continuous Improvement

- **Weekly review**: Identify highest token-consuming tasks for optimization
- **Pattern recognition**: Build playbooks for common scenarios (40-50% savings with templates)
- **Feedback loops**: Analyze task outcomes to improve routing and caching (15-25% efficiency gains)
- **Balance cost and quality**: Never sacrifice correctness for tokens
- **Document learnings**: Update this section with new strategies and measured results

### 26.13 Examples

**Efficient Task Execution**:

```text

User: "Fix the login validation bug in auth.py"

AI Approach:
1. grep_search("login.*validation|validate.*login", "auth.py") - Overview
2. read_file("auth.py", offset=45, limit=30) - Read specific function
3. Fix identified issue
4. Brief response: "Fixed validation logic in validate_login() - now checks email format before DB query."

Tokens saved: ~60% vs reading full file + verbose explanation

```

**Efficient Multi-File Refactor**:

```text

User: "Rename getUserData to fetchUserData across the codebase"

AI Approach:
1. grep_search("getUserData") - Find all occurrences (parallel with next)
2. semantic_search("getUserData function usage") - Confirm context
3. multi_replace_string_in_file([all files]) - Batch rename
4. Concise summary: "Renamed getUserData → fetchUserData in 12 files (src/api/, src/utils/, tests/)"

Tokens saved: ~75% vs sequential edits + detailed per-file reports

```

---

**End of `rules.md`.**
