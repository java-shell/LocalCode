# LocalCode LLM IDE (Standalone)

LocalCode is a standalone desktop platform built with Electron.
It is not a VS Code extension.

## Chat Side-Bar — feature v1.0.0 (2026-11-02)

While a chat task is running, click **Start Side-Bar** beside **Send** to pull
the assistant aside without stopping its work permanently:

1. The button changes to **Cancel Side-Bar** while the current model request
	and its entire tool batch finish. No tool operation is interrupted. If a
	`query_user` question is pending, answer it first so that tool can finish.
2. Once paused, use **Send Side-Bar** for one user message / one assistant
	reply at a time. Tools, MCP calls, and sub-agents cannot be invoked by these
	replies. Send and Resume are disabled while a reply is being generated.
3. Click **Resume Work** to continue the same task and remaining work-turn
	budget. All successful Side-Bar exchanges stay in its live context and are
	saved in chat history with Side-Bar labels. **Stop** still cancels the run.

Side-Bar messages do **not** consume work turns; their actual model requests
and tokens still contribute to usage totals. They see the current working
context: instructions, prior conversation, memory already injected, and tool
results. The model's existing context-window limits and compaction policies
still apply; this is not unlimited raw-history retention. The active provider
and model remain those of the running task.

Known limitations: Side-Bar is available only during an active Chat run, not
Orchestration or idle chat. Replies appear as complete messages (not partial
streams). Restarting the app restores saved exchanges, not the in-memory paused
execution; existing interrupted-run recovery applies. Failed replies retain the
draft and leave work paused. Session switching, creation, and deletion are locked
while a run owns the history. No new dependencies or settings migration are needed.

Design, risk assessment, test evidence, and the task ledger are recorded in
[CHAT_SIDEBAR.md](CHAT_SIDEBAR.md). Existing UI/theme conventions are retained
instead of introducing the Flask-based Assistant Coach scaffold into Electron.

## Startup and Dependency Change Notes — 2026-11-01

Working-tree fixes for version **1.0.1** (not yet packaged or committed):

- **Startup fix:** `npm start` now runs `npm run build` through npm's `prestart`
	lifecycle hook before launching Electron. The reported `onBrowserEvent` TypeError
	came from an older compiled preload missing the browser APIs already defined in
	TypeScript. Rebuilding the main/preload pair keeps it aligned with the renderer;
	no browser API, permission, or UI behavior was changed. Compile failures prevent launch.
- **Security fix:** upgraded `simple-git` from 3.36.0 to **4.0.2**, including
	`@simple-git/argv-parser` **2.0.1**, and migrated the internal import to the named
	`simpleGit` export required by v4. This resolves the critical Git command/configuration
	and editor-environment advisories. Existing Git tool inputs/results are unchanged;
	v4's stricter unsafe-option/environment filtering remains enabled. No unsafe opt-ins
	or dependency overrides were added. Existing lockfile security updates were retained.

### Audit Status and Remaining Risk

On 2026-11-01, `npm audit --omit=dev` reports **0 vulnerabilities**. The full audit
reports **15 moderate, 0 high, and 0 critical** findings, all propagated from
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in
Electron Builder's development-only `minimatch` dependency chains. This is a potential
CPU/memory denial of service from attacker-controlled glob patterns, not a clean full audit.

The installed Electron Builder **26.18.1** still depends on affected versions; even
**27.0.0-alpha.14** declares affected dependencies. The advisory lists **11.0.1** as
the first patched `minimatch`. A global override is not compatible with consumers such
as `dir-compare` that call the older function export. npm's proposed forced fix would
downgrade Electron Builder to **20.23.1**; that was rejected to preserve packaging.
`npm audit fix --dry-run` proposes no compatible changes.

Until compatible upstream fixes are available, build only reviewed/trusted source
and packaging configuration; do not pass untrusted glob patterns to the packaging
toolchain. Recheck the full audit before each release. The remaining development
findings are deferred, not suppressed or claimed fixed. Existing installers and
unpacked distribution artifacts were not regenerated and do not contain these fixes.

### Verification and TODO Ledger

Scope/risk: one startup lifecycle hook, one dependency major-version migration with
its required import adaptation, and isolated tests. No application API changes or new
dependencies. Git integration fixtures use disposable repositories, local test identity,
and disabled hooks/signing; the Electron fixture uses a hidden window and temporary
profile, without the real application, user data, workspace, or network content.

- [x] **AI-001:** Confirm stale compiled preload and reproduce the missing `prestart`
	safeguard test failure before applying the fix.
