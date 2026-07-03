# Rules Changelog

All notable changes to this AI ruleset are documented in this file.

The format follows semantic versioning: `vMajor.Minor.Patch`.

---

## v1.10.0 - 2026-04-14

### Added in v1.10.0

- Added packaged ethics-safety starter templates under `templates/ethics-safety/` for `bias_detector.py`, `moderator.py`, `chat_service_middleware.py`, and companion Python tests.
- Added setup-guide onboarding for when to enable advanced bias detection, moderation, fallback responses, logging, and latency tracking flags.

### Changed in v1.10.0

- Updated `setup-ai-rules.bat`, `SETUP-GUIDE.md`, `README.md`, `rules.md`, and `.github/copilot-instructions.md` so the ethics starter bundle is shipped and documented with the rest of the package.

---

## v1.9.0 - 2026-04-14

### Added in v1.9.0

- Added concrete ethics-framework requirements to `rules.md` for advanced bias detection across gender, racial, cultural, age, disability, and socioeconomic impacts.
- Added explicit content-moderation guidance covering harmful content, misinformation, privacy detection, severity-based approval, and context-aware allowances.
- Added chat-service integration guidance for real-time response screening, safe fallbacks, structured moderation logging, and processing-time tracking.
- Added ethics-safety configuration keys to `ai-rules-config.schema.json` plus aligned example/prototype presets.

### Changed in v1.9.0

- Updated `RULES-QUICKREF.md`, `.github/copilot-instructions.md`, `Reference.md`, and `README.md` so bias controls, moderation behavior, and fallback expectations are reflected in the published checklists and summaries.
- Expanded the function-notes standard and PR/delivery checklists so AI-facing logic explicitly documents fairness, moderation, and human-override assumptions when relevant.

---

## v1.8.0 - 2026-03-31

### Added in v1.8.0

- Added provider-agnostic semantic retrieval and vector search guidance to Token Optimization and Efficiency (§26).
- Added optional semantic retrieval configuration to `ai-rules-config.schema.json`, including explicit provider selection and Luna-specific settings.

### Changed in v1.8.0

- Updated `Reference.md` with companion guidance describing when Luna is a good fit for RAG and what must be documented if it is used.
- Updated `RULES-QUICKREF.md`, `.github/copilot-instructions.md`, `README.md`, and the example config presets so semantic retrieval guidance stays aligned across the published rule set.
- Updated `SETUP-GUIDE.md` with project-onboarding guidance for enabling semantic retrieval and documenting Luna-specific adoption decisions.
- Expanded `token-optimization.md` with a keyword vs. vector vs. hybrid retrieval decision checklist and a minimal evaluation rubric.

---

## v1.7.0 - 2026-03-23

### Added in v1.7.0

- Added strict GitHub Actions starter templates for .NET and Go under `templates/github-actions/`.
- Added PowerShell validators for .NET and Go test layout enforcement under `templates/pre-commit/`.

### Changed in v1.7.0

- Updated `Reference.md` and `RULES-TIERS.md` to point task flows to the packaged language-specific testing starters.
- Expanded `setup-ai-rules.bat`, `SETUP-GUIDE.md`, `README.md`, and `rules.md` so the .NET and Go testing templates are packaged and documented alongside the Jest and Pytest templates.

---

## v1.6.0 - 2026-03-23

### Added in v1.6.0

- Added strict GitHub Actions starter templates for Jest and Pytest under `templates/github-actions/`.
- Added PowerShell validators for Jest and Pytest test layout enforcement under `templates/pre-commit/`.

### Changed in v1.6.0

- Updated `setup-ai-rules.bat` and `SETUP-GUIDE.md` so the new testing templates are packaged into target projects.
- Expanded the template references in `rules.md` and `README.md` so Testing Requirements (§6) now point to concrete packaged automation starters.

---

## v1.5.1 - 2026-03-23

### Changed in v1.5.1

