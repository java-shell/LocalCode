# TODO: Feature Implementation Plan

## Overview

Three feature areas to implement in LocalCode (llm-ide):

1. **`.ai-rules` folder auto-injection** — Models read workspace `.ai-rules/` guidance before acting.
2. **Completion toast notification + "Ding" sound** — Visual + audio alert when chat/orchestration finishes.
3. **Enhanced documentation + Preset definitions** — Better docs and one-click preset configurations.

---

## 1. `.ai-rules` Folder Auto-Loading

### Goal

When a workspace contains a `.ai-rules/` folder, the model should automatically read its contents (rules, guidance files) and inject them as system context **before** processing any user prompt. If the folder does not exist, this step is silently skipped.

### Architecture Analysis

| Layer | Current State | What Needs to Change |
|---|---|---|
| **Filesystem access** | `workspaceFs.ts` provides `readWorkspaceFile()` and `buildWorkspaceTree()` | Add a new helper: `loadAiRules(workspaceDir)` that reads `.ai-rules/README.md` (or all `.md` files) and returns concatenated content |
| **Chat flow (`main.ts`)** | `chat:stream` IPC handler builds messages array, injects TurboVec memory, then user prompt | Insert `.ai-rules` content as a system message **before** the user prompt but **after** memory injection |
| **Orchestration flow (`orchestrationEngine.ts`)** | `runStepWithRetries()` builds messages with optional `step.systemPrompt`, then memory, then user prompt | Inject `.ai-rules` content as an additional system message in each step (or once at orchestration start) |
| **Tool runtime** | Tools can read files but no awareness of `.ai-rules` convention | Optionally add a note in tool descriptions that `.ai-rules/` exists and should be respected |

### Implementation Steps

#### 1.1 — New helper: `loadAiRules()` in `workspaceFs.ts`

**File:** `llm-ide/src/backend/workspaceFs.ts`

```
[ ] Add function:
    export async function loadAiRules(workspaceDir: string): Promise<string | null>
    
    Logic:
    a. Check if `.ai-rules/` directory exists via fs.access()
    b. If not → return null (caller skips injection)
    c. If yes → read all .md files in sorted order (README.md first, then alphabetical)
    d. Concatenate with file-name headers: "## .ai-rules/filename.md"
    e. Cap total output at ~8000 chars to avoid blowing context window
    f. Return concatenated string or null if folder is empty
```

#### 1.2 — Inject into Chat flow in `main.ts`

**File:** `llm-ide/src/main.ts` (inside `chat:stream` handler, ~line 500-600)

```
[ ] After memory injection block (~line 555), add:
    
    const aiRulesContent = await loadAiRules(selectedWorkspaceDir);
    if (aiRulesContent) {
      messages.push({
        role: 'system',
        content:
          'The following workspace rules and guidance were found in .ai-rules/. ' +
          'Follow these instructions when working with this codebase:\n\n' +
          aiRulesContent
      });
      event.sender.send('chat:event', '[ai-rules] injected workspace guidance.');
    }
```

**Order of system messages:** memory → `.ai-rules` → user prompt. This ensures rules are the last system instruction before the user's request.

#### 1.3 — Inject into Orchestration flow in `orchestrationEngine.ts`

**File:** `llm-ide/src/backend/orchestrationEngine.ts` (inside `runStepWithRetries()`, ~line 305-340)

```
[ ] After step.systemPrompt and memory injection, add:
    
    const aiRulesContent = await loadAiRules(runtimeContext?.workspaceDir || '');
    if (aiRulesContent) {
      messages.push({
        role: 'system',
        content:
          'Workspace guidance from .ai-rules/:\n\n' + aiRulesContent
      });
    }
```

**Note:** This adds `.ai-rules` to every orchestration step. Consider caching the result at orchestration start (in `runOrchestration()`) and passing it down to avoid re-reading on each step.

#### 1.4 — Cache `.ai-rules` at orchestration entry point

**File:** `llm-ide/src/backend/orchestrationEngine.ts` (inside `runOrchestration()`, ~line 713+)

```
[ ] At the top of runOrchestration():
    
    const aiRulesContent = await loadAiRules(runtimeContext?.workspaceDir || '');
    
[ ] Pass aiRulesContent into runStepWithRetries() as a new parameter
[ ] Use cached value instead of re-reading per step
```

