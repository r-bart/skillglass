# Skill workspace with inline diff — implementation lessons

**Date**: 2026-08-27  
**Plan**: `thoughts/plans/2026-08-27_skill-workspace-inline-diff.md`

## What proved important

1. An operation plan must be bound to the exact reviewed draft as well as the opening snapshot. A valid snapshot alone does not prevent an older renderer plan from being confirmed after the user edits again.
2. Responsive native `details` elements need assertions against real visibility and layout. A masked screenshot can make closed-but-present content look intentional while the information is actually unreachable in the wide layout.
3. A complexity guard must cap rendered output, not only the diff algorithm. The large-input fallback now produces bounded block rows, and Preview/Changes are not rendered while Code is active.
4. CodeMirror needs an explicit `lineSeparator` compartment and `sliceDoc()` to round-trip CRLF content exactly; the default document representation normalizes line endings.
5. Hidden or inert mounted subtrees can still retain document-level listeners. Inventory shortcut handling must be gated by the active shell state.
6. Workspace focus should move to the destination heading after inspection completes, then follow the deliberate tab order. Restoring focus through dialogs remains distinct from destination focus.
7. The repository's native dependencies and packaged Electron checks must run with the pinned Node 24.19 arm64 runtime. A different host Node can produce unrelated SQLite failures.

## Review outcome

The post-feature architecture review passed with no P0, P1, or P2 findings after correcting stale-plan invalidation, large-input DOM bounds, hidden rendering work, CRLF preservation, disclosure visibility, shortcut ownership, discard semantics, and live status behavior.

These lessons are feature-specific, so no project-wide instruction file change was necessary.
