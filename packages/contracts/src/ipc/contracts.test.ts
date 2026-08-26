import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  ApproveRootsInputSchema,
  ConfirmOperationInputSchema,
  EvidenceSchema,
  evidencedSchema,
  InstallationDetailDtoSchema,
  InventoryPageDtoSchema,
  InventoryQuerySchema,
  IPC_EVENT_CHANNEL_ALLOWLIST,
  IPC_EVENT_CHANNELS,
  IPC_EVENT_CONTRACTS,
  IPC_INVOKE_CHANNEL_ALLOWLIST,
  IPC_INVOKE_CHANNELS,
  IPC_INVOKE_CONTRACTS,
  InventoryChangedEventSchema,
  IpcEventChannelSchema,
  IpcInvokeChannelSchema,
  LocalSourceSelectionDtoSchema,
  OperationPlanDtoSchema,
  OperationRequestDtoSchema,
  OperationResultDtoSchema,
  OperationProgressEventSchema,
  OnboardingStateDtoSchema,
  RootCandidateDtoSchema,
  RootsChangedEventSchema,
  UndoOperationInputSchema,
} from "./index.js"

const NOW = "2026-08-26T12:00:00.000Z"
const LATER = "2026-08-26T12:15:00.000Z"
const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const TOKEN = "selection_token_abcdefghijklmnopqrstuvwxyz_0123456789"

const observed = {
  kind: "observed" as const,
  source: "adapter:codex",
  observedAt: NOW,
}
const unknown = { kind: "unknown" as const, source: "metadata:not-declared" }

const inventoryItem = {
  installationId: "installation_alpha",
  adapterId: "adapter_codex",
  rootId: "root_global",
  scope: { kind: "global" as const },
  key: "skill-forge",
  name: { state: "known" as const, value: "Skill Forge", evidence: observed },
  description: { state: "unknown" as const, evidence: unknown },
  declaredVersion: { state: "unknown" as const, evidence: unknown },
  status: {
    validity: "valid" as const,
    runtimeState: "unknown" as const,
    source: "local" as const,
    update: "unknown" as const,
    usage: "unavailable" as const,
  },
  observedAt: NOW,
}

function expectJsonRoundTrip<T>(schema: { parse(value: unknown): T }, value: unknown) {
  const parsed = schema.parse(value)
  const serialized = JSON.stringify(parsed)

  expect(serialized).toBeTypeOf("string")
  expect(schema.parse(JSON.parse(serialized))).toEqual(parsed)
}

describe("evidence contracts", () => {
  it("accepts serializable observed and inferred evidence", () => {
    expectJsonRoundTrip(EvidenceSchema, observed)
    expectJsonRoundTrip(EvidenceSchema, {
      kind: "inferred",
      source: "name heuristic",
      confidence: 0.72,
      observedAt: NOW,
    })
  })

  it("rejects invalid confidence and fabricated unknown values", () => {
    expect(
      EvidenceSchema.safeParse({ kind: "observed", confidence: 0.8 }).success,
    ).toBe(false)
    expect(
      EvidenceSchema.safeParse({ kind: "inferred", confidence: 2 }).success,
    ).toBe(false)

    const claimSchema = evidencedSchema(z.string())
    expect(
      claimSchema.safeParse({
        state: "known",
        value: "fabricated",
        evidence: { kind: "unknown" },
      }).success,
    ).toBe(false)
    expect(
      claimSchema.safeParse({
        state: "unknown",
        value: "fabricated",
        evidence: { kind: "unknown" },
      }).success,
    ).toBe(false)
  })
})

describe("root onboarding contracts", () => {
  const candidate = {
    candidateId: "candidate_user_codex",
    adapterId: "adapter_codex",
    displayName: "Codex user skills",
    displayPath: "/Users/example/.codex/skills",
    kind: "global" as const,
    access: "read-write" as const,
    writableWithoutElevation: true,
    discovery: observed,
  }

  it("round-trips root candidates and approves by candidate IDs only", () => {
    expectJsonRoundTrip(RootCandidateDtoSchema, candidate)
    expect(
      ApproveRootsInputSchema.parse({
        candidateIds: ["candidate_user_codex"],
      }),
    ).toEqual({ candidateIds: ["candidate_user_codex"] })
  })

  it("rejects duplicate IDs, arbitrary paths, and false access claims", () => {
    expect(
      ApproveRootsInputSchema.safeParse({
        candidateIds: ["candidate_a", "candidate_a"],
      }).success,
    ).toBe(false)
    expect(
      ApproveRootsInputSchema.safeParse({
        candidateIds: ["/tmp/skills"],
      }).success,
    ).toBe(false)
    expect(
      RootCandidateDtoSchema.safeParse({
        ...candidate,
        access: "read-only",
      }).success,
    ).toBe(false)
  })

  it("ties completion to persisted approvals and selections to proposed IDs", () => {
    expectJsonRoundTrip(OnboardingStateDtoSchema, {
      status: "required",
      proposedRoots: [candidate],
      selectedCandidateIds: [candidate.candidateId],
      approvedRoots: [],
    })
    expect(OnboardingStateDtoSchema.safeParse({
      status: "complete",
      proposedRoots: [candidate],
      selectedCandidateIds: [],
      approvedRoots: [],
    }).success).toBe(false)
  })
})