#### 1.5 — Add `.ai-rules` awareness to tool descriptions (optional)

**File:** `llm-ide/src/backend/toolRuntime.ts`

```
[ ] Consider adding a note to the system prompt or tool definitions:
    "This workspace may have an .ai-rules/ folder with coding conventions. 
     Respect those rules when making changes."
    
  This is optional — the auto-injection above handles most of it.
```

### Acceptance Criteria

- [ ] Workspace **with** `.ai-rules/` → model receives rules as system context before every chat/orch request
- [ ] Workspace **without** `.ai-rules/` → no change in behavior, no errors
- [ ] Rules content is capped at ~8000 chars to protect context window
- [ ] Event log shows `[ai-rules] injected workspace guidance.` when loaded
- [ ] Orchestration caches the read (not re-read per step)

---

## 2. Completion Toast Notification + "Ding" Sound

### Status: ✅ COMPLETE

### Goal

When a chat response or orchestration run completes successfully, display a toast notification in the UI and play a short "ding" sound to alert the user — even if they're not looking at the window. Error toasts are **required** (not optional). Toast also fires when `query_user` tool is invoked.

### Architecture Analysis

| Layer | Before | After |
|---|---|---|
| **Chat completion** | `chatStream()` promise resolves → renderer sets `status.textContent = 'Done'` | ✅ Trigger success toast + ding sound at this point |
| **Orchestration completion** | `runOrchestration()` promise resolves → renderer sets `status.textContent = 'Run complete'` | ✅ Trigger success toast + ding sound at these points |
| **Error handling** | Silent errors (except status text) | ❌ Error toasts with buzz sound for all non-cancelled failures |
| **query_user tool** | No notification when model asks user a question | ℹ️ Info toast + blip sound alerts user to pending input |
| **UI (renderer)** | No toast/notification system exists | ✅ Toast component with CSS animations, progress bar, close button |
| **Audio** | No audio assets or playback | ✅ Web Audio API ding/error/info sounds (no external assets) |

### Implementation Steps

#### 2.1 — Create toast notification component in HTML

**File:** `llm-ide/renderer/index.html`

```
[x] Add toast container element near top of body:
    
    <div id="toastContainer" class="toast-container"></div>
```

#### 2.2 — Style the toast in CSS

**File:** `llm-ide/renderer/styles.css`

```
[x] Add toast styles (155 lines):
    - .toast-container: fixed position, top-right, z-index 9999
    - .toast: card with border-radius, shadow, backdrop blur
    - .toast-success: green accent border + icon
    - .toast-error: red accent border + icon
    - .toast-info: blue accent border + icon
    - .toast-progress-bar: animated countdown indicator
    - .toast-close-btn: manual dismiss button
    - @keyframes toastIn: slide-in with cubic-bezier easing
    - @keyframes toastOut: slide-out for dismissal
```

#### 2.3 — Add ding sound (Web Audio API, no external asset needed)

**File:** `llm-ide/renderer/app.js`

```
[x] Implemented three sounds via Web Audio API:
    - playDingSound(): pleasant two-tone chime (A5 → C#6) for success
    - playErrorSound(): subtle square-wave buzz for failures
    - playInfoSound(): soft sine blip for info notifications
    - Graceful fallback: silently fails if Web Audio unavailable
```

#### 2.4 — Implement toast helper in `app.js`

**File:** `llm-ide/renderer/app.js` (197 lines of toast logic)

```
[x] Added functions:
    - showToast(options): creates toast with type, title, message, duration
    - dismissToast(el): exit animation + cleanup
    - 5-second auto-dismiss with visible countdown progress bar
    - Close button on each toast for manual dismissal
    - Stacking support (multiple toasts queue vertically)
```

#### 2.5 — Wire toast into Chat completion

**File:** `llm-ide/renderer/app.js` (~line 2245, inside chat send handler)

```
[x] After status.textContent = 'Done' (line ~2245), added:
    
    showToast({ type: 'success', title: 'Prompt Complete', message: 'Chat response finished successfully.' });
```

#### 2.6 — Wire toast into Orchestration completion (simple mode)

**File:** `llm-ide/renderer/app.js` (~line 3225, inside `initOrchestration()`)

