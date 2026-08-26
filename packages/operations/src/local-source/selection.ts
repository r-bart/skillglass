import { randomBytes } from "node:crypto"
import path from "node:path"

import { LocalSourceError } from "./errors.js"
import type {
  AdmittedLocalSource,
  LocalSourceAdmissionPort,
  LocalSourceKind,
  LocalSourceSelection,
  NativeSourceDialogPort,
} from "./types.js"

interface SelectionRecord {
  readonly token: string
  readonly admission: AdmittedLocalSource
  readonly expiresAt: string
  claimedByPlanId?: string
  persistedByPlanId?: string
}

export interface SourceSelectionServiceOptions {
  readonly dialog: NativeSourceDialogPort
  readonly admission: LocalSourceAdmissionPort
  readonly now?: () => Date
  readonly mintToken?: () => string
}

function sameIdentity(left: AdmittedLocalSource, right: AdmittedLocalSource): boolean {
  return left.kind === right.kind &&
    left.sourceLocator === right.sourceLocator &&
    left.identity.device === right.identity.device &&
    left.identity.inode === right.identity.inode &&
    left.identity.size === right.identity.size &&
    left.identity.modifiedMilliseconds === right.identity.modifiedMilliseconds &&
    left.manifest.treeHash === right.manifest.treeHash &&
    left.archiveSha256 === right.archiveSha256
}

export class SourceSelectionService {
  readonly #dialog: NativeSourceDialogPort
  readonly #admission: LocalSourceAdmissionPort
  readonly #now: () => Date
  readonly #mintToken: () => string
  readonly #records = new Map<string, SelectionRecord>()

  constructor(options: SourceSelectionServiceOptions) {
    this.#dialog = options.dialog
    this.#admission = options.admission
    this.#now = options.now ?? (() => new Date())
    this.#mintToken = options.mintToken ?? (() => randomBytes(32).toString("base64url"))
  }

  async select(kind: LocalSourceKind): Promise<LocalSourceSelection | undefined> {
    const selected = kind === "directory"
      ? await this.#dialog.selectDirectory()
      : await this.#dialog.selectZipFile()
    if (selected === undefined) return undefined
    const now = this.#now()
    const admission = await this.#admission.inspect(kind, selected, now.toISOString())
    let token = this.#mintToken()
    for (let attempt = 0; this.#records.has(token) && attempt < 8; attempt += 1) {
      token = this.#mintToken()
    }
    if (this.#records.has(token)) {
      throw new LocalSourceError("SOURCE_IO", "Could not mint a unique source-selection token")
    }
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString()
    this.#records.set(token, { token, admission, expiresAt })
    return {
      kind,
      selectionToken: token,
      displayName: path.basename(admission.sourceLocator),
      treeHash: admission.manifest.treeHash,
      ...(admission.archiveSha256 === undefined ? {} : { archiveSha256: admission.archiveSha256 }),
      expiresAt,
    }
  }

  async claimForPlan(
    token: string,
    planId: string,
    expected: Readonly<{ kind: LocalSourceKind; suggestedName?: string; treeHash: string; archiveSha256?: string }>,
  ): Promise<AdmittedLocalSource> {
    const record = this.#requireUsableRecord(token)
    if (record.claimedByPlanId !== undefined && record.claimedByPlanId !== planId) {
      throw new LocalSourceError("SELECTION_ALREADY_CLAIMED", "Selection token is already bound to another plan")
    }
    if (
      record.admission.kind !== expected.kind ||
      (expected.suggestedName !== undefined && (
        record.admission.kind === "zip"
          ? path.basename(record.admission.sourceLocator, path.extname(record.admission.sourceLocator))
          : path.basename(record.admission.sourceLocator)
      ) !== expected.suggestedName) ||
      record.admission.manifest.treeHash !== expected.treeHash ||
      record.admission.archiveSha256 !== expected.archiveSha256
    ) {
      throw new LocalSourceError("SOURCE_CHANGED", "Selection does not match the renderer's preview identity")
    }
    const current = await this.#admission.inspect(record.admission.kind, record.admission.sourceLocator, this.#now().toISOString())
    if (!sameIdentity(record.admission, current)) throw new LocalSourceError("SOURCE_CHANGED", "Local source changed after selection")
    record.claimedByPlanId = planId
    return current
  }

