import { describe, expect, it } from "vitest"

import type {
  Provenance,
  ScopeBinding,
  ValidationFinding,
} from "./entities.js"
import { observed } from "./evidence.js"
import {
  composeRuntimeState,
  composeSkillStatus,
  composeSourceStatus,
  composeValidity,
} from "./status.js"

function finding(severity: ValidationFinding["severity"]): ValidationFinding {
  return {
    code: `test.${severity}`,
    severity,
    message: severity,
    source: "core",
  }
}

function binding(
  relationship: ScopeBinding["relationship"],
  runtimeState: ScopeBinding["runtimeState"],
): ScopeBinding {
  return {
    installationId: "installation",
    targetScope: "global",
    relationship,
    runtimeState,
    evidence: observed({ source: "harness" }),
  }
}

function provenance(
  kind: Provenance["kind"],
  managedBy: Provenance["managedBy"],
): Provenance {
  return { kind, managedBy }
}

describe("status composition", () => {
  it("keeps validity unknown when validation did not run", () => {
    expect(composeValidity()).toBe("unknown")
  })

  it("composes validity by highest finding severity", () => {
    expect(composeValidity([])).toBe("valid")
    expect(composeValidity([finding("info")])).toBe("valid")
    expect(composeValidity([finding("warning"), finding("info")])).toBe(
      "warning",
    )
    expect(
      composeValidity([
        finding("warning"),
        finding("error"),
        finding("info"),
      ]),
    ).toBe("invalid")
  })

  it("composes runtime state without treating absent observations as enabled", () => {
    expect(composeRuntimeState()).toBe("unknown")
    expect(composeRuntimeState(binding("owned", "unknown"))).toBe("unknown")
    expect(composeRuntimeState(binding("owned", "enabled"))).toBe("enabled")
    expect(composeRuntimeState(binding("owned", "disabled"))).toBe("disabled")
    expect(composeRuntimeState(binding("owned", "unsupported"))).toBe(
      "unsupported",
    )
    expect(composeRuntimeState(binding("inherited", "inherit"))).toBe(
      "inherited",
    )
    expect(composeRuntimeState(binding("inherited", "unknown"))).toBe(
      "inherited",
    )
    expect(composeRuntimeState(binding("shadowed", "enabled"))).toBe(
      "shadowed",
    )
    expect(composeRuntimeState(binding("excluded", "unknown"))).toBe("unknown")
  })

  it("uses safety-relevant source status precedence", () => {
    expect(composeSourceStatus({})).toBe("unknown")
    expect(
      composeSourceStatus({ provenance: provenance("local", "user") }),
    ).toBe("local")
    expect(
      composeSourceStatus({ provenance: provenance("forge-import", "forge") }),
    ).toBe("managed")
    expect(
      composeSourceStatus({ provenance: provenance("plugin", "external") }),
    ).toBe("managed")
    expect(
      composeSourceStatus({
        access: "read-only",
        provenance: provenance("local", "user"),
      }),
    ).toBe("read-only")
    expect(
      composeSourceStatus({
        access: "read-only",
        provenance: provenance("local", "user"),
        locallyModified: true,
      }),
    ).toBe("modified")
  })

  it("preserves all independent dimensions", () => {
    expect(
      composeSkillStatus({
        findings: [finding("warning")],
        binding: binding("shadowed", "enabled"),
        access: "read-write",
        provenance: provenance("local", "user"),
        update: "diverged",
        usage: "observed",
      }),
    ).toEqual({
      validity: "warning",
      runtimeState: "shadowed",
      source: "local",
      update: "diverged",
      usage: "observed",
    })
  })

  it("uses honest defaults rather than positive fabricated states", () => {
    expect(composeSkillStatus()).toEqual({
      validity: "unknown",
      runtimeState: "unknown",
      source: "unknown",
      update: "unknown",
      usage: "unavailable",
    })
  })
})
