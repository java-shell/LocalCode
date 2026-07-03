# AI Rules Setup Guide

Use this guide to install the AI Rules package into another project with the included setup script.

## What the Setup Script Does

Running `setup-ai-rules.bat` copies the current rule package into a target project:

- `.ai-rules/rules.md`
- `.ai-rules/RULES-QUICKREF.md`
- `.ai-rules/README.md`
- `.ai-rules/refactoring.md`
- `.ai-rules/ModularizeCode.md`
- `.ai-rules/RULES-TIERS.md`
- `.ai-rules/Reference.md`
- `.ai-rules/rules-changelog.md`
- `.ai-rules/GLOSSARY.md`
- `.ai-rules/LOGGING-OBSERVABILITY.md`
- `.ai-rules/token-optimization.md`
- `.ai-rules/UI-Setup-Instructions.md`
- `.ai-rules/How_to_use_versioning_badge.md`
- `.ai-rules/ai-rules-config.example.json`
- `.ai-rules/ai-rules-config.prototype.json`
- `.ai-rules/ai-rules-config.schema.json`
- `.ai-rules/templates/github-actions/ai-rules-checks.yml`
- `.ai-rules/templates/github-actions/jest-testing-enforcement.yml`
- `.ai-rules/templates/github-actions/pytest-testing-enforcement.yml`
- `.ai-rules/templates/github-actions/dotnet-testing-enforcement.yml`
- `.ai-rules/templates/github-actions/go-testing-enforcement.yml`
- `.ai-rules/templates/pre-commit/pre-commit.sample`
- `.ai-rules/templates/pre-commit/validate-ai-rules.ps1`
- `.ai-rules/templates/pre-commit/validate-jest-tests.ps1`
- `.ai-rules/templates/pre-commit/validate-pytest-tests.ps1`
- `.ai-rules/templates/pre-commit/validate-dotnet-tests.ps1`
- `.ai-rules/templates/pre-commit/validate-go-tests.ps1`
- `.ai-rules/templates/ethics-safety/bias_detector.py`
- `.ai-rules/templates/ethics-safety/moderator.py`
- `.ai-rules/templates/ethics-safety/chat_service_middleware.py`
- `.ai-rules/templates/ethics-safety/README.md`
- `.ai-rules/templates/ethics-safety/tests/test_bias_detector.py`
- `.ai-rules/templates/ethics-safety/tests/test_moderator.py`
- `.ai-rules/templates/ethics-safety/tests/test_chat_service_middleware.py`
- `.github/copilot-instructions.md`
- `.vscode/tasks.json`

## Prerequisites

- Windows with `cmd.exe` available
- A destination project folder you want to equip with the rules package
- VS Code if you want to use the copied task helpers and Copilot instructions

## Quick Start

From a command prompt, run:

```cmd
"c:\Users\lmtzg\OneDrive\Desktop\AI Rules\setup-ai-rules.bat" "C:\Path\To\YourProject"
```

If you run the script with no argument, it installs into the current directory.

## Target Project Layout After Setup

```text
your-project/
|-- .ai-rules/
|   |-- rules.md
|   |-- RULES-QUICKREF.md
|   |-- README.md
|   |-- refactoring.md
|   |-- ModularizeCode.md
|   |-- RULES-TIERS.md
|   |-- Reference.md
|   |-- rules-changelog.md
|   |-- GLOSSARY.md
|   |-- LOGGING-OBSERVABILITY.md
|   |-- token-optimization.md
|   |-- UI-Setup-Instructions.md
|   |-- How_to_use_versioning_badge.md
|   |-- ai-rules-config.example.json
|   |-- ai-rules-config.prototype.json
|   |-- ai-rules-config.schema.json
|   `-- templates/
|       |-- github-actions/
|       |   |-- ai-rules-checks.yml
|       |   |-- jest-testing-enforcement.yml
|       |   |-- pytest-testing-enforcement.yml
|       |   |-- dotnet-testing-enforcement.yml
|       |   `-- go-testing-enforcement.yml
|       `-- pre-commit/
|           |-- pre-commit.sample
|           |-- validate-ai-rules.ps1
|           |-- validate-jest-tests.ps1
|           |-- validate-pytest-tests.ps1
|           |-- validate-dotnet-tests.ps1
|           `-- validate-go-tests.ps1
|       `-- ethics-safety/
|           |-- bias_detector.py
|           |-- moderator.py
|           |-- chat_service_middleware.py
|           |-- README.md
|           `-- tests/
|               |-- test_bias_detector.py
|               |-- test_moderator.py
|               `-- test_chat_service_middleware.py
|-- .github/
|   `-- copilot-instructions.md
`-- .vscode/
    `-- tasks.json
```

