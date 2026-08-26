import path from "node:path"

import {
  type Evidenced as EvidencedDto,
  InstallationDetailDtoSchema,
  InventoryPageDtoSchema,
  InventoryQuerySchema,
  type InstallationDetailDto,
  type InventoryItemDto,
  type InventoryPageDto,
  type InventoryQuery,
} from "@forge/contracts"
import {
  composeSkillStatus,
  evidenced,
  isEvidenced,
  observed,
  unknown,
  type Evidenced,
  type Provenance,
  type ProjectScope,
  type SkillInstallation,
  type SkillSnapshot,
} from "@forge/domain"
import { parseSkillSource } from "@forge/scanner"

import type {
  InventoryQueryRepository,
  ProjectionRepository,
  SnapshotRepository,
  StoredProvenance,
} from "./types.js"

interface InventoryRecord {
  readonly installation: SkillInstallation
  readonly snapshot: SkillSnapshot
  readonly provenance?: StoredProvenance
  readonly item: InventoryItemDto
  readonly searchable: string
}

const VALIDITY_ORDER = { invalid: 0, warning: 1, unknown: 2, valid: 3 } as const
const UPDATE_ORDER = { available: 0, diverged: 1, unknown: 2, unavailable: 3, current: 4 } as const

function knownValue(claim: InventoryItemDto["author"]): string | undefined {
  return claim?.state === "known" ? claim.value : undefined
}

function evidenceDto<T>(claim: Evidenced<T>): EvidencedDto<T> {
  return isEvidenced(claim)
    ? { state: "known", value: claim.value, evidence: claim.evidence }
    : { state: "unknown", evidence: claim.evidence }
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("es-ES")
}

function pathBasename(candidate: string): string {
  const basename = candidate.split(/[\\/]/u).filter(Boolean).at(-1)
  return basename === undefined || basename.length === 0 ? "skill-sin-nombre" : basename
}

function containedRelativeDisplayPath(
  base: string,
  candidate: string,
): string | undefined {
  const relative = path.relative(base, candidate)
  if (relative.length === 0) return "."
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) return undefined
  return relative.split(path.sep).join("/")
}

function relativeDisplayPath(base: string, candidate: string): string {
  const relative = containedRelativeDisplayPath(base, candidate)
  if (relative === undefined) {
    throw new Error("Stored installation paths are not contained")
  }
  return relative
}

function scopeDto(scope: SkillInstallation["scope"]): InventoryItemDto["scope"] {
  if (typeof scope === "object") return { kind: "project", projectId: scope.projectId }
  return { kind: scope }
}

function observedScalar(snapshot: SkillSnapshot, key: string): Evidenced<string> | undefined {
  const fields = parseSkillSource(snapshot.rawSource).fields.filter(
    (field) => field.key === key,
  )
  const value = fields.length === 1 ? fields[0]?.scalarValue?.trim() : undefined
  return value === undefined || value.length === 0
    ? undefined
    : evidenced(
        value,
        observed({
          source: `SKILL.md#frontmatter.${key}`,
          observedAt: snapshot.observedAt,
        }),
      )
}

function packageClaim(provenance: StoredProvenance | undefined): Evidenced<string> | undefined {
  if (provenance === undefined) return undefined
  const packageId = provenance?.value.packageId?.trim()
  return packageId === undefined || packageId.length === 0
    ? undefined
    : evidenced(packageId, observed({
        source: "provenance.packageId",
        observedAt: provenance.observedAt,
      }))
}

function provenanceKind(provenance: StoredProvenance | undefined): Provenance["kind"] {
  return provenance?.value.kind ?? "unknown"
}

function provenanceClaim(
  value: string | undefined,
  source: string,
  observedAt: string | undefined,
): EvidencedDto<string> {
  const claim = value === undefined || value.trim().length === 0
    ? unknown({ source })
    : evidenced(value, observed({ source, ...(observedAt === undefined
      ? {}
      : { observedAt }) }))
  return evidenceDto(claim)
}

