# Codex adapter fixtures

This tree models the documented Codex local-skill discovery contract without reading or modifying a developer's real skill installation.

## Scenario

- Treat `workspace` as the repository root.
- Treat `workspace/services/api/src` as the Codex current working directory.
- Treat `home` as the fixture user's home directory.
- Treat `admin/etc/codex/skills` as the admin root; Forge must keep it read-only regardless of host permissions.
- Resolve `__FIXTURE_ROOT__` in `home/.codex/config.toml` before parsing the configuration fixture.

Codex scans `.agents/skills` at the CWD and every ancestor through the repository root. It also reads the user and admin roots. The `duplicate-skill` installations intentionally share a frontmatter `name`; all must remain separate observations because Codex does not merge same-name skills or define a winner.

`fixture-manifest.json` is the golden result. Adapter tests should inject the fixture repository root instead of relying on a nested `.git` directory. `symlink-cases.json` describes links that tests must create with the native platform API, avoiding a committed symlink that would not check out consistently on Windows.

The fixture contains an undocumented `home/.codex/skills` folder as a negative case. The Codex adapter must not auto-discover it. It can be admitted only by the generic explicit-folder adapter.

## Static verification

From the repository root:

```sh
jq empty packages/test-fixtures/codex/fixture-manifest.json
jq empty packages/test-fixtures/codex/symlink-cases.json
find packages/test-fixtures/codex -name SKILL.md -type f -print | sort
```
