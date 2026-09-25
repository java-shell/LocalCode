# LocalCode LLM IDE (Standalone)

LocalCode is a standalone desktop platform built with Electron.
It is not a VS Code extension.

## What You Get

- Bottom Model Terminal panel that streams live stdout/stderr while model tools run shell commands.
- Monaco-based code editor with tab management and dirty-state tracking.
- Chat panel with streaming responses, tool calling, and TurboVec memory integration.
- Simple and Advanced orchestration for multi-step AI workflows.
- Toast notifications with audio alerts for completion and errors.

## Feature Reference

### Chat Panel

| Feature | Description |
| --- | --- |
| **Streaming Responses** | Token-by-token display of model output in markdown |
| **Tool Calling** | 23+ tools available (filesystem, git, web, memory, interaction, delegation, MCP introspection) |
| **Session Management** | Create, switch, and delete chat sessions with full history |
| **TurboVec Memory** | Inject recalled memories from workspace or global namespaces |
| **Context Windows** | Per-model context window configuration with auto-detection hints; overflow retries compact history to the configured safe budget |
| **Stop Behavior** | User-requested stops are reported as a stopped chat rather than a failed connection, even when the provider closes the stream |
| **Model Discovery** | Auto-discover available models via `/v1/models` endpoint |
| **Ollama Thinking** | Display native thinking separately; if a thinking response ends without final content, automatically request one concise Markdown summary with thinking and tools disabled, normalizing JSON-only replies for readability |
| **Sub-Agent Model Settings** | Configure multiple sub-agent profiles (provider/endpoint/model/API key) with per-profile max concurrent spawn limits and optional parallel `spawn_sub_agent` fan-out |
| **MCP Server Settings** | Add/remove MCP servers in Settings and enable each server for chat, orchestration, or both; persisted in app user data |
| **MCP Runtime Lifecycle** | Refresh/connect MCP servers from Settings, view per-server health/lifecycle status, discovered tool count, and last runtime error |
| **Prompt Policy Version** | Switch between `v1` legacy system-prompt assembly and `v2` revised policy sections without removing the fallback path |
| **Presets** | Quick-apply common configurations (Ollama, OpenAI-compatible, etc.) |

### Orchestration Panel (Simple)

| Feature | Description |
| --- | --- |
| **Linear Workflows** | Sequential multi-step plans with independent model settings per step |
| **Per-Step Tools** | Configure tool allowlists for each step independently |
| **Pass-Through Output** | Chain step outputs as context for subsequent steps |
| **Loop Mode** | Repeat execution until a completion marker is detected |
| **Presets** | Import pre-built workflow templates (Full Pipeline, Quick Fix, Code Review) |

### Advanced Orchestration

| Feature | Description |
| --- | --- |
| **Graph Editor** | Visual stage editor with drag-and-drop positioning |
| **Conditional Links** | Route between stages based on `always`, `success`, `error`, or `error:<pattern>` |
| **Downstream Routing** | Stages can call `route_to_stage` to jump to specific downstream stages |
| **Stage Execution Limits** | Cap total stage executions to prevent infinite loops |
| **Completion Markers** | Auto-terminate when output contains the configured marker string |

### Editor

| Feature | Description |
| --- | --- |
| **Monaco Editor** | Full VS Code editor experience with syntax highlighting |
| **Tab Management** | Multiple open files with dirty-state tracking |
| **File Tree Explorer** | Browse workspace files with expandable directory tree |
| **Disk Change Detection** | Detect and prompt on external file modifications |
| **Markdown Preview** | Toggle rendered markdown view for `.md` files |

### Model Terminal

| Feature | Description |
| --- | --- |
| **Live Output** | Real-time stdout/stderr streaming from tool-invoked commands |
| **Interactive Input** | Send stdin to running processes |
| **Process Interrupt** | Kill active processes with `(ctrl+c)` |
| **Clear Output** | Reset terminal buffer |

### Toast Notifications

| Event | Notification | Sound |
| --- | --- | --- |
| Chat complete | ✅ Success toast + "Ding" | Pleasant chime |
| Orchestration complete | ✅ Success toast + "Ding" | Pleasant chime |
| Error (non-cancelled) | ❌ Error toast + "Buzz" | Subtle buzz |
| Model asks question | ℹ️ Info toast + "Blip" | Soft blip |

### External Notifications (ntfy)

Optional outbound notifications published from the main process, so they arrive even when
this window is minimized or hidden.

