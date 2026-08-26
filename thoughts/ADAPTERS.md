# Forge — Runtime Adapter Contract

**Status**: Codex contract validated for MVP
**Updated**: 2026-08-26

## Purpose

Adapters isolate Forge from runtime-specific discovery, scope, precedence, runtime-state observation, installation, update, and validation rules. The core application must remain useful when an adapter cannot supply versions, usage data, updates, or runtime state.

## Capability States

Every adapter capability reports one of:

- `supported`: implemented using a documented or locally verified mechanism.
- `read-only`: observable but not safely mutable.
- `derived`: deterministic from supported observations.
- `inferred`: heuristic; must be labelled.
- `unsupported`: known not to exist or intentionally unavailable.
- `unknown`: not yet verified.

The UI hides mutating actions for `unsupported` and `unknown` capabilities. It never simulates success.

## Adapter Interface

Conceptual TypeScript boundary:

```ts
interface SkillRuntimeAdapter {
  readonly id: string
  readonly displayName: string

  capabilities(): Promise<AdapterCapabilities>
  discoverRoots(context: DiscoveryContext): Promise<RootCandidate[]>
  scanRoot(root: SourceRoot): AsyncIterable<InstallationObservation>
  parseInstallation(path: CanonicalPath): Promise<SkillObservation>
  validate(snapshot: SkillSnapshot): Promise<ValidationFinding[]>
  resolveScope(input: ResolutionInput): Promise<EffectiveSkill[]>
  describeBinding(input: BindingInput): Promise<ScopeBinding>
  planOperation(request: AdapterOperationRequest): Promise<AdapterOperationPlan>
}
```

The core owns transaction execution. An adapter may propose filesystem steps but cannot bypass preview, path validation, journaling, or postcondition checks.

## Required Adapter Capabilities

```ts
type AdapterCapabilities = {
  discoverGlobalRoots: CapabilityState
  discoverProjectRoots: CapabilityState
  parseSkill: CapabilityState
  enumerateResources: CapabilityState
  resolvePrecedence: CapabilityState
  observeRuntimeState: CapabilityState
  installToUserRoot: CapabilityState
  updateWritableInstallation: CapabilityState
  editLocal: CapabilityState
  declaredVersions: CapabilityState
  sourceProvenance: CapabilityState
  updateDiscovery: CapabilityState
  dependencies: CapabilityState
  permissionDeclarations: CapabilityState
  triggerTelemetry: CapabilityState
  usageTelemetry: CapabilityState
}
```

## Initial Support Matrix

This matrix is deliberately conservative. Codex states are backed by the evidence ledger in `thoughts/research/codex-adapter.md`; limitations in a `supported` capability are part of the contract, not implementation notes.

| Capability | Codex adapter | Agent Skills-compatible folder |
|---|---|---|
| Detect configured global roots | `supported` for USER `$HOME/.agents/skills` and ADMIN `/etc/codex/skills`; bundled SYSTEM filesystem inventory is `unknown` | User-configured or adapter default |
| Detect project roots | `supported`: `.agents/skills` at CWD and every ancestor through repository root | Supported when project root is configured |
| Parse `SKILL.md` | `supported` | Supported |
| Enumerate supporting resources | `supported` | Supported |
| Read required name/description | `supported` when present and valid | Supported when present and valid |
| Observe global/project scope | `supported` root observation; scope is `derived` | Derived from configured root |
| Resolve inheritance/precedence | `supported`: duplicate names coexist; Codex does not merge them or document a winning candidate | Unsupported without host-specific rules |
| Observe native per-scope runtime state | `read-only` for an explicit `[[skills.config]]` disabled entry; otherwise `unknown` | Unsupported by the folder convention alone |
| Install into an approved user root | `supported` for an approved, writable USER or REPO authoring root; ADMIN and SYSTEM are never destinations | Supported when the configured root is writable |
| Update a writable installation | `supported` for an approved, writable USER or REPO installation; source provenance is verified separately | Supported with verified provenance or direct edit |
| Edit writable local skill | `supported` in approved USER/REPO roots | Supported |
| Edit system/plugin-managed cache | `read-only` | Not applicable unless configured read-only |
| Declared semantic version | `unknown` | Optional/unknown |
| Source package/release | `unknown` without a separate provenance manifest | Only with provenance manifest |
| Discover update | `supported` only for Forge-managed provenance; otherwise `unknown` | Only for Forge-managed provenance |
| Resolve dependencies | `supported` for declared `agents/openai.yaml` tool dependencies; otherwise `unknown` | Declared/derived only |
| Enforce permissions | `unsupported` | Unsupported |
| Trigger log | `unknown` | Unsupported by folder convention |
| Usage log | `unknown` | Unsupported by folder convention |

