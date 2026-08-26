import { enumerateSkillResources } from "../validation/index.js"
import { hashFiles } from "./tree-hash.js"
import type { HashDirectoryResult } from "./types.js"

export async function hashDirectorySource(root: string): Promise<HashDirectoryResult> {
  const enumeration = await enumerateSkillResources(root)
  if (enumeration.findings.some(({ severity }) => severity === "error")) {
    return { ignoredEntries: enumeration.ignoredEntries, findings: enumeration.findings }
  }
  try {
    const manifest = await hashFiles(enumeration.files)
    return { manifest, ignoredEntries: enumeration.ignoredEntries, findings: enumeration.findings }
  } catch (error) {
    return {
      ignoredEntries: enumeration.ignoredEntries,
      findings: [
        ...enumeration.findings,
        {
          code: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "SOURCE_HASH_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : "Source hashing failed",
        },
      ],
    }
  }
}
