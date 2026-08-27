# Implementation Plan: Skill workspace with inline diff

**Date**: 2026-08-27  
**Status**: Complete  
**Prototype**: `prototypes/editor-surface/?v=2`

---

## Overview

Replace the modal `SKILL.md` editor with a first-class skill workspace that owns the complete app body while preserving the existing local-first mutation contract. The workspace exposes three in-place modes—safe rendered preview, CodeMirror editing, and an exact inline review—then uses the current `update-entry-content` operation plan and confirmation path to perform the write.

This increment deliberately excludes agent analysis or rewriting. It establishes the stable reading, editing, review, save, conflict, and responsive foundations that a later intelligence layer can consume.

## Requirements

- [ ] Pressing `Editar` navigates from the inspector to a full-width skill workspace rather than opening `AccessibleDialog`.
- [ ] The global application topbar remains for native window controls; the workspace replaces the sidebar, inventory body, and inspector for the duration of the edit session.
- [ ] The workspace preserves the current Forge visual tokens, matte surfaces, typography, CodeMirror editor, status language, and operation feedback.
- [ ] The central body provides `Vista previa`, `Código`, and `Cambios (N)` modes without opening a second editor surface.
- [ ] `Vista previa` renders the current draft as inert Markdown; raw HTML, links, images, directives, and scripts remain unexecuted.
- [ ] `Código` retains the current line-numbered, wrapping CodeMirror experience and keyboard access.
- [ ] `Revisar cambios` requests a real `update-entry-content` plan before exposing the confirmation state.
- [ ] `Cambios` renders additions and removals inline with old/new line numbers, `+`/`−` markers, text labels for assistive technology, and green/red surface treatment that is never the only signal.
- [ ] The diff wraps safely at narrow widths and 200% zoom; it must not widen the document or require page-level horizontal scrolling.
- [ ] `Volver a editar`, `Descartar cambios`, and `Actualizar skill` are functional and keep planning distinct from applying.
- [ ] A successful update remains on the skill workspace, reloads the committed observation, resets the draft baseline, and switches to the rendered preview.
- [ ] External edits or watcher refreshes never rebase or overwrite a dirty draft silently; the edit session retains its opening snapshot and reports a stale/conflict result.
- [ ] Returning to the inventory preserves the current scope, query/list state, selection, and focus target.
- [ ] Read-only and managed installations continue to omit the `Editar` action.
- [ ] Undo, persistent snapshots, recovery, operation history, and backend authorization remain unchanged.
- [ ] Existing immutable business-value tests remain byte-for-byte unchanged and passing.

## Non-goals

- Agent feedback, AI analysis, rewriting, trigger simulation, or conversational UI.
- Editing files other than the observed entry `SKILL.md`.
- Three-way merge or automatic reconciliation of external edits.
- Changing IPC DTOs, filesystem permissions, snapshot retention, journaling, undo, or recovery behavior.
- General application routing or adding a router dependency.
- Reworking source-managed updates, installation confirmation, Pending, or History.
- Collapsing Forge's independent validity, source, runtime, and update dimensions into one synthetic health value.

---

## Existing Contracts and Reusable Foundations

- `ContentUpdateCoordinator` already rejects stale snapshots and external file changes, registers a persisted plan, stages the replacement, snapshots the original, verifies the result, and supports restart-safe undo.
- `OperationRequestDto` already carries the exact draft through `update-entry-content`; no contract or preload change is needed.
- `CodeEditor` already provides CSP-authorized CodeMirror styles, Markdown language support, line numbers, line wrapping, and accessible textbox semantics.
- `SafeMarkdown` already emits inert React text and deliberately refuses active Markdown features.
- `OperationPlanDetails` already exposes affected paths, preconditions, warnings, conflicts, scope, recovery, and undo evidence.
- `TextDiff` already has accessible added/removed/context classes, but its current prefix/suffix algorithm supports only one coarse hunk and has no line-number model.
- The immutable suite `tests/spec/forge-mvp.e2e.spec.ts` covers direct-edit preview, non-mutation before confirmation, commit, restart, and undo. Its SHA-256 must remain `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`.

---

## Approach Analysis

### Option A: Enlarge the existing editor dialog

**Description**: Make `.editor-sheet` nearly viewport-sized and add Preview/Code/Changes controls inside it.

**Pros**: Smallest component diff; keeps existing local state and focus trap.  
**Cons**: Still reads as a transient overlay, obscures navigation context, retains nested dialog review, and fails the selected “first-class page” direction.  
**Complexity**: Low.  
**Verdict**: Reject.

