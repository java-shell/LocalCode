# LocalCode

LocalCode is a desktop LLM coding environment built with Electron + TypeScript.

The main application lives in the [llm-ide](llm-ide) folder and provides:

- A Monaco-based editor with tabbed files and autosync with disk changes.
- A chat panel connected to OpenAI-compatible APIs (including local endpoints).
- A workflow/orchestration runner with per-step tool permissions.
- A bottom terminal stream that shows live stdout/stderr from tool-driven commands.

## Repository Layout

- [llm-ide](llm-ide): Main desktop application.
- [llm-ide/src/main.ts](llm-ide/src/main.ts): Electron main process, IPC handlers, window lifecycle.
- [llm-ide/src/preload.ts](llm-ide/src/preload.ts): Context-isolated bridge API exposed to renderer.
- [llm-ide/src/backend](llm-ide/src/backend): LLM client, orchestration engine, plan schema/storage, tool runtime.
- [llm-ide/renderer](llm-ide/renderer): HTML/CSS/JS UI (Monaco editor, chat, orchestration, terminal panel).

## Features

### Editor + Workspace

- Select and switch workspace folders from the UI.
- Tree view file explorer.
- Open/edit/save files with Monaco.
- Save current file or save all dirty tabs.
- File watch support to detect and load external disk changes.

### Chat with Tool Calling

- Connect to OpenAI-compatible `/v1/chat/completions` endpoints.
- Stream responses and model events to chat output.
- Enable/disable model tool access by name.
- Adjustable max tool turns (bounded to 1..200).

### Orchestration Workflows

- Multi-step plans with independent model settings per step.
- Per-step tool allowlist and pass-through output chaining.
- Plan load/validate/save/run actions.
- Event stream + step output viewer.

### Model Terminal

- Live terminal output pane for tool-invoked shell commands.
- Send stdin input to active process.
- Interrupt active process from UI (`(ctrl+c)` shortcut in input).

## Available Tools in Runtime

The tool runtime supports scoped operations (`workspace` or `root`) with guardrails.

Read-oriented tools:

- `list_dir`
- `file_search`
- `read_file`
- `grep_search`
- `git_status`
- `git_diff`

Mutation-oriented tools:

- `create_file`
- `write_file`
- `replace_in_file`
- `insert_in_file`
- `create_directory`
- `move_path`
- `delete_path`

Git/command tools:

- `git_add`
- `git_commit`
- `run_terminal_command`

Mutation safety:

- Mutating tools are restricted to selected scope.
- Outside-workspace mutation requests trigger an approval dialog.

## Prerequisites

- Node.js 18+ (Node.js 20 recommended)
- npm 9+
- Linux, macOS, or Windows desktop environment

## Quick Start

From repository root:

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

- `npm run build`: Compile TypeScript to [llm-ide/out](llm-ide/out).
- `npm run watch`: Compile in watch mode.
- `npm run start`: Launch Electron using compiled output.
- `npm run dev`: Build then launch Electron.

## LLM Endpoint Configuration

In the Chat tab:

- Endpoint example: `http://localhost:11434/v1/chat/completions`
- Model example: `llama3`
- API key: optional unless your provider requires auth

Model discovery uses `GET /v1/models` (derived from the chat endpoint).

## Default Orchestration Plan

The default workflow is a 2-step pipeline:

1. Planner: analyzes request and gathers context with safe/read tools.
2. Coder: performs implementation-oriented actions with broader file tools.

Schema validation is implemented in [llm-ide/src/backend/schema.ts](llm-ide/src/backend/schema.ts).

## Security/Isolation Notes

- Electron renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- Renderer access to system APIs is only via whitelisted preload bridge methods.
- Path resolution enforces scope boundaries for filesystem operations.

## Build Artifacts and Ignored Paths

The root [.gitignore](.gitignore) excludes generated and dependency-heavy directories such as:

- `llm-ide/node_modules/`
- `llm-ide/out/`

## Troubleshooting

### App does not launch

- Ensure dependencies are installed in [llm-ide](llm-ide).
- Rebuild TypeScript: `cd llm-ide && npm run build`.

### No models appear in dropdown

- Verify endpoint is reachable.
- Confirm endpoint exposes `/v1/models`.
- Check API key requirements.

### Tool execution appears stalled

- Inspect Model Terminal output.
- Send required interactive input in terminal input field.
- Use `(ctrl+c)` in terminal input to interrupt.

## Development Notes

- Current repository root contains this metadata README and the app folder [llm-ide](llm-ide).
- If you plan to add more packages, consider introducing a workspace manager and a top-level `package.json`.
