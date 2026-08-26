export interface FrontmatterField {
  readonly key: string
  /** Exact source for this top-level field, including continuation lines. */
  readonly raw: string
  /** Exact text after the colon, excluding continuation lines. */
  readonly rawValue: string
  /** Decoded scalar when the value is a supported YAML string scalar. */
  readonly scalarValue?: string
}

export interface SkillParserFinding {
  readonly code: string
  readonly severity: "warning" | "error"
  readonly message: string
  readonly start?: number
  readonly end?: number
}

export interface ParsedSkillSource {
  /** The entry file exactly as decoded; line endings and formatting are retained. */
  readonly rawSource: string
  /** Text between the frontmatter delimiters, retained byte-for-byte as text. */
  readonly rawFrontmatter?: string
  /** Everything after the closing delimiter, retained exactly. */
  readonly rawBody: string
  readonly fields: readonly FrontmatterField[]
  readonly name?: string
  readonly description?: string
  readonly findings: readonly SkillParserFinding[]
}
