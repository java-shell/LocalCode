# LocalCode

**LocalCode** is a desktop LLM coding environment built with Electron and TypeScript.

It brings an editor, chat, workflow runner, and live terminal output into one local-first workspace.

| Area | What It Provides |
| --- | --- |
| Editor | Monaco-based editing with tabs, dirty-state tracking, saves, and disk change detection |
| Chat | OpenAI-compatible chat completions, streaming output, model discovery, and tool controls |
| Workflows | Multi-step orchestration plans with per-step model settings and tool permissions |
| Terminal | Live stdout/stderr for tool-driven commands, stdin input, and interrupt support |

## Repository Layout

| Path | Purpose |
| --- | --- |
| [llm-ide](llm-ide) | Main desktop application |
| [llm-ide/src/main.ts](llm-ide/src/main.ts) | Electron main process, IPC handlers, and window lifecycle |
| [llm-ide/src/preload.ts](llm-ide/src/preload.ts) | Context-isolated bridge API exposed to the renderer |
| [llm-ide/src/backend](llm-ide/src/backend) | LLM client, orchestration engine, plan schema/storage, and tool runtime |
| [llm-ide/renderer](llm-ide/renderer) | HTML/CSS/JS UI for the editor, chat, orchestration, and terminal panel |

## Features

### Editor + Workspace

- Select and switch workspace folders from the UI.
- Browse files with a tree-view explorer.
- Open, edit, and save files with Monaco.
- Save the current file or all dirty tabs.
- Watch the filesystem for external disk changes.

### Chat with Tool Calling

- Connect to OpenAI-compatible `/v1/chat/completions` endpoints.
- Stream responses and model events into the chat output.
- Enable or disable model tool access by name.
- Adjust max tool turns, bounded from `1` to `200`.

### Orchestration Workflows

- Build multi-step plans with independent model settings per step.
- Configure per-step tool allowlists and pass-through output chaining.
- Load, validate, save, and run plans.
- Inspect event streams and step output.

### Model Terminal

- View live terminal output for tool-invoked shell commands.
- Send stdin to the active process.
- Interrupt the active process from the terminal input with `(ctrl+c)`.

## Runtime Tools

The tool runtime supports scoped operations, either `workspace` or `root`, with guardrails.

| Category | Tools |
| --- | --- |
| Read | `list_dir`, `file_search`, `read_file`, `grep_search`, `git_status`, `git_diff` |
| Mutation | `create_file`, `write_file`, `replace_in_file`, `insert_in_file`, `create_directory`, `move_path`, `delete_path` |
| Git + command | `git_add`, `git_commit`, `run_terminal_command` |

### Mutation Safety

- Mutating tools are restricted to the selected scope.
- Outside-workspace mutation requests trigger an approval dialog.

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | `18+` (`20` recommended) |
| npm | `9+` |
| OS | Linux, macOS, or Windows desktop environment |

## Quick Start

From the repository root:

```bash
cd llm-ide
npm install
npm run build
npm start
```

One-command dev cycle:

```bash
cd llm-ide
npm run dev
```

## npm Scripts

Defined in [llm-ide/package.json](llm-ide/package.json):

| Script | Description |
| --- | --- |
| `npm run build` | Compile TypeScript to [llm-ide/out](llm-ide/out) |
| `npm run watch` | Compile in watch mode |
| `npm run start` | Launch Electron using compiled output |
| `npm run dev` | Build, then launch Electron |

## LLM Endpoint Configuration

Configure the provider from the Chat tab.

| Field | Example |
| --- | --- |
| Endpoint | `http://localhost:11434/v1/chat/completions` |
| Model | `llama3` |
| API key | Optional unless your provider requires authentication |

Model discovery uses `GET /v1/models`, derived from the chat endpoint.

## Default Orchestration Plan

The default workflow is a two-step pipeline:

1. **Planner** analyzes the request and gathers context with safe/read tools.
2. **Coder** performs implementation-oriented actions with broader file tools.

Schema validation is implemented in [llm-ide/src/backend/schema.ts](llm-ide/src/backend/schema.ts).

## Security + Isolation

- Electron renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- Renderer access to system APIs is routed through whitelisted preload bridge methods.
- Path resolution enforces scope boundaries for filesystem operations.

## Build Artifacts + Ignored Paths

The root [.gitignore](.gitignore) excludes generated and dependency-heavy directories, including:

- `llm-ide/node_modules/`
- `llm-ide/out/`

## Troubleshooting

| Issue | Checks |
| --- | --- |
| App does not launch | Ensure dependencies are installed in [llm-ide](llm-ide), then rebuild with `cd llm-ide && npm run build`. |
| No models appear in dropdown | Verify the endpoint is reachable, exposes `/v1/models`, and has any required API key configured. |
| Tool execution appears stalled | Inspect Model Terminal output, send required interactive input, or use `(ctrl+c)` to interrupt. |

## Development Notes

- Current repository root contains this metadata README and the app folder [llm-ide](llm-ide).
- If you plan to add more packages, consider introducing a workspace manager and a top-level `package.json`.
