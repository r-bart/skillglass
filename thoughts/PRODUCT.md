# Forge — Product Contract

**Status**: MVP implemented; beta release gates pending
**Updated**: 2026-08-26

## Product Thesis

Forge is a local-first desktop application for discovering, understanding, installing, and safely updating agent skills on a developer's machine.

Its primary value is not adding more skills. It is answering, with evidence:

- What skills are installed?
- Where did each one come from?
- In which scopes can it take effect?
- Which concrete file will win when names overlap?
- Is its on-disk structure valid?
- What will change before Forge writes anything?
- How can the user undo that change?

Forge must never present inferred or unavailable information as an observed fact.

## Intended User

A developer who uses one or more agent runtimes and has skills distributed across global roots, project roots, package-managed locations, plugin caches, or other configured directories.

The MVP optimizes for a single developer on one machine. Teams, synchronization, shared policy, and cloud accounts are not part of the first release.

## Supported Platforms

The application targets macOS, Windows, and Linux from the first implementation commit.

The first public build may ship on macOS, but CI, domain logic, filesystem fixtures, keyboard handling, and window layout must remain green on all three platforms.

Platform conventions are part of the product contract:

- Native window controls or an operating-system-specific title bar.
- `Command` shortcuts on macOS and `Ctrl` shortcuts on Windows/Linux.
- Native path presentation and file dialogs.
- Support for display scaling, resizable windows, keyboard navigation, high contrast, and reduced motion.

## MVP Runtime Scope

The initial implementation targets:

1. Codex skill locations and behavior that can be verified locally.
2. Agent Skills-compatible folders containing a required `SKILL.md` and optional supporting resources.

Every runtime is accessed through an adapter. A folder that happens to resemble a skill is not automatically assumed to have the same inheritance, runtime-state, or precedence rules in every runtime.

Additional runtimes are future adapters, not compatibility claims made by the core product.

## Product Principles

### Evidence before convenience

Every non-trivial field has an evidence state:

- `observed`: read from a file, manifest, runtime configuration, or supported log.
- `derived`: deterministically calculated from observed data.
- `inferred`: heuristic and explicitly labelled as such.
- `unknown`: unavailable; shown as "Sin datos" rather than guessed.

### Filesystem remains the source of truth

Forge may use SQLite for indexing, snapshots, history, and its transaction journal. The database does not replace the files that runtimes actually read.

### Safe by default

- Read operations do not mutate the machine.
- Every mutation starts with a previewable operation plan.
- Every supported write has a recoverable snapshot and persistent journal entry.
- Imported content is treated as untrusted and is never executed during inspection or installation.
- Forge writes only to user-approved, user-writable roots.
- Managed, system, plugin, and permission-restricted locations are always read-only.
- Forge never requests administrator, root, or operating-system elevation.

### Runtime semantics belong to adapters

Forge does not invent a universal rule for inheritance, precedence, runtime state, or versions. The core presents the effective behavior reported by the selected adapter.

Forge never activates or deactivates a skill and never modifies harness configuration for that purpose. Runtime state may be displayed read-only when an adapter can observe it; the user changes it through the relevant harness.

### Accessible desktop behavior

All interactions must be available by keyboard and exposed through semantic controls. Information cannot rely on color, opacity, hover, animation, or graph geometry alone.

## MVP Information Architecture

### Inventory

The default surface. It provides:

- `Todas` / `Esta máquina`: every discovered installation.
- `Global`: only globally installed skills.
- Project scopes: project-owned skills plus the effective inherited skills reported by the adapter.
- Search by name, description, path, and observed metadata.
- Filters for validity, observed runtime state, provenance, runtime, and update information when available.
- Grouping by author or package only when those values have evidence.

### Inspector

Shows the selected installation and its effective context:

- Name and description.
- Canonical path and runtime.
- Scope and precedence.
- Provenance and management mode.
- Declared, source, and local revision information.
- Static validation findings.
- Dependencies or external requirements, with their evidence state.
- Actions supported in the current scope.

### Pending

Groups actionable findings by operation type. A selection may only expose a batch action when every selected finding supports the same operation plan. A mixed selection uses "Resolver N pendientes", never "Actualizar N".

### Editor and history

The editor updates real files in user-writable roots. Saving creates a recoverable snapshot before an atomic write. Managed and read-only content can be inspected but is never modified or forked implicitly.

### Onboarding

On first launch Forge:

1. Detects supported runtimes.
2. Shows every root it proposes to scan.
3. Labels writable, managed, read-only, missing, and user-added roots.
4. Lets the user include or exclude roots.
5. Scans without changing any file.
6. Explains `Todas`, `Global`, and project scopes before entering the inventory.

## MVP Capabilities

- Discover supported skill roots.
- Index real skill folders and supporting resources.
- Inspect canonical paths, provenance, and effective scope.
- Validate `SKILL.md` and local resource references statically.
- Search, filter, group, and sort the inventory.
- Install skills into approved user-writable roots through previewable operation plans.
- Update writable installed skills, including direct content edits, with snapshot history and rollback.
- Discover updates only when a verified source and installed revision are available.
- Detect exact identity conflicts and deterministic shadowing.
- Recover interrupted operations from a persistent journal.

## Explicitly Outside the MVP

- Trigger or usage telemetry without an official runtime integration.
- Claims such as "unused for 74 days" based on absence of filesystem changes.
- Execution simulation or agent-output prediction.
- Automatic trigger-overlap percentages.
- A dependency graph inferred from prose.
- A remote marketplace or `skills.sh` browser.
- Installing directly from arbitrary remote URLs.
- AI generation or rewriting.
- Updates without verified provenance or an immutable source revision.
- Activation, deactivation, harness configuration, uninstall, deletion, and filesystem relocation.
- Writes requiring administrator, root, or operating-system elevation.
- App stores, third-party binary mirrors, and automatic in-app binary updates.
- Three-way rebase of local forks.
- Cloud sync, teams, accounts, and shared policy.

These features may return after their data and security contracts exist. Their exclusion does not prevent the domain model from preserving provenance and package references.

## Health and Status Language

The MVP does not use a single overloaded `health` value. It presents independent dimensions:

- **Validity**: valid, warning, invalid, unknown.
- **Runtime state**: enabled, disabled, inherited, shadowed, unsupported, unknown; read-only and only when observable.
- **Source state**: local, managed, read-only, modified, unknown.
- **Update state**: current, update available, diverged, unavailable, unknown.
- **Usage state**: observed, unavailable. No synthetic "idle" state.

## Success Criteria

The MVP is ready for beta when:

- A user can identify the exact file and scope that will take effect for a skill.
- Forge never shows invented version, usage, dependency, permission, or update data.
- Every supported mutation previews affected paths and can recover from interruption.
- Undo works after restarting the application.
- The inventory and core operations pass automated tests on macOS, Windows, and Linux.
- Keyboard-only use covers onboarding, inventory, inspector, editor, and operation confirmation.
- Unsupported actions are absent or explicitly labelled, never simulated as successful.

## Open Decisions

- Execute the native Windows/Linux adapter, filesystem, and packaged SQLite matrix; macOS arm64 is validated.
- Choose the repository's open-source license.
- Select the first supported registry, if remote discovery returns after the MVP.
- Decide whether packages become navigable objects after package operations exist.
- Define the future telemetry contract per runtime before restoring trigger logs.

## Distribution Contract

Forge is open source. Official binaries are published only as release assets in the source repository. The project does not distribute binaries through app stores, mirrors, download portals, or unrelated domains. The README must state this prominently and link users only to the repository's release section once its public URL exists.
