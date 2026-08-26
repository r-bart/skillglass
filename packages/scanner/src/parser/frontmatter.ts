import type { FrontmatterField, SkillParserFinding } from "./types.js"

interface ParsedFrontmatter {
  readonly fields: readonly FrontmatterField[]
  readonly findings: readonly SkillParserFinding[]
}

interface SourceLine {
  readonly text: string
  readonly start: number
  readonly end: number
}

function linesOf(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = []
  const pattern = /.*(?:\r\n|\n|\r|$)/g
  for (const match of source.matchAll(pattern)) {
    if (match[0].length === 0) continue
    const start = match.index
    const end = start + match[0].length
    lines.push({ text: match[0].replace(/(?:\r\n|\n|\r)$/, ""), start, end })
  }
  return lines
}

function decodeQuotedScalar(value: string): string | undefined {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value)
      return typeof decoded === "string" ? decoded : undefined
    } catch {
      return undefined
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return undefined
}

function scalarValue(rawValue: string, rawField: string): string | undefined {
  const value = rawValue.trim()
  const quoted = decodeQuotedScalar(value)
  if (quoted !== undefined) return quoted

  if (value === "|" || value === ">" || /^[|>][+-]?[1-9]?$/.test(value)) {
    const continuation = linesOf(rawField).slice(1)
    if (continuation.length === 0) return ""
    const indents = continuation
      .filter(({ text }) => text.trim().length > 0)
      .map(({ text }) => text.match(/^\s*/)?.[0].length ?? 0)
    const indent = Math.min(...indents)
    const content = continuation.map(({ text }) => text.slice(indent))
    return value.startsWith(">") ? content.join(" ").trimEnd() : content.join("\n")
  }

  if (
    value.length === 0 ||
    value.startsWith("[") ||
    value.startsWith("{") ||
    value.startsWith("&") ||
    value.startsWith("*") ||
    /^(?:null|~|true|false)$/i.test(value)
  ) {
    return undefined
  }
  return value.replace(/\s+#.*$/, "").trimEnd()
}

export function parseFrontmatterFields(
  source: string,
  sourceOffset: number,
): ParsedFrontmatter {
  const lines = linesOf(source)
  const fields: FrontmatterField[] = []
  const findings: SkillParserFinding[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined) break
    if (line.text.trim().length === 0 || line.text.trimStart().startsWith("#")) {
      index += 1
      continue
    }

    const header = /^([A-Za-z0-9_.-]+):(?:[ \t]*(.*))?$/.exec(line.text)
    if (header === null) {
      findings.push({
        code: "FRONTMATTER_MALFORMED",
        severity: "error",
        message: "Frontmatter must contain top-level key/value fields",
        start: sourceOffset + line.start,
        end: sourceOffset + line.end,
      })
      index += 1
      continue
    }

    let nextIndex = index + 1
    while (nextIndex < lines.length) {
      const next = lines[nextIndex]
      if (next === undefined) break
      if (/^[A-Za-z0-9_.-]+:/.test(next.text)) break
      nextIndex += 1
    }
    const end = lines[nextIndex - 1]?.end ?? line.end
    const raw = source.slice(line.start, end)
    const rawValue = header[2] ?? ""
    const decoded = scalarValue(rawValue, raw)
    fields.push({
      key: header[1] ?? "",
      raw,
      rawValue,
      ...(decoded === undefined ? {} : { scalarValue: decoded }),
    })
    index = nextIndex
  }

  return { fields, findings }
}
