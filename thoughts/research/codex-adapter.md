# Codex adapter research

**Date**: 2026-08-26
**Decision status**: Accepted for MVP implementation
**Contract**: `thoughts/ADAPTERS.md`
**Fixtures**: `packages/test-fixtures/codex`

## Outcome

The Codex adapter can discover and inspect documented local skill roots, install or update only inside user-approved writable authoring roots, and observe an explicit disabled configuration entry without mutating it. Codex does not define precedence for same-name skills: it keeps installations separate and both can appear in selectors. Forge must not invent an effective winner.

Activation, deactivation, Codex configuration writes, admin/system writes, invocation telemetry, and usage telemetry are not Forge capabilities.

## Authoritative source

The primary source is the official OpenAI documentation page [Build skills](https://learn.chatgpt.com/docs/build-skills), observed on 2026-08-26. The former Codex URL `https://developers.openai.com/codex/skills` redirects to this page.

The page establishes:

- A skill is a directory containing required `SKILL.md`; the file requires `name` and `description`. `scripts`, `references`, `assets`, and `agents/openai.yaml` are optional.
- Codex discovers repository skills from `.agents/skills` at the current working directory and every ancestor up through the repository root.
- Codex discovers user skills at `$HOME/.agents/skills`, admin skills at `/etc/codex/skills`, and system skills bundled by OpenAI.
- Same-name skills are not merged; both can appear in skill selectors.
- Codex follows symlinked skill folders when scanning documented locations.
- Codex detects local skill changes automatically, with restart documented as the fallback when a change is not shown.
- `[[skills.config]]` entries in `~/.codex/config.toml` can explicitly disable a skill by exact `SKILL.md` path. A Codex restart is required after a configuration change.
- `agents/openai.yaml` may declare interface metadata, implicit-invocation policy, and tool dependencies. This is optional and does not establish semantic versions, source provenance, update provenance, general permissions, or usage telemetry.

No other web source is used to establish Codex behavior.

## Verified capability ledger

`supported` below means the documented rule is implementable with ordinary, non-elevated filesystem access. It does not override Forge's root approval, path containment, journal, or verification requirements.

| Capability | State | Evidence and exact boundary |
|---|---|---|
| Discover USER root | `supported` | Official docs identify `$HOME/.agents/skills`. Resolve the OS home directory through Node; do not hardcode a platform path. Missing directory means no installation, not an error. |
| Discover ADMIN root | `supported` for observation | Official docs identify `/etc/codex/skills`. Forge proposes it only when present and always marks it read-only. No elevation or permission change is offered. |
| Discover bundled SYSTEM skills | `unknown` as a filesystem inventory | Official docs establish that bundled skills exist but do not publish a stable filesystem path or enumeration API. The adapter must not guess one. |
| Discover REPO roots | `supported` | Official docs specify `$CWD/.agents/skills`, each ancestor's `.agents/skills`, and `$REPO_ROOT/.agents/skills`. Stop at the repository root and never scan ancestors above it. |
| Detect project context | `supported` | The adapter accepts canonical CWD and repository-root context. Repository-root detection is infrastructure input and must support Git worktrees; it is not inferred from skill contents. |
| Parse `SKILL.md` | `supported` | Official docs require `name` and `description` and define optional resource directories. Invalid/missing metadata remains an indexed finding. |
| Enumerate resources | `supported` | Official docs describe optional `scripts`, `references`, `assets`, and `agents/openai.yaml`. Enumeration never executes content. |
| Scope observation | `supported` root observation; scope is derived | REPO, USER, ADMIN, and abstract SYSTEM are determined from the documented source root. Forge keeps storage scope separate from runtime state. |
| Resolve same-name candidates | `supported` as coexistence | Official docs say Codex does not merge same-name skills and both can appear. Forge returns every installation plus a duplicate-name finding; `winner = null`. |
| Observe configured disabled state | `read-only` | An exact `[[skills.config]]` entry with `enabled = false` proves configured-disabled state for that path. Forge may parse it but never edit it. |
| Observe enabled/effective/invoked state | `unknown` | Absence of a disabled entry does not prove selection, inclusion in the initial prompt, implicit invocation, or execution. Initial skill lists can also be truncated by Codex's context budget. |
| Install to USER root | `supported` | Manual skill-folder creation is documented and USER is an authoring location. Forge additionally requires explicit approval and a successful non-elevated writability check. |
| Install to REPO root | `supported` | Repository `.agents/skills` is a documented authoring location. Forge requires explicit project/root selection and ordinary user writability. |
| Install to ADMIN or SYSTEM | `unsupported` by Forge policy | These sources are inventory-only. Forge does not request elevation even if an environment exposes unusual permissions. |
| Update writable USER/REPO installation | `supported` | Codex detects skill file changes. Forge may perform a journaled local-source update only after destination approval, containment, collision, provenance, and stale-plan checks. |
| Update discovery | `unknown` natively; `supported` for Forge provenance | Codex docs do not define a package update feed. Forge can compare a recorded local directory/ZIP source only when Forge has its own verified provenance record. |
| Edit writable USER/REPO installation | `supported` | These are documented authoring locations. Editing remains subject to targeted preservation and safe operation plans. |
| Edit ADMIN, SYSTEM, or plugin-managed content | `read-only` | Forge exposes no mutation for managed locations. Plugin caches are not part of this Codex filesystem-root contract. |
| Declared semantic version | `unknown` | Neither required `SKILL.md` metadata nor documented `agents/openai.yaml` establishes a semantic version contract. Preserve any extra field as author content, not runtime truth. |
| Source/package provenance | `unknown` | The Codex local-discovery docs do not define install-source metadata. Forge claims provenance only from its own manifest or another separately verified source record. |
| Tool dependencies | `supported` when declared | Optional `agents/openai.yaml` can declare tool dependencies. Undeclared dependencies and skill-to-skill semantic relationships remain unknown. |
| General permission declarations/enforcement | `unsupported` | The documented invocation policy is not a filesystem/network permission model. Forge must not present it as one. |
| Trigger telemetry | `unknown` | The official local-skill documentation exposes no trigger log or stable local telemetry interface. |
| Usage telemetry | `unknown` | The official local-skill documentation exposes no usage log or stable local telemetry interface. |

## Root algorithm

Given canonical `cwd`, optional canonical `repositoryRoot`, and OS home:

1. Propose `cwd/.agents/skills` as REPO if it exists.
2. If `repositoryRoot` contains `cwd`, walk parents and propose each existing `.agents/skills` directory, including `repositoryRoot/.agents/skills`, exactly once.
3. Stop at `repositoryRoot`; do not scan above it.
4. Propose `$HOME/.agents/skills` as USER if it exists.
5. Propose `/etc/codex/skills` as ADMIN if it exists, marked read-only.
6. Represent bundled SYSTEM as an abstract, read-only source only when a future verified enumeration channel supplies observations. Do not invent a filesystem path.
7. Canonicalize and deduplicate physical roots before asking for approval. Preserve each logical scope observation when symlinks or worktrees point to the same physical root.

The adapter does not auto-discover `$HOME/.codex/skills`. That directory exists in the inspected development environment, but the current official documentation does not list it as a local Codex authoring root. A user may explicitly add it through the generic folder adapter; Forge must label that evidence as user-configured, not Codex-native.

## Collision semantics

The fixture contains three installations whose frontmatter name is `duplicate-skill`: USER, repository root, and a nested repository directory. Expected behavior:

```json
{
  "resolution": "coexist",
  "winner": null,
  "installationCount": 3
}
```

Discovery order is retained only for deterministic presentation and debugging. It is not runtime precedence. Forge must not call a repository candidate an override or a user candidate shadowed.

## Runtime-state boundary

The configuration fixture proves only explicit configured-disabled observation:

```toml
[[skills.config]]
path = "<absolute fixture root>/home/.agents/skills/disabled-skill/SKILL.md"
enabled = false
```

Forge may match the canonical path and display `Configurada como deshabilitada en Codex` with configuration-file evidence. For every other discovered installation, native runtime state is `unknown`; filesystem presence is not equivalent to enabled, loaded, selected, triggered, or used.

Forge never writes this configuration. Users activate or deactivate skills through Codex or their chosen harness.

## Symlink boundary

Codex officially follows symlinked skill folders. Forge has a stricter safety invariant: it does not traverse outside an approved root unless the resolved target is separately approved. `symlink-cases.json` therefore distinguishes:

- An approved target inside an approved root: scan and retain link/target evidence.
- An external unapproved target: report the link and block traversal until approval.
- A cycle: report it and stop traversal.

Tests create these links at runtime with native filesystem APIs so Windows CI does not depend on Git symlink checkout behavior.

## Controlled local evidence

Read-only inspection on 2026-08-26 found:

- `codex-cli 0.146.0` at the user's local executable path.
- `$HOME/.agents/skills` exists and contains local `SKILL.md` files, matching the documented USER root.
- `$HOME/.codex/skills` also exists, but is not listed by the current official root contract; it remains excluded from native auto-discovery.
- `/etc/codex/skills` is absent, which the adapter treats as a normal empty ADMIN source.
- No `[[skills.config]]` blocks were present in the inspected user configuration, so no real runtime-state claims were made.

No real skill file or Codex configuration was changed. The controlled fixture is the only writable test surface.

## Fixture verification

Commands run from the Forge project root:

```sh
jq empty packages/test-fixtures/codex/fixture-manifest.json
jq empty packages/test-fixtures/codex/symlink-cases.json
find packages/test-fixtures/codex -name SKILL.md -type f -print | sort
rg -n "Verify" thoughts/ADAPTERS.md
```

Expected results:

- Both JSON documents parse successfully.
- Eleven physical `SKILL.md` fixture files exist: ten expected Codex installations and one negative undocumented-root installation.
- The manifest lists ten expected installations, three same-name candidates, and no winner.
- `thoughts/ADAPTERS.md` contains no remaining `Verify` marker.

## Implementation gates

The Codex adapter admission tests must prove:

1. CWD-to-repository-root traversal includes all four fixture REPO roots and never crosses the injected root.
2. USER and ADMIN roots are discovered only when present; ADMIN is always read-only.
3. `home/.codex/skills` is absent from native Codex results.
4. All three `duplicate-skill` observations survive resolution with `winner = null`.
5. Only `disabled-skill` receives configured-disabled state; all other runtime states remain unknown.
6. Install/update plans reject ADMIN, SYSTEM, unapproved roots, and external symlink targets.
7. Adapter tests do not read or mutate the developer's real home, configuration, or installed skills.
