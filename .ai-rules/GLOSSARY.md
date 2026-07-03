# AI Rules Glossary

Use this glossary to keep wording consistent across `rules.md`, config files, setup assets, and derivative guides.

## Preferred Terms

### Non-breaking changes

Preferred prose term for changes that preserve existing behavior for callers and users.

### Backward compatibility (BWC)

The compatibility property preserved by non-breaking changes. In config, the schema key remains `backward_compatibility` for stability.

### Change Safety Protocol

The named rules section in `rules.md` (§5) that defines how non-breaking changes are protected and how breaking changes must be handled.

### Named rule reference

The preferred cross-reference style for derivative docs: cite the stable section title first and the section number second, for example `Task Start Protocol (§0.5)`.

### TODO Ledger

The tracked list of multi-step work items using stable IDs such as `AI-001`.

### ADR (Architecture Decision Record)

A short design note documenting an architectural or cross-cutting technical decision and the reasoning behind it.

### Modularize Code Flow

The refactoring flow used for structural cleanups: analyze responsibilities, extract small cohesive units, remove duplication, and create clear boundaries without changing behavior.

### Observability

The combined use of logs, metrics, traces, dashboards, and alerts to understand system behavior in production.

## Wording Conventions

- Prefer `non-breaking changes` in prose over `backward compatibility` when describing the default change policy.
- Use `BWC` only as a short form after the term `backward compatibility` has already been introduced.
- Keep `Change Safety Protocol` as the section title in `rules.md` because it describes the enforcement mechanism, not just the outcome.
- Prefer named rule references such as `Testing Requirements (§6)` over bare section numbers such as `§6`.
- Use `structured logging` when you mean machine-parseable logs with stable fields.
- Use `observability` when you mean logs plus metrics, traces, and alerting together.

## Config Naming Notes

- `rules.backward_compatibility` is intentionally retained for schema stability.
- `rules.documentation_updates` controls whether README/API/CHANGELOG updates are expected for applicable changes.
- `standards.logging_observability` controls the observability baseline, including structured logging and correlation IDs.

## Related Files

- `rules.md`
- `README.md`
- `ai-rules-config.schema.json`
- `LOGGING-OBSERVABILITY.md`