The undocumented local path `$HOME/.codex/skills` is not treated as a Codex-native root. Forge may expose it through the explicit folder adapter, but the Codex adapter neither auto-discovers nor installs into it until official documentation establishes that contract.

## Discovery Contract

Discovery has two phases.

### Root discovery

The adapter proposes roots with evidence:

```ts
type RootCandidate = {
  path: string
  kind: "global" | "project" | "managed" | "system"
  projectPath?: string
  evidence: Evidence
  defaultIncluded: boolean
}
```

The user sees and approves roots during onboarding. User-added roots remain explicit and are never silently promoted to runtime-native roots.

### Installation discovery

The adapter:

- Avoids recursive traversal outside the approved root.
- Detects symlink and junction cycles.
- Does not follow links outside the root unless the user separately approved the target root.
- Returns parse failures as findings rather than dropping folders silently.
- Preserves the raw file tree needed for later validation and hashing.

## Scope and Precedence Contract

An adapter must answer separately:

1. Where an installation is stored.
2. In which target scopes it is visible.
3. Whether its runtime state can be observed.
4. Which candidate wins a collision.
5. Which evidence proves that resolution.

If the runtime has no documented or testable precedence rule, Forge reports a conflict or unknown result. It must not assume that project always wins over global.

For Codex specifically, same-name installations are a documented coexistence case: Codex does not merge them, and both can appear in skill selectors. Forge therefore returns all candidates with their source scopes and a duplicate-name finding. It does not label any candidate as effective, inherited, shadowed, or overridden.

## Harness State Boundary

Forge may observe enabled, disabled, inherited, or shadowed state when the runtime exposes documented or locally verifiable evidence. This observation is read-only.

For Codex, an exact `[[skills.config]]` entry with `enabled = false` is evidence only that the referenced skill is explicitly configured as disabled. Absence of such an entry does not prove invocation, selection, or inclusion in the initial prompt; Forge reports those states as `unknown`. The Codex adapter never writes `~/.codex/config.toml`.

Adapters never plan activation, deactivation, exclusion, or harness-configuration mutations. The interface directs users to the relevant harness when they want to change runtime state.

## Writable Boundary

- Install and update destinations must be inside an approved user-writable root.
- A denied, managed, system, or otherwise permission-restricted root remains read-only.
- Forge never launches an elevated helper or requests administrator/root credentials.
- Lack of write access is reported as an unsupported destination, not as an error the user is asked to bypass.
- Codex ADMIN (`/etc/codex/skills`) and bundled SYSTEM locations are read-only in Forge even if an unusual environment makes them writable.

## Parsing Contract

- Treat `SKILL.md` body and unknown frontmatter as user-authored source.
- Preserve formatting and comments whenever a targeted edit is possible.
- Do not normalize or rewrite unrelated fields on save.
- Resolve resource references without escaping the installation root.
- Never execute scripts, imports, binaries, hooks, or embedded commands while parsing.
- Render Markdown with raw HTML disabled or sanitized.

## Provenance Contract

Forge only claims author, package, license, release, or update availability when it has a source record. Possible sources include:

- A Forge installation manifest.
- A package or plugin manifest.
- A verified registry response tied to an installed hash.
- A repository remote and immutable commit.
- Explicit metadata inside the skill.

A folder name, URL fragment, or prose attribution is insufficient evidence for package management.

## Platform Contract

Every adapter is tested with native fixtures on:

- macOS: APFS case-sensitive and case-insensitive scenarios where practical, symlinks, missing shell `PATH`.
- Windows: drive letters, UNC paths where supported, junctions, locked files, case-insensitive paths, CRLF.
- Linux: case-sensitive paths, symlinks, permission failures, common packaging environments.

Paths are stored canonically and displayed natively. Adapter code never hardcodes `/opt/homebrew`, `~`, backslashes, or a single shell initialization model.

## Testing Contract

Each adapter ships with golden fixtures covering:

- Valid minimal skill.
- Invalid or missing frontmatter.
- Optional resources.
- Broken resource link.
- Symlink cycle and external symlink.
- Duplicate names in two roots.
- Read-only managed installation.
- Unknown metadata fields.
- Unicode, spaces, mixed case, and platform line endings.
- Scope collision and precedence, when supported.

Capability tests must fail if an advertised operation returns a decorative success without changing or observing the expected state.

## Adapter Admission Checklist

A new adapter is not considered supported until:

1. Its roots and scope rules are documented.
2. Its read and write capabilities are individually declared.
3. Precedence behavior has fixtures.
4. Unsupported metadata returns `unknown`.
5. Every mutation produces an adapter operation plan.
6. CI exercises read and mutation fixtures on the target platforms.
7. User-facing terminology matches the runtime rather than a generic approximation.