### Option B: Full-screen portal owned by `Inspector`

**Description**: Keep all state in `Inspection`, but render a fixed, non-modal overlay above the shell.

**Pros**: Reuses current callbacks with limited state movement; inventory remains mounted.  
**Cons**: Couples a viewport-level destination to the inspector, complicates focus and responsive ownership, creates fragile z-index behavior, and is visually full-screen without being real navigation.  
**Complexity**: Medium.  
**Verdict**: Reject.

### Option C: App-owned skill workspace route

**Description**: Add a small route-like state object to `App` for the active installation and opening mode. `Inspector` delegates edit navigation upward; a dedicated `SkillWorkspace` loads the installation, owns the immutable edit baseline/draft/plan, and takes over the complete app body. The existing inventory and inspector stay mounted but hidden/inert so their state and return-focus target survive.

**Pros**: Matches the selected prototype; creates a durable home for later agent review; cleanly separates inventory inspection from editing; preserves application context and current mutation guarantees; avoids a router dependency.  
**Cons**: Requires deliberate App shell composition, state extraction from the large Inspector component, and updates to visual/accessibility fixtures.  
**Complexity**: Medium–High.  
**Verdict**: Recommended.

### Diff implementation choice

#### Option C1: Add a CodeMirror merge dependency

**Description**: Introduce a merge-view package and render the review through a second editor configuration.

**Pros**: Rich editor-native decorations and mature interaction patterns.  
**Cons**: Adds dependency and theming/accessibility work, risks a split-pane bias at narrow widths, and is unnecessary for the first read-only review increment.  
**Verdict**: Defer.

#### Option C2: Evolve the existing `TextDiff`

**Description**: Extract a deterministic line-diff model and render it as an accessible unified review surface sharing Forge's editor geometry.

**Pros**: No dependency change; full control over responsive wrapping, semantics, and forced-colors; directly replaces current production code.  
**Cons**: Requires bounded algorithm design and focused unit coverage.  
**Verdict**: Recommended.

## Architectural Decisions

1. **App-body navigation, not a modal**: retain the global topbar for drag regions and native window controls; hide/inert the library sidebar, inventory content, and inspector while the workspace owns the complete remaining viewport.
2. **Session baseline is immutable**: capture `baseContent` and `baseSnapshotId` when the workspace loads. Watcher-driven observations may update status messaging, but they do not replace a dirty session's baseline.
3. **Backend plan remains authoritative**: local diff/count calculation is presentation-only. The confirmation view is entered only after `operations.plan(...)` succeeds for the opening snapshot and current draft.
4. **Inline confirmation remains a semantic dialog region**: the `Cambios` body exposes a non-modal `role="dialog"` labelled `Confirmar actualización`, visually in-flow and without a backdrop or focus trap. This preserves a distinct confirmation context and the immutable BV-6 selector while satisfying the same-page design.
5. **Plan invalidation is explicit**: changing the draft after returning from review clears the renderer's active plan; a fresh `Revisar cambios` call is required.
6. **Save stays in context**: after commit, re-inspect the installation, reset the baseline, show `Vista previa`, announce the result, and retain access to History/Undo through the existing topbar.
7. **No page-level scrolling**: the workspace body, preview article, editor, diff, and facts/plan aside own their scroll independently.
8. **Responsive diff changes structure, not scale**: desktop shows old and new line-number columns; narrow/200%-zoom mode shows one effective line number, wraps prose/code, and keeps markers plus assistive labels.

## Workspace State Model

```ts
type SkillWorkspaceRoute = {
  installationId: string
  initialMode: "preview" | "code"
}

type WorkspaceMode = "preview" | "code" | "changes"

type EditSession = {
  detail: InstallationDetailDto
  baseContent: string
  baseSnapshotId: string
  draft: string
  mode: WorkspaceMode
  plan?: OperationPlanDto
  planning: boolean
  applying: boolean
  error?: string
}
```

State transitions:

```text
Inspector.Editar
  → loading workspace
  → code(base snapshot)
  → preview(draft) ↔ code(draft)
  → review request
      → planning
      → changes(plan + exact diff)
          → code (plan cleared)
          → discard (draft reset, plan cleared)
          → confirm
              → committed → reload observation → preview(clean)
              → conflict/stale → changes(error, no write)
  → back
      → clean: inventory
      → dirty: discard confirmation → inventory | continue editing
```

---

## Files to Create/Modify

