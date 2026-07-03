# AI Rules - File Organization

## 📂 Current Files

### Core Rule Files

- **`rules.md`** — Primary, comprehensive ruleset (version 1.10.0)
  - Includes Refactoring Standards (§13), Modularize Code flow for structural refactors, UI/UX Module Versioning (§14), UI Development Guidelines (§18), and additional standards (§19-26), including the advanced ethics safety framework for bias detection and moderation
- **`rules-changelog.md`** — Version history and change log (semantic versioning)
- **`RULES-QUICKREF.md`** — Quick reference checklist for task starts
- **`RULES-TIERS.md`** — Tiered adoption guide for essential, standard, and comprehensive rule usage
- **`Reference.md`** — Decision guide for mapping task types to applicable rule sections
- **`refactoring.md`** — Detailed refactoring philosophy & techniques guide
- **`ModularizeCode.md`** — Standard modularization flow for refactors that split responsibilities into cohesive modules
- **`GLOSSARY.md`** — Preferred terminology reference for keeping rule wording consistent across docs and config
- **`LOGGING-OBSERVABILITY.md`** — Logging, metrics, tracing, and alerting guidance that expands the §15 baseline
- **`token-optimization.md`** — Token usage optimization strategies (§26 implementation)
- **`UI-Setup-Instructions.md`** — Baseline UI development framework (Assistant Coach setup)
- **`How_to_use_versioning_badge.md`** — Module versioning implementation guide

### Review & Analysis

- **`AI-RULES-REVIEW.md`** — External review findings and improvement recommendations for the rules system

### Automation & Setup

- **`setup-ai-rules.bat`** — Automated setup script for new projects
- **`SETUP-GUIDE.md`** — Complete guide for using the automation
- **`templates/`** — GitHub Actions, pre-commit, and ethics-safety starter templates for optional automated enforcement and AI-response safety bootstrapping

### Configuration

- **`.github/copilot-instructions.md`** — GitHub Copilot automatic enforcement instructions
- **`.vscode/tasks.json`** — VS Code tasks to display rules on demand (base repo version)
- **`.vscode/tasks.target.json`** — VS Code tasks template for target projects (portable paths)
- **`ai-rules-config.example.json`** — Example configuration template
- **`ai-rules-config.prototype.json`** — Prototype configuration with advanced settings
- **`ai-rules-config.schema.json`** — JSON schema for configuration validation, including optional semantic retrieval/vector search settings and ethics-safety toggles for moderation, bias review, and observability

---

## 🎯 Which File to Use

### For AI at Task Start

1. **First check**: `.github/copilot-instructions.md` (auto-loaded by GitHub Copilot)
2. **Quick reference**: `RULES-QUICKREF.md` for condensed checklist
3. **Full details**: `rules.md` for comprehensive documentation

### For Humans

- **Quick start**: `RULES-QUICKREF.md`
- **Complete reference**: `rules.md`
- **Setting up AI tools**: `.github/copilot-instructions.md`

### VS Code Tasks (Run via Command Palette > Tasks: Run Task)

- **AI: Show Rules Checklist** — Display quick reference in terminal
- **AI: Show Full Rules** — Display complete rules in terminal
- **AI: Open Rules in Editor** — Open both rule files in editor tabs

---

## 📋 File Hierarchy (Authority)

1. **`rules.md`** — Primary source of truth
2. **`RULES-QUICKREF.md`** — Derived from rules.md (must stay in sync)
3. **`.github/copilot-instructions.md`** — Enforcement wrapper (references rules.md)

**Note**: Always update `rules.md` first, then sync derivative files.

Derivative docs should prefer named rule references with section numbers as secondary navigation aids, for example `Change Safety Protocol (§5)`.

---

## 🚀 Quick Start

### To Use These Rules in a New Project

```cmd
"c:\Users\lmtzg\OneDrive\Desktop\AI Rules\setup-ai-rules.bat" "C:\Path\To\YourProject"
```

See **`SETUP-GUIDE.md`** for complete instructions.

---

## 🔄 Version History

- **Apr 14, 2026**: Added packaged ethics-safety starter templates for `bias_detector.py`, `moderator.py`, chat-service moderation middleware, and companion tests; expanded setup guidance for when to enable each ethics config flag

- **Apr 14, 2026**: Added concrete ethics-framework guidance for advanced bias detection, multi-layer moderation, real-time chat response screening, moderation fallbacks, and safety observability across the rule set

- **Mar 31, 2026**: Added provider-agnostic semantic retrieval guidance, optional Luna-aware config schema support, and companion RAG usage notes across the docs

- **Mar 23, 2026**: Added strict .NET and Go automation templates and expanded the packaged testing starters for Testing Requirements (§6)
- **Mar 23, 2026**: Added strict Jest and Pytest automation templates so teams can enforce Testing Requirements (§6) with packaged starter workflows and validators
- **Mar 23, 2026**: Clarified cross-reference maintenance by adopting named-rule-first references across `rules.md`, `RULES-QUICKREF.md`, `.github/copilot-instructions.md`, and `GLOSSARY.md`

- **Mar 20, 2026**: Added GitHub Actions and pre-commit templates, introduced glossary and observability guides, expanded the runtime/logging baseline, and synced terminology across docs and config
- **Mar 20, 2026**: Repaired setup assets, added missing config presets and VS Code task templates, rebuilt `SETUP-GUIDE.md`, and aligned PR checklists with token-efficiency guidance
- **Mar 20, 2026**: Integrated `ModularizeCode.md` into the core refactoring workflow, quick reference, decision guide, and Copilot enforcement instructions
- **Nov 13, 2025**: Added UI Development Guidelines (§18) using Assistant Coach UI Setup as baseline; expanded rules with Security (§19), Accessibility (§20), Performance (§21), Error Handling (§22), CI/CD (§23), and Ethics (§24)
- **Nov 11, 2025**: Added Refactoring & Code Quality Standards (§13); renumbered subsequent sections
- **Nov 8, 2025**: Added UI/UX Documentation Standards (now §14) for module versioning and release notes
- **Oct 24, 2025**: Added Task Start Protocol (§0.5), created quick reference, Copilot instructions, and VS Code tasks
- **Earlier**: Initial ruleset creation (archived as rules-v1.md.archive)

---

**Maintained by**: Metzger
**Version**: 1.10.0
**Last Updated**: April 14, 2026
