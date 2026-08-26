import type { SkillInstallation } from "./entities.js"

declare const installationIdentityBrand: unique symbol

export type InstallationIdentity = string & {
  readonly [installationIdentityBrand]: "InstallationIdentity"
}

export interface CanonicalIdentityInput {
  readonly adapterId: string
  readonly canonicalPath: string
}

function assertIdentityPart(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} cannot be empty`)
  }
}

/**
 * Canonical installation identity is adapter + canonical path. JSON tuple
 * encoding is deliberately unambiguous even when either component contains a
 * delimiter used by a filesystem or adapter.
 */
export function canonicalInstallationIdentity(
  input: CanonicalIdentityInput,
): InstallationIdentity {
  assertIdentityPart(input.adapterId, "Adapter ID")
  assertIdentityPart(input.canonicalPath, "Canonical path")
  return JSON.stringify([
    input.adapterId,
    input.canonicalPath,
  ]) as InstallationIdentity
}

export interface IdentityCollision {
  readonly identity: InstallationIdentity
  readonly installationIds: readonly string[]
}

export function findCanonicalIdentityCollisions(
  installations: readonly Pick<
    SkillInstallation,
    "id" | "adapterId" | "canonicalPath"
  >[],
): readonly IdentityCollision[] {
  const byIdentity = new Map<InstallationIdentity, string[]>()

  for (const installation of installations) {
    const identity = canonicalInstallationIdentity(installation)
    const existing = byIdentity.get(identity)
    if (existing === undefined) {
      byIdentity.set(identity, [installation.id])
    } else {
      existing.push(installation.id)
    }
  }

  return [...byIdentity.entries()]
    .filter(([, installationIds]) => installationIds.length > 1)
    .map(([identity, installationIds]) => ({
      identity,
      installationIds: [...installationIds].sort(),
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity))
}

export function assertUniqueCanonicalIdentities(
  installations: readonly Pick<
    SkillInstallation,
    "id" | "adapterId" | "canonicalPath"
  >[],
): void {
  const collisions = findCanonicalIdentityCollisions(installations)
  if (collisions.length > 0) {
    throw new Error(
      `Duplicate canonical installation identities: ${collisions
        .map(({ identity }) => identity)
        .join(", ")}`,
    )
  }
}