| File | Action | Purpose |
|---|---|---|
| `thoughts/PRODUCT.md` | Modify | Record the first-class skill workspace and its Preview/Code/Changes behavior; keep AI outside this increment |
| `apps/desktop/src/renderer/SkillWorkspace.ts` | Create | Own detail loading, baseline/draft/plan state, navigation modes, context facts, review, confirm, stale handling, and focus behavior |
| `apps/desktop/src/renderer/SkillWorkspace.test.ts` | Create | Cover workspace state transitions, exact operation inputs, conflict behavior, safe save, and focus/return flows |
| `apps/desktop/src/renderer/SafeMarkdown.ts` | Create | Extract and improve the inert renderer so Inspector and workspace share one implementation |
| `apps/desktop/src/renderer/SafeMarkdown.test.ts` | Create | Verify inert HTML/directives/links/images, headings, grouped lists, code fences, and draft rendering |
| `apps/desktop/src/renderer/TextDiff.ts` | Modify | Introduce a bounded multi-hunk line model, line numbers, markers, accessible labels, compact fallback, and change counts |
| `apps/desktop/src/renderer/TextDiff.test.ts` | Create | Verify additions, deletions, replacements, disjoint hunks, empty/trailing lines, bounds, and accessible output |
| `apps/desktop/src/renderer/CodeEditor.ts` | Modify | Add a controlled focus hook and `Mod-Enter` review shortcut without changing CSP or document ownership |
| `apps/desktop/src/renderer/inventory/Inspector.ts` | Modify | Remove modal direct-edit state; extract `SafeMarkdown`; delegate `Editar` to App with installation ID and return-focus element |
| `apps/desktop/src/renderer/inventory/Inspector.test.ts` | Modify | Replace sheet-specific expectations with delegation/read-only/source-preview tests; retain source-update coverage |
| `apps/desktop/src/renderer/App.ts` | Modify | Add route-like workspace state, keep library mounted hidden/inert, own navigation/return focus, and pass operation/inventory bridges |
| `apps/desktop/src/renderer/AppChrome.ts` | Modify | Allow the topbar context and global operation visibility to reflect the active skill workspace without adding a sidebar destination |
| `apps/desktop/src/renderer/App.test.ts` | Modify | Cover entering/exiting workspace, hidden/inert library preservation, focus restoration, and successful status propagation |
| `apps/desktop/src/renderer/styles/shell.css` | Modify | Add workspace shell mode that hides sidebar/inspector and removes main-content padding while retaining viewport ownership |
| `apps/desktop/src/renderer/styles/components.css` | Modify | Add workspace header, tabs, preview typography, editor frame, inline diff, operation facts, actions, and dirty/error states; retire editor-sheet rules |
| `apps/desktop/src/renderer/styles/responsive.css` | Modify | Add single-column context disclosure, compact diff numbering/wrapping, 200%-zoom behavior, and 44 px touch targets |
| `tests/e2e/accessibility-keyboard.e2e.spec.ts` | Modify | Replace modal editor assertions with page-navigation, inline confirmation, keyboard, focus restoration, zoom, save, and restart-safe undo assertions |
| `tests/e2e/visual-fidelity.e2e.spec.ts` | Modify | Capture and geometrically assert preview, code, inline changes, desktop, compact, and narrow workspace states |
| `tests/e2e/support/forge-visual-fixture.ts` | Modify | Add deterministic workspace preview/code/diff scenarios using real DTO and operation-plan shapes |
| `tests/e2e/visual-fidelity.e2e.spec.ts-snapshots/editor-macos-darwin.png` | Replace | Approve the selected full-page code workspace baseline |
| `tests/e2e/visual-fidelity.e2e.spec.ts-snapshots/skill-preview-macos-darwin.png` | Create | Rendered skill page baseline |
| `tests/e2e/visual-fidelity.e2e.spec.ts-snapshots/skill-diff-macos-darwin.png` | Create | Inline unified diff baseline |
| `prototypes/editor-surface/**` | Delete after acceptance | Remove the throwaway prototype only after production parity is verified |
| `tests/spec/forge-mvp.e2e.spec.ts` | **Do not modify; make pass** | Immutable BV-6 direct-edit/preview/undo contract |

No changes are planned for `packages/contracts`, preload/IPC, `ContentUpdateCoordinator`, operation storage, snapshots, or filesystem execution.

---

## Implementation Phases

### Phase 0: Freeze acceptance and preserve the working tree

#### Task 0.1: Record the chosen experience contract

Update `thoughts/PRODUCT.md` so “Editor and history” explicitly states:

