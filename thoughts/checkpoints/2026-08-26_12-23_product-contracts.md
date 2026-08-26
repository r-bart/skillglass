# Checkpoint: Forge Product Contracts

**Created**: 2026-08-26 12:23 CEST
**Branch**: no Git repository
**Context**: major product-definition phase complete; fresh session recommended before implementation

---

## Original Goal

Turn the Forge high-fidelity handoff into a coherent foundation for a cross-platform desktop application, choose a TypeScript-only stack, audit contradictions, and define the contracts required before implementation.

---

## Completed

- [x] Created the numbered project at `29.skill-forge`.
- [x] Read and audited the complete Forge handoff and source-of-truth prototype.
- [x] Reviewed product coherence, filesystem feasibility, security, cross-platform behavior, Nielsen heuristics, and WCAG 2.1 AA concerns.
- [x] Chose Electron + TypeScript as the intended implementation direction.
- [x] Defined the MVP product contract.
  - Added: `thoughts/PRODUCT.md`
- [x] Defined the domain model and invariants.
  - Added: `thoughts/DOMAIN.md`
- [x] Defined runtime adapter capabilities and admission rules.
  - Added: `thoughts/ADAPTERS.md`
- [x] Defined transactional filesystem operations, recovery, and undo.
  - Added: `thoughts/OPERATIONS.md`

---

## Current State

### Working

- The project has a complete high-fidelity design handoff in `thoughts/handoff/`.
- Product, domain, adapter, and operation contracts now agree on a conservative MVP.
- `Todas` / `Esta máquina` is an inventory view; `Global` is a real scope.
- Activation is scoped by installation × target scope × adapter.
- Unknown data remains unknown and carries evidence metadata.
- Filesystem operations require persisted plans, snapshots, verification, and restart-safe undo.
- Electron + React + TypeScript is the selected architectural direction; production scaffolding has not started.

### Not Working / Pending

- The exact Codex global/project roots, precedence rules, and writable operations are not yet verified on macOS, Windows, and Linux.
- No production code, package manifest, Electron shell, database, or tests exist.
- The original `Breadboard.dc.html` and `Design System.dc.html` are historical and contradict the latest product direction in places.
- The prototype remains macOS-specific, fixed-size, and structurally inaccessible; it must be translated into semantic production components rather than copied.
- Remote discovery, AI generation, trigger telemetry, semantic graph, package operations, and rebase are intentionally outside the MVP.
- The folder is not currently a Git repository.

### Errors

No project execution errors exist because implementation has not started. The in-app browser could not open the local `file://` prototype due to browser security policy; the audit used the complete source and included visual assets instead.

---

## Files Modified This Session

| File | Change | Status |
|---|---|---|
| `thoughts/PRODUCT.md` | Created MVP product contract | Complete draft |
| `thoughts/DOMAIN.md` | Created domain entities, evidence model, and invariants | Complete draft |
| `thoughts/ADAPTERS.md` | Created runtime adapter contract and capability matrix | Complete draft; Codex rows require verification |
| `thoughts/OPERATIONS.md` | Created filesystem transaction, recovery, and security contract | Complete draft |
| `thoughts/checkpoints/2026-08-26_12-23_product-contracts.md` | Created session checkpoint | Complete |
| `thoughts/STATE.md` | Updated persistent project position | Complete |
| `thoughts/SUMMARY.md` | Updated session recap | Complete |

---

## Next Steps

To continue in a new session:

1. **Immediate next action: validate the Codex adapter contract**
   - Inventory actual global, project, system, and plugin-managed skill roots.
   - Establish which roots are writable or read-only.
   - Verify discovery, inheritance, precedence, and activation behavior from official documentation and controlled filesystem fixtures.
   - Replace every `Verify` cell in the Codex column of `thoughts/ADAPTERS.md` with supported, read-only, unsupported, or unknown evidence.

2. **Then: define the implementation plan**
   - Specify the Electron process boundary, package layout, SQLite schema, IPC contracts, and CI matrix.
   - Decide whether to initialize Git and the exact package manager before scaffolding.

3. **Then: reconcile the design artifacts**
   - Mark the old breadboard and design-system sections as historical or produce updated artifacts.
   - Convert the fixed macOS shell into cross-platform responsive component specifications.

4. **Verification**

   ```bash
   cd /Users/roberto/Desktop/ventures/100-projects/29.skill-forge
   rg '^## ' thoughts/PRODUCT.md thoughts/DOMAIN.md thoughts/ADAPTERS.md thoughts/OPERATIONS.md
   rg 'Verify' thoughts/ADAPTERS.md
   ```

---

## Context for Next Session

### Key Decisions Made

- **TypeScript-only desktop stack**: use Electron, React, TypeScript, and Vite to maximize development velocity and visual consistency across operating systems.
- **Local-first source of truth**: skill files remain authoritative; SQLite is an index, snapshot store, and transaction journal.
- **Adapter-owned semantics**: Forge core does not invent inheritance, precedence, activation, or version rules.
- **Evidence model**: fields are observed, derived, inferred, or unknown; unavailable information is shown as `Sin datos`.
- **Scoped activation**: replace the prototype's global `off[]` model with scope bindings.
- **Separate inventory from scope**: `Todas` is not `Global`.
- **Recoverable deletion**: ordinary delete means quarantine; permanent deletion is separate.
- **Persistent undo**: undo is backed by journal entries and snapshots, not toast state.
- **Narrow MVP**: focus on discovery, inspection, static validation, safe local editing, history, and reversible mutations.
- **Deferred promises**: no fabricated telemetry, dry-run execution, semantic dependency graph, remote marketplace, package workflow, AI generation, or rebase in the MVP.

### Things to Remember

- `App.dc.html` is the latest prototype reference, not production code.
- `Breadboard.dc.html` and `Design System.dc.html` retain obsolete MCP, plugin, grid, token, and selection concepts.
- The current prototype's `Global` behavior is ambiguous and its `off[]` activation state is invalid for per-project control.
- Accessibility issues are structural: production components need semantic HTML, focus management, contrast-safe tokens, and reduced-motion/high-contrast variants.
- Managed plugin and system skill locations observed on this machine must default to read-only until an adapter proves safe writes.
- A runtime capability marked `Verify` is not a shipping promise.

### Related Files

- `thoughts/PRODUCT.md` — MVP scope, principles, information architecture, and success criteria.
- `thoughts/DOMAIN.md` — canonical entities, evidence, versions, bindings, and invariants.
- `thoughts/ADAPTERS.md` — runtime capability boundary and initial Codex validation matrix.
- `thoughts/OPERATIONS.md` — mutation planning, journaling, rollback, quarantine, and security.
- `thoughts/handoff/HANDOFF.md` — original product handoff.
- `thoughts/handoff/App.dc.html` — high-fidelity prototype and behavior simulation.

---

## Resume Command

```text
I'm resuming work from a checkpoint. Please read:
thoughts/checkpoints/2026-08-26_12-23_product-contracts.md

The immediate next step is to validate the Codex adapter contract with official evidence and controlled local fixtures, then update the Verify cells in thoughts/ADAPTERS.md.
```
