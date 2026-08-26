import { parseSkillFile } from "../parser/index.js"
import { enumerateSkillResources } from "./enumerate.js"
import { validateResourceReferences } from "./references.js"
import type { ScannerFinding, SkillDirectoryValidation } from "./types.js"

export async function validateSkillDirectory(root: string): Promise<SkillDirectoryValidation> {
  const enumeration = await enumerateSkillResources(root)
  const findings: ScannerFinding[] = [...enumeration.findings]
  const entries = enumeration.files.filter(({ kind }) => kind === "entry")
  if (entries.length === 0) {
    findings.push({ code: "SKILL_ENTRY_MISSING", severity: "error", message: "Selected folder has no root SKILL.md", path: root })
    return { ...enumeration, resources: enumeration.files.filter(({ kind }) => kind === "resource"), references: [], findings, valid: false }
  }
  const entry = entries[0]
  if (entry === undefined) throw new Error("unreachable")
  const parsed = await parseSkillFile(entry.absolutePath)
  findings.push(...parsed.findings.map((finding) => ({ code: finding.code, severity: finding.severity, message: finding.message, path: "SKILL.md" })))
  const referenceValidation = validateResourceReferences(parsed.rawBody, new Set(enumeration.files.map(({ path }) => path)))
  findings.push(...referenceValidation.findings)
  return {
    ...enumeration,
    parsed,
    resources: enumeration.files.filter(({ kind }) => kind === "resource"),
    references: referenceValidation.references,
    findings,
    valid: !findings.some(({ severity }) => severity === "error"),
  }
}