| Event | Notification |
| --- | --- |
| Chat complete | `chat.completed` (priority 3) |
| Model asks question | `chat.input_needed` (priority 4) |
| Error (non-cancelled) | `chat.error` (priority 4) |
| Orchestration complete | `orchestration.completed` (priority 3) |

Configure under **Settings → External Notifications (ntfy)**. Model output is excluded
unless **Include a response excerpt** is enabled. Full guide: [NTFY.md](../NTFY.md).

### TurboVec Memory

The Diagnostics tab supports managing vector memory namespaces:

- **Export Namespace**: Save as `*.turbovec-namespace.json`
- **Import Namespace**: Restore from archive with optional overwrite
- **Clear Namespace**: Remove all records
- **Lock/Unlock**: Prevent accidental modifications

## Presets

### Chat Presets

Access from the **Chat Settings** panel → **Quick Preset** dropdown:

| Preset | Provider | Endpoint | Model | Context |
| --- | --- | --- | --- | --- |
| 🏠 Local Ollama (Coding) | ollama | `localhost:11434` | llama3 | 8K |
| 🏠 Local Ollama (32K) | ollama | `localhost:11434` | llama3.1 | 32K |
| 🌐 OpenAI-Compatible | openai-compatible | `localhost:1234` | (custom) | Auto |
| 📖 Read-Only Assistant | ollama | `localhost:11434` | llama3 | 8K |

### Orchestration Plan Presets

Access from the **Orchestration** tab → **Import Preset** button:

| Preset | Stages | Description |
| --- | --- | --- |
| Full Coding Pipeline | 5 | Context Scan → Planner → Implementer → Validator → Reviewer |
| Quick Fix | 2 | Analyze → Implement (minimal steps) |
| Code Review | 3 | Scan → Review → Suggestions |

## Run

1. Install dependencies.
2. Build TypeScript.
3. Start Electron.

Commands:

- `npm install`
- `npm run build`
- `npm start`

For a one-shot dev run:

- `npm run dev`

You can also launch from VS Code debugger with [launch.json](.vscode/launch.json).

## OpenAI-Compatible Endpoint

In the Chat tab, set:

- Endpoint, for example: `http://localhost:11434/v1/chat/completions`
- Model, for example: `llama3`
- API key only when required by your endpoint

Or use a **Quick Preset** from the Chat Settings panel to auto-configure.

## Orchestration Plan

The orchestration tab stores a JSON plan in Electron user data and supports:

- Load
- Validate
- Save
- Run
- Import (from file or preset)
- Export (to JSON file)

Each step can enable these tools:

- `list_dir`, `file_search`, `read_file`, `create_file`, `write_file`
- `replace_in_file`, `insert_in_file`, `create_directory`, `move_path`, `delete_path`
- `grep_search`, `git_status`, `git_diff`, `git_add`, `git_commit`
- `run_terminal_command`, `browser_fetch`, `web_search`
- `list_namespaces`, `query_memory`, `query_user`, `spawn_sub_agent`, `list_mcp_servers`
- plus dynamically discovered MCP tools namespaced as `mcp_<serverId>__<toolName>` when a server is connected

Tool execution is restricted to workspace paths and only to tools enabled on that step.

Tool calls also support `scope`:

- `workspace` (default): selected top-level workspace directory
- `root`: LocalCode app root directory

Line-oriented file tools use 1-based numbering consistently:

- `read_file` accepts optional `startLine` / `endLine` and returns `numberedContent` plus `totalLines`
- `insert_in_file` inserts **before** the specified 1-based `line`
- use `line = totalLines + 1` to append at the end of a file

## Project Layout

- [src/main.ts](src/main.ts) Electron window + IPC handlers
- [src/preload.ts](src/preload.ts) Safe renderer API bridge
- [src/backend/llmClient.ts](src/backend/llmClient.ts) Streaming + tool-call chat client
- [src/backend/orchestrationEngine.ts](src/backend/orchestrationEngine.ts) Step runner
- [src/backend/toolRuntime.ts](src/backend/toolRuntime.ts) Local tool implementations
- [src/backend/schema.ts](src/backend/schema.ts) Plan schema, validation, and presets
- [src/backend/notify.ts](src/backend/notify.ts) Outbound ntfy notifications
- [renderer/index.html](renderer/index.html) Desktop UI shell
- [renderer/app.js](renderer/app.js) UI logic + Monaco wiring

## License

MIT
