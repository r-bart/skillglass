import path from "node:path"

import {
  parseSkillFile,
  validateResourceReferences,
  type LocalSourceManifestV1,
} from "@forge/scanner"

import { LocalSourceError } from "./errors.js"

/** Validates inert skill metadata and references without importing bundled code. */
export async function validateAdmittedSkillTree(
  root: string,
  manifest: LocalSourceManifestV1,
): Promise<void> {
  if (!manifest.files.some((file) => file.path === "SKILL.md")) {
    throw new LocalSourceError("SKILL_ENTRY_MISSING", "Skill payload has no root SKILL.md")
  }
  const parsed = await parseSkillFile(path.join(root, "SKILL.md"))
  const parserErrors = parsed.findings.filter(({ severity }) => severity === "error")
  if (parserErrors.length > 0) {
    throw new LocalSourceError(
      "SOURCE_INVALID",
      parserErrors.map(({ message }) => message).join("; "),
      { path: "SKILL.md" },
    )
  }
  const references = validateResourceReferences(
    parsed.rawBody,
    new Set(manifest.files.map(({ path: relativePath }) => relativePath)),
  )
  const referenceErrors = references.findings.filter(({ severity }) => severity === "error")
  if (referenceErrors.length > 0) {
    throw new LocalSourceError(
      "SOURCE_INVALID",
      referenceErrors.map(({ message }) => message).join("; "),
      { path: "SKILL.md" },
    )
  }
}
