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
| [namespace_creator](namespace_creator) | TurboVec namespace ingest CLI |
| [.ai-rules](.ai-rules) | Workspace guidance consumed by AI assistants |
| [markdown-reference](markdown-reference) | Long-form design, remediation, and operations notes |
| [NEXT.md](NEXT.md) | Review findings and prioritized next steps |

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
- Adjust max tool turns, bounded from `1` to `1000`.

### Orchestration Workflows

- Build multi-step plans with independent model settings per step.
- Configure per-step tool allowlists and pass-through output chaining.
- Load, validate, save, and run plans.
- Inspect event streams and step output.

### Model Terminal

- View live terminal output for tool-invoked shell commands.
- Send stdin to the active process.
- Interrupt the active process from the terminal input with `(ctrl+c)`.

### External Notifications (ntfy)

Optional outbound notifications, sent from the Electron main process so they arrive even
when the window is minimized. No account, no API key, and no new dependencies.

| Event | When it fires |
| --- | --- |
| `chat.completed` | A chat prompt finished successfully |
| `chat.input_needed` | The model called `query_user` and is waiting for you |
| `chat.error` | A chat or orchestration run failed |
| `orchestration.completed` | An orchestration run finished |

Enable it under **Settings → External Notifications (ntfy)** and click **Send Test
Notification** to verify delivery. Model output is never included unless you explicitly
opt in. See [markdown-reference/NTFY.md](markdown-reference/NTFY.md) for setup, privacy notes, and
troubleshooting.

## Runtime Tools

The tool runtime supports scoped operations — `workspace`, `root` or a reference workspace
(`ref:<id>`) — with guardrails.

| Category | Tools | Description |
| --- | --- | --- |
| **Read** | `list_dir`, `file_search`, `read_file`, `grep_search`, `git_status`, `git_diff` | Inspect files and repository state without modifications |
| **Mutation** | `create_file`, `write_file`, `replace_in_file`, `insert_in_file`, `create_directory`, `move_path`, `delete_path` | Create, edit, move, or delete files and directories |
| **Git + Command** | `git_add`, `git_commit`, `run_terminal_command` | Stage/commit changes and execute shell commands |
| **Web** | `browser_fetch`, `web_search` | Fetch web pages and search the internet |
| **Memory** | `list_namespaces`, `query_memory` | Interact with TurboVec memory store |
| **Interaction** | `query_user` | Ask the user questions (text, yes/no, checkboxes) |

### Tool Scope Behavior

- **`workspace`** (default): Operations are restricted to the selected workspace directory
- **`root`**: Operations target the LocalCode application root directory
- **`ref:<id>`**: Operations target a reference workspace added in Settings
- All paths are resolved relative to their scope; paths that escape the scope are rejected

### Mutation Safety

- Mutating tools are restricted to the selected scope.
- Mutations that leave the selected workspace directory trigger an approval dialog.
- Reference workspace scopes are gated by their own access flag, not by the
  outside-workspace dialog: a reference marked read/write is written without prompting, and a
  read-only reference triggers a single "Approve Write To Read-Only Reference Workspace" prompt.
- `delete_path` and destructive commands require explicit tool enablement per step.

### query_user Tool

Models can pause execution and ask you questions using the `query_user` tool:

- **Text input**: Free-form text response
- **Yes/No**: Binary confirmation prompts
- **Checkboxes**: Multi-select option lists

When a model calls `query_user`, an info toast notification appears with a "blip" sound, and a dialog is rendered in the chat panel for your response.

### Tool Calling Flow

1. Model receives user prompt + system context (memory, .ai-rules)
2. Model decides to call tools based on available permissions
3. Each tool executes locally; results are streamed to the model
4. Model can make up to `maxToolTurns` rounds of tool calls (chat default: 250, max: 1000)
5. Final response is streamed back to the chat panel

## TurboVec Memory

TurboVec provides a local vector memory store for persistent context recall across sessions.

### How It Works

- **Embedding**: Code snippets, documentation, and conversation history are embedded into vector indices
- **Recall**: On each chat or orchestration request, relevant memories are retrieved and injected as system context
- **Namespaces**: Memory is organized into named namespaces for isolation

### Namespace Types

| Type | Scope | Use Case |
| --- | --- | --- |
| **Workspace** | Tied to current workspace directory | Project-specific knowledge (code patterns, conventions) |
| **Global** | Shared across all workspaces | General coding preferences, personal rules |

### Managing Namespaces (Diagnostics Tab)

- **List**: View all namespaces with record counts and lock status
- **Export**: Save a namespace as `*.turbovec-namespace.json` for backup or sharing
- **Import**: Restore a namespace from an exported archive
- **Clear**: Remove all records from a namespace
- **Lock/Unlock**: Prevent accidental modifications to important namespaces

### Memory Injection Order

1. Step system prompt (orchestration) or base system prompt (chat)
2. TurboVec recalled memories (global + workspace namespaces)
3. `.ai-rules` workspace guidance (if present)
4. User prompt

## Advanced Orchestration

Beyond simple linear workflows, LocalCode supports graph-based orchestration with conditional branching.

### Key Concepts

| Concept | Description |
| --- | --- |
| **Stages** | Independent execution nodes, each with their own model, tools, and system prompt |
| **Links** | Directed edges between stages defining flow paths |
| **Conditions** | `always`, `success`, `error`, or `error:<pattern>` — control when a link activates |
| **Entry Stage** | The starting point of the graph execution |
| **Downstream Routing** | Stages can call `route_to_stage` to jump to specific downstream stages |

### Workflow Patterns

