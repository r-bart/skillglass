import { readFile } from "node:fs/promises"

import { parseFrontmatterFields } from "./frontmatter.js"
import type { ParsedSkillSource, SkillParserFinding } from "./types.js"

interface FrontmatterBounds {
  readonly contentStart: number
  readonly contentEnd: number
  readonly bodyStart: number
}

function frontmatterBounds(source: string): FrontmatterBounds | undefined {
  const opening = /^(?:\uFEFF)?---(?:\r\n|\n|\r)/.exec(source)
  if (opening === null) return undefined
  const contentStart = opening[0].length
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/gm
  closing.lastIndex = contentStart
  const match = closing.exec(source)
  if (match === null) return undefined
  return {
    contentStart,
    contentEnd: match.index,
    bodyStart: match.index + match[0].length,
  }
}

function requiredField(
  key: "name" | "description",
  fields: ParsedSkillSource["fields"],
  findings: SkillParserFinding[],
): string | undefined {
  const matches = fields.filter((field) => field.key === key)
  if (matches.length === 0) {
    findings.push({
      code: `FRONTMATTER_${key.toUpperCase()}_REQUIRED`,
      severity: "error",
      message: `Frontmatter requires a non-empty ${key} string`,
    })
    return undefined
  }
  if (matches.length > 1) {
    findings.push({
      code: `FRONTMATTER_${key.toUpperCase()}_DUPLICATE`,
      severity: "error",
      message: `Frontmatter contains more than one ${key} field`,
    })
  }
  const value = matches[0]?.scalarValue
  if (value === undefined || value.trim().length === 0) {
    findings.push({
      code: `FRONTMATTER_${key.toUpperCase()}_INVALID`,
      severity: "error",
      message: `Frontmatter ${key} must be a non-empty string`,
    })
    return undefined
  }
  return value
}

export function parseSkillSource(rawSource: string): ParsedSkillSource {
  const findings: SkillParserFinding[] = []
  const bounds = frontmatterBounds(rawSource)
  if (bounds === undefined) {
    findings.push({
      code: "FRONTMATTER_REQUIRED",
      severity: "error",
      message: "SKILL.md requires a closed YAML frontmatter block",
    })
    return { rawSource, rawBody: rawSource, fields: [], findings }
  }

  const rawFrontmatter = rawSource.slice(bounds.contentStart, bounds.contentEnd)
  const parsed = parseFrontmatterFields(rawFrontmatter, bounds.contentStart)
  findings.push(...parsed.findings)
  const name = requiredField("name", parsed.fields, findings)
  const description = requiredField("description", parsed.fields, findings)

  return {
    rawSource,
    rawFrontmatter,
    rawBody: rawSource.slice(bounds.bodyStart),
    fields: parsed.fields,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    findings,
  }
}

export async function parseSkillFile(filePath: string): Promise<ParsedSkillSource> {
  const bytes = await readFile(filePath)
  try {
    return parseSkillSource(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    const rawSource = bytes.toString("utf8")
    const parsed = parseSkillSource(rawSource)
    return {
      ...parsed,
      findings: [
        {
          code: "SKILL_SOURCE_INVALID_UTF8",
          severity: "error",
          message: "SKILL.md must be valid UTF-8",
        },
        ...parsed.findings,
      ],
    }
  }
}