function matchesScope(
  installation: SkillInstallation,
  query: ReturnType<typeof InventoryQuerySchema.parse>,
  projects: ReadonlyMap<string, ProjectScope>,
): boolean {
  switch (query.scope.kind) {
    case "all": return true
    case "global": return installation.scope === "global"
    case "root": return installation.rootId === query.scope.rootId
    case "project": {
      const project = projects.get(query.scope.projectId)
      if (project === undefined) return false
      return (
        typeof installation.scope === "object" &&
        installation.scope.projectId === query.scope.projectId
      ) || (
        installation.scope === "global" &&
        project.adapterIds.includes(installation.adapterId)
      )
    }
  }
}

function includes<T>(filter: readonly T[] | undefined, value: T): boolean {
  return filter === undefined || filter.length === 0 || filter.includes(value)
}

function groupLabel(record: InventoryRecord, groupBy: "none" | "author" | "package"): string | undefined {
  if (groupBy === "author") return knownValue(record.item.author)
  if (groupBy === "package") return knownValue(record.item.packageId)
  return undefined
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "es", { sensitivity: "base", numeric: true })
}

function compareRecords(
  left: InventoryRecord,
  right: InventoryRecord,
  query: ReturnType<typeof InventoryQuerySchema.parse>,
): number {
  if (query.groupBy !== "none") {
    const leftGroup = groupLabel(left, query.groupBy)
    const rightGroup = groupLabel(right, query.groupBy)
    if (leftGroup !== rightGroup) {
      if (leftGroup === undefined) return 1
      if (rightGroup === undefined) return -1
      const grouped = compareText(leftGroup, rightGroup)
      if (grouped !== 0) return grouped
    }
  }
  let primary = 0
  switch (query.sort.by) {
    case "name": primary = compareText(left.item.key, right.item.key); break
    case "observedAt": primary = left.item.observedAt.localeCompare(right.item.observedAt); break
    case "validity": primary = VALIDITY_ORDER[left.item.status.validity] - VALIDITY_ORDER[right.item.status.validity]; break
    case "update": primary = UPDATE_ORDER[left.item.status.update] - UPDATE_ORDER[right.item.status.update]; break
  }
  if (primary !== 0) return query.sort.direction === "asc" ? primary : -primary
  const adapter = left.item.adapterId.localeCompare(right.item.adapterId)
  return adapter !== 0 ? adapter : left.item.installationId.localeCompare(right.item.installationId)
}

/** Read-only query over reconstructible projections plus immutable observations. */
export class StoredInventoryQueryRepository implements InventoryQueryRepository {
  readonly #projections: ProjectionRepository
  readonly #snapshots: SnapshotRepository
  readonly #now: () => Date

  constructor(
    projections: ProjectionRepository,
    snapshots: SnapshotRepository,
    now: () => Date = () => new Date(),
  ) {
    this.#projections = projections
    this.#snapshots = snapshots
    this.#now = now
  }

