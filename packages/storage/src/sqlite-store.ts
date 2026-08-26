import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"

import {
  canonicalPath,
  type EffectiveSkill,
  type ProjectScope,
  type ScopeBinding,
  type SkillInstallation,
  type SkillSnapshot,
  type SourceRoot,
  type ValidationFinding,
} from "@forge/domain"

import { migrate } from "./migrations.js"
import { StoredInventoryQueryRepository } from "./inventory-query.js"
import { SettingsUpdateObservationRepository } from "./update-observations.js"
import type {
  ForgeStore,
  InventoryProjection,
  JournalStep,
  OpenForgeStoreOptions,
  OperationJournalRepository,
  OperationPlanState,
  ProjectionRepository,
  RecoveryRecord,
  SettingsRepository,
  SnapshotRepository,
  StoredOperationPlan,
  StoredProvenance,
} from "./types.js"

type SqlValue = SQLInputValue
type SqlRow = Record<string, SqlValue>

export class ForgeStorageError extends Error {
  override readonly name: string = "ForgeStorageError"
}

export class ForgeStorageCorruptionError extends ForgeStorageError {
  override readonly name = "ForgeStorageCorruptionError"
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new ForgeStorageError("Cannot persist an undefined JSON value")
  }
  return serialized
}

function parseJson<T>(value: SqlValue | undefined, field: string): T {
  if (typeof value !== "string") {
    throw new ForgeStorageCorruptionError(`${field} is not stored as JSON text`)
  }
  try {
    return JSON.parse(value) as T
  } catch (error) {
    throw new ForgeStorageCorruptionError(
      `${field} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function textValue(row: SqlRow, field: string): string {
  const value = row[field]
  if (typeof value !== "string") {
    throw new ForgeStorageCorruptionError(`${field} is not text`)
  }
  return value
}

function nullableText(row: SqlRow, field: string): string | undefined {
  const value = row[field]
  if (value === null) return undefined
  if (typeof value !== "string") {
    throw new ForgeStorageCorruptionError(`${field} is not nullable text`)
  }
  return value
}

function integerValue(row: SqlRow, field: string): number {
  const value = row[field]
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ForgeStorageCorruptionError(`${field} is not a safe integer`)
  }
  return value
}

function rows<T extends SqlRow>(value: unknown): T[] {
  return value as T[]
}

function transaction<T>(database: DatabaseSync, callback: () => T): T {
  database.exec("BEGIN IMMEDIATE")
  try {
    const result = callback()
    database.exec("COMMIT")
    return result
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK")
    throw error
  }
}

class SqliteSettingsRepository implements SettingsRepository {
  readonly #get
  readonly #set
  readonly #delete
  readonly #entries

  constructor(database: DatabaseSync) {
    this.#get = database.prepare("SELECT value_json FROM settings WHERE key = ?")
    this.#set = database.prepare(`
      INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `)
    this.#delete = database.prepare("DELETE FROM settings WHERE key = ?")
    this.#entries = database.prepare(
      "SELECT key, value_json, updated_at FROM settings ORDER BY key",
    )
  }

  get<T>(key: string): T | undefined {
    const row = this.#get.get(key) as SqlRow | undefined
    return row === undefined ? undefined : parseJson<T>(row.value_json, "settings.value_json")
  }

  set(key: string, value: unknown, updatedAt = new Date().toISOString()): void {
    this.#set.run(key, json(value), updatedAt)
  }

  delete(key: string): boolean {
    return this.#delete.run(key).changes > 0
  }

  entries(): ReadonlyArray<Readonly<{ key: string; value: unknown; updatedAt: string }>> {
    return rows<SqlRow>(this.#entries.all()).map((row) => ({
      key: textValue(row, "key"),
      value: parseJson(row.value_json, "settings.value_json"),
      updatedAt: textValue(row, "updated_at"),
    }))
  }
}

class SqliteProjectionRepository implements ProjectionRepository {
  readonly #database: DatabaseSync
  readonly #deleteInstallations
  readonly #deleteRoots
  readonly #deleteProjects
  readonly #deleteBindings
  readonly #deleteEffectiveSkills
  readonly #insertProject
  readonly #insertRoot
  readonly #insertInstallation
  readonly #insertBinding
  readonly #insertEffectiveSkill
  readonly #listProjects
  readonly #listRoots
  readonly #listInstallations
  readonly #getInstallation
  readonly #listBindings
  readonly #listEffectiveSkills

  constructor(database: DatabaseSync) {
    this.#database = database
    this.#deleteInstallations = database.prepare("DELETE FROM installations")
    this.#deleteRoots = database.prepare("DELETE FROM roots")
    this.#deleteProjects = database.prepare("DELETE FROM projects")
    this.#deleteBindings = database.prepare("DELETE FROM scope_bindings")
    this.#deleteEffectiveSkills = database.prepare("DELETE FROM effective_skills")
    this.#insertProject = database.prepare(`
      INSERT INTO projects(id, display_name, canonical_path, adapter_ids_json)
      VALUES (?, ?, ?, ?)
    `)
    this.#insertRoot = database.prepare(`
      INSERT INTO roots(
        id, adapter_id, canonical_path, kind, project_id, access, discovery_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    this.#insertInstallation = database.prepare(`
      INSERT INTO installations(
        id, adapter_id, root_id, canonical_path, entry_file, scope_json,
        project_id, snapshot_id, provenance_id, access
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.#insertBinding = database.prepare(`
      INSERT INTO scope_bindings(installation_id, target_scope_json, value_json)
      VALUES (?, ?, ?)
    `)
    this.#insertEffectiveSkill = database.prepare(`
      INSERT INTO effective_skills(adapter_id, target_scope_json, skill_key, value_json)
      VALUES (?, ?, ?, ?)
    `)
    this.#listProjects = database.prepare("SELECT * FROM projects ORDER BY id")
    this.#listRoots = database.prepare("SELECT * FROM roots ORDER BY id")
    this.#listInstallations = database.prepare(
      "SELECT * FROM installations ORDER BY id",
    )
    this.#getInstallation = database.prepare(
      "SELECT * FROM installations WHERE id = ?",
    )
    this.#listBindings = database.prepare(
      "SELECT value_json FROM scope_bindings ORDER BY installation_id, target_scope_json",
    )
    this.#listEffectiveSkills = database.prepare(
      "SELECT value_json FROM effective_skills ORDER BY adapter_id, target_scope_json, skill_key",
    )
  }

  replaceInventory(projection: InventoryProjection): void {
    transaction(this.#database, () => {
      this.#deleteBindings.run()
      this.#deleteEffectiveSkills.run()
      this.#deleteInstallations.run()
      this.#deleteRoots.run()
      this.#deleteProjects.run()

      for (const project of projection.projects) {
        this.#insertProject.run(
          project.id,
          project.displayName,
          project.canonicalPath,
          json(project.adapterIds),
        )
      }
      for (const root of projection.roots) {
        this.#insertRoot.run(
          root.id,
          root.adapterId,
          root.canonicalPath,
          root.kind,
          root.projectId ?? null,
          root.access,
          json(root.discovery),
        )
      }
      for (const installation of projection.installations) {
        const projectId =
          typeof installation.scope === "object"
            ? installation.scope.projectId
            : null
        this.#insertInstallation.run(
          installation.id,
          installation.adapterId,
          installation.rootId,
          installation.canonicalPath,
          installation.entryFile,
          json(installation.scope),
          projectId,
          installation.snapshotId,
          installation.provenanceId,
          installation.access,
        )
      }
      for (const binding of projection.bindings ?? []) {
        this.#insertBinding.run(
          binding.installationId,
          json(binding.targetScope),
          json(binding),
        )
      }
      for (const effective of projection.effectiveSkills ?? []) {
        this.#insertEffectiveSkill.run(
          effective.adapterId,
          json(effective.targetScope),
          effective.key,
          json(effective),
        )
      }
    })
  }

  listProjects(): readonly ProjectScope[] {
    return rows<SqlRow>(this.#listProjects.all()).map(projectFromRow)
  }

  listRoots(): readonly SourceRoot[] {
    return rows<SqlRow>(this.#listRoots.all()).map(rootFromRow)
  }

  listInstallations(): readonly SkillInstallation[] {
    return rows<SqlRow>(this.#listInstallations.all()).map(installationFromRow)
  }

  getInstallation(id: string): SkillInstallation | undefined {
    const row = this.#getInstallation.get(id) as SqlRow | undefined
    return row === undefined ? undefined : installationFromRow(row)
  }

  listBindings(): readonly ScopeBinding[] {
    return rows<SqlRow>(this.#listBindings.all()).map((row) =>
      parseJson<ScopeBinding>(row.value_json, "scope_bindings.value_json"),
    )
  }

  listEffectiveSkills(): readonly EffectiveSkill[] {
    return rows<SqlRow>(this.#listEffectiveSkills.all()).map((row) =>
      parseJson<EffectiveSkill>(row.value_json, "effective_skills.value_json"),
    )
  }
}

function projectFromRow(row: SqlRow): ProjectScope {
  return {
    id: textValue(row, "id"),
    displayName: textValue(row, "display_name"),
    canonicalPath: canonicalPath(textValue(row, "canonical_path")),
    adapterIds: parseJson<string[]>(row.adapter_ids_json, "projects.adapter_ids_json"),
  }
}

function rootFromRow(row: SqlRow): SourceRoot {
  const projectId = nullableText(row, "project_id")
  return {
    id: textValue(row, "id"),
    adapterId: textValue(row, "adapter_id"),
    canonicalPath: canonicalPath(textValue(row, "canonical_path")),
    kind: textValue(row, "kind") as SourceRoot["kind"],
    ...(projectId === undefined ? {} : { projectId }),
    access: textValue(row, "access") as SourceRoot["access"],
    discovery: parseJson(row.discovery_json, "roots.discovery_json"),
  }
}

function installationFromRow(row: SqlRow): SkillInstallation {
  return {
    id: textValue(row, "id"),
    adapterId: textValue(row, "adapter_id"),
    rootId: textValue(row, "root_id"),
    canonicalPath: canonicalPath(textValue(row, "canonical_path")),
    entryFile: canonicalPath(textValue(row, "entry_file")),
    scope: parseJson(row.scope_json, "installations.scope_json"),
    snapshotId: textValue(row, "snapshot_id"),
    provenanceId: textValue(row, "provenance_id"),
    access: textValue(row, "access") as SkillInstallation["access"],
  }
}

class SqliteSnapshotRepository implements SnapshotRepository {
  readonly #database: DatabaseSync
  readonly #insertSnapshot
  readonly #insertFinding
  readonly #getSnapshot
  readonly #listSnapshots
  readonly #listFindings
  readonly #insertProvenance
  readonly #getProvenance

  constructor(database: DatabaseSync) {
    this.#database = database
    this.#insertSnapshot = database.prepare(`
      INSERT INTO snapshots(
        id, installation_id, content_hash, observed_at, name_json,
        description_json, declared_version_json, files_json,
        requirements_json, raw_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.#insertFinding = database.prepare(`
      INSERT INTO findings(
        snapshot_id, ordinal, code, severity, message, file, range_json, source_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.#getSnapshot = database.prepare("SELECT * FROM snapshots WHERE id = ?")
    this.#listSnapshots = database.prepare(`
      SELECT * FROM snapshots
      WHERE installation_id = ?
      ORDER BY observed_at DESC, id DESC
    `)
    this.#listFindings = database.prepare(`
      SELECT * FROM findings WHERE snapshot_id = ? ORDER BY ordinal
    `)
    this.#insertProvenance = database.prepare(`
      INSERT INTO provenance(id, installation_id, observed_at, value_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        installation_id = excluded.installation_id,
        observed_at = excluded.observed_at,
        value_json = excluded.value_json
    `)
    this.#getProvenance = database.prepare(
      "SELECT * FROM provenance WHERE id = ?",
    )
  }

  put(snapshot: SkillSnapshot): void {
    transaction(this.#database, () => {
      this.#insertSnapshot.run(
        snapshot.id,
        snapshot.installationId,
        snapshot.contentHash,
        snapshot.observedAt,
        json(snapshot.name),
        json(snapshot.description),
        json(snapshot.declaredVersion),
        json(snapshot.files),
        json(snapshot.requirements),
        snapshot.rawSource,
      )
      snapshot.findings.forEach((finding, ordinal) => {
        this.#insertFinding.run(
          snapshot.id,
          ordinal,
          finding.code,
          finding.severity,
          finding.message,
          finding.file ?? null,
          finding.range === undefined ? null : json(finding.range),
          json(finding.source),
        )
      })
    })
  }

  get(id: string): SkillSnapshot | undefined {
    const row = this.#getSnapshot.get(id) as SqlRow | undefined
    return row === undefined ? undefined : this.#snapshotFromRow(row)
  }

  listForInstallation(installationId: string): readonly SkillSnapshot[] {
    return rows<SqlRow>(this.#listSnapshots.all(installationId)).map((row) =>
      this.#snapshotFromRow(row),
    )
  }

  putProvenance(provenance: StoredProvenance): void {
    this.#insertProvenance.run(
      provenance.id,
      provenance.installationId,
      provenance.observedAt,
      json(provenance.value),
    )
  }

  getProvenance(id: string): StoredProvenance | undefined {
    const row = this.#getProvenance.get(id) as SqlRow | undefined
    if (row === undefined) return undefined
    return {
      id: textValue(row, "id"),
      installationId: textValue(row, "installation_id"),
      observedAt: textValue(row, "observed_at"),
      value: parseJson(row.value_json, "provenance.value_json"),
    }
  }

  #snapshotFromRow(row: SqlRow): SkillSnapshot {
    const id = textValue(row, "id")
    const findings = rows<SqlRow>(this.#listFindings.all(id)).map(
      findingFromRow,
    )
    return {
      id,
      installationId: textValue(row, "installation_id"),
      contentHash: textValue(row, "content_hash"),
      observedAt: textValue(row, "observed_at"),
      name: parseJson(row.name_json, "snapshots.name_json"),
      description: parseJson(row.description_json, "snapshots.description_json"),
      declaredVersion: parseJson(
        row.declared_version_json,
        "snapshots.declared_version_json",
      ),
      files: parseJson(row.files_json, "snapshots.files_json"),
      requirements: parseJson(
        row.requirements_json,
        "snapshots.requirements_json",
      ),
      findings,
      rawSource: textValue(row, "raw_source"),
    }
  }
}

function findingFromRow(row: SqlRow): ValidationFinding {
  const file = nullableText(row, "file")
  const rangeValue = row.range_json
  return {
    code: textValue(row, "code"),
    severity: textValue(row, "severity") as ValidationFinding["severity"],
    message: textValue(row, "message"),
    ...(file === undefined ? {} : { file: canonicalPath(file) }),
    ...(rangeValue === null
      ? {}
      : { range: parseJson(rangeValue, "findings.range_json") }),
    source: parseJson(row.source_json, "findings.source_json"),
  }
}

class SqliteOperationJournalRepository
  implements OperationJournalRepository
{
  readonly #putPlan
  readonly #database: DatabaseSync
  readonly #getPlan
  readonly #listPlans
  readonly #updatePlanState
  readonly #transitionPlan
  readonly #appendStep
  readonly #listSteps
  readonly #putRecovery
  readonly #getRecovery
  readonly #listPendingRecovery

  constructor(database: DatabaseSync) {
    this.#database = database
    this.#putPlan = database.prepare(`
      INSERT INTO operation_plans(
        id, kind, state, created_at, updated_at, expires_at, adapter_id, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.#getPlan = database.prepare("SELECT * FROM operation_plans WHERE id = ?")
    this.#listPlans = database.prepare(
      "SELECT * FROM operation_plans ORDER BY created_at DESC, id DESC",
    )
    this.#updatePlanState = database.prepare(`
      UPDATE operation_plans SET state = ?, updated_at = ? WHERE id = ?
    `)
    this.#transitionPlan = database.prepare(`
      UPDATE operation_plans
      SET kind = ?, state = ?, updated_at = ?, expires_at = ?, adapter_id = ?, payload_json = ?
      WHERE id = ? AND json_extract(payload_json, '$.revision') = ?
    `)
    this.#appendStep = database.prepare(`
      INSERT INTO journal_steps(id, plan_id, sequence, state, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.#listSteps = database.prepare(`
      SELECT * FROM journal_steps WHERE plan_id = ? ORDER BY sequence
    `)
    this.#putRecovery = database.prepare(`
      INSERT INTO recovery_records(
        id, plan_id, state, created_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `)
    this.#getRecovery = database.prepare(
      "SELECT * FROM recovery_records WHERE id = ?",
    )
    this.#listPendingRecovery = database.prepare(`
      SELECT * FROM recovery_records
      WHERE state = 'pending'
      ORDER BY updated_at, id
    `)
  }

  putPlan(plan: StoredOperationPlan): void {
    this.#putPlan.run(
      plan.id,
      plan.kind,
      plan.state,
      plan.createdAt,
      plan.updatedAt,
      plan.expiresAt ?? null,
      plan.adapterId,
      json(plan.payload),
    )
  }

  insertPlanWithStep(plan: StoredOperationPlan, step: JournalStep): void {
    transaction(this.#database, () => {
      this.putPlan(plan)
      this.appendStep(step)
    })
  }

  getPlan(id: string): StoredOperationPlan | undefined {
    const row = this.#getPlan.get(id) as SqlRow | undefined
    return row === undefined ? undefined : operationPlanFromRow(row)
  }

  listPlans(): readonly StoredOperationPlan[] {
    return rows<SqlRow>(this.#listPlans.all()).map(operationPlanFromRow)
  }

  updatePlanState(
    id: string,
    state: OperationPlanState,
    updatedAt = new Date().toISOString(),
  ): boolean {
    return this.#updatePlanState.run(state, updatedAt, id).changes > 0
  }

  transitionPlanWithStep(
    expectedRevision: number,
    plan: StoredOperationPlan,
    step: JournalStep,
  ): boolean {
    return transaction(this.#database, () => {
      const changed = this.#transitionPlan.run(
        plan.kind,
        plan.state,
        plan.updatedAt,
        plan.expiresAt ?? null,
        plan.adapterId,
        json(plan.payload),
        plan.id,
        expectedRevision,
      ).changes > 0
      if (!changed) return false
      this.appendStep(step)
      return true
    })
  }

  appendStep(step: JournalStep): void {
    this.#appendStep.run(
      step.id,
      step.planId,
      step.sequence,
      step.state,
      step.createdAt,
      json(step.payload),
    )
  }

  listSteps(planId: string): readonly JournalStep[] {
    return rows<SqlRow>(this.#listSteps.all(planId)).map(journalStepFromRow)
  }

  putRecovery(record: RecoveryRecord): void {
    this.#putRecovery.run(
      record.id,
      record.planId,
      record.state,
      record.createdAt,
      record.updatedAt,
      json(record.payload),
    )
  }

  getRecovery(id: string): RecoveryRecord | undefined {
    const row = this.#getRecovery.get(id) as SqlRow | undefined
    return row === undefined ? undefined : recoveryFromRow(row)
  }

  listPendingRecovery(): readonly RecoveryRecord[] {
    return rows<SqlRow>(this.#listPendingRecovery.all()).map(recoveryFromRow)
  }
}

function operationPlanFromRow(row: SqlRow): StoredOperationPlan {
  const expiresAt = nullableText(row, "expires_at")
  return {
    id: textValue(row, "id"),
    kind: textValue(row, "kind"),
    state: textValue(row, "state") as OperationPlanState,
    createdAt: textValue(row, "created_at"),
    updatedAt: textValue(row, "updated_at"),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    adapterId: textValue(row, "adapter_id"),
    payload: parseJson(row.payload_json, "operation_plans.payload_json"),
  }
}

function journalStepFromRow(row: SqlRow): JournalStep {
  return {
    id: textValue(row, "id"),
    planId: textValue(row, "plan_id"),
    sequence: integerValue(row, "sequence"),
    state: textValue(row, "state") as OperationPlanState,
    createdAt: textValue(row, "created_at"),
    payload: parseJson(row.payload_json, "journal_steps.payload_json"),
  }
}

function recoveryFromRow(row: SqlRow): RecoveryRecord {
  return {
    id: textValue(row, "id"),
    planId: textValue(row, "plan_id"),
    state: textValue(row, "state") as RecoveryRecord["state"],
    createdAt: textValue(row, "created_at"),
    updatedAt: textValue(row, "updated_at"),
    payload: parseJson(row.payload_json, "recovery_records.payload_json"),
  }
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON")
  database.exec("PRAGMA busy_timeout = 5000")
  database.exec("PRAGMA synchronous = FULL")
  database.exec("PRAGMA trusted_schema = OFF")
  database.enableDefensive(true)
}

export function openForgeStore(options: OpenForgeStoreOptions): ForgeStore {
  if (options.path.length === 0) {
    throw new ForgeStorageError("Database path cannot be empty")
  }
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true })
  }

  const database = new DatabaseSync(options.path, {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    readOnly: false,
  })

  try {
    configure(database)
    migrate(database)
    if (options.path !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL")
    }

    const projections = new SqliteProjectionRepository(database)
    const snapshots = new SqliteSnapshotRepository(database)
    const settings = new SqliteSettingsRepository(database)
    const updates = new SettingsUpdateObservationRepository(settings)
    const store: ForgeStore = {
      path: options.path,
      projections,
      inventory: new StoredInventoryQueryRepository(projections, snapshots, () => new Date(), updates),
      snapshots,
      operations: new SqliteOperationJournalRepository(database),
      settings,
      updates,
      close: () => {
        if (database.isOpen) database.close()
      },
    }
    return store
  } catch (error) {
    if (database.isOpen) database.close()
    throw error
  }
}