```
[x] After status.textContent = 'Run complete' (line ~3225), added:
    
    showToast({ type: 'success', title: 'Orchestration Complete', message: 'Simple orchestration run finished.' });
```

#### 2.7 — Wire toast into Advanced Orchestration completion

**File:** `llm-ide/renderer/app.js` (~line 4474, inside `initAdvancedOrchestration()`)

```
[x] After status.textContent = 'Advanced run complete' (line ~4474), added:
    
    showToast({ type: 'success', title: 'Advanced Orchestration Complete', message: 'Graph-based orchestration finished.' });
```

#### 2.8 — Add error toasts (**REQUIRED**, not optional)

**File:** `llm-ide/renderer/app.js`

```
[x] In chat error handler (~line 2250):
    if (!/canceled/i.test(errorMessage)) {
      showToast({ type: 'error', title: 'Chat Failed', message: errorMessage.slice(0, 120) });
    }

[x] In orchestration error handlers (~line 3228, ~line 4478):
    if (!/stopped|canceled/i.test(errorMessage)) {
      showToast({ type: 'error', title: 'Orchestration Failed', message: errorMessage.slice(0, 120) });
    }

[x] User-cancelled operations (stop button) do NOT show error toasts
```

#### 2.9 — Wire toast into `query_user` tool invocation

**File:** `llm-ide/renderer/app.js` (inside chat event listener for `chat:query`)

```
[x] When model calls query_user tool, show info toast:
    
    showToast({ type: 'info', title: 'Model Needs Input', message: 'Please respond to the question below.' });
```

### Acceptance Criteria

- [x] Chat completion → toast appears top-right with ✅ icon + "Prompt Complete"
- [x] Orchestration completion → toast appears with ✅ icon + "Orchestration Complete"
- [x] Advanced orchestration completion → same toast behavior
- [x] A pleasant "ding" sound plays on success (Web Audio API, no external asset required)
- [x] Toast auto-dismisses after 5 seconds with animated progress bar
- [x] Error toasts show ❌ icon + buzz sound (**required**, not optional)
- [x] No toast if user cancels/stops the operation
- [x] `query_user` tool invocation shows ℹ️ info toast + blip sound
- [x] Toasts stack vertically with gap spacing
- [x] Manual close button available on each toast

### Files Modified

| File | Lines Added | Description |
|---|---|---|
| `llm-ide/renderer/index.html` | 1 | Toast container `<div>` |
| `llm-ide/renderer/styles.css` | ~155 | Full toast styling + animations |
| `llm-ide/renderer/app.js` | ~197 | Toast helper, sounds, all 7 trigger points |

### Commit Reference

```
feat: add toast notification system with ding sound and error alerts
- Toast container in index.html
- CSS animations (slide-in/out, progress bar)
- Web Audio API sounds (ding/error/info)
- Wired into chat, orchestration, advanced orchestration completions
- Error toasts for all non-cancelled failures
- Info toast for query_user tool invocations
```

---

## 3. Enhanced Documentation + Preset Definitions

### Status: ✅ COMPLETE

### Goal

Improve documentation for feature sets and add "Preset" configurations that let users quickly set up common workflows (e.g., "Local Ollama Coding", "Remote OpenAI Assistant", etc.).

### Architecture Analysis

| Area | Before | After |
|---|---|---|
| **Root README** | Good overview but missing detail on TurboVec memory, advanced orchestration, tool calling, query_user | ✅ Expanded with TurboVec, Tool Calling Reference, Advanced Orchestration, .ai-rules, and Presets sections |
| **llm-ide/README.md** | Minimal — only build steps and basic config | ✅ Full feature reference tables for all panels, presets documentation |
| **Chat Presets** | None exist | ✅ 4 presets defined (Ollama local, Ollama 32K, OpenAI-compatible, Read-only) with dropdown selector in Chat Settings |
| **Orchestration Presets** | None exist | ✅ 3 plan presets (Full Coding Pipeline, Quick Fix, Code Review) with "Import Preset" button |
| **Settings storage** | `settingsState` in app.js stores provider/endpoint/model | ✅ `applyPreset()` function populates settings and syncs UI |

### Implementation Steps

#### 3.1 — Expand Root README.md