- editing is a first-class skill workspace;
- Preview/Code/Changes are modes of one destination;
- the backend plan remains mandatory before applying;
- agent intelligence is deferred.

Do not weaken existing evidence, write-boundary, preview, snapshot, or undo requirements.

#### Task 0.2: Lock current acceptance references

- Record the current immutable suite hash.
- Capture the selected prototype states at desktop and narrow widths as implementation references.
- Treat all pre-existing modified files as user-owned; do not reset or overwrite unrelated work.
- Run the focused current direct-edit tests before structural changes to distinguish existing failures from regressions.

Completion record (2026-08-27):

- [x] Confirmed `tests/spec/forge-mvp.e2e.spec.ts` at SHA-256 `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`; its scoped Git diff is empty.
- [x] Captured reproducible Code, Preview, and Changes references from `prototypes/editor-surface/?v=2` at exact 1420×892 and 760×520 viewports without modifying the prototype.
- [x] Stored the capture script, source/image hashes, environment manifest, screenshots, commands, and results under `thoughts/research/artifacts/skill-workspace-inline-diff/`.
- [x] Focused renderer edit tests pass: 2 files, 22 tests. Focused packaged Electron edit tests pass: 3 tests, including immutable BV-6.
- [x] Recorded two pre-existing non-edit E2E failures observed in an over-broad baseline run (BV-2 missing `Esta máquina` control and BV-5 ambiguous `Solo lectura` selector) and the Node 22 SQLite environment mismatch in the evidence README.
- [x] Preserved the pre-existing working tree; no production, test, or prototype file was changed by Task 0.2.

### Phase 1: Shared safe content and diff foundations

#### Task 1.1: Extract the inert Markdown renderer

Move `markdownBody` and `SafeMarkdown` out of `Inspector.ts` into `SafeMarkdown.ts`.

Preserve the security model:

- every source token is emitted as React text;
- frontmatter is omitted from rendered body but remains visible in Code;
- raw HTML, Markdown links, images, directives, and scripts are not interpreted;
- adjacent list items are grouped into one semantic list;
- code fences remain literal code.

Add unit tests before changing presentation styles.

#### Task 1.2: Build a bounded exact line-diff model

Refactor `TextDiff.ts` into a pure model plus renderer:

```ts
type DiffRow = {
  kind: "context" | "added" | "removed"
  text: string
  beforeLine?: number
  afterLine?: number
}

type TextDiffModel = {
  rows: readonly DiffRow[]
  added: number
  removed: number
  changed: boolean
  simplified: boolean
}
```

Algorithm requirements:

1. Strip the common prefix and suffix first.
2. Produce minimal multi-hunk output for a bounded changed middle.
3. If the line-count/cross-product guard is exceeded, fall back to an exact but non-minimal removed/added block rather than freezing the renderer.
4. Preserve empty lines and trailing-newline differences.
5. Collapse only long unchanged spans, with an explicit textual row stating how many lines were omitted.
6. Never use a quadratic table for unbounded 10 MiB input.

Render desktop old/new line columns and a compact effective line column at narrow widths. Use `+`/`−`, visually hidden “línea añadida/eliminada” text, and semantic status colors.

#### Task 1.3: Extend CodeMirror integration minimally

Add a focus-ready callback/ref and a `Mod-Enter` key binding that delegates to workspace review only when the draft is dirty and no operation is busy. Retain line wrapping, nonce-authorized generated styles, editor-owned document updates, and platform-native undo/redo.

### Phase 2: Build `SkillWorkspace`

#### Task 2.1: Load and freeze an edit session

On mount, call `inventory.inspect({ installationId })`, then capture:

- full `InstallationDetailDto`;
- immutable `baseContent` and `baseSnapshotId`;
- editable `draft` initialized from the base;
- initial mode `code` when opened through `Editar`.

Show explicit loading, not-found, read-only, and inspect-error states. If capability changes to read-only before editing begins, do not mount the editor.

#### Task 2.2: Compose the first-class layout

Build:

- header with Back, stable skill tile, name, adapter/scope, evidenced update status, Discard, and Review;
- semantic tabs for `Vista previa`, `Código`, and `Cambios (N)`;
- central preview/editor/diff panel;
- observed context aside with location, manager, snapshot, and safety statement;
- footer/status region for local-draft and operation messaging.

Use the production DTO and status maps; do not copy mock snapshot values or status assumptions from the prototype.

#### Task 2.3: Implement Preview and Code modes

