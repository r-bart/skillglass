# Implementation Plan: Forge handoff style fidelity

**Date**: 2026-08-26  
**Status**: Complete  
**Audit**: `thoughts/reviews/2026-08-26_forge-handoff-style-fidelity.md`

---

## Overview

Rebuild Forge's presentation layer so the supported MVP surfaces reproduce the visual language and desktop geometry of `thoughts/handoff/App.dc.html` at 1420×892, while preserving the implemented product contracts, semantic controls, keyboard behavior, safe operations and responsive cross-platform layout.

This is a visual-fidelity project, not authorization to restore features excluded by `thoughts/PRODUCT.md`.

## Requirements

- [x] Treat `App.dc.html` as the visual source of truth for shared surfaces and primitives.
- [x] Preserve current product behavior, DTOs, IPC boundaries and immutable business-value tests.
- [x] Match the 1420×892 handoff geometry and density for desktop reference captures.
- [x] Use the handoff's exact colors, borders, radii, typography, glass and metal treatments.
- [x] Keep all interactions semantic, keyboard-operable and correctly labelled.
- [x] Keep the application resizable and usable at the existing minimum 760×520.
- [x] Preserve reduced-motion and forced-colors variants.
- [x] Prevent document-level scrolling; only content panels and sheets may scroll.
- [x] Add deterministic visual regression coverage and geometric assertions.
- [x] Do not modify `tests/spec/forge-mvp.e2e.spec.ts`.

## Non-goals

- Graph view or inferred dependencies.
- Remote discovery or `skills.sh` marketplace.
- AI generation, arbitrary URL installation or trigger telemetry.
- Activation/deactivation, uninstall/delete, move/copy or implicit forking.
- Fake macOS traffic lights or a macOS-only renderer.
- Replacing native path, evidence, preview, journal, undo or recovery behavior with prototype data.

---

## Approach Analysis

### Option A: Token-only CSS reskin

**Description**: Replace the current colors, radii and typography while keeping the existing DOM and layout.

**Pros**: Small diff; lowest immediate regression risk.  
**Cons**: Cannot reproduce the compact topbar, sidebar scopes, dense list, persistent inspector, pending hierarchy or sheets. The header would still wrap and the filters would still dominate the viewport.  
**Complexity**: Low.  
**Verdict**: Reject.

### Option B: Copy the Design Component into React

**Description**: Port the handoff markup and state model nearly verbatim.

**Pros**: Fastest route to a superficial screenshot match.  
**Cons**: Reintroduces simulated and prohibited behavior; replaces evidence-backed data with mock assumptions; loses semantic controls and multiplatform behavior.  
**Complexity**: High and unsafe.  
**Verdict**: Reject.

### Option C: Reference-faithful presentation refactor

**Description**: Define exact visual tokens and reusable presentation primitives, then recompose existing product surfaces around the handoff's shell, density and materials. Keep production state and operations intact.

**Pros**: Achieves fidelity without violating product contracts; produces maintainable primitives and testable geometry; supports responsive variants.  
**Cons**: Touches several renderer components and requires deliberate test fixtures and screenshot review.  
**Complexity**: Medium–High.  
**Verdict**: Recommended.

## Visual Contract

### Canonical viewport

- Reference content viewport: **1420×892**.
- Topbar: **46 px**.
- Sidebar: **226 px**.
- Inspector when open: **326 px**.
- Main column with inspector open: **868 px**.
- No page-level vertical or horizontal scroll at the reference viewport.

The preferred window size should be clamped to the active display's work area. `useContentSize` should make the web-content target explicit. Smaller screens use responsive modes; they do not scale the entire UI down.

### Tokens to encode exactly

| Token | Value |
|---|---|
| App background | `#0b0b0d` |
| Topbar | `#101013` |
| Sidebar / inspector | `#0e0e11` |
| Raised surface | `#131317` |
| Sheet | `#111115` |
| Recessed field | `#0d0d10` |
| Primary text | `#f4f4f6` |
| Secondary text | `rgba(244,244,246,.5)` |
| Tertiary text | `rgba(244,244,246,.34)` |
| Subtle borders | `rgba(255,255,255,.06)` through `.16`, normally `.5px` |
| Row radius | `11px` |
| Card radius | `12px` |
| Sheet radius | `14px` |
| Pill radius | `999px` |
| Success | `oklch(.72 .15 152)` |
| Attention | `oklch(.78 .15 82)` |
| Error | `oklch(.62 .19 26)` |
| Idle | `#3a3a42` |
| Hover duration | `140ms` |
| State duration | `180–260ms` |
| Standard easing | `cubic-bezier(.32,.72,0,1)` |

