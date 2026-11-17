# Browser Integration Review

## Task Start Declaration
- Task: Review what it would take to add a true integrated browser interface plus Playwright-driven browsing for model use.
- Type: Multi-step review and design note (documentation-only output).
- Applicable Rules: Task Start Protocol, Change Safety Protocol, Testing Requirements, Token Optimization and Efficiency.
- Breaking Changes: None. Proposed path is feature-flagged and off by default.
- Clarifications Needed: None.

## Executive Summary

LocalCode already has a strong model/tool runtime and IPC structure that can host browser capabilities cleanly. Today, model web access is text-fetch based (`browser_fetch`) and not tied to a live browser surface. A true integrated browser requires:

1. A real embedded browser surface in Electron (recommended: `WebContentsView`-based Browser pane).
2. A browser session manager in the main process.
3. New IPC channels so renderer can drive/view session state.
4. New model tools for live navigation and interaction.
5. A Playwright bridge that can control the same browser session (recommended via CDP attach).

This can be delivered safely in phases behind a feature flag so the current running instance behavior is unchanged.

## Current State Findings

### 1) Browser capability exists only as fetch-and-parse
- `browser_fetch` fetches raw HTML with Axios, strips tags/scripts/styles, and returns text + extracted links.
- This is useful for lightweight retrieval, but it is not a live browser and cannot represent dynamic JS-driven UIs accurately.