- Preview renders the current draft, not only the opening content.
- Code keeps the editor mounted while switching modes so undo history and selection are not lost.
- Dirty state is derived from `draft !== baseContent`; no separate boolean may drift.
- Changes count comes from the diff model and is presented textually.
- Discard restores `baseContent`, clears the renderer plan/error, and keeps the session open in Code.

#### Task 2.4: Plan and render Changes inline

`Revisar cambios` and `Mod-Enter` call:

```ts
operationBridge.plan({
  kind: "update-entry-content",
  installationId,
  expectedSnapshotId: baseSnapshotId,
  content: draft,
})
```

Only after a planned response:

- switch to `changes`;
- render an in-flow, non-modal `role="dialog"` named `Confirmar actualización`;
- show `TextDiff` in the main panel;
- show path, `OperationPlanDetails`, expiry/recovery/undo evidence, warnings, conflicts, and errors without hiding the diff;
- focus the primary `Actualizar skill` action;
- let Escape/`Volver a editar` return to Code and restore focus to `Revisar cambios`.

Blocked/expired plans never expose an enabled confirm action.

#### Task 2.5: Confirm, reload, and retain context

Confirm only the exact active `planId`. While applying, disable all draft/navigation mutations and announce progress. On `committed`:

1. announce the operation result through App's existing status surface;
2. call `inventory.inspect` again;
3. replace detail/base/draft with the committed observation;
4. clear the plan and dirty state;
5. switch to Preview;
6. keep History available for persistent undo.

On conflict/stale/failure, preserve the draft and inline diff, clear or disable the invalid plan, and offer `Volver a editar`, `Recargar desde disco` (destructive confirmation required), or retry planning as applicable. Do not merge automatically.

### Phase 3: Integrate navigation and simplify Inspector

#### Task 3.1: Add App-owned workspace routing

Add `SkillWorkspaceRoute | undefined` state to `App`. Do not add `skill` to primary sidebar destinations and do not introduce URL/router machinery.

When a workspace opens:

- retain `activeSurface`, inventory scope, selected installation, and mounted Inventory/Inspector instances;
- mark the library subtree `hidden` and `inert`;
- hide sidebar and inspector through the workspace shell mode;
- let main content occupy the full app body with zero outer padding;
- update AppTopbar context and suppress unrelated install/update actions while retaining History.

#### Task 3.2: Delegate editing from Inspector

Remove `editing`, content-plan state, `editor-sheet`, and direct content confirmation from `Inspection`. Keep source-update planning/conflict dialogs unchanged.

Add an `onEditEntry` callback that passes the installation ID and trigger element to App. Read-only capability behavior remains unchanged.

#### Task 3.3: Implement back and unsaved-change protection

- Clean Back returns immediately to the preserved inventory and restores focus to the original `Editar` trigger.
- Dirty Back/Escape opens the existing accessible destructive-confirmation pattern; it never discards silently.
- Cancelling the discard returns focus to the workspace control that initiated it.
- Confirming discard closes the workspace and restores inventory focus after the hidden/inert state is removed.

### Phase 4: Production styling and responsive behavior

#### Task 4.1: Port the selected visual language

Translate the accepted prototype using existing Forge tokens rather than importing prototype CSS. Implement the workspace header, tabs, centered preview measure, CodeMirror frame, context aside, inline diff, and sticky actions in the current plain-CSS system.

Retire `.editor-sheet*` styles only after no production component or test references them.

#### Task 4.2: Define scroll ownership

- `html/body/#root/app-shell` stay viewport-locked.
- Preview article, CodeMirror scroller, diff body, and context/plan aside own overflow.
- Tabs/header/actions remain visible.
- Switching mode resets only the newly active panel's scroll position; returning to Code preserves editor cursor/selection.
- No fade overlays cover scrollable content.

#### Task 4.3: Implement responsive modes

At wide desktop, use a main content column plus approximately inspector-width facts aside. At compact and 200%-zoom widths:

- collapse facts/plan into a labelled disclosure below or above the main panel;
- keep every action reachable with a 44 px target;
- wrap header actions without covering the title;
- use one compact diff line-number column;
- allow diff lines to wrap and use `overflow-wrap:anywhere` for paths/unbroken content;
- assert zero document-level horizontal overflow at the minimum 760×520 window and 200% zoom.

#### Task 4.4: Accessibility and alternate rendering modes

- Tabs use `tablist`/`tab`/`tabpanel`, arrow-key navigation, `aria-selected`, and controlled focus.
- Confirmation uses a labelled non-modal dialog region with a predictable initial focus.
- Dirty, planning, applying, committed, and error states are announced with `role=status`/`alert` without duplicating global announcements.
- Added/removed meaning survives forced colors and does not depend on color.
- Reduced motion removes non-essential transitions.
- Preview headings preserve a logical outline under the page's single `h1`.

