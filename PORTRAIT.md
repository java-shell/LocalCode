# Portrait Accessibility Plan

## Objective

Improve usability and accessibility in vertical (portrait) windows without regressing existing desktop landscape behavior.

## Constraints

- Keep existing desktop workflow intact in landscape layouts.
- Prioritize non-breaking additive changes.
- Preserve keyboard accessibility and visible focus states.
- Avoid introducing new dependencies.

## Phase 1: Portrait Layout Priority

### Goals

- Add portrait-aware layout behavior beyond width-only breakpoints.
- Allow fast switching between primary panes in portrait mode.
- Reduce cognitive load by showing one major pane at a time in narrow/tall windows.

### Implementation

1. Add a portrait pane switcher in the top bar.
2. Add portrait media queries using orientation/aspect-ratio.
3. In portrait mode, switch workspace to a single-pane presentation.
4. Support two panes:
   - Code pane (workspace tree on the left, editor in the remaining area)
   - Assistant pane
5. Persist selected pane in local settings.

### Acceptance Criteria

- In portrait mode, user can switch between Code and Assistant panes in one click.
- Only one primary pane is visible at a time in portrait mode.
- Landscape behavior remains unchanged.

## Phase 2: Chat Composer Reachability

### Goals

- Keep prompt input and send controls reachable while scrolling long chat history.
- Improve touch ergonomics in narrow/tall windows.

### Implementation

1. Wrap chat prompt label, input, and actions in a dedicated composer container.
2. Make composer sticky to the bottom of the chat panel in portrait mode.
3. Add visual separation from scrollable content.
4. Increase minimum action sizing and spacing for portrait interactions.

### Acceptance Criteria

- Prompt field and Send/Stop remain visible in portrait mode while scrolling.
- Chat history remains scrollable without covering composer controls.
- Keyboard focus remains visible and functional.

## Next Phases (Planned)

### Phase 3: Collapsible Secondary Regions

- Collapsible file tree and context usage sections with aria-expanded semantics.
- Better density controls for diagnostics/orchestration controls in narrow windows.

### Phase 4: Modal and Keyboard Refinements

- Portrait-optimized settings modal with sticky actions.
- Skip links and improved tab order verification for portrait reflow.
- Screen-reader pass for new pane-switch controls.

## Test Checklist

1. Manual viewport checks:
   - 900x1400
   - 768x1365
   - 600x1024
2. Keyboard-only checks:
   - Pane switcher buttons
   - Chat prompt and send flow
3. Regression checks:
   - Existing chat/orchestration tab behavior
   - Embedded browser tab availability
   - Landscape panel resizing