- Clarified rule-maintenance guidance to make named section titles the primary cross-reference mechanism, with section numbers kept as secondary navigation aids.
- Updated `RULES-QUICKREF.md` and `.github/copilot-instructions.md` to model named-rule-first references instead of relying on bare section numbers.
- Added glossary guidance for named rule references and updated published metadata in `rules.md` and `README.md`.

---

## v1.5.0 - 2026-03-20

### Added in v1.5.0

- Added GitHub Actions and pre-commit templates under `templates/` for optional automated enforcement.
- Added `GLOSSARY.md` to standardize terminology across docs and config.
- Added `LOGGING-OBSERVABILITY.md` as a companion guide for structured logs, metrics, traces, and alerting.

### Changed in v1.5.0

- Expanded §15 in `rules.md` from a brief default list into a fuller runtime and observability baseline.
- Added CI template references to `rules.md` §23 and `Reference.md`.
- Added terminology and observability settings to `ai-rules-config.schema.json` and aligned the example config files.
- Updated setup packaging so the new guides and templates are copied into target projects.
- Bumped published rule-set metadata to `1.5.0`.

---

## v1.4.1 - 2026-03-20

### Added in v1.4.1

- Added `ai-rules-config.example.json` as a schema-aligned standard configuration template.
- Added `ai-rules-config.prototype.json` as a relaxed prototype preset.
- Added `.vscode/tasks.json` and `.vscode/tasks.target.json` so the documented VS Code tasks now exist.
- Added `token-optimization.md` as a companion guide for §26.

### Changed in v1.4.1

- Rebuilt `SETUP-GUIDE.md` after corruption so setup instructions are usable again.
- Updated `setup-ai-rules.bat` to copy the current rule package, including Modularize Code, tier/reference guides, changelog, config presets, and helper guides.
- Updated `README.md` to reflect actual files in the repository.
- Updated `rules.md` and `RULES-QUICKREF.md` checklists to include token-efficiency verification.
- Updated version metadata in `rules.md`, `README.md`, and `.github/copilot-instructions.md`.

---

## v1.4.0 - 2026-03-20

### Added in v1.4.0

- Integrated `ModularizeCode.md` into the core refactoring workflow in `rules.md`.
- Added Modularize Code guidance to `RULES-QUICKREF.md` for task-start and refactor work.
- Added Modularize Code steps to `Reference.md` for the refactoring decision path.
- Added Modularize Code enforcement to `.github/copilot-instructions.md`.
- Added Modularize Code coverage to `RULES-TIERS.md` for the Standard and Workflow tiers.
- Created this changelog file for ongoing rule maintenance.

### Changed in v1.4.0

- Updated `README.md` to list `ModularizeCode.md` as part of the core rule set.
- Bumped the published ruleset version to `1.4.0` in `README.md`.

---

## v1.3.0 - 2025-11-13

### Added in v1.3.0

- Added UI Development Guidelines (§18) using Assistant Coach UI Setup as the baseline.
- Expanded the ruleset with Security (§19), Accessibility (§20), Performance (§21), Error Handling (§22), CI/CD (§23), and Ethics (§24).

---

## v1.2.0 - 2025-11-11

### Added in v1.2.0

- Added Refactoring & Code Quality Standards (§13).

### Changed in v1.2.0

- Renumbered subsequent sections to accommodate the new refactoring section.

---

## v1.1.0 - 2025-11-08

### Added in v1.1.0

- Added UI/UX Documentation Standards, later organized as §14, covering module versioning and release notes.

---

## v1.0.0 - 2025-10-24

### Added in v1.0.0

- Added the Task Start Protocol (§0.5).
- Created `RULES-QUICKREF.md`.
- Added GitHub Copilot enforcement instructions.
- Added VS Code task support for surfacing the rules in the editor.

---

## Pre-v1.0.0

### Added before v1.0.0

- Initial ruleset creation, later archived as `rules-v1.md.archive`.