### Phase 5: Tests, visual acceptance, and cleanup

#### Task 5.1: Unit and renderer integration tests

Add/modify tests for:

- safe Markdown security and formatting;
- exact bounded multi-hunk diff and compact semantics;
- workspace open/load/edit/preview/review/confirm/discard/back flows;
- exact `expectedSnapshotId` and draft sent to `operations.plan`;
- stale watcher refresh preserving the dirty opening baseline;
- plan conflict/expiry/failure without write;
- successful save re-inspection and clean Preview state;
- Inspector edit delegation and read-only omission;
- App hidden/inert library preservation and focus restoration.

#### Task 5.2: Keyboard and responsive E2E

Update the mutable accessibility suite to cover:

1. keyboard selection and `Editar` navigation;
2. heading/editor focus order;
3. CodeMirror line/gutter alignment and CSP nonce;
4. `Mod-Enter` review;
5. inline confirmation focus, Escape, and return focus;
6. commit, restart, History, and Undo;
7. dirty Back confirmation;
8. 200% zoom with readable Preview/Code/Changes and no page overflow.

#### Task 5.3: Visual and geometric acceptance

Capture deterministic baselines at:

- 1420×892: Preview, Code, and Changes;
- 1180×760: compact workspace;
- 760×520: narrow workspace;
- 760×520 at 200% zoom or equivalent CSS viewport.

Assert the app topbar remains stable, the workspace owns the full app body, sidebar/inspector are absent, panels stay within viewport, line markers align, and long content wraps without document overflow. Review screenshots side-by-side with the accepted prototype before approving new baselines.

#### Task 5.4: Preserve immutable acceptance and remove prototype

- Run `tests/spec/forge-mvp.e2e.spec.ts` without editing it.
- Confirm its SHA-256 is unchanged.
- Run the complete renderer and Electron suites.
- Delete `prototypes/editor-surface/**` only after production behavior and screenshots are accepted.
- Run the post-feature review and record any intentional visual baseline changes.

---

## Task Dependencies

```yaml
dependencies:
  0.1: []
  0.2: [0.1]
  1.1: [0.2]
  1.2: [0.2]
  1.3: [0.2]
  2.1: [1.1]
  2.2: [2.1]
  2.3: [1.1, 1.3, 2.2]
  2.4: [1.2, 2.3]
  2.5: [2.4]
  3.1: [2.1]
  3.2: [3.1]
  3.3: [2.3, 3.2]
  4.1: [2.5, 3.3]
  4.2: [4.1]
  4.3: [4.2]
  4.4: [4.1]
  5.1: [2.5, 3.3]
  5.2: [4.3, 4.4, 5.1]
  5.3: [4.3, 5.2]
  5.4: [5.1, 5.2, 5.3]
```

Parallelizable work:

- Tasks 1.1, 1.2, and 1.3 can proceed independently after acceptance freeze.
- Tasks 3.1 and the early state portion of 2.1 can proceed together once the component contract is fixed.
- Tasks 4.3 and 4.4 can proceed in parallel after the base workspace styles exist.

---

## Risk Analysis

### Product and state risks

- [ ] **Watcher refresh rebases a draft accidentally**: keep the opening snapshot/content immutable; never replace dirty state from `revision` updates.
- [ ] **Renderer diff is mistaken for authorization**: require a real backend plan before enabling `Actualizar skill`; keep plan facts adjacent to the diff.
- [ ] **Plan becomes stale while reviewing**: show plan expiry/error, handle confirm conflict, retain draft, and require re-planning.
- [ ] **Inventory context is lost on return**: keep library subtree mounted hidden/inert and explicitly test search/scope/selection persistence.
- [ ] **Two sources of operation status diverge**: workspace owns local phase; App owns global operation announcement. Pass only committed/failure outcomes upward.
- [ ] **Source update flow regresses during Inspector extraction**: leave `sourcePlan`/`sourceConflict` logic in Inspector and retain its tests.

### Diff risks

- [ ] **Quadratic work freezes renderer on large files**: prefix/suffix trim, hard complexity guards, exact non-minimal fallback, and unit benchmarks/timeout assertions.
- [ ] **Trailing newline or CRLF appears incorrectly**: test empty terminal lines and preserve displayed source text exactly; diff presentation must not normalize the draft sent to backend.
- [ ] **Color-only meaning**: keep signs, old/new line numbers, accessible row labels, and forced-color styles.
- [ ] **Narrow layout clips code**: compact number model, wrapping, internal scrolling, and explicit 200%/minimum-window assertions.