  list(input: InventoryQuery): InventoryPageDto {
    const query = InventoryQuerySchema.parse(input)
    const roots = new Map(this.#projections.listRoots().map((root) => [root.id, root]))
    const projects = this.#projections.listProjects()
    const projectsById = new Map(projects.map((project) => [project.id, project]))
    const projectNames = new Map(projects.map((project) => [project.id, project.displayName]))
    const records: InventoryRecord[] = []

    for (const installation of this.#projections.listInstallations()) {
      const snapshot = this.#snapshots.get(installation.snapshotId)
      if (
        snapshot === undefined ||
        !matchesScope(installation, query, projectsById)
      ) continue
      const provenance = this.#snapshots.getProvenance(installation.provenanceId)
      const authorClaim = observedScalar(snapshot, "author")
      const packageClaimValue = packageClaim(provenance)
      const author = authorClaim === undefined ? undefined : evidenceDto(authorClaim)
      const packageId = packageClaimValue === undefined
        ? undefined
        : evidenceDto(packageClaimValue)
      const name = isEvidenced(snapshot.name) ? snapshot.name.value : pathBasename(installation.canonicalPath)
      const item: InventoryItemDto = {
        installationId: installation.id,
        adapterId: installation.adapterId,
        rootId: installation.rootId,
        scope: scopeDto(installation.scope),
        key: name,
        name: evidenceDto(snapshot.name),
        description: evidenceDto(snapshot.description),
        declaredVersion: evidenceDto(snapshot.declaredVersion),
        ...(author === undefined ? {} : { author }),
        ...(packageId === undefined ? {} : { packageId }),
        status: composeSkillStatus({
          findings: snapshot.findings,
          access: installation.access,
          ...(provenance === undefined ? {} : { provenance: provenance.value }),
        }),
        observedAt: snapshot.observedAt,
      }
      const root = roots.get(installation.rootId)
      const projectName = typeof installation.scope === "object"
        ? projectNames.get(installation.scope.projectId)
        : undefined
      records.push({
        installation,
        snapshot,
        ...(provenance === undefined ? {} : { provenance }),
        item,
        searchable: normalized([
          item.key,
          item.description.state === "known" ? item.description.value : "",
          installation.canonicalPath,
          root?.canonicalPath ?? "",
          knownValue(author) ?? "",
          knownValue(packageId) ?? "",
          projectName ?? "",
        ].join("\n")),
      })
    }

    const needle = query.search === undefined ? "" : normalized(query.search)
    const filtered = records.filter((record) => {
      const author = knownValue(record.item.author)
      const packageId = knownValue(record.item.packageId)
      return (
        (needle.length === 0 || record.searchable.includes(needle)) &&
        includes(query.adapterIds, record.item.adapterId) &&
        includes(query.validity, record.item.status.validity) &&
        includes(query.runtimeStates, record.item.status.runtimeState) &&
        includes(query.sourceStates, record.item.status.source) &&
        includes(query.updates, record.item.status.update) &&
        includes(query.provenanceKinds, provenanceKind(record.provenance)) &&
        (query.authors === undefined || (author !== undefined && query.authors.includes(author))) &&
        (query.packageIds === undefined || (packageId !== undefined && query.packageIds.includes(packageId)))
      )
    }).sort((left, right) => compareRecords(left, right, query))

    const cursorIndex = query.cursor === undefined
      ? -1
      : filtered.findIndex(({ item }) => item.installationId === query.cursor)
    const start = cursorIndex < 0 ? 0 : cursorIndex + 1
    const pageRecords = filtered.slice(start, start + query.pageSize)
    const last = pageRecords.at(-1)
    const nextCursor = start + pageRecords.length < filtered.length && last !== undefined
      ? last.item.installationId
      : null
    const latestObservation = records.reduce<string | undefined>(
      (latest, { snapshot }) => latest === undefined || snapshot.observedAt > latest ? snapshot.observedAt : latest,
      undefined,
    )
    return InventoryPageDtoSchema.parse({
      items: pageRecords.map(({ item }) => item),
      projects: projects.map(({ id, displayName }) => ({ projectId: id, displayName })),
      nextCursor,
      total: filtered.length,
      observedAt: latestObservation ?? this.#now().toISOString(),
    })
  }

  inspect(installationId: string): InstallationDetailDto | undefined {
    const installation = this.#projections.getInstallation(installationId)
    if (installation === undefined) return undefined
    const snapshot = this.#snapshots.get(installation.snapshotId)
    if (snapshot === undefined) return undefined
    const provenance = this.#snapshots.getProvenance(installation.provenanceId)
    const root = this.#projections.listRoots().find(({ id }) => id === installation.rootId)
    if (root === undefined) return undefined

    const authorClaim = observedScalar(snapshot, "author")
    const packageClaimValue = packageClaim(provenance)
    const name = isEvidenced(snapshot.name)
      ? snapshot.name.value
      : pathBasename(installation.canonicalPath)
    const inventoryItem: InventoryItemDto = {
      installationId: installation.id,
      adapterId: installation.adapterId,
      rootId: installation.rootId,
      scope: scopeDto(installation.scope),
      key: name,
      name: evidenceDto(snapshot.name),
      description: evidenceDto(snapshot.description),
      declaredVersion: evidenceDto(snapshot.declaredVersion),
      ...(authorClaim === undefined
        ? {}
        : { author: evidenceDto(authorClaim) }),
      ...(packageClaimValue === undefined
        ? {}
        : { packageId: evidenceDto(packageClaimValue) }),
      status: composeSkillStatus({
        findings: snapshot.findings,
        access: installation.access,
        ...(provenance === undefined ? {} : { provenance: provenance.value }),
      }),
      observedAt: snapshot.observedAt,
    }
    const entryFile = relativeDisplayPath(
      installation.canonicalPath,
      installation.entryFile,
    )
    const writableRoot = root.access === "read-write" &&
      root.kind !== "managed" && root.kind !== "system"
    const editableProvenance = provenance?.value.kind !== "plugin" &&
      provenance?.value.kind !== "system" &&
      provenance?.value.managedBy !== "runtime" &&
      provenance?.value.managedBy !== "external"
    const canEditEntry = installation.access === "read-write" &&
      writableRoot && editableProvenance
    const unavailableReasons = canEditEntry
      ? []
      : [installation.access === "read-only" || !writableRoot
          ? "Solo lectura"
          : "La procedencia no permite editar esta instalación"]
    const provenanceValue = provenance?.value
    const provenanceObservedAt = provenance?.observedAt

    return InstallationDetailDtoSchema.parse({
      installation: inventoryItem,
      snapshotId: snapshot.id,
      locationLabel: installation.canonicalPath,
      entryFile,
      rawEntryContent: snapshot.rawSource,
      contentHash: snapshot.contentHash,
      files: snapshot.files.map((file) => ({
        relativePath: relativeDisplayPath(
          installation.canonicalPath,
          file.canonicalPath,
        ),
        byteLength: file.size,
        sha256: file.contentHash,
        kind: file.canonicalPath === installation.entryFile ? "entry" : "resource",
      })).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
      findings: snapshot.findings.map((finding) => {
        const relativeFile = finding.file === undefined
          ? undefined
          : containedRelativeDisplayPath(
              installation.canonicalPath,
              finding.file,
            )
        return {
          code: finding.code,
          severity: finding.severity,
          message: finding.message,
          ...(relativeFile === undefined ? {} : { relativeFile }),
          ...(finding.range === undefined ? {} : { range: finding.range }),
          source: finding.source === "core"
            ? { kind: "core" }
            : { kind: "adapter", adapterId: finding.source.adapterId },
        }
      }),
      requirements: snapshot.requirements,
      provenance: {
        id: provenance?.id ?? installation.provenanceId,
        kind: provenanceValue?.kind ?? "unknown",
        sourceLabel: provenanceClaim(
          provenanceValue?.sourceUrl ?? provenanceValue?.packageId,
          "provenance.source",
          provenanceObservedAt,
        ),
        release: provenanceClaim(
          provenanceValue?.release,
          "provenance.release",
          provenanceObservedAt,
        ),
        commit: provenanceClaim(
          provenanceValue?.commit,
          "provenance.commit",
          provenanceObservedAt,
        ),
        license: provenanceClaim(
          provenanceValue?.license,
          "provenance.license",
          provenanceObservedAt,
        ),
        managedBy: provenanceValue?.managedBy ?? "unknown",
      },
      capabilities: {
        canInstallSibling: writableRoot,
        canUpdateFromSource: canEditEntry && (
          provenanceValue?.kind === "local" ||
          provenanceValue?.kind === "forge-import"
        ),
        canEditEntry,
        unavailableReasons,
      },
    })
  }
}