**File:** `README.md` (root)

```
[x] Added new sections:

## TurboVec Memory
- What it is: local vector memory store for conversation context recall
- How namespaces work (workspace-scoped + global)
- Diagnostics tab: export/import/lock namespaces
- How memory injection works in chat and orchestration
- Injection order documented (system prompt → memory → .ai-rules → user prompt)

## Tool Calling Reference
- Full table of all available tools with descriptions (Read, Mutation, Git+Command, Web, Memory, Interaction)
- Scope behavior (workspace vs root)
- Mutation safety and approval dialogs
- query_user tool: how models can ask you questions (text, yes/no, checkboxes)
- Tool calling flow documented (5-step process)

## Advanced Orchestration
- Graph-based workflow editor
- Stage linking, conditions, branching
- Downstream routing and completion markers
- Loop-until-complete mode
- Workflow patterns (Linear, Branching, Loop, Supervisor)

## .ai-rules Workspace Guidance
- How to create a .ai-rules/ folder
- What files are read (README.md + all .md files)
- How rules are injected into model context
- Example structure and best practices

## Presets
- Chat presets table with descriptions
- Orchestration plan presets table with descriptions
```

#### 3.2 — Expand llm-ide/README.md

**File:** `llm-ide/README.md`

```
[x] Complete rewrite with:

## Feature Reference
### Chat Panel (7 features in table)
- Streaming responses, tool calling, session management, TurboVec memory, context windows, model discovery, presets

### Orchestration Panel (Simple) (5 features in table)
- Linear workflows, per-step tools, pass-through output, loop mode, presets

### Advanced Orchestration (5 features in table)
- Graph editor, conditional links, downstream routing, execution limits, completion markers

### Editor (5 features in table)
- Monaco editor, tab management, file tree explorer, disk change detection, markdown preview

### Model Terminal (4 features in table)
- Live output, interactive input, process interrupt, clear output

### Toast Notifications (4 events in table)
- Chat complete, orchestration complete, error, model asks question

### TurboVec Memory
- Export/import/clear/lock namespace operations

## Presets
### Chat Presets (4 presets in table)
- Local Ollama (Coding), Local Ollama (32K), OpenAI-Compatible, Read-Only Assistant

### Orchestration Plan Presets (3 presets in table)
- Full Coding Pipeline, Quick Fix, Code Review
```

#### 3.3 — Define Chat Preset Configuration Format

**File:** `llm-ide/renderer/app.js` (new section after normalizeProvider, ~line 61)

```
[x] Added PRESETS object with 4 presets:

const PRESETS = {
  ollama_local: {
    label: '🏠 Local Ollama (Coding)',
    description: 'Local Llama 3 via Ollama with full tool access',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3',
    apiKey: '',
    maxToolTurns: 40,
    requestTimeoutMs: 180000,
    contextWindowTokens: 8192
  },
  ollama_local_32k: {
    label: '🏠 Local Ollama (32K Context)',
    description: 'Local model with extended context window for larger codebases',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3.1',
    apiKey: '',
    maxToolTurns: 60,
    requestTimeoutMs: 300000,
    contextWindowTokens: 32768
  },
  openai_compatible: {
    label: '🌐 OpenAI-Compatible Endpoint',
    description: 'Custom OpenAI-compatible API (LM Studio, vLLM, etc.)',
    provider: 'openai-compatible',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    model: '',
    apiKey: '',
    maxToolTurns: 40,
    requestTimeoutMs: 180000,
    contextWindowTokens: 0
  },
  lite_read_only: {
    label: '📖 Read-Only Assistant',
    description: 'Lightweight setup with read-only tools and low timeout',
    provider: 'ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3',
    apiKey: '',
    maxToolTurns: 10,
    requestTimeoutMs: 60000,
    contextWindowTokens: 8192
  }
};
```

#### 3.4 — Add Preset Apply Function

**File:** `llm-ide/renderer/app.js` (after PRESETS definition)

```
[x] Added async applyPreset(presetKey) function that:
    a. Looks up preset by key
    b. Updates settingsState with preset values (provider, endpoint, model, apiKey, maxToolTurns, requestTimeoutMs)
    c. Sets context window tokens for the preset model
    d. Calls saveSettings() to persist to localStorage
    e. Syncs all UI elements (provider dropdown, endpoint input, model dropdown, API key input)
    f. Refreshes model options and syncs context window input
    g. Shows success toast with preset label and description
```

