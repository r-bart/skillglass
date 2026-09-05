import type { SourceRoot } from "@forge/domain"

export interface ScannableAdapter<TObservation> {
  readonly id: string
  scanRoot(root: SourceRoot, context?: ScanRootContext): AsyncIterable<TObservation>
}

/**
 * A root-local omission reported by an adapter while it keeps scanning.
 * The coordinator supplies root and adapter identity before publishing it.
 */
export interface AdapterScanFinding {
  readonly code:
    | "ROOT_DENIED"
    | "ROOT_MISSING"
    | "ROOT_SCAN_FAILED"
    | "INSTALLATION_SCAN_FAILED"
    | "SYMLINK_OUTSIDE_APPROVED_ROOT"
    | "SYMLINK_TARGET_INACCESSIBLE"
  readonly severity: "warning" | "error"
  readonly message: string
  readonly path: string
  readonly targetPath?: string
  readonly causeCode?: string
}

export interface ScanRootContext {
  reportFinding(finding: AdapterScanFinding): void
}

export interface ScanFinding {
  readonly code:
    | "ADAPTER_NOT_FOUND"
    | "ROOT_DENIED"
    | "ROOT_MISSING"
    | "ROOT_SCAN_FAILED"
    | AdapterScanFinding["code"]
  readonly severity: "warning" | "error"
  readonly message: string
  readonly rootId: string
  readonly adapterId: string
  readonly path: string
  readonly targetPath?: string
  readonly causeCode?: string
}

export interface ScanProgress {
  readonly phase:
    | "started"
    | "root-started"
    | "root-completed"
    | "completed"
    | "stopped"
  readonly totalRoots: number
  readonly completedRoots: number
  readonly activeRoots: number
  readonly observationCount: number
  readonly findingCount: number
  readonly rootId?: string
}

export type ScanEvent<TObservation> =
  | Readonly<{
      kind: "observation"
      rootId: string
      adapterId: string
      observation: TObservation
    }>
  | Readonly<{ kind: "finding"; finding: ScanFinding }>
  | Readonly<{ kind: "progress"; progress: ScanProgress }>

export interface ScanCoordinatorOptions<TObservation> {
  readonly adapters: readonly ScannableAdapter<TObservation>[]
  readonly approvedRoots: readonly SourceRoot[]
  readonly concurrency?: number
  readonly yieldEvery?: number
  readonly yieldControl?: () => Promise<void>
}
