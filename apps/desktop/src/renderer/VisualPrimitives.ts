import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react"
import { createElement } from "./i18n.js"

export type ActionTone = "metal" | "dark" | "quiet" | "danger"
export type StatusTone = "ok" | "attention" | "danger" | "idle" | "neutral"
export type SkillTileVariant = "blue" | "green" | "amber" | "plum" | "steel"
export type SkillGlyphVariant = "ring" | "block" | "bar" | "dot" | "dash"

type ButtonActionProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  readonly as?: "button"
  readonly className?: string
  readonly tone?: ActionTone
}

type LinkActionProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href"> & {
  readonly as: "a"
  readonly className?: string
  readonly disabled?: boolean
  readonly href: string
  readonly tone?: ActionTone
}

export type VisualActionProps = ButtonActionProps | LinkActionProps

function classes(...values: readonly (string | false | undefined)[]): string {
  return values.filter(Boolean).join(" ")
}

/**
 * A native button or link with one of Forge's named material treatments.
 * Disabled links deliberately lose their destination and tab stop while retaining
 * an explicit accessible disabled state.
 */
export function VisualAction(props: VisualActionProps): ReactNode {
  if (props.as === "a") {
    const {
      as: _as,
      children,
      className,
      disabled = false,
      href,
      onClick,
      tabIndex,
      tone = "quiet",
      ...anchorProps
    } = props
    void _as

    const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
      if (disabled) {
        event.preventDefault()
        return
      }
      onClick?.(event)
    }

    return createElement(
      "a",
      {
        ...anchorProps,
        ...(disabled ? {} : { href }),
        "aria-disabled": disabled || undefined,
        className: classes("visual-action", `visual-action--${tone}`, className),
        onClick: handleClick,
        tabIndex: disabled ? -1 : tabIndex,
      },
      children,
    )
  }

  const {
    as: _as,
    children,
    className,
    tone = "quiet",
    type = "button",
    ...buttonProps
  } = props
  void _as

  return createElement(
    "button",
    {
      ...buttonProps,
      className: classes("visual-action", `visual-action--${tone}`, className),
      type,
    },
    children,
  )
}

type WithoutTone<T> = T extends unknown ? Omit<T, "tone"> : never
type ToneActionProps = WithoutTone<VisualActionProps>

export function MetalAction(props: ToneActionProps): ReactNode {
  return VisualAction({ ...props, tone: "metal" } as VisualActionProps)
}

export function DarkAction(props: ToneActionProps): ReactNode {
  return VisualAction({ ...props, tone: "dark" } as VisualActionProps)
}

export function QuietAction(props: ToneActionProps): ReactNode {
  return VisualAction({ ...props, tone: "quiet" } as VisualActionProps)
}

export function DangerAction(props: ToneActionProps): ReactNode {
  return VisualAction({ ...props, tone: "danger" } as VisualActionProps)
}

export interface StatusPillProps {
  readonly ariaLabel?: string
  readonly children?: ReactNode
  readonly className?: string
  readonly disabled?: boolean
  readonly onClick?: MouseEventHandler<HTMLButtonElement>
  readonly pressed?: boolean
  readonly tone?: StatusTone
}

export function StatusPill({
  ariaLabel,
  children,
  className,
  disabled = false,
  onClick,
  pressed,
  tone = "neutral",
}: StatusPillProps): ReactNode {
  const content = [
    createElement("span", { "aria-hidden": "true", className: "status-pill__dot", key: "dot" }),
    createElement("span", { className: "status-pill__label", key: "label" }, children),
  ]

  if (onClick !== undefined) {
    return createElement(
      "button",
      {
        "aria-label": ariaLabel,
        "aria-pressed": pressed,
        className: classes("status-pill", "status-pill--interactive", `status-pill--${tone}`, className),
        disabled,
        onClick,
        type: "button",
      },
      ...content,
    )
  }

  return createElement(
    "span",
    { "aria-label": ariaLabel, className: classes("status-pill", `status-pill--${tone}`, className) },
    ...content,
  )
}

export interface FilterChipProps {
  readonly className?: string
  readonly disabled?: boolean
  readonly label: ReactNode
  readonly onRemove: () => void
  /** Used to name the remove button when the visible label is not plain text. */
  readonly removeLabel?: string
}