describe("inventory contracts", () => {
  it("applies bounded query defaults and rejects path-shaped scope IDs", () => {
    expect(
      InventoryQuerySchema.parse({ scope: { kind: "all" } }),
    ).toMatchObject({ pageSize: 50, sort: { by: "name", direction: "asc" } })

    expect(
      InventoryQuerySchema.safeParse({
        scope: { kind: "root", rootId: "../../private" },
      }).success,
    ).toBe(false)
    expect(
      InventoryQuerySchema.safeParse({
        scope: { kind: "all" },
        pageSize: 10_000,
      }).success,
    ).toBe(false)
  })

  it("round-trips inventory pages and installation details", () => {
    expectJsonRoundTrip(InventoryPageDtoSchema, {
      items: [inventoryItem],
      nextCursor: null,
      total: 1,
      observedAt: NOW,
    })

    expectJsonRoundTrip(InstallationDetailDtoSchema, {
      installation: inventoryItem,
      snapshotId: "snapshot_alpha",
      locationLabel: "Codex user skills / skill-forge",
      entryFile: "SKILL.md",
      rawEntryContent: "---\nname: skill-forge\n---\n",
      contentHash: HASH_A,
      files: [
        {
          relativePath: "SKILL.md",
          byteLength: 33,
          sha256: HASH_A,
          kind: "entry",
        },
      ],
      findings: [],
      requirements: [],
      provenance: {
        id: "provenance_alpha",
        kind: "local",
        sourceLabel: {
          state: "known",
          value: "Local directory",
          evidence: observed,
        },
        release: { state: "unknown", evidence: unknown },
        commit: { state: "unknown", evidence: unknown },
        license: { state: "unknown", evidence: unknown },
        managedBy: "forge",
      },
      capabilities: {
        canInstallSibling: true,
        canUpdateFromSource: true,
        canEditEntry: true,
        unavailableReasons: [],
      },
    })
  })
})

