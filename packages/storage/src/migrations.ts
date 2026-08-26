import type { DatabaseSync } from "node:sqlite"

interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

/**
 * Append-only schema migrations. Never edit a released migration; add another.
 * Statements are static and contain no application input.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "settings",
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "inventory_and_observation_history",
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        adapter_ids_json TEXT NOT NULL CHECK (json_valid(adapter_ids_json))
      ) STRICT;

      CREATE TABLE roots (
        id TEXT PRIMARY KEY NOT NULL,
        adapter_id TEXT NOT NULL,
        canonical_path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('global', 'project', 'managed', 'system', 'user-added')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        access TEXT NOT NULL CHECK (access IN ('read-write', 'read-only', 'missing', 'denied')),
        discovery_json TEXT NOT NULL CHECK (json_valid(discovery_json)),
        UNIQUE (adapter_id, canonical_path)
      ) STRICT;

      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY NOT NULL,
        installation_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        name_json TEXT NOT NULL CHECK (json_valid(name_json)),
        description_json TEXT NOT NULL CHECK (json_valid(description_json)),
        declared_version_json TEXT NOT NULL CHECK (json_valid(declared_version_json)),
        files_json TEXT NOT NULL CHECK (json_valid(files_json)),
        requirements_json TEXT NOT NULL CHECK (json_valid(requirements_json)),
        raw_source TEXT NOT NULL
      ) STRICT;

      CREATE INDEX snapshots_installation_observed
        ON snapshots(installation_id, observed_at DESC, id);

      CREATE TABLE provenance (
        id TEXT PRIMARY KEY NOT NULL,
        installation_id TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json))
      ) STRICT;

      CREATE INDEX provenance_installation_observed
        ON provenance(installation_id, observed_at DESC, id);

      CREATE TABLE findings (
        snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        code TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
        message TEXT NOT NULL,
        file TEXT,
        range_json TEXT CHECK (range_json IS NULL OR json_valid(range_json)),
        source_json TEXT NOT NULL CHECK (json_valid(source_json)),
        PRIMARY KEY (snapshot_id, ordinal)
      ) STRICT;

      CREATE TABLE installations (
        id TEXT PRIMARY KEY NOT NULL,
        adapter_id TEXT NOT NULL,
        root_id TEXT NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
        canonical_path TEXT NOT NULL,
        entry_file TEXT NOT NULL,
        scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
        provenance_id TEXT NOT NULL REFERENCES provenance(id) ON DELETE RESTRICT,
        access TEXT NOT NULL CHECK (access IN ('read-write', 'read-only')),
        UNIQUE (adapter_id, canonical_path)
      ) STRICT;

      CREATE INDEX installations_root ON installations(root_id);
      CREATE INDEX installations_project ON installations(project_id);
    `,
  },
  {
    version: 3,
    name: "operation_journal_and_recovery",
    sql: `
      CREATE TABLE operation_plans (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'planned', 'preconditions-checked', 'staged', 'snapshot-created',
          'applying', 'verifying', 'committed', 'rolling-back', 'rolled-back',
          'recovery-required', 'blocked', 'expired', 'failed'
        )),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        adapter_id TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      ) STRICT;

      CREATE TABLE journal_steps (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL REFERENCES operation_plans(id) ON DELETE RESTRICT,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        state TEXT NOT NULL CHECK (state IN (
          'planned', 'preconditions-checked', 'staged', 'snapshot-created',
          'applying', 'verifying', 'committed', 'rolling-back', 'rolled-back',
          'recovery-required', 'blocked', 'expired', 'failed'
        )),
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        UNIQUE (plan_id, sequence)
      ) STRICT;

      CREATE INDEX journal_steps_plan_sequence
        ON journal_steps(plan_id, sequence);

      CREATE TABLE recovery_records (
        id TEXT PRIMARY KEY NOT NULL,
        plan_id TEXT NOT NULL REFERENCES operation_plans(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (state IN ('pending', 'resolved', 'conflict')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
      ) STRICT;

      CREATE INDEX recovery_records_pending
        ON recovery_records(state, updated_at);
    `,
  },
  {
    version: 4,
    name: "adapter_scope_projections",
    sql: `
      CREATE TABLE scope_bindings (
        installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
        target_scope_json TEXT NOT NULL CHECK (json_valid(target_scope_json)),
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        PRIMARY KEY (installation_id, target_scope_json)
      ) STRICT;

      CREATE TABLE effective_skills (
        adapter_id TEXT NOT NULL,
        target_scope_json TEXT NOT NULL CHECK (json_valid(target_scope_json)),
        skill_key TEXT NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        PRIMARY KEY (adapter_id, target_scope_json, skill_key)
      ) STRICT;
    `,
  },
]

export function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `)

  const appliedStatement = database.prepare(
    "SELECT version FROM schema_migrations ORDER BY version",
  )
  const applied = new Set(
    (appliedStatement.all() as Array<{ version: number }>).map(
      ({ version }) => version,
    ),
  )
  const recordStatement = database.prepare(
    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue

    database.exec("BEGIN IMMEDIATE")
    try {
      database.exec(migration.sql)
      recordStatement.run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      )
      database.exec("COMMIT")
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK")
      throw error
    }
  }
}
