# Local import fixtures

These fixtures exercise `thoughts/research/local-source-contract.md` (`local-source-v1`). They contain no executable or large binary payloads.

- `directories/` contains real trees that scanner tests can read directly.
- `archives/` contains declarative ZIP cases. Test helpers generate archives in a temporary directory so unsafe names, duplicate entries, and synthetic sizes never enter the repository as opaque binaries.
- `filesystem/` describes directory-only link and special-entry cases that a platform test materializes in a temporary directory.
- `limits/` provides boundary and boundary-plus-one inputs without storing large payloads.
- `expected/` contains known hashing vectors independent from the source trees.
- `undo/` describes post-install states used to prove the narrow journal-owned undo rule.

Manifest entry kinds are `file`, `directory`, `symlink`, or `generated-files`. `content` is UTF-8 fixture data. `declaredCompressedBytes` and `declaredExpandedBytes` allow limit-accounting tests without storing those bytes. A generator must refuse to materialize declared-size-only cases outside a bounded temporary test.

Every manifest includes `expected.admitted` and a stable reason suitable for assertions. Fixture generators must use the logical entry name verbatim in the ZIP central directory; they must not sanitize it before testing the validator.
