import type { CanonicalPath } from "@forge/domain"

import { pathImplementation, nativePathFlavor } from "./canonicalize.js"
import {
  PathAuthorizationError,
  type PathSemantics,
} from "./types.js"

function normalizeForComparison(
  value: string,
  semantics: PathSemantics,
): string {
  const flavor = semantics.flavor ?? nativePathFlavor()
  const implementation = pathImplementation(flavor)
  const normalized = implementation.normalize(value)
  const caseSensitive = semantics.caseSensitive ?? flavor !== "win32"
  return caseSensitive ? normalized : normalized.toLocaleLowerCase("en-US")
}

/** Segment-aware containment: `/skills-a` is never inside `/skills`. */
export function isPathContained(
  root: string,
  candidate: string,
  semantics: PathSemantics = {},
): boolean {
  const flavor = semantics.flavor ?? nativePathFlavor()
  const implementation = pathImplementation(flavor)
  const comparableRoot = normalizeForComparison(root, semantics)
  const comparableCandidate = normalizeForComparison(candidate, semantics)
  const relative = implementation.relative(comparableRoot, comparableCandidate)

  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${implementation.sep}`) &&
      !implementation.isAbsolute(relative))
  )
}

export function assertPathContained(
  root: CanonicalPath,
  candidate: CanonicalPath,
  semantics: PathSemantics = {},
): void {
  if (!isPathContained(root, candidate, semantics)) {
    throw new PathAuthorizationError(
      "PATH_OUTSIDE_ROOT",
      "The path is outside the approved root",
    )
  }
}