### Accessibility risks

- [ ] **Hidden library remains in accessibility tree**: apply both `hidden` and `inert`; verify with role queries.
- [ ] **Navigation loses focus**: record the exact trigger, focus page heading on entry, and restore only after the trigger is visible again.
- [ ] **Inline dialog semantics become modal accidentally**: do not use `aria-modal`, backdrop, or focus trap; Escape returns to editing.
- [ ] **CodeMirror remount loses undo/cursor**: keep Code mode mounted and visually hidden while Preview/Changes are active.

### Integration risks

- [ ] **Dirty working tree collisions**: inspect current diffs before each touched file and preserve unrelated modifications.
- [ ] **Visual baselines are updated mechanically**: require side-by-side review against the accepted prototype before approval.
- [ ] **Immutable suite pressure encourages semantic hacks**: keep a genuine discrete confirmation region; never add an invisible compatibility dialog.

---

## Testing Strategy

### Unit tests

- `SafeMarkdown.test.ts`: frontmatter removal, inert raw HTML, no active anchors/images, grouped lists, headings, code fences.
- `TextDiff.test.ts`: no change, add, delete, replace, disjoint changes, unchanged gaps, trailing newline, CRLF display, bounded fallback, line counts, accessible labels.
- `SkillWorkspace.test.ts`: load, dirty state, tab behavior, exact planning input, plan details, confirm, error/conflict, refresh after save, discard, back guard, keyboard shortcuts.

### Renderer integration tests

- `Inspector.test.ts`: edit delegation, source preview/source view, source-managed update, read-only behavior.
- `App.test.ts`: enter/exit workspace, library preserved hidden/inert, topbar context, status propagation, focus restoration.

### Electron E2E

- Keyboard-only complete edit → review → update → restart → undo.
- External edit between workspace opening and planning/confirmation produces conflict and preserves external content.
- Desktop, compact, minimum-window, 200%-zoom, forced-colors where supported, and reduced-motion smoke checks.
- Exact screenshot and geometry baselines for all three workspace modes.

### Immutable spec tests

- **Make pass**: `tests/spec/forge-mvp.e2e.spec.ts`.
- **Do not edit**: test content and SHA-256 remain unchanged.

---

## Done Criteria

### Phase 0: Contract

- [ ] `thoughts/PRODUCT.md` describes the workspace and explicitly defers intelligence.
- [ ] Immutable suite hash equals `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`.
- [ ] Existing unrelated working-tree changes remain intact.

### Phase 1: Foundations

- [ ] Safe Markdown tests prove active content is never interpreted: `pnpm test -- apps/desktop/src/renderer/SafeMarkdown.test.ts`.
- [ ] Diff tests cover multiple hunks, bounds, line numbers, textual markers, and edge cases: `pnpm test -- apps/desktop/src/renderer/TextDiff.test.ts`.
- [ ] CodeMirror retains nonce-authorized styles, line wrapping, native undo, and correct line/gutter alignment.

### Phase 2: Workspace behavior

- [ ] `Editar` opens a full app-body workspace in Code mode with no editor backdrop.
- [ ] Preview renders the current draft safely and Code retains editor state across tab switches.
- [ ] Review calls `operations.plan` with the opening snapshot and exact draft before enabling confirmation.
- [ ] Inline Changes shows path, operation facts, responsive diff, and functional Back/Discard/Update actions.
- [ ] No file changes before `operations.confirm`; successful confirm reloads Preview and leaves persistent Undo available.
- [ ] External-change conflict preserves both the external file and the user's unsaved draft.

### Phase 3: Navigation

- [ ] Sidebar, library, and inspector are absent from the active workspace but their state remains mounted and inert.
- [ ] Clean Back restores inventory state/focus; dirty Back requires explicit discard confirmation.
- [ ] Managed/read-only skills still expose no Edit action.

### Phase 4: Presentation and accessibility

- [ ] 1420×892 matches the accepted workspace hierarchy and uses existing Forge tokens.
- [ ] 1180×760 and 760×520 remain usable with owned panel scrolling.
- [ ] At 200% zoom, Preview/Code/Changes have no document-level horizontal overflow.
- [ ] Diff meaning is available through color, `+`/`−`, line numbers, and assistive labels.
- [ ] Tabs, inline confirmation, discard confirmation, and focus restoration work by keyboard.
- [ ] Forced-colors and reduced-motion modes remain legible and functional.