Metal primary, dark primary, glass selection and danger treatments must be copied from the handoff as named CSS primitives rather than repeated declarations.

### Typography

- UI stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, sans-serif` with platform fallbacks after it.
- Mono stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Surface title: 22 px / 1.2 / 600 / `-.018em`.
- Row name: 13–13.5 px / 600.
- Body and helper copy: 11.5–12.5 px.
- Section and field labels: 9.5 px / 600 / `.11em` / uppercase / mono.
- Use tabular numerals for counts, versions and timestamps.

---

## Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `apps/desktop/src/main/window.ts` | Modify | Preferred content size, platform titlebar integration and background color |
| `apps/desktop/src/main/window.test.ts` | Create | Assert platform-safe window options and canonical dimensions |
| `apps/desktop/src/renderer/main.ts` | Modify | Load the split style layers in deterministic order |
| `apps/desktop/src/renderer/styles/tokens.css` | Create | Exact handoff tokens, elevations and motion values |
| `apps/desktop/src/renderer/styles/foundation.css` | Create | Reset, typography, focus, forced colors and reduced motion |
| `apps/desktop/src/renderer/styles/shell.css` | Create | Topbar, sidebar, main, inspector and scrolling geometry |
| `apps/desktop/src/renderer/styles/components.css` | Create | Buttons, pills, fields, rows, tiles, cards, dialogs, diff and editor |
| `apps/desktop/src/renderer/styles/responsive.css` | Create | Compact and mobile adaptations |
| `apps/desktop/src/renderer/styles.css` | Replace | Compatibility entrypoint or remove after imports migrate |
| `apps/desktop/src/renderer/AppChrome.ts` | Create | Semantic topbar, sidebar navigation and compact action menus |
| `apps/desktop/src/renderer/VisualPrimitives.ts` | Create | Shared section labels, pills, metal/dark buttons, tile and surface header |
| `apps/desktop/src/renderer/App.ts` | Modify | Recompose shell, onboarding, operation status and modal entry points; reset panel scroll |
| `apps/desktop/src/renderer/inventory/Inventory.ts` | Modify | Compact toolbar, filters and handoff-style skill rows |
| `apps/desktop/src/renderer/inventory/Inspector.ts` | Modify | Persistent 326 px inspector, compact metadata rows and action footer |
| `apps/desktop/src/renderer/Pending.ts` | Modify | Group headers, compact rows, badges and batch bar |
| `apps/desktop/src/renderer/AccessibleDialog.ts` | Modify | Handoff sheet structure while preserving focus semantics |
| `apps/desktop/src/renderer/OperationPlanDetails.ts` | Modify | Dense operation plan presentation using the shared visual primitives |
| `apps/desktop/src/renderer/TextDiff.ts` | Modify if needed | Add stable hooks/classes for handoff diff treatment |
| `apps/desktop/src/renderer/CodeEditor.ts` | Modify if needed | Stable editor shell hooks and compact density |
| Existing renderer tests | Modify | Preserve semantic and behavioral assertions after recomposition |
| `tests/e2e/visual-fidelity.e2e.spec.ts` | Create | Geometry, scroll, responsive and screenshot assertions |
| `tests/e2e/visual-fidelity.e2e.spec.ts-snapshots/**` | Create | Platform-specific approved visual baselines |
| `playwright.config.ts` | Modify | Snapshot path/tolerance only if test-local options are insufficient |

`thoughts/handoff/**` and `tests/spec/forge-mvp.e2e.spec.ts` remain immutable references.

---

## Implementation Phases

### Phase 0: Freeze the acceptance contract

#### Task 0.1: Define reference states

Create deterministic visual scenarios for:

1. Onboarding with one proposed writable root.
2. Inventory with enough rows to prove density, mixed evidence/status values and no selection.
3. Inventory with one selected skill and open inspector.
4. Pending with update, conflict and validation groups.
5. Operation confirmation dialog with warnings and file diff.
6. Editor and history states.

The fixtures must use real DTO shapes and product-safe states; they must not invent activation, usage or remote registry facts.

#### Task 0.2: Record geometric assertions

At 1420×892 assert topbar, sidebar, main and inspector rectangles; document scroll dimensions; and verify that header actions do not wrap. At 1180×760 and 760×520 assert the intended compact modes.

#### Task 0.3: Protect immutable behavior

Run and record the current business suite hash before UI changes. Do not edit the immutable test file.

### Phase 1: Tokens and primitives

#### Task 1.1: Install the exact visual tokens

Move the handoff values into `tokens.css`. Remove the generic yellow accent from selection/navigation and reserve semantic colors for evidence/status. Define every consumed custom property, including radius, danger and shadows.

#### Task 1.2: Build shared visual primitives

Create semantic wrappers for:

- metal, dark, quiet and danger actions;
- status pills and removable filter chips;
- mono uppercase section labels;
- skill tile/glyph variants derived from stable product data, never random;
- glass-selected rows;
- compact surface headers.

Visual wrappers must accept native buttons/links and retain disabled, focus-visible and high-contrast behavior.

#### Task 1.3: Establish typography and focus

Replace landing-page scale with the tool-density scale. Keep focus visible and distinct; blue may be used for editing focus as in the handoff, while selection remains glass.

### Phase 2: Window and shell

#### Task 2.1: Configure the preferred desktop window

Compute a preferred 1420×892 content size clamped to the display work area. Keep 760×520 as a supported minimum. Use native platform controls:

- macOS: evaluate `titleBarStyle: "hiddenInset"` and native traffic lights integrated into the 46 px topbar;
- Windows/Linux: use the supported titlebar overlay or retain native decorations when that is more reliable, reserving the overlay area in CSS.

Do not render fake traffic lights.

#### Task 2.2: Rebuild the app chrome

At the reference viewport, implement:

- 46 px topbar;
- brand/context at the left without the yellow `F` tile;
- inventory search in the center when relevant;
- pending status and compact action entry points at the right;
- 226 px sidebar with scopes first and views second;
- 326 px inspector when a selection exists.

Product-safe actions should be consolidated into compact menus: for example, installation sources in one menu and history as a quiet action. Labels must describe the real capability rather than copy “Nueva skill” blindly.

#### Task 2.3: Fix scroll ownership and navigation reset

Make the shell exactly viewport-height. Give independent overflow to main content, inventory rows, inspector and dialogs. Reset the active content panel to its start on surface changes and after onboarding approval; do not mutate the window's document scroll position as a substitute for panel scroll.

### Phase 3: Inventory and inspector

#### Task 3.1: Move scope and search into the handoff hierarchy

Use the sidebar for `Esta máquina`, `Global` and evidenced projects. Put search in the topbar. Preserve accessible labels and keyboard focus commands.

#### Task 3.2: Replace the filter wall with progressive disclosure

Keep every current filter, but expose only high-signal summaries and active chips in the inventory header. Put the complete filter set in an accessible popover/sheet. Preserve grouping and sorting in compact controls.

#### Task 3.3: Build dense skill rows

Render 52 px rows at the reference viewport with:

- semantic selectable row behavior and arrow-key navigation;
- deterministic health/evidence marker with textual equivalent;
- tile/glyph;
- name, scope and one-line description;
- compact independent status pills for validity/source/update as evidence permits;
- declared version only when observed;
- glass selection matching the handoff.

Do not collapse independent product statuses into the handoff's synthetic `health` field.

#### Task 3.4: Recompose the inspector

Use a 326 px panel with compact header, description, actions, metadata rows and internal scroll. Preserve exact paths, evidence labels, findings, requirements, files, precedence and provenance. Move primary actions into a sticky footer patterned after the handoff. Long paths and hashes must wrap or scroll without widening the panel.

When no installation is selected, collapse the inspector at wide widths or render a deliberate narrow empty state; choose one behavior and capture it as a baseline. The selected state must match the 326 px reference.

### Phase 4: Pending, onboarding and sheets

#### Task 4.1: Recompose Pending

Match the handoff's grouped hierarchy: mono group labels with semantic dots, explanatory note, compact rows, contextual badge and pill action. Preserve the rule that only homogeneous update selections receive an update batch action.

#### Task 4.2: Extrapolate onboarding from the same system

Onboarding has no final handoff screen. Use the sheet/card, section-label, field and button primitives without inventing a new hero style. Keep approval evidence, native selection and safety copy visible. The screen should feel native to the handoff while remaining explicitly an MVP addition.

#### Task 4.3: Restyle all dialogs as handoff sheets

Apply `#111115`, 14 px radius, `.5px` border, exact shadow, compact header/body/footer and metal/dark actions to install, operation preview, history and pending-plan dialogs. Preserve focus trap, Escape handling, `aria-labelledby`, initial focus and focus restoration.

#### Task 4.4: Present editor and history as sheets

Keep the real CodeMirror editor and persistent history, but use the handoff editor/history geometry, internal scrolling and footer actions. Managed/read-only entries remain inspect-only; no implicit fork is added.

### Phase 5: Responsive and accessibility hardening

#### Task 5.1: Define three deliberate layout modes

- **Reference desktop**: ≥1280 px, three columns and exact 1420×892 target.
- **Compact desktop/tablet**: 960–1279 px, sidebar retained or compacted; inspector becomes a controlled side sheet instead of falling below the page.
- **Narrow**: 760–959 px and below, navigation disclosure plus full-width main; inspector and filters are accessible sheets.

Avoid a breakpoint equal to the default window width.

#### Task 5.2: Revalidate accessibility modes

Verify keyboard-only onboarding, search, rows, inspector, editor, dialogs and pending. Validate 200% scaling, high contrast, reduced motion, focus visibility and touch-sized controls in narrow mode. Color and opacity must never be the only status indicator.

### Phase 6: Visual regression and final QA

#### Task 6.1: Add visual E2E coverage

Use Playwright `toHaveScreenshot` with named, platform-specific baselines. Pin the Electron/runtime environment used to approve macOS goldens. Mask only genuinely volatile values such as temporary absolute paths and timestamps; do not mask layout regions.

#### Task 6.2: Compare against the handoff

For the first approval, produce side-by-side and 50% overlay comparisons at 1420×892 for inventory/inspector, pending and representative sheets. Record deviations intentionally caused by product-contract differences.

#### Task 6.3: Run full gates

Run typecheck, lint, unit/integration tests, immutable business E2E, visual E2E, keyboard/accessibility E2E and packaging smoke. Review snapshots rather than updating them automatically after a failure.

---

## Task Dependencies

```yaml
dependencies:
  0.1: []
  0.2: ["0.1"]
  0.3: []
  1.1: ["0.1"]
  1.2: ["1.1"]
  1.3: ["1.1"]
  2.1: ["0.2"]
  2.2: ["1.2", "1.3", "2.1"]
  2.3: ["2.2"]
  3.1: ["2.2"]
  3.2: ["3.1"]
  3.3: ["1.2", "3.1"]
  3.4: ["1.2", "2.2", "3.3"]
  4.1: ["1.2", "2.2"]
  4.2: ["1.2", "2.2"]
  4.3: ["1.2", "1.3"]
  4.4: ["3.4", "4.3"]
  5.1: ["2.3", "3.4", "4.1", "4.2", "4.3", "4.4"]
  5.2: ["5.1"]
  6.1: ["0.1", "5.2"]
  6.2: ["6.1"]
  6.3: ["6.2"]
```

---

## Risk Analysis

### Product risks

- A literal port could restore prohibited actions or synthetic status. Mitigation: audit every visible control against `PRODUCT.md` and BV-10.
- Compacting filters could make advanced evidence filters harder to discover. Mitigation: visible active chips, labelled filter entry point and preserved keyboard access.
- Moving editor/inspector presentation could alter test locators or focus. Mitigation: preserve roles/names and extend semantic tests before visual snapshots.

### Technical risks

- Custom titlebars vary across macOS, Windows and Linux. Mitigation: use supported native overlay APIs, platform branches and native packaging smoke tests.
- Font rendering makes cross-platform pixel equality unrealistic. Mitigation: per-platform goldens and exact geometry/token assertions independent of raster output.
- Long real paths can break the fixed inspector. Mitigation: explicit overflow/wrapping fixtures with macOS, Windows and Linux paths.
- Screenshot baselines can become approval-by-update. Mitigation: documented manual overlay for the initial baseline and reviewed snapshot changes only.
- Splitting CSS can introduce cascade-order drift. Mitigation: deterministic import order and component-level class ownership.

### Edge cases

- No approved roots, no inventory items, no pending items and no selected item.
- One item versus hundreds of paginated items.
- Unknown evidence for every field.
- Very long project, package and skill names.
- Windows drive/UNC paths and POSIX paths.
- Operation warning/conflict lists that exceed sheet height.
- 200% display scaling and narrow work areas smaller than the preferred handoff size.

---

## Testing Strategy

### Unit/component tests

- Preserve roles, names, keyboard navigation and absence of prohibited controls.
- Test compact action menus, filter disclosure and selection state.
- Test window option calculation per platform and work-area size.
- Test status-to-visual mapping without reducing independent status dimensions.

### Electron E2E

- Geometry at 1420×892, 1180×760 and 760×520.
- `document.scrollingElement.scrollHeight === clientHeight` at the reference viewport.
- Surface navigation begins at panel scroll position zero.
- Inspector remains reachable without page scrolling in reference and compact modes.
- Header actions do not wrap.
- Keyboard-only flows remain green.

### Visual E2E

- Onboarding.
- Inventory empty, populated and selected-inspector states.
- Pending grouped state and empty state.
- Operation plan, history and editor sheets.
- Reduced-motion snapshot where animation could affect stability.

Visual comparisons must run in the same pinned environment as their baseline, as recommended by Playwright.

---

## Done Criteria

### Visual foundation

- [x] Computed reference tokens equal the values in the Visual Contract.
- [x] No undefined custom property is consumed by production CSS.
- [x] `rg "var\(--(radius|shadow-large|danger)" apps/desktop/src/renderer` finds no unresolved token use.

### Reference desktop

- [x] At 1420×892, topbar is 46 px ±0.5 px.
- [x] Sidebar is 226 px ±1 px.
- [x] Selected inspector is 326 px ±1 px.
- [x] Main column is 868 px ±2 px with the inspector open.
- [x] Header actions remain on one line.
- [x] The document has no page-level overflow; list, inspector and sheets own their scroll.
- [x] Surface title computes to 22 px and inventory rows to 52 px in the reference state.

### Product and accessibility

- [x] No activation, deactivation, delete, uninstall, move, remote install, AI generation or synthetic usage control is introduced.
- [x] Exact evidence, paths, previews, journal state and undo remain visible.
- [x] Keyboard-only onboarding, inventory, inspector, editor and confirmation pass.
- [x] Reduced-motion and forced-colors tests pass.
- [x] 760×520 remains usable without inaccessible off-screen controls.

### Visual verification

- [x] Approved macOS snapshots exist for all reference states.
- [x] Initial side-by-side/overlay review records every intentional deviation from the handoff.
- [x] Subsequent `pnpm test:e2e` runs fail on unapproved visual drift.

### Repository gates

- [x] Immutable suite hash remains `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`.
- [x] `pnpm typecheck` passes.
- [x] `pnpm lint` passes.
- [x] `pnpm test` passes.
- [x] `pnpm test:e2e` passes.
- [x] `pnpm package` and packaged launch smoke pass on the active native platform.
- [x] `git diff --check` passes.

## Execution Record

- Implemented in dependency order from acceptance scaffolding through tokens, chrome, inventory, inspector, sheets, responsive/accessibility hardening and visual approval.
- Approved seven macOS reference snapshots and twelve versioned comparison assets for inventory/inspector, pending, editor and history.
- Stabilized visual fixtures without masking layout, and made equal-name inventory ordering deterministic by adapter, scope, canonical path and installation ID.
- Final verification on Node 24.19.0 / pnpm 11.5.1: typecheck and lint pass; 40 test files and 289 unit/integration tests pass; 30/30 Electron E2E tests pass; native macOS package and SQLite reopen smoke pass.
- Implementation commits: `209f517`, `b5f71fc`, `638a60e`, `2ac72a1`, `986185e`, `764bebb`, `e77cf3b`, `a384845`, `5a92d79`, `24e6cb4`, `fbf8d88`, `99ab1cd`, `a95754e`.

---

## Approval Question

Approve Option C with this scope definition:

> 1:1 means exact visual fidelity at 1420×892 for supported surfaces and shared primitives; product behavior, evidence, accessibility and responsive adaptations remain governed by the implemented MVP contracts.