- [x] **AI-002:** Add `prestart`; retain/extend compiled bridge contract coverage and
	add an opt-in real context-isolated Electron bridge fixture.
- [x] **AI-003:** Apply the patched Git dependency/import; Git status, diff, staging,
	commit, tracked-tree enumeration, and non-repository compatibility tests pass.
- [x] **AI-004:** Build and editor diagnostics pass; focused tests **10/10 pass**, including
	real Electron IPC. Full suite: **205 passed, 6 failed, 2 skipped**. Remaining failures
	were present before these fixes: one renderer reference-workspace assertion, one
	Windows terminal-timeout assertion, and four TurboVec assertions with a broken Python
	environment (`failed to locate pyvenv.cfg`). Production audit is clean; diff whitespace
	checks pass. Completion references are these working-tree changes; no commit/PR exists.
- [ ] **AI-005 (deferred/upstream):** Resolve the 15 moderate packaging findings when
	compatible upstream patches exist; validate packaging before adoption.

The real Electron check is opt-in via `LOCALCODE_TEST_ELECTRON_BROWSER=1` when running
the test suite on a machine capable of launching Electron. The separate native-crash
fixture remains opt-in and was not needed for this change.

## Native Crash Diagnostics

### Patched Runtime and IPC Churn — 2026-10-31