#### 3.5 — Add Preset Selector UI

**File:** `llm-ide/renderer/index.html` (in Chat settings panel, after chatNewMemoryNamespace)

```
[x] Added preset selector row:
    <div class="preset-selector-row">
      <label class="label" for="chatPresetSelect">Quick Preset</label>
      <select id="chatPresetSelect">
        <option value="">— Select a preset —</option>
      </select>
    </div>
```

**File:** `llm-ide/renderer/app.js` (in initChat, after chatNewMemoryNamespace listener)

```
[x] Wiring:
    a. Populate dropdown from PRESETS object (label as text, description as title)
    b. On change → call applyPreset(selectedKey) → reset dropdown to empty
```

#### 3.6 — Add Orchestration Plan Presets

**File:** `llm-ide/src/backend/schema.ts` (end of file)

```
[x] Added export const planPresets with 3 presets:

1. full_coding_pipeline (5 stages):
   - Context Scan → Planner → Safe Implementer → Validator → Reviewer Checkpoint
   - Comprehensive workflow for safe code changes

2. quick_fix (2 stages):
   - Analyze → Implement
   - Fast workflow for simple changes

3. code_review (3 stages):
   - Repository Scan → Code Reviewer → Suggestions
   - Analyze code quality and provide improvement recommendations

Each preset includes full step definitions with:
- System prompts tailored to the stage role
- Appropriate tool allowlists per stage
- Temperature, maxTokens, maxToolTurns tuned for the task
- passOutputToNext chaining configured
```

#### 3.7 — Add Preset Import to Orchestration UI

**File:** `llm-ide/renderer/index.html` (in orchestration actions row)

```
[x] Added button:
    <button id="orchImportPreset">Import Preset</button>
```

**File:** `llm-ide/src/preload.ts`

```
[x] Added IPC bridge methods:
    getPlanPresets: async () → Record<string, { name, description }>
    getPlanPreset: async (key) → OrchestrationPlan
```

**File:** `llm-ide/src/main.ts`

```
[x] Added IPC handlers:
    'orch:list-plan-presets' → returns preset metadata from planPresets
    'orch:get-plan-preset' → returns full plan for given key
[x] Imported planPresets from schema.ts
```

**File:** `llm-ide/renderer/app.js` (after export button handler)

```
[x] Added Import Preset button handler:
    a. Fetch available presets via IPC
    b. Show prompt dialog listing all presets with keys
    c. User enters preset key
    d. Fetch full plan via IPC
    e. Populate orchestration UI (name, description, loop settings, steps)
    f. Call renderWorkflow() to display steps
    g. Show success toast with preset name and description
```

### Acceptance Criteria

- [x] Root README.md has expanded sections for TurboVec, tools, advanced orchestration, .ai-rules, presets
- [x] llm-ide/README.md has feature reference tables and presets section
- [x] Preset dropdown appears in Chat settings panel (Quick Preset selector)
- [x] Selecting a preset auto-fills provider, endpoint, model, and tool settings
- [x] 4 chat presets defined (Ollama local, Ollama 32K, OpenAI-compatible, Read-only)
- [x] Toast notification confirms preset was applied
- [x] 3 orchestration plan presets available for import (Full Coding Pipeline, Quick Fix, Code Review)
- [x] "Import Preset" button in Orchestration tab loads preset plans into UI
- [x] Settings persist after reload (stored in localStorage)
    
    async function applyPreset(presetKey) {
      const preset = PRESETS[presetKey];
      if (!preset) return;
      
      settingsState.provider = preset.provider;
      settingsState.endpoint = preset.endpoint;
      settingsState.model = preset.model;
      settingsState.apiKey = preset.apiKey || '';
      settingsState.maxToolTurns = preset.maxToolTurns;
      settingsState.requestTimeoutMs = preset.requestTimeoutMs;
      
      if (preset.contextWindowTokens) {
        setConfiguredContextWindow(preset.model, preset.contextWindowTokens);
      }
      
      saveSettings();
      
      // Sync UI elements
      provider.value = preset.provider;
      endpoint.value = preset.endpoint;
      model.value = preset.model;
      apiKey.value = preset.apiKey || '';
      
      await refreshModelOptions();
      syncChatContextWindowInput();
      
      showCompletionToast(`Preset applied: ${preset.label}`, 'success');
    }
