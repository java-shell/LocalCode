# LocalCode LLM IDE (Standalone)

LocalCode is a standalone desktop platform built with Electron.
It is not a VS Code extension.

## What You Get

- Bottom Model Terminal panel that streams live stdout/stderr while model tools run shell commands.

## Run

1. Install dependencies.
2. Build TypeScript.
3. Start Electron.

Commands:

- npm install
- npm run build
- npm start

For a one-shot dev run:

- npm run dev

You can also launch from VS Code debugger with [launch.json](.vscode/launch.json).

## OpenAI-Compatible Endpoint

In the Chat tab, set:

- Endpoint, for example: http://localhost:11434/v1/chat/completions
- Model, for example: llama3
- API key only when required by your endpoint

## Orchestration Plan

The orchestration tab stores a JSON plan in Electron user data and supports:

- Load
- Validate
- Save
- Run

Each step can enable these tools:

- list_dir
- file_search
- read_file
- create_file
- write_file
- replace_in_file
- insert_in_file
- create_directory
- move_path
- delete_path
- grep_search
- git_status
- git_diff
- git_add
- git_commit
- run_terminal_command

Tool execution is restricted to workspace paths and only to tools enabled on that step.

Tool calls also support `scope`:

- `workspace` (default): selected top-level workspace directory
- `root`: LocalCode app root directory

## Project Layout

- [src/main.ts](src/main.ts) Electron window + IPC handlers
- [src/preload.ts](src/preload.ts) Safe renderer API bridge
- [src/backend/llmClient.ts](src/backend/llmClient.ts) Streaming + tool-call chat client
- [src/backend/orchestrationEngine.ts](src/backend/orchestrationEngine.ts) Step runner
- [src/backend/toolRuntime.ts](src/backend/toolRuntime.ts) Local tool implementations
- [renderer/index.html](renderer/index.html) Desktop UI shell
- [renderer/app.js](renderer/app.js) UI logic + Monaco wiring

## License

MIT