Electron is pinned to **42.11.18**. The first fixed 42.x release is **42.11.2**:
[release notes](https://github.com/electron/electron/releases/tag/v42.11.2) explicitly
include [backport #53419](https://github.com/electron/electron/pull/53419), fixing
[IPC template exhaustion #53380](https://github.com/electron/electron/issues/53380).
Tagged source in both fixed releases packs frame IDs into a BigInt instead of
creating an ObjectTemplate per IPC event. The installed binary version was checked.

Set `LOCALCODE_IPC_CHURN=1` before launching to opt into measurement. The main process
writes aggregate channel totals, interval/average/peak rates, and runtime version to
its user-data debug directory in `ipc-churn.json`. Sampling is every 10 seconds, keeps
at most 60 windows and 128 channel buckets, and replaces the same file (private mode
0600 on Unix). Normal quit flushes; native crashes retain the last persisted sample.
No payloads, prompts, URLs, credentials, renderer IDs, or additional IPC calls are
recorded/generated. Disabled by default. Counts cover registered LocalCode
`ipcMain.handle` calls, not internal Electron IPC, unhandled invokes, renderer sends,
or all V8 template allocations. Peak rates are sampling-window averages, not instantaneous.

Live measurement found an idle `browser:set-bounds` feedback loop at approximately
33,000 invokes/second. In the first 50.087 seconds, it produced 1,553,272 of 1,553,303
handled invokes. `setBounds` emitted state on every request, and the renderer's state
listener sent bounds again. Identical normalized requests now succeed without emitting
state or touching the view/timestamp, breaking the echo; real bounds changes still apply.
The feedback loop is covered by failing-before/passing-after tests.

After the correction, the same startup/idle run recorded **7 bounds calls / 36 total
invokes in 50.125 seconds**, with **zero invokes in each of four subsequent 10-second
idle windows**. The corrected diagnostic instance was verified mapped and native Wayland.
This validates the idle feedback fix, not every possible interaction or long-run workload.
Native Crashpad reporting remains enabled; the existing graphics warnings remain unrelated
to the demonstrated V8/IPC template-overflow mechanism.

Verification TODO ledger (working tree, not yet committed):

- [x] AI-001: Verify upstream fix, first fixed release, tagged source and installed binary.
- [x] AI-002: Add bounded opt-in payload-free IPC counters and persistence/compatibility tests.
- [x] AI-003: Reproduce and break the identical-bounds feedback loop without API changes.
- [x] AI-004: Measure before/after live churn; build and targeted tests passed 12/12,
  including the explicit native SIGTRAP fixture. Final full suite: 206 passed, 1 failed,
  1 skipped (native fixture is opt-in). The remaining renderer reference-workspace
  tool-list assertion was also failing before the bounds correction. Editor diagnostics
  and diff whitespace checks passed. Whole-dirty-tree structural gates still flag earlier
  terminal/guidance work; setBounds has no incompatible callers.

Electron Crashpad starts as the first main-process import, before app readiness and
renderer creation. Native crashes such as SIGTRAP can produce local minidumps even
when the main process cannot run JavaScript cleanup. Reports are **never uploaded**;
the system crash handler remains enabled for independent core-dump evidence.

Startup prints `[crash-reporter] Native crash dumps (local only): <directory>`.
The directory is Electron's `app.getPath('crashDumps')` (normally
`~/.config/llm-ide/Crashpad` for Linux development). Search beneath the printed
directory for `.dmp` files; Crashpad's internal subdirectory layout may vary.
Preserve the dump, terminal stderr, crash time, and installed Electron version for
analysis. Minidumps require matching native symbols to obtain useful stacks.

Dumps may contain secrets or user content from process memory. Keep them private,
share only through a trusted channel, and remove them when no longer needed.
No custom prompt, URL, workspace, or credential annotations are added. Initialization
failure is logged without aborting startup. Collection cannot recover earlier crashes,
normal exits, SIGKILL, or failures before Crashpad starts; a missing dump is not proof
that no crash occurred. Arbitrary model-terminal programs are not covered by Electron
Crashpad. Enablement takes effect on the **next application launch** after compilation.

The test suite executes the compiled bootstrap with mocked Electron APIs. An opt-in
native integration test (`LOCALCODE_TEST_NATIVE_CRASH=1`) deliberately crashes a separate,
windowless Electron fixture using a temporary profile, checks the minidump header, and
deletes its test artifacts. Linux explicitly self-signals SIGTRAP; other platforms use
Electron's `process.crash()`. It never loads LocalCode or the real user profile.

### Diagnostics Change Notes — 2026-10-31

- Added local-only early Crashpad initialization; this is instrumentation, not a SIGTRAP fix.
- Removed the earlier unvalidated Linux GPU-off/X11 startup overrides after the next
	build activated them in a Wayland session and an X11 presentation error was reported.
	Electron again selects its display/GPU backend normally; native reporting remains enabled.
- Design decision: use Electron's out-of-process reporter rather than unsafe native-exit
	callbacks; retain the default dump directory and OS crash handler without new dependencies.

Diagnostics TODO ledger (completed in the working tree; not yet committed):

- [x] AI-001: Verify Electron Crashpad API and early-start requirements.
- [x] AI-002: Enable local-only reporting without changing graphics configuration.
- [x] AI-003: Build; validate startup/failure tests and real isolated SIGTRAP minidump;
	document privacy and collection limits.

Launch-regression TODO ledger (working tree, not yet committed):

- [x] AI-001: Verify Wayland environment and compiled X11/software overrides.
- [x] AI-002: Establish a failing regression test, remove the speculative overrides,
	and retain Crashpad initialization.
- [x] AI-003: Rebuild; graphics-preservation and native crash collection tests passed 5/5.
	Launched LocalCode once; Hyprland reported its window mapped, not hidden, and native
	Wayland (`xwayland: false`). Crashpad remained enabled. The longstanding Mesa/Wayland
	warnings still appeared, but the reported X11 presentation error did not.

Validation on 2026-10-31: focused tests 4/4 passed, including a real SIGTRAP dump with
the `MDMP` header. Full suite: 199 passed, 3 failed, 1 skipped (native test is opt-in).
Remaining failures: renderer reference-workspace tool-list assertion and two TurboVec
P3 checks reporting missing `numpy`. Whole-dirty-tree structural checks also flag existing
terminal/guidance changes outside this diagnostics addition; no incompatible callers of
`startNativeCrashReporter` were reported.

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

- Select **Save** to name and store the current chat configuration as a custom preset. Saving with an existing name asks before replacing it; saved presets remain local to the app.

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
2. Start Electron; npm automatically builds TypeScript before launch.

Commands:

- `npm install`
- `npm start`

Use `npm run build` for compilation only. For a one-shot build-and-launch dev run
(equivalent to `npm start`, not a live-reload watcher):

- `npm run dev`

You can also launch from VS Code debugger with [launch.json](.vscode/launch.json).

## OpenAI-Compatible Endpoint

In the Chat tab, set:

- Endpoint, for example: `http://localhost:11434/v1/chat/completions`
- Model, for example: `llama3`
- API key only when required by your endpoint

OpenAI-compatible base URLs are also accepted; LocalCode appends `/chat/completions` when it is missing. For Gemini, use `https://generativelanguage.googleapis.com/v1beta/openai/`, your Gemini API key, and a bare model ID such as `gemini-3.8-flash`. A `models/` prefix returned by model discovery is removed when sending Gemini OpenAI-compatible requests. Gemini tool-call thought signatures are retained and returned with the assistant tool-call message on subsequent turns.

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