  /** Reauthorizes a renderer claim so an adapter can describe a plan before the token is consumed. */
  async inspectForPlanning(
    token: string,
    expected: Readonly<{ kind: LocalSourceKind; suggestedName: string; treeHash: string; archiveSha256?: string }>,
  ): Promise<AdmittedLocalSource> {
    const record = this.#requireUsableRecord(token)
    if (
      record.admission.kind !== expected.kind ||
      path.basename(record.admission.sourceLocator, record.admission.kind === "zip" ? path.extname(record.admission.sourceLocator) : undefined) !== expected.suggestedName ||
      record.admission.manifest.treeHash !== expected.treeHash ||
      record.admission.archiveSha256 !== expected.archiveSha256
    ) {
      throw new LocalSourceError("SOURCE_CHANGED", "Selection does not match the renderer's preview identity")
    }
    const current = await this.#admission.inspect(record.admission.kind, record.admission.sourceLocator, this.#now().toISOString())
    if (!sameIdentity(record.admission, current)) throw new LocalSourceError("SOURCE_CHANGED", "Local source changed after selection")
    return current
  }

  /** Marks the claim as consumed only after its operation plan is durable. */
  markPlanPersisted(token: string, planId: string): void {
    const record = this.#requireRecord(token)
    if (record.claimedByPlanId !== planId) {
      throw new LocalSourceError("SELECTION_UNKNOWN", "Selection token is not claimed by this plan")
    }
    if (record.persistedByPlanId !== undefined && record.persistedByPlanId !== planId) {
      throw new LocalSourceError("SELECTION_ALREADY_CLAIMED", "Selection token was consumed by another plan")
    }
    record.persistedByPlanId = planId
  }

  expiresAtForPlan(token: string, planId: string): string {
    const record = this.#requireUsableRecord(token)
    if (record.claimedByPlanId !== planId) {
      throw new LocalSourceError("SELECTION_UNKNOWN", "Selection token is not claimed by this plan")
    }
    return record.expiresAt
  }

  /** Reopens the original source immediately before confirmation. */
  async reauthorizeForPlan(token: string, planId: string): Promise<AdmittedLocalSource> {
    const record = this.#requireUsableRecord(token)
    if (record.claimedByPlanId !== planId || record.persistedByPlanId !== planId) {
      throw new LocalSourceError("SELECTION_UNKNOWN", "Selection token is not bound to this persisted plan")
    }
    const current = await this.#admission.inspect(
      record.admission.kind,
      record.admission.sourceLocator,
      this.#now().toISOString(),
    )
    if (!sameIdentity(record.admission, current)) {
      throw new LocalSourceError("SOURCE_CHANGED", "Local source changed after the install preview")
    }
    return current
  }

  releaseUnpersistedClaim(token: string, planId: string): void {
    const record = this.#records.get(token)
    if (record?.claimedByPlanId === planId && record.persistedByPlanId === undefined) {
      delete record.claimedByPlanId
    }
  }

  forgetPersistedSelection(token: string, planId: string): void {
    const record = this.#records.get(token)
    if (record?.persistedByPlanId === planId) this.#records.delete(token)
  }

  #requireRecord(token: string): SelectionRecord {
    const record = this.#records.get(token)
    if (record === undefined) {
      throw new LocalSourceError("SELECTION_UNKNOWN", "Selection token is unknown to this process")
    }
    return record
  }

  #requireUsableRecord(token: string): SelectionRecord {
    const record = this.#requireRecord(token)
    if (this.#now().getTime() >= Date.parse(record.expiresAt)) {
      this.#records.delete(token)
      throw new LocalSourceError("SELECTION_EXPIRED", "Selection token expired")
    }
    return record
  }
}
