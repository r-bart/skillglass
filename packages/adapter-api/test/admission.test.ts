import { canonicalPath } from "@forge/domain"
import { describe, expect, it } from "vitest"

import {
  AdapterAdmissionError,
  ADAPTER_CAPABILITY_NAMES,
  assertAdapterAdmission,
  defineAdapterCapabilities,
  inspectAdapterAdmission,
  type AdapterAdmissionFixture,
} from "../src/index.js"
import {
  FakeAdapter,
  HASH,
  capabilities,
  discoveryContext,
  operationRequest,
} from "./fakes.js"

function fixture(state: { readonly value: number } = { value: 0 }): AdapterAdmissionFixture {
  return {
    discoveryContext,
    operationProbes: [
      {
        capability: "installToUserRoot",
        request: operationRequest("install-local"),
        captureState: () => state,
      },
      {
        capability: "updateWritableInstallation",
        request: operationRequest("update-from-local"),
        captureState: () => state,
      },
      {
        capability: "editLocal",
        request: operationRequest("update-entry-content"),
        captureState: () => state,
      },
    ],
  }
}

describe("adapter capability contract", () => {
  it("defines every capability from ADAPTERS.md and freezes the declaration", () => {
    const declared = capabilities()
    expect(Object.keys(declared).sort()).toEqual([...ADAPTER_CAPABILITY_NAMES].sort())
    expect(Object.isFrozen(declared)).toBe(true)
  })

  it("rejects missing and extra capability declarations", () => {
    const declared = { ...capabilities() }
    delete (declared as Partial<typeof declared>).parseSkill
    expect(() => defineAdapterCapabilities(declared as ReturnType<typeof capabilities>)).toThrow("Missing adapter capability")

    expect(() =>
      defineAdapterCapabilities({ ...capabilities(), fabricated: "supported" } as ReturnType<typeof capabilities>),
    ).toThrow("Unknown adapter capability")
  })
})

describe("shared adapter admission kit", () => {
  it("admits a complete adapter and accepts explicit unsupported/unknown results", async () => {
    const report = await inspectAdapterAdmission(new FakeAdapter(), fixture())
    expect(report).toEqual({ adapterId: "fake", passed: true, issues: [] })
    await expect(assertAdapterAdmission(new FakeAdapter(), fixture())).resolves.toBeUndefined()
  })

  for (const state of [
    "read-only",
    "derived",
    "inferred",
    "unsupported",
    "unknown",
  ] as const) {
    it(`rejects decorative success for ${state} capabilities`, async () => {
      const capability = "editLocal" as const
      const kind = "update-entry-content" as const
      const adapter = new FakeAdapter({
        capabilities: capabilities({ editLocal: state }),
        planner: async (request) => {
          if (request.request.kind !== kind) return new FakeAdapter().planOperation(request)
          const valid = await new FakeAdapter({ capabilities: capabilities({ [capability]: "supported" }) }).planOperation(request)
          return valid
        },
      })
      expect(adapter.declared[capability]).toBe(state)
      const report = await inspectAdapterAdmission(adapter, fixture())
      expect(report.issues).toContainEqual(expect.objectContaining({ code: "DECORATIVE_OPERATION_SUCCESS" }))
    })
  }

  it("detects state mutation performed while merely planning", async () => {
    const state = { value: 0 }
    const adapter = new FakeAdapter({
      planner: (request) => {
        state.value += 1
        return new FakeAdapter().planOperation(request)
      },
    })
    const report = await inspectAdapterAdmission(adapter, fixture(state))
    expect(report.issues.filter((issue) => issue.code === "PLANNING_MUTATED_STATE")).toHaveLength(3)
  })

  it("requires supported mutations to have contained steps and hash postconditions", async () => {
    const adapter = new FakeAdapter({
      planner: async (request) => {
        const result = await new FakeAdapter().planOperation(request)
        if (result.status !== "planned" || request.request.kind !== "install-local") return result
        return {
          ...result,
          plan: {
            ...result.plan,
            steps: [{ kind: "create-installation", rootId: "wrong_root", relativePath: "../escape", sourceTreeHash: HASH }],
            postconditions: [{ kind: "tree-hash-equals", rootId: "wrong_root", relativePath: "../escape", expectedHash: "bad" }],
          },
        }
      },
    })
    const report = await inspectAdapterAdmission(adapter, fixture())
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "OPERATION_PLAN_INVALID" }),
      expect.objectContaining({ code: "OPERATION_POSTCONDITION_INVALID" }),
    ]))
  })

  it("rejects path-shaped or duplicate root identities and unproven evidence", async () => {
    const badRoot = {
      candidateId: "../root",
      adapterId: "other",
      canonicalPath: canonicalPath("relative/path"),
      kind: "global" as const,
      access: "read-only" as const,
      writableWithoutElevation: true,
      evidence: { kind: "inferred" as const, confidence: 2 },
      defaultIncluded: true,
    }
    const adapter = new FakeAdapter({
      roots: [badRoot, badRoot],
      evidence: [],
    })
    const report = await inspectAdapterAdmission(adapter, fixture())
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ROOT_CANDIDATE_INVALID" }),
      expect.objectContaining({ code: "ROOT_CANDIDATE_DUPLICATE" }),
      expect.objectContaining({ code: "CAPABILITY_EVIDENCE_INVALID" }),
    ]))
  })

  it("throws an actionable aggregate admission error", async () => {
    const adapter = new FakeAdapter({ roots: [] })
    Object.defineProperty(adapter, "displayName", { value: "" })
    await expect(assertAdapterAdmission(adapter, fixture())).rejects.toBeInstanceOf(AdapterAdmissionError)
  })
})