describe("operation contracts", () => {
  const localSource = {
    kind: "zip" as const,
    selectionToken: TOKEN,
    archiveSha256: HASH_A,
    treeHash: HASH_B,
  }

  it("accepts tokenized installs and reconstructs update sources from installation IDs", () => {
    expectJsonRoundTrip(OperationRequestDtoSchema, {
      kind: "install-local",
      source: { ...localSource, suggestedName: "skill" },
      targetRootId: "root_global",
    })
    expectJsonRoundTrip(OperationRequestDtoSchema, {
      kind: "update-from-local",
      installationId: "installation_alpha",
      expectedSnapshotId: "snapshot_alpha",
    })
    expectJsonRoundTrip(OperationRequestDtoSchema, {
      kind: "update-entry-content",
      installationId: "installation_alpha",
      expectedSnapshotId: "snapshot_alpha",
      content: "new content",
    })

    expect(
      OperationRequestDtoSchema.safeParse({
        kind: "install-local",
        source: { ...localSource, suggestedName: "skill", path: "/tmp/skill.zip" },
        targetRootId: "root_global",
      }).success,
    ).toBe(false)
    expect(
      OperationRequestDtoSchema.safeParse({
        kind: "install-local",
        source: { ...localSource, suggestedName: "skill", selectionToken: "/tmp/skill.zip" },
        targetRootId: "root_global",
      }).success,
    ).toBe(false)
  })

  it("round-trips source selections, plans, and operation results", () => {
    expectJsonRoundTrip(LocalSourceSelectionDtoSchema, {
      ...localSource,
      displayName: "skill.zip",
      expiresAt: LATER,
    })

    expectJsonRoundTrip(OperationPlanDtoSchema, {
      planId: "plan_alpha",
      kind: "install-local",
      status: "planned",
      createdAt: NOW,
      expiresAt: LATER,
      adapterId: "adapter_codex",
      installationIds: [],
      targetRootId: "root_global",
      affectedScopes: [{ kind: "global" }],
      affectedEntries: [
        {
          action: "create",
          rootId: "root_global",
          relativePath: "skill-forge/SKILL.md",
        },
        {
          action: "delete",
          rootId: "root_global",
          relativePath: "skill-forge/obsolete.md",
          beforeByteLength: 12,
          beforeSha256: "d".repeat(64),
        },
      ],
      preconditions: [],
      conflicts: [],
      warnings: [],
      undo: "persistent",
      summary: "Install Skill Forge",
    })

    expectJsonRoundTrip(OperationResultDtoSchema, {
      operationId: "operation_alpha",
      planId: "plan_alpha",
      journalId: "journal_alpha",
      status: "committed",
      finishedAt: NOW,
      installationIds: ["installation_alpha"],
      message: "Installed",
      issues: [],
      undoAvailable: true,
    })
  })

  it("rejects invalid plan/result invariants and path-shaped authority", () => {
    expect(
      OperationPlanDtoSchema.safeParse({
        planId: "plan_alpha",
        kind: "install-local",
        status: "blocked",
        createdAt: NOW,
        expiresAt: LATER,
        adapterId: "adapter_codex",
        installationIds: [],
        targetRootId: "root_global",
        affectedScopes: [],
        affectedEntries: [],
        preconditions: [],
        conflicts: [],
        warnings: [],
        undo: "persistent",
        summary: "Blocked",
      }).success,
    ).toBe(false)

    expect(
      OperationResultDtoSchema.safeParse({
        operationId: "operation_alpha",
        journalId: "journal_alpha",
        status: "failed",
        finishedAt: NOW,
        installationIds: [],
        message: "Failed",
        issues: [],
        undoAvailable: true,
      }).success,
    ).toBe(false)

    expect(
      ConfirmOperationInputSchema.safeParse({ planId: "/tmp/plan" }).success,
    ).toBe(false)
    expect(
      UndoOperationInputSchema.safeParse({ journalId: "../../journal" }).success,
    ).toBe(false)
  })
})

describe("closed channel and event allowlists", () => {
  it("contains exactly the declared invoke contracts", () => {
    expect(Object.keys(IPC_INVOKE_CONTRACTS).sort()).toEqual(
      [...IPC_INVOKE_CHANNEL_ALLOWLIST].sort(),
    )
    expect(IpcInvokeChannelSchema.safeParse("forge:filesystem:read").success).toBe(
      false,
    )
    expect(
      IpcInvokeChannelSchema.parse(IPC_INVOKE_CHANNELS.operationsPlan),
    ).toBe("forge:operations:plan")
  })

  it("contains exactly the declared event contracts", () => {
    expect(Object.keys(IPC_EVENT_CONTRACTS).sort()).toEqual(
      [...IPC_EVENT_CHANNEL_ALLOWLIST].sort(),
    )
    expect(IpcEventChannelSchema.safeParse("forge:event:any").success).toBe(false)
    expect(IpcEventChannelSchema.parse(IPC_EVENT_CHANNELS.inventoryChanged)).toBe(
      "forge:event:inventory-changed",
    )
  })

  it("round-trips allowlisted event payloads and rejects unbounded payloads", () => {
    expectJsonRoundTrip(RootsChangedEventSchema, {
      rootIds: ["root_global"],
      observedAt: NOW,
    })
    expectJsonRoundTrip(InventoryChangedEventSchema, {
      installationIds: ["installation_alpha"],
      reason: "operation",
      observedAt: NOW,
      findings: [{
        code: "ROOT_SCAN_FAILED",
        severity: "error",
        message: "The approved root could not be scanned",
        rootId: "root_global",
        adapterId: "folder",
        path: "/skills",
      }],
    })
    expectJsonRoundTrip(OperationProgressEventSchema, {
      operationId: "operation_alpha",
      planId: "plan_alpha",
      journalId: "journal_alpha",
      stage: "verifying",
      message: "Verifying installed tree",
    })

    expect(
      InventoryChangedEventSchema.safeParse({
        installationIds: ["/tmp/arbitrary"],
        reason: "watcher",
        observedAt: NOW,
      }).success,
    ).toBe(false)
  })
})