```

#### 3.5 — Add Preset Selector UI

**File:** `llm-ide/renderer/index.html` (in Chat settings area)

```
[ ] Add preset dropdown in the chat settings panel:
    
    <div class="settings-row">
      <label for="presetSelect">Quick Preset</label>
      <select id="presetSelect">
        <option value="">— Select a preset —</option>
      </select>
    </div>
```

**File:** `llm-ide/renderer/app.js` (in initChat())

```
[ ] Populate preset dropdown:
    
    const presetSelect = document.getElementById('presetSelect');
    for (const [key, preset] of Object.entries(PRESETS)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.label;
      option.title = preset.description;
      presetSelect.appendChild(option);
    }
    
    presetSelect.addEventListener('change', async () => {
      const selected = presetSelect.value;
      if (selected) {
        await applyPreset(selected);
        presetSelect.value = '';  // Reset after applying
      }
    });
```

#### 3.6 — Add Preset Definitions for Orchestration Plans

**File:** `llm-ide/src/backend/schema.ts` or new file `llm-ide/src/backend/presets.ts`

```
[ ] Create preset orchestration plans:
    
    export const planPresets = {
      code_review: {
        name: 'Code Review Pipeline',
        description: 'Review code quality, find issues, suggest fixes',
        steps: [
          { id: 'reviewer', name: 'Code Reviewer', ... },
          { id: 'fixer', name: 'Fix Suggester', ... }
        ]
      },
      refactor: {
        name: 'Refactoring Pipeline',
        description: 'Analyze, plan refactoring, then implement',
        steps: [...]
      },
      debug: {
        name: 'Debug Assistant',
        description: 'Find bugs, test fixes, verify resolution',
        steps: [...]
      }
    };
```

#### 3.7 — Add Preset Import to Orchestration UI

**File:** `llm-ide/renderer/app.js` (in initOrchestration())

```
[ ] Add preset plan selector similar to chat presets
[ ] On selection, populate the orchestration form with preset step data
```

### Acceptance Criteria

- [ ] Root README.md has expanded sections for TurboVec, tools, advanced orchestration, .ai-rules
- [ ] llm-ide/README.md has feature reference and presets section
- [ ] Preset dropdown appears in Chat settings panel
- [ ] Selecting a preset auto-fills provider, endpoint, model, and tool settings
- [ ] At least 4 presets defined (Ollama local, Ollama 32K, OpenAI-compatible, Read-only)
- [ ] Toast notification confirms preset was applied
- [ ] Preset orchestration plans available for import

---

## Implementation Order & Dependencies

```
Phase 1: Foundation (no dependencies between items)
├── 1.1  loadAiRules() helper in workspaceFs.ts          [ ] PENDING
├── 2.1  Toast HTML container                             [x] COMPLETE
├── 2.2  Toast CSS styles                                 [x] COMPLETE
└── 3.1  README documentation updates                     [ ] PENDING

Phase 2: Core Features (depends on Phase 1)
├── 1.2  Chat flow .ai-rules injection                    [ ] PENDING
├── 1.3  Orchestration flow .ai-rules injection           [ ] PENDING
├── 1.4  Orchestration caching for .ai-rules              [ ] PENDING
├── 2.3  Ding sound (Web Audio API)                       [x] COMPLETE
├── 2.4  Toast helper function in app.js                  [x] COMPLETE
├── 3.3  Preset definitions                               [x] COMPLETE
└── 3.4  Preset apply function                            [x] COMPLETE