- **Linear Pipeline**: Sequential stages (Planner → Coder → Validator)
- **Branching**: Conditional paths based on success/error outcomes
- **Loop-until-complete**: Repeat execution until a completion marker is detected
- **Supervisor Pattern**: A coordinator stage delegates to specialist sub-stages

### Completion Markers

When `loopUntilComplete` is enabled, the engine checks each stage's output for the configured `completionMarker` string (default: `TASK_COMPLETE`). When found, the loop terminates.

## .ai-rules Workspace Guidance

Create a `.ai-rules/` folder in your workspace to provide automatic guidance to models.

### How It Works

1. Place `.md` files inside `.ai-rules/` at your workspace root
2. On every chat or orchestration request, LocalCode reads the `.md` files in that folder
   (`README.md` and `RULES-QUICKREF.md` first, then alphabetical). Nested folders are not read.
3. Each file is capped at 4000 characters and the combined block at 8000 characters, so one large
   rules file cannot crowd out the overview files
4. Content is concatenated under `## .ai-rules/<file>` headers and injected as system context
   **before** the user prompt — in chat, in every orchestration stage, and in spawned sub-agents
5. The read happens once per request (and once per orchestration run), then is reused by stages
   and sub-agents instead of being re-read
6. The event log shows `[ai-rules] injected workspace guidance.` when rules were loaded
7. If the folder doesn't exist, or has no readable Markdown, this step is silently skipped

### Example Structure

```
my-project/
├── .ai-rules/
│   ├── README.md          # General project overview
│   ├── coding-style.md    # Style conventions
│   ├── testing.md         # Testing requirements
│   └── architecture.md    # Architecture decisions
├── src/
└── package.json
```

### Best Practices

- Keep rules concise — every character counts against the context window
- Use `README.md` for high-level project overview (read first)
- Separate concerns into focused files (style, testing, architecture)
- Rules are injected as system messages, which most LLMs prioritize highly

## Presets

LocalCode includes quick-start presets for common configurations. Access them from the **Settings** panel or the **Chat Settings** dropdown.

### Chat Presets

| Preset | Description |
| --- | --- |
| 🏠 Local Ollama (Coding) | Default local setup with Llama 3 and full tool access |
| 🏠 Local Ollama (32K Context) | Extended context window for larger codebases |
| 🌐 OpenAI-Compatible | Template for LM Studio, vLLM, or other compatible APIs |
| 📖 Read-Only Assistant | Lightweight setup with read-only tools and low timeout |

### Orchestration Plan Presets

Pre-built workflow templates available via the **Import Preset** button in the Orchestration tab:

| Preset | Description |
| --- | --- |
| Full Coding Pipeline | 5-stage pipeline: Context Scan → Planner → Implementer → Validator → Reviewer |
| Quick Fix | 2-stage pipeline: Analyze → Implement (fast, minimal steps) |
| Code Review | 3-stage pipeline: Scan → Review → Suggestions |

## LLM Endpoint Configuration

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

## External Notifications

Optional push notifications to [ntfy](https://ntfy.sh) on chat completion, model
questions, errors, and orchestration completion.

```
Settings → External Notifications (ntfy) → Topic → Send Test Notification
```

| Field | Example |
| --- | --- |
| Topic | `my-localcode-alerts` |
| Server | `https://ntfy.sh` |
| Repeat suppression | `15` seconds |
| Include response excerpt | Off (off keeps model output on this machine) |

Full setup, event semantics, privacy guarantees, self-hosting, and troubleshooting are in
[markdown-reference/NTFY.md](markdown-reference/NTFY.md).

## Default Orchestration Plan

The default workflow is a two-step pipeline:

1. **Planner** analyzes the request and gathers context with safe/read tools.
2. **Coder** performs implementation-oriented actions with broader file tools.

Schema validation is implemented in [llm-ide/src/backend/schema.ts](llm-ide/src/backend/schema.ts).

## Security + Isolation

- Electron renderer runs with `contextIsolation: true` and `nodeIntegration: false`.
- Renderer access to system APIs is routed through whitelisted preload bridge methods.
- Path resolution enforces scope boundaries for filesystem operations.
- Outbound notifications are configured only by the user and are never exposed as a
  model-callable tool, so a prompt-injected model cannot retarget them. The ntfy topic is
  treated as a secret and redacted from logs. See [markdown-reference/NTFY.md](markdown-reference/NTFY.md).

## Build Artifacts + Ignored Paths

The root [.gitignore](.gitignore) excludes generated and dependency-heavy directories, including:

- `llm-ide/node_modules/`
- `llm-ide/out/`
- `llm-ide/dist/` — packaged installers (`AppImage`, `nsis`, `zip`) and `*-unpacked/` trees are
  build output, not source. Earlier releases committed them through Git LFS (~2.6 GB); publish each
  build as a GitHub Release asset instead. See [NEXT.md](NEXT.md).

## Troubleshooting

| Issue | Checks |
| --- | --- |
| App does not launch | Ensure dependencies are installed in [llm-ide](llm-ide), then rebuild with `cd llm-ide && npm run build`. |
| No models appear in dropdown | Verify the endpoint is reachable, exposes `/v1/models`, and has any required API key configured. |
| Tool execution appears stalled | Inspect Model Terminal output, send required interactive input, or use `(ctrl+c)` to interrupt. |
| ntfy notifications do not arrive | Re-run **Settings → Send Test Notification** and compare the topic name on the subscribing device. See [markdown-reference/NTFY.md](markdown-reference/NTFY.md#troubleshooting). |

## Development Notes

- Current repository root contains this metadata README and the app folder [llm-ide](llm-ide).
- If you plan to add more packages, consider introducing a workspace manager and a top-level `package.json`.