export function FilterChip({
  className,
  disabled = false,
  label,
  onRemove,
  removeLabel,
}: FilterChipProps): ReactNode {
  const accessibleLabel = removeLabel ?? (typeof label === "string"
    ? `Quitar filtro ${label}`
    : "Quitar filtro")

  return createElement(
    "span",
    { className: classes("filter-chip", disabled && "filter-chip--disabled", className) },
    createElement("span", { className: "filter-chip__label" }, label),
    createElement(
      "button",
      {
        "aria-label": accessibleLabel,
        className: "filter-chip__remove",
        disabled,
        onClick: onRemove,
        type: "button",
      },
      createElement("span", { "aria-hidden": "true" }, "×"),
    ),
  )
}

type SectionLabelElement = "h2" | "h3" | "h4" | "p" | "div" | "span"

export interface SectionLabelProps {
  readonly as?: SectionLabelElement
  readonly children?: ReactNode
  readonly className?: string
  readonly id?: string
}

export function SectionLabel({
  as = "h2",
  children,
  className,
  id,
}: SectionLabelProps): ReactNode {
  return createElement(as, { className: classes("section-label", className), id }, children)
}

export interface SkillAppearanceIdentity {
  /** Runtime adapter is observed product data and prevents cross-runtime aliasing. */
  readonly adapterId: string
  /** Canonical inventory key; unlike list position, it remains stable across scans. */
  readonly key: string
}

export interface SkillAppearance {
  readonly glyph: SkillGlyphVariant
  readonly tile: SkillTileVariant
}

const TILE_VARIANTS: readonly SkillTileVariant[] = ["blue", "green", "amber", "plum", "steel"]
const GLYPH_VARIANTS: readonly SkillGlyphVariant[] = ["ring", "block", "bar", "dot", "dash"]

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Maps observed identity to one of the handoff's fixed tile/glyph recipes. */
export function skillAppearanceFor({ adapterId, key }: SkillAppearanceIdentity): SkillAppearance {
  const hash = stableHash(`${adapterId.trim().toLowerCase()}:${key.trim().toLowerCase()}`)
  return {
    glyph: GLYPH_VARIANTS[Math.floor(hash / TILE_VARIANTS.length) % GLYPH_VARIANTS.length] ?? "dot",
    tile: TILE_VARIANTS[hash % TILE_VARIANTS.length] ?? "steel",
  }
}

export interface SkillTileProps {
  readonly accessibleLabel?: string
  readonly adapterId: string
  readonly className?: string
  /** React reserves `key`, so the canonical inventory key uses this prop name. */
  readonly skillKey: string
}

export function SkillTile({
  accessibleLabel,
  adapterId,
  className,
  skillKey,
}: SkillTileProps): ReactNode {
  const appearance = skillAppearanceFor({ adapterId, key: skillKey })
  const accessibility = accessibleLabel === undefined
    ? { "aria-hidden": "true" as const }
    : { "aria-label": accessibleLabel, role: "img" }

  return createElement(
    "span",
    {
      ...accessibility,
      className: classes("skill-tile", `skill-tile--${appearance.tile}`, className),
      "data-glyph": appearance.glyph,
      "data-tile": appearance.tile,
    },
    createElement("span", {
      "aria-hidden": "true",
      className: classes("skill-glyph", `skill-glyph--${appearance.glyph}`),
    }),
  )
}

export function glassSelectedRowClassName(selected: boolean, className?: string): string {
  return classes("glass-selectable-row", selected && "is-glass-selected", className)
}

export function glassSelectedRowProps(
  selected: boolean,
  className?: string,
): Readonly<{ "aria-selected": boolean; className: string }> {
  return {
    "aria-selected": selected,
    className: glassSelectedRowClassName(selected, className),
  }
}

type SurfaceTitleElement = "h1" | "h2" | "h3"

export interface CompactSurfaceHeaderProps {
  readonly actions?: ReactNode
  readonly className?: string
  readonly description?: ReactNode
  readonly eyebrow?: ReactNode
  readonly title: ReactNode
  readonly titleAs?: SurfaceTitleElement
  readonly titleId?: string
}

export function CompactSurfaceHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
  titleAs = "h1",
  titleId,
}: CompactSurfaceHeaderProps): ReactNode {
  return createElement(
    "header",
    { className: classes("surface-header", className) },
    createElement(
      "div",
      { className: "surface-header__copy" },
      eyebrow === undefined
        ? null
        : createElement(SectionLabel, { as: "div" }, eyebrow),
      createElement(titleAs, { className: "surface-header__title", id: titleId }, title),
      description === undefined
        ? null
        : createElement("p", { className: "surface-header__description" }, description),
    ),
    actions === undefined
      ? null
      : createElement("div", { className: "surface-header__actions" }, actions),
  )
}
