# MCP HTTP Header Configuration

## Release history

- **Feature version:** v1.1.0
- **Recorded:** 2026-11-06T20:30:00-05:00
- **Status:** working-tree implementation; not committed or packaged.
- **Contributor:** GitHub Copilot (AI-assisted; human review before release).
- **Feature:** per-server custom HTTP headers, exposed through the existing MCP
  settings editor and `saveMcpServers()` bridge.
- **Improvement:** value-free validation errors and credential-safe HTTP diagnostics.
- **Known limitations:** HTTP transport only, visible JSON values, no encrypted
  credential storage/OAuth/token refresh. Existing HTTP transport still requires
  JSON responses; this change does not implement full Streamable HTTP session/SSE
  response handling. No additional features are promised by this change.

## Review and design decision

Configuration previously had no header field, backend and renderer normalization
dropped unknown properties, and the HTTP client's request and notification methods
used fixed header maps. Persistence and UI both required changes; adding headers
only to fetch would not expose usable authentication settings.

Add optional `MCPServerConfig.headers: Record<string, string>` through the existing
list/save IPC methods. No separate credential IPC route is needed: the existing
`window.llmIde.saveMcpServers({ servers })` method accepts the additive field and
already persists, reconfigures, and refreshes server connections. Per-server settings
remain in the version-1 store; old records require no migration.

`normalizeMcpHttpHeaders()` validates maps with Node's HTTP validators, rejects
non-string values/invalid names or characters/case-insensitive duplicates, and
returns a detached lowercase map. Names are not silently trimmed, values are not
coerced, and errors never include input names or values. Empty maps become absent
headers. `buildMcpHttpHeaders()` merges these maps over the existing JSON content
type and JSON/event-stream accept defaults. Explicit overrides are allowed; users
are responsible for keeping protocol headers compatible with their server.

Both requests and notifications use the same builder: initialize, initialized,
tools/list, and tools/call all receive headers. Client configuration is snapshotted;
the existing settings save/refresh lifecycle creates new clients for rotated or
cleared credentials. Stdio/SSE ignore header maps, so switching away and back can
retain valid saved headers without accidentally sending them on another transport.

The UI stores unparsed text only in temporary modal drafts, strips UI-only fields
before IPC, and preserves draft text when rendering after a runtime refresh.
Only HTTP enables the textarea. Blank or `{}` clears headers. Invalid JSON or
non-string values stop saving without exposing the raw text in errors; backend HTTP
validation runs before disk writes. Cancel/reopening reloads saved settings.

Existing Electron settings/theme controls are retained rather than introducing the
Flask Assistant Coach scaffold (UI Development Guidelines §18.3). The settings
heading carries the feature version, with release history here; the existing project
does not have the React-based version-dialog infrastructure. No structural refactor
or new dependency is introduced.

## Change safety and security assessment

- **Affected boundaries:** shared config, persistence, existing preload method,
  HTTP transport, and MCP settings UI. Optional configuration preserves old callers.
- **Credential handling:** headers are configuration-only; model-facing
  `list_mcp_servers` retains its explicit field allowlist and excludes header values.
  UI values are visible and persist unencrypted in the application profile's existing
  MCP settings file. Protect that profile and avoid screenshots containing real keys.
  Secret-vault integration is not part of this feature.
- **Network safety:** credential-bearing HTTP requests reject redirects because
  fetch does not strip arbitrary API-key headers on cross-origin redirects. Configure
  the final HTTPS endpoint. Without headers, existing redirect behavior remains.
- **Diagnostics:** custom-header requests suppress HTTP error bodies and remote RPC
  error messages; malformed JSON errors are generic. Old no-header requests retain
  their bounded HTTP/RPC diagnostics. Successful tool output remains server-provided
  content; this feature does not sanitize intentional credentials returned by tools.
- **Accessibility:** associated label, help text through `aria-describedby`, standard
  keyboard-editable textarea, disabled non-HTTP state, and a live status region.
  Existing theme/focus styling is reused. This is a targeted audit, not a full WCAG
  certification of the application.
- **Performance/concurrency:** validation/copying is O(total header length); no extra
  network round trips or background work. Isolated tests measure the actual request
  path; no performance optimization or changed concurrency model is claimed.
- **Ethics:** no model output/ranking/automated-decision changes. Credential exclusion
  is the relevant privacy safeguard; user-entered connection configuration is explicit.

## Verification

- `npm run build`: passes; TypeScript/editor diagnostics clean for changed code.
- Focused tests: **17/17 pass**, including unchanged stdio, HTTP, and SSE discovery
  and invocation; header validation/default overrides; all HTTP RPC phases; credential
  rotation/clearing; redirect blocking; error secrecy; real store persistence and failed
  save immutability; executable renderer draft/save behavior; existing IPC contracts;
  model-visible listing exclusion; dynamic MCP dispatch.
- `npm test`: **227 passed, 6 failed, 2 skipped** (235 tests). Failures match the
  previously recorded unrelated baseline: renderer reference-workspace tool assertion,
  Windows terminal-timeout assertion, and four TurboVec tests whose Python environment
  cannot locate pyvenv.cfg. No MCP tests fail. These issues were not modified here.
- Integrated browser: actual shipped renderer with an isolated mock Electron bridge;
  confirmed associated header textbox, invalid JSON keeps Settings open with a safe
  live error, SSE disables/HTTP enables input, runtime refresh retains drafts, valid
  JSON reaches the existing save method without UI-only fields, and Save closes the
  modal. At a 480px viewport the header field fits without horizontal overflow,
  receives keyboard focus, and blank input clears the saved header map.
  No real user profile, credentials, or MCP endpoints were used. Existing
  Monaco font CSP warning is unrelated. Persistence and network boundaries are tested
  separately with the real backend implementations.
- Source whitespace checks pass. Existing package-version/distribution changes were
  preserved; installers were not regenerated.

## TODO Ledger

Completion references below are the working-tree files; no commit/PR was created.

- [x] **AI-001:** Review configuration/transport/IPC/UI flow —
  [mcpServerManager.ts](src/backend/mcpServerManager.ts),
  [mcpServerStore.ts](src/backend/mcpServerStore.ts).
- [x] **AI-002:** Implement additive header API/settings controls —
  [types.ts](src/shared/types.ts), [mcpHttpHeaders.ts](src/backend/mcpHttpHeaders.ts),
  [app.js](renderer/app.js), [index.html](renderer/index.html).
- [x] **AI-003:** Verify contracts, compatibility, and delivery —
  [mcpHttpHeaders.test.ts](src/tests/mcpHttpHeaders.test.ts),
  [mcpServerManager.test.ts](src/tests/mcpServerManager.test.ts),
  [mcpServerStore.test.ts](src/tests/mcpServerStore.test.ts),
  [renderer.mcpHeaders.test.ts](src/tests/renderer.mcpHeaders.test.ts),
  [toolRuntime.mcpServers.test.ts](src/tests/toolRuntime.mcpServers.test.ts).
- [x] **AI-004:** Document feature v1.1.0/release notes and risks —
  [README.md](README.md), this document.