Phase 3: Wiring & Polish (depends on Phase 2)
├── 2.5  Chat completion toast                            [x] COMPLETE
├── 2.6  Orchestration completion toast                   [x] COMPLETE
├── 2.7  Advanced orchestration toast                     [x] COMPLETE
├── 2.8  Error toasts (REQUIRED)                          [x] COMPLETE
├── 2.9  query_user tool toast                            [x] COMPLETE
├── 3.5  Preset selector UI                               [x] COMPLETE
├── 3.6  Orchestration plan presets                       [x] COMPLETE
└── 3.7  Preset import in orchestration UI                [x] COMPLETE
```

### Feature Completion Status

| Feature | Status | Items Done |
|---|---|---|
| **1. `.ai-rules` Folder Auto-Loading** | ⏳ Not Started | 0/5 items |
| **2. Toast Notifications + Sounds** | ✅ Complete | 9/9 items |
| **3. Documentation + Presets** | ✅ Complete | 7/7 items |

---

## File Change Summary

| File | Feature(s) | Type of Change |
|---|---|---|
| `llm-ide/src/backend/workspaceFs.ts` | #1 | New function: `loadAiRules()` |
| `llm-ide/src/main.ts` | #1, #3 | Inject `.ai-rules` into chat messages + plan preset IPC handlers |
| `llm-ide/src/backend/orchestrationEngine.ts` | #1 | Inject `.ai-rules` into orchestration steps + caching |
| `llm-ide/src/backend/schema.ts` | #3 | Orchestration plan presets (3 presets) |
| `llm-ide/src/preload.ts` | #3 | IPC bridge for plan preset listing and retrieval |
| `llm-ide/renderer/index.html` | #2, #3 | Toast container + preset selector HTML + Import Preset button |
| `llm-ide/renderer/styles.css` | #2 | Toast animation styles |
| `llm-ide/renderer/app.js` | #2, #3 | Toast helper, ding sound, preset definitions, apply logic, preset import handler |
| `README.md` (root) | #3 | Expanded documentation (TurboVec, tools, orchestration, .ai-rules, presets) |
| `llm-ide/README.md` | #3 | Complete rewrite with feature reference tables and presets docs |

---

## Notes & Considerations

### Context Window Impact (.ai-rules)
- `.ai-rules` content is capped at ~8000 chars to avoid consuming too much context
- For very large rule sets, consider summarization or selective loading
- Rules are injected as system messages (most LLMs handle these efficiently)

### Audio Permissions (Ding Sound)
- Web Audio API may require user interaction first in some browsers
- Electron renderer should allow it without gesture since it's a desktop app
- Graceful fallback: if audio fails, toast still shows visually

### Preset Security
- Presets only modify local settings — no network calls
- API key field is left blank for user to fill in
- Endpoint URLs are examples; user should verify their own endpoint

### Testing Checklist

#### Feature 1: `.ai-rules` Folder Auto-Loading
- [ ] Test with workspace containing `.ai-rules/` (multiple .md files)
- [ ] Test with workspace without `.ai-rules/`
- [ ] Verify rules are injected as system messages before user prompt
- [ ] Verify content is capped at ~8000 chars
- [ ] Verify orchestration caches the read (not re-read per step)

#### Feature 2: Toast Notifications + Sounds ✅
- [x] Test toast appears on chat completion (success + ding sound)
- [x] Test toast appears on simple orchestration completion (success + ding sound)
- [x] Test toast appears on advanced orchestration completion (success + ding sound)
- [x] Test error toast shows for non-cancelled failures (error + buzz sound)
- [x] Test NO toast shows when user cancels/stops the operation
- [x] Test info toast shows when query_user tool is called (info + blip sound)
- [x] Test toast auto-dismisses after 5 seconds with progress bar animation
- [x] Test manual close button dismisses toast immediately
- [x] Test multiple toasts stack vertically without overlap

#### Feature 3: Documentation + Presets ✅
- [x] Root README.md expanded with TurboVec, Tool Calling, Advanced Orchestration, .ai-rules, Presets sections
- [x] llm-ide/README.md rewritten with feature reference tables for all panels
- [x] Chat preset dropdown populates correctly in Chat settings (4 presets)
- [x] Selecting a chat preset auto-fills provider, endpoint, model, maxToolTurns, requestTimeoutMs
- [x] Preset settings persist after reload (stored in localStorage)
- [x] Success toast shows when preset is applied
- [x] "Import Preset" button appears in Orchestration tab actions row
- [x] Import Preset dialog lists all 3 orchestration presets with descriptions
- [x] Selecting an orchestration preset populates the workflow UI with correct steps
- [x] Success toast shows when orchestration preset is imported
- [ ] Test orchestration plan presets import correctly