### Spec tests

- [ ] All immutable spec tests pass: `pnpm test:e2e -- tests/spec/forge-mvp.e2e.spec.ts`.
- [ ] No spec test files were modified; verify with `git diff -- tests/spec/forge-mvp.e2e.spec.ts` and SHA-256.

### Overall

- [ ] Focused renderer tests pass: `pnpm test -- apps/desktop/src/renderer/SafeMarkdown.test.ts apps/desktop/src/renderer/TextDiff.test.ts apps/desktop/src/renderer/SkillWorkspace.test.ts apps/desktop/src/renderer/inventory/Inspector.test.ts apps/desktop/src/renderer/App.test.ts`.
- [ ] Accessibility and visual E2E pass: `pnpm test:e2e -- tests/e2e/accessibility-keyboard.e2e.spec.ts tests/e2e/visual-fidelity.e2e.spec.ts`.
- [ ] Quality checks pass: `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] No new `TODO`, `FIXME`, or `HACK` markers.
- [ ] No IPC/schema/backend mutation changes were introduced.
- [ ] `prototypes/editor-surface/**` is removed only after production visual and behavior acceptance.
- [ ] Post-feature review reports no unresolved P0/P1 findings.

---

## Verification Sequence

```bash
shasum -a 256 tests/spec/forge-mvp.e2e.spec.ts
pnpm test -- apps/desktop/src/renderer/SafeMarkdown.test.ts apps/desktop/src/renderer/TextDiff.test.ts apps/desktop/src/renderer/SkillWorkspace.test.ts apps/desktop/src/renderer/inventory/Inspector.test.ts apps/desktop/src/renderer/App.test.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e -- tests/e2e/accessibility-keyboard.e2e.spec.ts tests/e2e/visual-fidelity.e2e.spec.ts
pnpm test:e2e -- tests/spec/forge-mvp.e2e.spec.ts
git diff --exit-code -- tests/spec/forge-mvp.e2e.spec.ts
```

Manual acceptance:

1. Select a writable skill and press `Editar`.
2. Confirm the workspace owns the complete app body and opens in Code.
3. Switch to Preview and verify formatted inert content.
4. Make one replacement, one insertion, and one deletion.
5. Review and verify exact red/green rows, signs, line numbers, path, plan facts, and no disk mutation.
6. Return to Code; confirm draft, cursor, and undo history remain.
7. Review again and update; confirm clean Preview and global success announcement.
8. Open History, undo, and confirm the original file returns after restart.
9. Repeat at 760×520 and 200% zoom; confirm no clipped header, controls, or horizontal page scroll.
10. Open a dirty workspace, modify the file externally, and verify Forge refuses silent overwrite while retaining the draft.

After every phase is complete, run `devtronic:post-review` before marking the plan complete.

---

## Execution completion record (2026-08-27)

- Implemented the first-class full-body skill workspace with Preview, persistent CodeMirror editing, and an in-flow Changes confirmation backed by the existing operation-plan boundary.
- Bound every renderer plan to the exact reviewed snapshot and draft; stale, conflicting, rejected, and failed flows preserve the draft and offer explicit recovery.
- Kept Markdown inert, preserved CRLF round trips, bounded both diff computation and rendered DOM for very large entries, and avoided hidden Preview/Changes work in the typing hot path.
- Added responsive context/plan disclosures, exact wide-column presentation, compact diff numbering, keyboard focus behavior, live dirty-state messaging, forced-colors/reduced-motion coverage, and deterministic screenshots at 1420×892, 1180×760, 760×520, and 200%-zoom CSS dimensions.
- Preserved the immutable spec at SHA-256 `3528ff79a1e75b3ca5cfe012e7997d6d5dd04337c1258ac2e393cd6586cbaf6c`; no contract, preload, IPC, backend, filesystem authorization, snapshot, journal, recovery, or undo change was introduced by this execution.
- Final verification on Node 24.19 arm64: typecheck passed, lint passed, 44 unit/renderer files with 323 tests passed, and all 36 packaged Electron E2E tests passed (including 10 immutable business-value tests and 15 visual tests).
- `devtronic:post-review` verdict: PASS, with no unresolved P0, P1, or P2 findings.
- Removed `prototypes/editor-surface/**` only after production visual acceptance. The recoverable backup is `/tmp/skill-forge-editor-surface-backup.eeRckM/editor-surface`; durable reference captures remain under `thoughts/research/artifacts/skill-workspace-inline-diff/`.
- Preserved unrelated pre-existing working-tree changes and intentionally created no commit.