## Recommended First Steps After Setup

1. Open the target project in VS Code.
2. Review `.ai-rules/README.md` to understand the file hierarchy.
3. Choose a config starting point:
   - `ai-rules-config.example.json` for standard enforcement
   - `ai-rules-config.prototype.json` for faster prototype work
4. Confirm `.github/copilot-instructions.md` matches how you want Copilot to behave.
5. Run one of the copied VS Code tasks to verify the setup:
   - `AI: Show Rules Checklist`
   - `AI: Show Full Rules`
   - `AI: Open Rules in Editor`

## Configuration Files

### Standard Template

Use `.ai-rules/ai-rules-config.example.json` when you want the default production-oriented rules profile.

### Prototype Template

Use `.ai-rules/ai-rules-config.prototype.json` when you want lighter enforcement for fast iteration. This preset relaxes testing, TODO tracking, and backward-compatibility enforcement while keeping token optimization enabled.

### Schema Validation

Use `.ai-rules/ai-rules-config.schema.json` to validate custom configurations.

### Semantic Retrieval and Luna Setup

Enable semantic retrieval only when the target project is large enough that keyword search alone stops being reliable. Good candidates include repositories with large documentation sets, concept-heavy domain language, or multiple modules that reuse the same ideas with different terms.

Keep the feature optional in project config. Start with retrieval disabled for small or early-stage projects, then enable it once simple string search begins missing relevant context or causing repeated broad reads.

If you enable semantic retrieval:

- Pick a provider through the config rather than hard-coding one into local prompts or scripts.
- Set clear fallback behavior so keyword search still works when the retrieval service is unavailable or low-confidence.
- Document privacy and security constraints before indexing proprietary code or documents.
- Record a simple quality benchmark, such as a small set of representative queries and the expected top results.

If the project chooses Luna, fill out the Luna-specific config fields and document why Luna is the right fit for the repository. Capture the retrieval rationale, indexing scope, cost and latency expectations, benchmark queries, and fallback-to-keyword behavior in the project docs or ADRs.

Use the packaged presets as starting points:

- `ai-rules-config.prototype.json` keeps semantic retrieval disabled by default.
- `ai-rules-config.example.json` shows a Luna-enabled configuration that you can adapt for larger production-oriented repositories.

Validate the final config against `.ai-rules/ai-rules-config.schema.json` before relying on the new settings in automation or local tooling.

### Ethics Safety Setup

Start with the ethics flags enabled when the target project produces user-visible AI output, automated decisions, rankings, summaries, moderation actions, or any workflow that can amplify bias or expose sensitive information. For internal tools that never surface model output outside a trusted team, you can keep the defaults but phase adoption in by risk.

Use these heuristics for the ethics keys in `.ai-rules/ai-rules-config.example.json` and `.ai-rules/ai-rules-config.prototype.json`:

- `bias_detection`: Keep this enabled for any AI-assisted feature that influences wording, recommendations, prioritization, or automated decisions.
- `advanced_bias_detection`: Enable when the system touches protected classes, public audiences, HR-style workflows, search/ranking, or customer support responses at scale.
- `content_moderation`: Enable whenever the model can produce free-form text shown to users, stored in transcripts, or sent to external channels.
- `protected_attributes`: Leave the full list in place unless a documented scope decision proves some categories are genuinely out of scope.
- `fairness_metrics`: Measure both metrics when the system approves, denies, ranks, routes, or scores items. If the feature is pure text generation with no binary or ranking outcome, document why metric collection is not applicable.
- `review_threshold`: Keep `medium` for production systems so ambiguous misinformation, privacy, or bias findings are routed to review before display.
- `block_threshold`: Keep `critical` when you want explicit blocking only for severe harm. Lower it to `high` for regulated or customer-facing deployments with low risk tolerance.
- `context_aware_allowances`: Keep enabled for technical, security, debugging, or safety-oriented products where words like `attack`, `kill`, or `exploit` can appear in legitimate contexts.
- `fallback_responses`: Enable whenever blocked responses must degrade gracefully instead of failing silently or echoing unsafe content.
- `moderation_logging`: Enable in any environment where operators need an audit trail of why content was allowed, reviewed, or blocked.
- `processing_time_tracking`: Enable when the feature has latency objectives or service-level targets so safety checks stay visible in performance budgets.

