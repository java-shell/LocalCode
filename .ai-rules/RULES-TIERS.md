# AI Rules - Tier System

> **Purpose**: Progressive disclosure of rules based on task complexity and project maturity. Start with Essential, expand to Standard, reference Comprehensive when needed.

---

## How to Use This System

- **New to AI Rules?** Start with **Essential Tier** only
- **Building production features?** Follow **Standard Tier**
- **Complex/critical systems?** Reference **Comprehensive Tier** sections as needed

**Rule of thumb**: Don't apply rules you don't understand yet. Grow into them.

---

## Essential Tier (The Non-Negotiables)

**Apply these to EVERY task, no exceptions.**

### 1. Document Your Functions (3 - Simplified)

Every function needs at minimum:

- **Purpose**: What it does and why
- **Inputs/Outputs**: Parameters and return values
- **Errors**: What can go wrong

Skip other sections unless the function is complex or public-facing.

### 2. No Breaking Changes (5)

Preserve existing behavior unless explicitly instructed to break it.

- Add new features with flags/adapters
- Migration plan required for approved breaks

### 3. Test Your Changes (6 - Core)

- Unit tests for new functions
- Verify existing functionality still works
- No flaky tests
- When the stack matches, start from the packaged strict testing templates for Jest, Pytest, .NET, or Go instead of inventing enforcement from scratch

### 4. Keep It Simple (7)

- Straightforward solutions over clever ones
- Minimize dependencies
- Small, focused functions

### 5. Clean Commits (9 - Basic)

Use conventional commit format:

```text
feat: Add user login
fix: Resolve null pointer in validator
docs: Update API examples
```

**That's it for Essential Tier.** Master these five before moving on.

---

## Standard Tier (Production-Ready Development)

**Add these when building features for production use.**

### 6. Task Planning (0.5, 4)

For multi-step tasks:

- Create TODO Ledger with `AI-###` IDs
- Track progress with checkboxes
- Mark complete with commit references

### 7. Documentation Updates (8)

- Update README/API docs when adding features
- Add CHANGELOG entries for notable changes
- Write design notes (ADRs) for architectural decisions

### 8. Comprehensive Function Notes (3 - Full)

For public APIs and complex functions, add:

- Side effects (I/O, network, DB)
- Performance considerations
- Security/privacy notes
- Concurrency assumptions
- Rationale and trade-offs

### 9. Refactoring Standards (13)

When improving code:

- Small, incremental changes
- Tests first to lock behavior
- Analyze responsibilities and coupling before moving code
- Follow the Modularize Code flow for structural refactors
- DRY, YAGNI, SRP principles
- Document rationale

### 10. PR Best Practices (10)

Complete PR checklist:

- Tests pass
- Docs updated
- TODO Ledger current
- No unnecessary dependencies
- Security evaluated

### 11. Testing Automation Starters (6, 23)

For projects with established stacks, use the packaged starters:

- Jest: `templates/github-actions/jest-testing-enforcement.yml`
- Pytest: `templates/github-actions/pytest-testing-enforcement.yml`
- .NET: `templates/github-actions/dotnet-testing-enforcement.yml`
- Go: `templates/github-actions/go-testing-enforcement.yml`

Pair them with the matching PowerShell validators under `templates/pre-commit/` when you want stricter local enforcement.

**Standard Tier = Professional software delivery.**

---

## Comprehensive Tier (Domain-Specific Excellence)

**Reference these sections when applicable to your project domain.**

### UI/UX Projects

- **14**: Module Versioning (release notes, version badges)
- **18**: UI Development Guidelines (Assistant Coach baseline)
- **20**: Accessibility Standards (WCAG AA, keyboard nav, screen readers)
- **25**: Internationalization (i18n/l10n, RTL support, locale formatting)

### Security-Critical Projects

- **19**: Security Best Practices (OWASP Top 10, input validation, secure auth)
- **22**: Error Handling (retry logic, circuit breakers, graceful degradation)

### High-Performance Systems

- **21**: Performance Optimization (profiling, caching, algorithm efficiency)
- **26**: Token Optimization (efficient context, RAG principles, batching)

### DevOps & Infrastructure

- **15**: Azure/Docker Defaults (deterministic builds, env vars, structured logging, observability baselines)
- **23**: CI/CD Best Practices (pipeline design, deployment strategies, rollbacks)

### AI & Ethics

- **24**: Ethical AI Coding (bias detection, moderation, privacy protection, fallback safety, transparency)

### Workflow & Meta

- **2**: Workflow (Plan  Build  Verify  Document  Deliver)
- **11**: Session Conduct (working notes, delivery summaries)
- **16**: Governance & Exceptions (when to waive rules)
- **27**: Rule Maintenance (versioning, cross-references, periodic review)
- **13.4**: Modularize Code flow for responsibility-driven refactors

---

## Tier Comparison

| Aspect | Essential | Standard | Comprehensive |
| --- | --- | --- | --- |
| **Learning Time** | 30 minutes | 2-3 hours | Ongoing reference |
| **Task Coverage** | 80% of simple tasks | 95% of features | 100% of complex projects |
| **Team Size** | Solo/small | 5-20 people | 20+ or regulated industry |
| **Overhead** | Minimal | Moderate | High (justified) |
| **Risk Mitigation** | Basic safety | Production-ready | Enterprise-grade |

---

## Decision Guide: Which Tier Do I Need?

### Use Essential Tier If

- Learning AI-assisted development
- Building prototypes or demos
- Working on personal projects
- Time-constrained tasks

### Use Standard Tier If

- Delivering production features
- Working in a team
- Code will be maintained long-term
- Users depend on reliability

### Use Comprehensive Tier If

- Building user-facing UI/UX
- Handling sensitive data or auth
- Performance is critical
- Accessibility/i18n required
- Regulated industry (healthcare, finance, etc.)
- Enterprise systems

---

## Growth Path

**Week 1-2**: Master Essential Tier (5 rules)

**Week 3-4**: Add Standard Tier gradually (10 rules total)

**Month 2+**: Reference Comprehensive sections as needed

**Month 6+**: Contribute improvements back to rules

---

## Pro Tips

1. **Don't memorize**: Bookmark this file, reference as needed
2. **Start small**: Apply one new rule per task until it's habit
3. **Team alignment**: Agree on tier for your project (document in README)
4. **Exceptions are okay**: Use 16 to document when/why you deviate
5. **Measure impact**: Track time saved, bugs prevented, maintenance ease

---

**Version**: 1.4.0
**Created**: November 29, 2025
**Last Updated**: April 14, 2026
**Complements**:
rules.md, RULES-QUICKREF.md, ModularizeCode.md, GLOSSARY.md, LOGGING-OBSERVABILITY.md
**Next**: See GETTING-STARTED.md for step-by-step onboarding