Relevant code:
- [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts#L378)
- [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts#L1075)
- [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts#L2746)

### 2) Tool runtime architecture is already a strong extension point
- All tool calls are centralized through `executeTool`, with existing allowlist filtering and orchestration/chat integration.
- This is the right place to add browser tools for model actions.

Relevant code:
- [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts#L2640)
- [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts#L2764)

### 3) Main process + preload IPC pattern is suitable for browser session control
- `ipcMain.handle(...)` already hosts many feature services and emits events to renderer.
- Preload exposes a typed API wrapper (`window.llmIde`) for renderer usage.
- This pattern can be mirrored for browser session commands/events.

Relevant code:
- [llm-ide/src/main.ts](llm-ide/src/main.ts#L1355)
- [llm-ide/src/preload.ts](llm-ide/src/preload.ts#L1)

### 4) Renderer currently has no Browser tab/view
- Current tabs are: chat, orchestration, advanced orchestration, diagnostics.
- No browser view container or navigation UI exists today.

Relevant code:
- [llm-ide/renderer/index.html](llm-ide/renderer/index.html#L95)
- [llm-ide/renderer/app.js](llm-ide/renderer/app.js#L15)
- [llm-ide/renderer/app.js](llm-ide/renderer/app.js#L1663)

### 5) Dependency baseline does not include Playwright
- No Playwright dependency exists in `package.json` currently.

Relevant code:
- [llm-ide/package.json](llm-ide/package.json#L1)

## What "True Browser" Means Here

For this app, a true browser integration should provide:

1. A visible browsing surface inside LocalCode.
2. Real page lifecycle events (start, commit, finish, fail).
3. DOM and interaction support for dynamic sites (not just static HTML fetch).
4. Session continuity (cookies/storage) during a run.
5. Safe model control through bounded tools.

## Architecture Options

## Option A: Renderer `<webview>` tag
- Pros: Easy visual embedding in HTML layout.
- Cons: Larger security surface, requires `webviewTag` enablement, harder to guarantee strong isolation policy long-term.
- Verdict: Not preferred.

## Option B: Main-process `WebContentsView` session manager (recommended)
- Pros: Better process/control boundary, aligns with existing Electron IPC architecture, easier centralized lifecycle and security policy.
- Cons: Requires bounds synchronization between renderer layout and main process view.
- Verdict: Best fit.

## Option C: External Chromium window controlled by Playwright only
- Pros: Fastest Playwright-first proof of concept.
- Cons: Not a true integrated in-app browser surface.
- Verdict: Good temporary prototype, not final target.

## Recommended Target Design

### 1) Browser Session Manager in main process
Create `browserSessionManager.ts` in backend/main-process layer to own:

- Session lifecycle: create/destroy/reset.
- Page lifecycle and URL state.
- Navigation methods: goto/back/forward/reload/stop.
- Capture methods: screenshot/snapshot/text extraction.
- Interaction methods: click/type/press/scroll (gated).
- Event fan-out to renderer (`browser:event`) and tool runtime.

Potential integration points:
- [llm-ide/src/main.ts](llm-ide/src/main.ts#L1303)
- [llm-ide/src/main.ts](llm-ide/src/main.ts#L2239)

### 2) Embedded browser surface
Use `WebContentsView` attached to the main window and positioned over a renderer-declared browser region.

- Renderer owns layout and reports browser viewport bounds to main process.
- Main process moves/resizes the `WebContentsView` accordingly.
- Browser tab activation toggles visibility.

Renderer additions:
- Add Browser tab and Browser panel container in [llm-ide/renderer/index.html](llm-ide/renderer/index.html).
- Extend tab routing in [llm-ide/renderer/app.js](llm-ide/renderer/app.js#L1663).
- Add style/layout updates in [llm-ide/renderer/styles.css](llm-ide/renderer/styles.css).

### 3) IPC contract
Add preload and main handlers for:

- `browser:create-session`
- `browser:destroy-session`
- `browser:navigate`
- `browser:get-state`
- `browser:capture`
- `browser:interact`
- `browser:set-bounds`
- `browser:on-event`

Wire through preload similarly to existing APIs in [llm-ide/src/preload.ts](llm-ide/src/preload.ts).

### 4) Tool-runtime additions for model browsing
Add new tools in [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts):

- `browser_open_page` (url)
- `browser_get_snapshot` (current structured page summary)
- `browser_click` (selector or semantic target)
- `browser_type` (selector + text)
- `browser_keypress` (key/chord)
- `browser_back`, `browser_forward`, `browser_reload`
- `browser_screenshot` (viewport or element)

Optional (later):
- `browser_wait_for` (url/text/selector with timeout)
- `browser_eval` (restricted, policy-controlled)

Keep existing `browser_fetch` for fast retrieval cases.

### 5) Playwright bridge integration

#### Recommended model
Control the same embedded browser session using Playwright over CDP:

1. Start LocalCode with remote debugging port enabled for browser targets.
2. Bridge module attaches via `playwright.chromium.connectOverCDP(...)`.
3. Resolve the page target associated with the managed browser session.
4. Execute Playwright actions and return structured results to tool runtime.

Why this path:
- Preserves a true visible in-app browser while gaining Playwright reliability/selector tooling.
- Avoids dual-browser desync between hidden automation browser and visible embedded browser.

#### Practical fallback
If CDP target mapping is unreliable initially, phase 1 can use Electron-native commands for interactions and reserve Playwright for phase 2 once target binding is stable.

## Security and Safety Requirements

Browser integration expands attack surface. Minimum controls:

1. Default off via feature flag (for example `LOCALCODE_BROWSER_ENABLED=false`).
2. Domain policy:
   - allowlist mode or explicit prompt approval for unknown domains.
   - block private network ranges by default unless explicitly approved.
3. Permission policy:
   - deny camera/mic/geolocation/notifications by default.
4. Download policy:
   - block auto-download unless user approves.
5. Interaction safety:
   - require model confirmation gates for irreversible actions (form submit, checkout-like flows).
6. Tool bounds:
   - strict per-call timeout, max actions per turn, and activity logs.
7. Event and data privacy:
   - sanitize or redact sensitive page text in logs if needed.

## Data Contracts to Add

In [llm-ide/src/shared/types.ts](llm-ide/src/shared/types.ts), add types like:

- `BrowserSessionState`
- `BrowserNavigationRequest`
- `BrowserInteractionRequest`
- `BrowserSnapshot`
- `BrowserToolResult`

Add corresponding preload signatures in [llm-ide/src/preload.ts](llm-ide/src/preload.ts).

## Phased Integration Plan (Non-Breaking)

### Phase 0: Design and stubs (no behavior change)
1. Add types and IPC interfaces only.
2. Add feature flag checks.
3. Add no-op manager implementation returning clear "disabled" responses.

### Phase 1: Visible integrated browser (manual use first)
1. Add Browser tab/panel UI.
2. Implement `WebContentsView` session manager.
3. Wire navigation controls and state updates.
4. Add lifecycle telemetry events.

### Phase 2: Model-driven browsing (Electron-native actions)
1. Add browser tool definitions and `executeTool` handlers.
2. Enforce per-tool policy checks and user approvals.
3. Add snapshots + screenshots for model context.

### Phase 3: Playwright bridge
1. Add Playwright dependency and CDP attach service.
2. Route interaction tools through Playwright where advantageous.
3. Add retry/wait heuristics and robust selector fallback strategy.

### Phase 4: Hardening
1. Expand tests.
2. Add settings UI for browser policy controls.
3. Add observability and failure diagnostics.

## Testing Strategy

### Unit tests
- Tool argument validation and safety gates.
- Browser state reducers/event mapping.
- Feature-flag gating behavior.

### Integration tests
- IPC roundtrip for browser commands.
- Session create/destroy and navigation state transitions.
- Tool-runtime to browser-manager dispatch.

### End-to-end smoke
- Open page, navigate, click, type, screenshot, back/forward.
- Validate renderer Browser tab state sync.

## Expected File Touch Map

Core likely files:
- [llm-ide/src/main.ts](llm-ide/src/main.ts)
- [llm-ide/src/preload.ts](llm-ide/src/preload.ts)
- [llm-ide/src/backend/toolRuntime.ts](llm-ide/src/backend/toolRuntime.ts)
- [llm-ide/src/shared/types.ts](llm-ide/src/shared/types.ts)
- [llm-ide/renderer/index.html](llm-ide/renderer/index.html)
- [llm-ide/renderer/app.js](llm-ide/renderer/app.js)
- [llm-ide/renderer/styles.css](llm-ide/renderer/styles.css)

New likely files:
- `llm-ide/src/backend/browserSessionManager.ts`
- `llm-ide/src/backend/browserPlaywrightBridge.ts`
- `llm-ide/src/tests/browserSessionManager.test.ts`
- `llm-ide/src/tests/browser.toolRuntime.test.ts`

## Dependency Impact

- Add Playwright (likely `playwright` or `playwright-core` plus browser runtime strategy).
- Ensure packaging and CI handle platform browser binaries if full Playwright package is used.
- Evaluate keeping browser installation optional and feature-gated.

## Risks and Mitigations

1. Risk: Embedded view bounds and z-order bugs.
   - Mitigation: start with single browser panel region and explicit resize events.

2. Risk: CDP target mismatch for Playwright attach.
   - Mitigation: retain Electron-native fallback path and add deterministic session-target tagging.

3. Risk: Security regressions from arbitrary browsing.
   - Mitigation: strict default-deny permissions, domain gating, explicit user confirmation for sensitive actions.

4. Risk: Tool loops causing runaway interactions.
   - Mitigation: per-turn action caps, mandatory waits, and loop detection similar to existing tool call guards.

## Recommended First Implementation Slice

Safest first vertical slice:

1. Feature flag + Browser tab shell.
2. Main-process browser session manager with open URL + state + screenshot only.
3. Add read-only tools:
   - `browser_open_page`
   - `browser_get_snapshot`
   - `browser_screenshot`

No click/type yet. This gives immediate model-visible browsing value with lower risk.

## Bottom Line

This integration is very feasible in the current LocalCode architecture. The app already has the right IPC and tool-runtime skeleton; the major work is adding a managed browser session layer, renderer surface, and policy-safe model tools. Playwright can be introduced incrementally after the integrated browser is stable, ideally by attaching to the same visible browser session over CDP.