If you need implementation starters, copy the files from `.ai-rules/templates/ethics-safety/` into the target application's source tree and adapt the thresholds, regexes, log fields, and review workflow before production use.

## Automation Templates

The setup package includes optional automation templates under `.ai-rules/templates/`.

### GitHub Actions

Copy `.ai-rules/templates/github-actions/ai-rules-checks.yml` into `.github/workflows/` and adapt the commands to your project's actual test and lint toolchain.

For stricter stack-specific enforcement, start from `.ai-rules/templates/github-actions/jest-testing-enforcement.yml` for JavaScript/TypeScript projects using Jest-style scripts, `.ai-rules/templates/github-actions/pytest-testing-enforcement.yml` for Python projects using Pytest and the `tests/unit` plus `tests/integration` layout, `.ai-rules/templates/github-actions/dotnet-testing-enforcement.yml` for .NET solutions using `dotnet test`, or `.ai-rules/templates/github-actions/go-testing-enforcement.yml` for Go modules using `go test`.

### Pre-commit Hook

Copy `.ai-rules/templates/pre-commit/pre-commit.sample` into `.git/hooks/pre-commit` and make it executable in environments that support Unix-style hooks. The sample hook calls `.ai-rules/templates/pre-commit/validate-ai-rules.ps1` for the actual checks.

If you want stricter local test-structure validation, call `.ai-rules/templates/pre-commit/validate-jest-tests.ps1`, `.ai-rules/templates/pre-commit/validate-pytest-tests.ps1`, `.ai-rules/templates/pre-commit/validate-dotnet-tests.ps1`, or `.ai-rules/templates/pre-commit/validate-go-tests.ps1` from your own hook or pre-push workflow.

These templates are intentionally staged under `.ai-rules/templates/` rather than installed live into workflows or hooks, so they cannot silently alter an existing project's automation.

### Ethics Safety Starters

The setup package also includes starter implementations under `.ai-rules/templates/ethics-safety/`.

- `bias_detector.py` provides protected-attribute coverage, pattern scanning, severity scoring, fairness metrics, and mitigation recommendations.
- `moderator.py` layers harmful-content, misinformation, privacy, and bias checks into a single moderation decision.
- `chat_service_middleware.py` shows how to moderate every AI response before display, emit safe fallbacks, and log timing/decision telemetry.
- `tests/` contains unit-style examples that teams can adapt into their own CI pipeline.

Treat these as source templates, not drop-in production code. Copy them into the application, connect them to your real data model and review workflow, and calibrate thresholds with representative prompts before release.

## VS Code Tasks

The copied `.vscode/tasks.json` provides helper tasks to display the rules files inside the integrated terminal.

The `AI: Open Rules in Editor` task uses the VS Code `code` CLI if it is available on `PATH`. If it is not installed, open the rule files manually from the Explorer.

## Troubleshooting

### The script says setup completed, but some files are missing

- Verify the source AI Rules folder contains the latest packaged files.
- Re-run the script after pulling the latest changes.
- Check whether the target folder is writable.

### VS Code tasks do not open files

- The display tasks should still work because they only read files.
- If the open task fails, install the `code` CLI from VS Code or open the markdown files manually.

### Copilot does not appear to follow the rules

- Confirm `.github/copilot-instructions.md` exists in the target project.
- Verify the target repo is opened at the project root in VS Code.
- Keep `.ai-rules/rules.md` and `.ai-rules/RULES-QUICKREF.md` in sync with local changes.

## Maintenance Guidance

- Update `rules.md` first, then sync derivative files like `RULES-QUICKREF.md`, `.github/copilot-instructions.md`, and this guide.
- Record rule package changes in `rules-changelog.md`.
- If you add setup assets, update both `setup-ai-rules.bat` and this guide together.
- Keep `GLOSSARY.md` aligned with config descriptions and prose terminology in the other docs.

## Related Files

- `README.md`
- `rules.md`
- `RULES-QUICKREF.md`
- `rules-changelog.md`
- `setup-ai-rules.bat`
