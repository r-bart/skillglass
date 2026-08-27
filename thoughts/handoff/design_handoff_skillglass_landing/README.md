# Handoff: Skillglass marketing landing page

## Overview

A single-page public landing for **Skillglass**, the desktop app for discovering, inspecting, installing and safely updating agent skills. The page has one job: get a developer to the GitHub Releases page, having understood that the app is local-first, read-only by default, and honest about what it does not do.

The page is bilingual (Spanish / English) with an in-page switch. Spanish is the default.

Live design file in this bundle: `Landing.dc.html` (open it directly in a browser; `support.js` and `assets/` must sit beside it).

## About the Design Files

The files in this bundle are **design references created in HTML** — a prototype showing the intended look, copy and behaviour. They are **not production code to copy directly.**

`Landing.dc.html` is authored in a proprietary streaming-component format: markup with `{{ }}` template holes plus a small logic class at the bottom of the file, driven by `support.js`. Do not try to ship or port that runtime.

The task is to **recreate this design in the target codebase's own environment** — Astro, Next.js, plain HTML+CSS, whatever the project already uses — following its established conventions. If no web environment exists yet (the repo is an Electron desktop app), a static site generator or a plain hand-written HTML/CSS page is the appropriate choice; this page has no server-side logic and only one piece of client-side state.

Read the design file for exact copy and exact style values. Everything is inline-styled, so every value you need is on the element itself.

## Fidelity

**High fidelity.** Final colours, typography, spacing, materials and copy. Recreate it pixel-accurately.

Two caveats:

1. **The style is not invented.** Every colour, hairline, radius, gradient and shadow is lifted from the real app's own token layer at `apps/desktop/src/renderer/styles/tokens.css`. When you implement the page, import or mirror that file rather than re-typing hex codes — the app and the landing must not drift. The Design Tokens section below lists the ones actually used.
2. **The product shot in the hero is a hand-built HTML recreation of the app UI**, not a screenshot. That was deliberate for the design phase (crisp at any scale, editable, no stale screenshots). For production, decide one of the two paths in *Product shot* below.

## Screens / Views

One page, ten blocks, in source order. Page background `#0b0b0d`, text `#f4f4f6`, font stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, system-ui, sans-serif`. Root wrapper carries `overflow-x: clip`.

Every content block is a `<section>` with `padding: clamp(72px, 9vw, 120px) clamp(20px, 4vw, 40px) 0` and an inner `max-width: 1200px; margin: 0 auto` container.

### 1. Sticky header

- `position: sticky; top: 0; z-index: 60`, height `60px`, padding `0 clamp(16px, 4vw, 40px)`, `gap: clamp(12px, 2vw, 24px)`.
- Background `rgba(11,11,13,0.82)` with `backdrop-filter: blur(20px) saturate(1.6)`; bottom border `0.5px solid rgba(255,255,255,0.07)`.
- Left: 26px app icon (`border-radius: 7px`) + wordmark "Skillglass" at 14.5px/600.
- Nav links at 13px/500, colour `rgba(244,244,246,0.52)`: *Cómo funciona · Capacidades · Seguridad · FAQ* (EN: *How it works · Capabilities · Safety · FAQ*). Anchors to `#how`, `#features`, `#safety`, `#faq`.
- Right, pushed with `margin-left: auto`: the ES/EN switch, then a small metal "Descargar" button (height 30px, `padding: 0 15px`, pill, metal recipe).
- ES/EN switch: 2px-padded pill container, `border: 0.5px solid rgba(255,255,255,0.09)`, `background: rgba(0,0,0,0.3)`, radius 999px. Each button 30px min-width × 22px, radius 5px, mono 650/10px, `letter-spacing: 0.04em`. Active: `background: rgba(255,255,255,0.12)`, colour `#f4f4f6`. Inactive: transparent, colour `rgba(244,244,246,0.34)`. Use `aria-pressed`.

### 2. Hero (`#top`) — centred

`padding: clamp(56px, 7vw, 96px) clamp(20px, 4vw, 40px) 0`, `position: relative; isolation: isolate; overflow: clip`, inner container `text-align: center`.

Two decorative radial blooms, both `position: absolute; z-index: -1`, `aria-hidden="true"`, `border-radius: 50%`:
- 1100×700, `top: -300px; left: 50%; margin-left: -550px` — violet, `radial-gradient(closest-side, rgba(111,66,255,0.20), transparent)`.
- 720×420, `top: -180px; left: 50%; margin-left: -140px` — orange, `radial-gradient(closest-side, rgba(255,129,46,0.13), transparent)`.

Stack, all centred:
1. **Kicker** — mono `600 11px/1.4`, `letter-spacing: 0.11em`, uppercase, `rgba(244,244,246,0.4)`. ES "Inventario local de agent skills · Open source" / EN "Local inventory for agent skills · Open source".
2. **Main statement (h1)** — `max-width: 1120px`, `margin: 24px auto 0`, `font-size: clamp(31px, 5.2vw, 58px)`, weight 600, `line-height: 1.1`, `letter-spacing: -0.032em`, `text-wrap: balance`. ES "La forma tranquila de ver, entender y ordenar todas las skills que tienes instaladas." / EN "The calm way to see, understand and tidy up every skill you have installed."
3. **Supporting paragraph** — `max-width: 780px`, `margin: 28px auto 0`, 18px/1.6, `rgba(244,244,246,0.6)`, `text-wrap: pretty`.
4. **CTA row** — flex, `justify-content: center`, `flex-wrap: wrap`, `gap: 12px`, `margin-top: 38px`. Primary (metal + signature glow, see below) → `/releases`. Secondary (quiet) → repo root. Both height 44px, `padding: 0 24px`, pill, 14.5px/600, `white-space: nowrap`.
5. **Privacy paragraph** — `max-width: 720px`, `margin: 24px auto 0`, 17px/1.6, `rgba(244,244,246,0.5)`. ES "Sin cloud, sin cuentas y sin telemetría. Tus archivos se quedan donde están. Y nada se escribe sin que tú lo veas primero."
6. **Platform line** — mono `400 11.5px/1.5`, `rgba(244,244,246,0.34)`, `margin-top: 18px`. ES "macOS · Windows · Linux — solo desde este repositorio".

### 3. Product shot

Directly under the hero, `margin-top: 72px`, `perspective: 2200px`.

A full recreation of the app's Inventory screen, authored at a **fixed 1280 × 606px** and uniformly scaled to fit its container. The window: `border-radius: 12px`, `overflow: hidden`, background `#0b0b0d`, shadow `0 0 0 1px rgba(0,0,0,0.6), 0 40px 90px rgba(0,0,0,0.7), 0 0 90px -20px rgba(111,66,255,0.18)` (the last stop is the signature glow, not app chrome).

Geometry, matching the app exactly:
- **Topbar** 46px, background `#101013`, bottom hairline `rgba(255,255,255,0.07)`, `padding: 0 14px`, `gap: 16px`, grid `minmax(10rem, 1fr) 376px minmax(20rem, 1fr)`. Left: 3 traffic lights (10px circles, `#3a3a42`) + icon + "Inventario". Centre: search field with `⌘F` hint. Right: ES/EN-style pills, "+ Crear skill" (metal), "Instalar ▾" (quiet), a 28px refresh button, "↶ Historial".
- **Body** 560px, grid `226px minmax(0, 1fr) 326px`.
- **Sidebar** 226px, background `#08080a`, right hairline `rgba(255,255,255,0.07)`. Section labels ("Biblioteca", "Ubicaciones", "Gestionar") at 10.5px/600, `rgba(244,244,246,0.38)`. Rows 28px, radius 6px, 12.5px/500; the active row uses `background: rgba(244,244,246,0.06)` and colour `#f4f4f6`. Nav SVGs are copied verbatim from `apps/desktop/src/renderer/AppChrome.ts`.
- **Inventory column** background `#0b0b0d`, `padding: 20px 24px`. Header: mono kicker "SKILLS OBSERVADAS", h1 22px/600 `letter-spacing: -0.018em` "Inventario", helper 11.5px. Then a toolbar of quiet pills, then 6 rows.
- **Row** — 52px outer, inner grid `6px 30px minmax(9rem, 1fr) auto auto`, `gap: 13px`, `padding: 0 24px`, radius 11px. Columns: 6px status dot, 30px skill tile (radius 9px, one of the `--tile-*` gradients, `--tile-shadow`), name + description, evidence pills, version. The selected row uses the **glass selection** recipe: `border: 0.5px solid rgba(255,255,255,0.17)`, `background: linear-gradient(180deg, rgba(255,255,255,0.115) 0%, rgba(255,255,255,0.05) 100%)`.
- **Inspector** 326px, background `#0e0e11`, left hairline. Header with 34px tile + title/subtitle; then `<dl>` sections with `grid-template-columns: 82px minmax(0, 1fr)`, `gap: 10px`, `padding: 9px 18px`, top hairline `rgba(255,255,255,0.045)`; `dt` mono `600 9.5px`, uppercase, `rgba(244,244,246,0.34)`; `dd` 11.5px `rgba(244,244,246,0.76)`. Footer 59px, `background: rgba(0,0,0,0.28)`: quiet "Abrir archivo" left, metal "Editar" right.

**Scaling behaviour.** A wrapper is measured with a `ResizeObserver`; `scale = min(1, wrapperWidth / 1280)`. The inner element gets `transform: scale(s) rotateX(3.2deg)` with `transform-origin: 0 0`, and the wrapper's height is set to `round(606 * s)px` so the page reflows correctly. Do not swap this for a fluid layout — the app chrome is authored at real pixel sizes and reflowing it destroys the hairline geometry.

**Production decision.** Either (a) keep the HTML recreation and port it as a component, so it scales crisply and stays editable, or (b) replace it with a real 2560px-wide screenshot of the app at the Inventory screen and drop the whole subtree. (a) is more work but does not go stale; (b) is honest marketing. Recommend (b) for launch, with the HTML version kept as the fallback if a clean capture isn't available.

### 4. How it works (`#how`)

Kicker "Cómo funciona". h2 `max-width: 700px`, `margin-top: 18px`, `clamp(26px, 3.7vw, 40px)`, 600, `line-height: 1.1`, `letter-spacing: -0.03em`, `text-wrap: balance`: ES "Se pone en marcha en tres pasos. Ninguno escribe nada." / EN "It gets going in three steps. None of them write anything."

Three cards in a hairline-divided block: `margin-top: 56px`, `display: grid`, `grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr))`, `gap: 1px`, `border: 0.5px solid rgba(255,255,255,0.09)`, `border-radius: 12px`, `overflow: hidden`, container background `rgba(255,255,255,0.09)` (the gap shows through as the divider), each card `padding: 32px; background: #131317`.

Each card: a 28px numbered circle (`border: 0.5px solid rgba(255,255,255,0.13)`, `background: rgba(244,244,246,0.05)`), an h3, a body paragraph. Steps: *Elige las raíces* → *Escanea sin escribir* → *Mira, aprende, edita*.

### 5. Capabilities (`#features`)

Kicker "Capacidades". h2 "Sí, puede hacer todo esto." / "Yes, it can do all of this."

Six cards, `margin-top: 56px`, `grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr))`, `gap: 18px`. Each: `padding: 26px`, `border: 0.5px solid rgba(255,255,255,0.09)`, `border-radius: 12px`, `background: #131317`. h3 17px/600 `letter-spacing: -0.012em`; body `margin-top: 10px`, 14.5px/1.6, `rgba(244,244,246,0.55)`.

Titles: Buscar y filtrar · Saber cuál gana · Validar la estructura · Instalar y actualizar · Editar y crear · Deshacer de verdad.

Inline `<code>` in the bodies: `rgba(244,244,246,0.72)`, mono `400 13px/1`.

### 6. The interface (`#shots`)

Kicker "La interfaz", h2 "Cada fila lleva su evidencia encima." Annotated anatomy of a row and a standalone inspector card (same materials as the product shot, rebuilt at natural width).

### 7. Safety (`#safety`)

Kicker, h2 "¿Te preocupa que toque tus archivos? A nosotros también." / "Worried it will touch your files? So were we." Lead paragraph `max-width: 640px`, 16px/1.6, `rgba(244,244,246,0.55)`.

A `<ul>` of boundaries: `margin-top: 44px`, `grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr))`, `gap: 1px`, hairline border, radius 12px, `overflow: hidden`; each `<li>` `padding: 22px 24px; background: #0f0f12`, flex with a 6px status dot (`margin-top: 8px`) and text.

### 8. Download (`#download`)

Two columns: `grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr))`, `gap: 20px`, `align-items: stretch`.

- Left: h2 `clamp(23px, 2.8vw, 30px)` "Solo desde la página de Releases. En serio, solo desde ahí." Two 15px paragraphs, then an **amber notice** — the unsigned-builds warning. Border and text use the `--status-stale` hue (`oklch(0.78 0.15 82)` / body `oklch(0.88 0.12 82)`). Then a metal CTA, `margin-top: 28px`, height 42px.
- Right: h2 "Las tres, desde el primer commit." and a `<dl>` of platform requirements, rows `grid-template-columns: minmax(96px, 132px) minmax(0, 1fr)`, `gap: 14px`, `padding: 16px 0`, top hairline `rgba(255,255,255,0.07)`.

### 9. FAQ (`#faq`)

Kicker "Preguntas", h2 "Y sí, ya sabemos lo que vas a preguntar." / "And yes, we know what you're going to ask." Q&A pairs in `grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr))`, `gap: 40px 56px`, `margin-top: 48px`. h3 17px/600; answers 14.5px/1.6 `rgba(244,244,246,0.55)`. Plain text, no accordion.

### 10. Closing CTA + footer

Closing card: `max-width: 1200px`, `padding: clamp(44px, 6vw, 72px) clamp(20px, 4vw, 40px)`, `border: 0.5px solid rgba(255,255,255,0.09)`, `border-radius: 14px`, background `#0e0e11`, `overflow: hidden`, with one absolutely-positioned violet bloom (620×360, `top: -160px`, centred). 72px app icon (radius 18px), h2 `clamp(24px, 3.2vw, 34px)` "Open source, Apache 2.0, y las issues abiertas.", a 16px paragraph, then three centred buttons (GitHub / CONTRIBUTING.md / SECURITY.md).

Footer: `margin-top: 96px`, `padding: 32px 40px 48px`, top hairline `rgba(255,255,255,0.06)`. 20px icon + "Skillglass v0.0.0", a mono line "Apache License 2.0 · Local-first · Sin telemetría", and GitHub / Releases links pushed right.

## Interactions & Behavior

**Language switch** — the only interactive state on the page. Both language variants are present in the DOM and toggled with `display`. In production prefer real localisation (two routes, or the framework's i18n) over shipping both copies; if you keep the toggle, persist the choice and respect `navigator.language` on first visit.

**Links** — all CTAs are external `<a>` to `github.com/r-bart/skillglass` and `/releases`. Nav items are same-page anchors. Give the anchor targets `scroll-margin-top: 76px` so the sticky header does not cover them, and set `scroll-behavior: smooth`.

**Hover states** (transition `140ms cubic-bezier(0.32, 0.72, 0, 1)`):
- Metal buttons: `filter: brightness(1.06)`.
- Quiet buttons: `background: rgba(244,244,246,0.05)` → `rgba(244,244,246,0.11)`, colour → `#f4f4f6`.
- Nav links and footer links: colour → `#f4f4f6`.
- Cards do not react to hover. Nothing on this page moves on scroll.

**Focus** — not styled in the prototype. **This must be fixed in production:** every link and button needs a visible ring. Use the app's own focus token: `outline: 2px solid oklch(0.62 0.17 250); outline-offset: 2px`, or the `--edit-focus-ring` shadow.

**Reduced motion** — the only transform is the hero shot's static `rotateX(3.2deg)`. Nothing animates, so `prefers-reduced-motion` needs no special handling; keep it that way.

**Responsive** — the prototype degrades fluidly with `clamp()` and `repeat(auto-fit, minmax(min(100%, Npx), 1fr))`, with no media queries (the design format only allows inline styles). It holds down to roughly 380px, but **it has not been tested on a real narrow viewport.** In production, use real breakpoints and check at least these:
- The 6 capability cards should be 3 / 2 / 1 columns.
- The header nav needs a decision under ~700px — either drop the nav links and keep logo + switch + CTA, or a menu. The prototype's `overflow-x: auto` is a stopgap, not a design.
- The product shot goes very small on a phone. Consider cropping to the inventory column only, or swapping to a portrait-friendly detail crop, rather than shrinking the whole window.
- Section padding should bottom out around 20px, headline around 31px.

**Accessibility to fix in production** — visible focus rings (above); the product shot needs `role="img"` with a descriptive `aria-label` (or `alt` on the screenshot) since it is decorative markup conveying real information; the decorative blooms already carry `aria-hidden="true"`; check the amber notice text against `#111115` (it passes, but re-verify after any colour change); the `rgba(244,244,246,0.34)` mono lines are below AA on body text and should only be used at the small metadata sizes shown.

## State Management

One variable.

```
lang: "es" | "en"   // default "es"
```

Plus one derived, non-user value: the product shot's scale factor, computed from container width by a `ResizeObserver`.

No data fetching, no forms, no auth, no analytics. If analytics are added later, note that the page copy promises no telemetry in the app — keep the site's own tracking minimal and say so.

## Design Tokens

All values come from `apps/desktop/src/renderer/styles/tokens.css`. Import that file rather than re-declaring these.

**Surfaces** — app `#0b0b0d` · topbar `#101013` · sidebar `#08080a` · inspector `#0e0e11` · raised `#131317` · sheet `#111115` · field `#0d0d10` · safety-list card `#0f0f12`

**Text** — primary `#f4f4f6` · secondary `rgba(244,244,246,0.5)` · tertiary `rgba(244,244,246,0.34)` · on-metal `#141417`. The landing also uses `0.6`, `0.55` and `0.4` alphas for marketing body copy.

**Hairlines** — width `0.5px`. subtle `rgba(255,255,255,0.06)` · chrome `0.07` · default `0.09` · control `0.13` · elevated `0.14` · strongest `0.16`. Inspector `<dl>` dividers use `0.045`.

**Radii** — 6 compact · 8 control · 9 tile · 11 row · 12 card · 14 sheet · 999 pill. Landing-only: 7px (26px icon), 18px (72px icon).

**Typography** — UI stack as above; mono `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

| Role | Size | Weight | Line height | Tracking |
|---|---|---|---|---|
| h1 hero | `clamp(31px, 5.2vw, 58px)` | 600 | 1.1 | -0.032em |
| h2 section | `clamp(26px, 3.7vw, 40px)` | 600 | 1.1 | -0.03em |
| h2 column | `clamp(23px, 2.8vw, 30px)` | 600 | 1.15 | -0.025em |
| h2 closing | `clamp(24px, 3.2vw, 34px)` | 600 | 1.15 | -0.028em |
| h3 card | 17px | 600 | — | -0.012em |
| Hero body | 18px | 400 | 1.6 | — |
| Card body | 14.5px | 400 | 1.6 | — |
| Section lead | 16px | 400 | 1.6 | — |
| Kicker (mono) | 11px | 600 | 1.4 | 0.11em, uppercase |
| Meta (mono) | 11.5px | 400 | 1.5 | — |
| App-chrome text | 9.5 / 11.5 / 12.5 / 13 / 13.5 / 15 / 22px | — | — | — |

Headlines use `text-wrap: balance`; body copy uses `text-wrap: pretty`.

**Spacing** — section padding `clamp(72px, 9vw, 120px)` top / `clamp(20px, 4vw, 40px)` sides. Card grid gaps 18px (cards) and 1px (hairline-divided blocks). Kicker → h2 18px. h2 → grid 56px. Content max-width 1200px.

**Status colours (evidence only, never selection)** — ok `oklch(0.72 0.15 152)` · stale `oklch(0.78 0.15 82)` · broken `oklch(0.62 0.19 26)` · idle `#3a3a42`. Each dot adds `box-shadow: 0 0 8px <colour> / 0.5`.

**Blue is reserved** for editing focus and links: focus `oklch(0.62 0.17 250)`, ring `oklch(0.62 0.17 250 / 0.18)`, link `oklch(0.68 0.15 250)`, link hover `oklch(0.78 0.13 250)`. Do not use blue anywhere else on the page.

**Metal primary button**
```css
background: linear-gradient(180deg, #fefefe 0%, #f0f0f2 44%, #d5d5d9 53%, #c4c4c9 100%);
border: 0.5px solid rgba(0, 0, 0, 0.5);
color: #141417;
box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.07),
            0 1px 2px rgba(0,0,0,0.55), 0 6px 16px rgba(0,0,0,0.35);
```
The 53% stop is the specular band. Keep the whole recipe together — dropping a layer flattens it.

**Quiet button** — `background: rgba(244,244,246,0.05)`, hover `rgba(244,244,246,0.11)`, `border: 0.5px solid rgba(255,255,255,0.09)`, colour `rgba(244,244,246,0.8)`.

**Glass selection** — `background: linear-gradient(180deg, rgba(255,255,255,0.115) 0%, rgba(255,255,255,0.05) 100%)`, `border: 0.5px solid rgba(255,255,255,0.17)`, `backdrop-filter: blur(16px) saturate(1.6)`.

**Skill tiles** — blue `linear-gradient(180deg, oklch(0.68 0.17 250), oklch(0.55 0.17 250))` · green `oklch(0.75 0.15 152) → oklch(0.6 0.15 152)` · amber `oklch(0.8 0.15 82) → oklch(0.66 0.15 82)` · plum `oklch(0.66 0.17 310) → oklch(0.52 0.17 310)` · steel `#5c5c66 → #3a3a42`. All with `inset 0 1px 0 rgba(255,255,255,0.26), 0 1px 3px rgba(0,0,0,0.5)`.

### The signature glow — landing-only

The one thing on this page that is **not** in the app's token file. It comes from the icon asset `branding/Skillglass.icon/Assets/forge-glow.svg`, whose gradient runs `#6f42ff → #be43c7 → #d3469d → #ff812e`. On the landing it appears in exactly three places, and nowhere else:

1. Hero background blooms — violet `rgba(111,66,255,0.20)` and orange `rgba(255,129,46,0.13)`.
2. Product-shot window shadow — the trailing `0 0 90px -20px rgba(111,66,255,0.18)`.
3. **Primary hero CTA**, as a directional glow around the pill, appended after the metal shadow:

```css
box-shadow:
  inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.07),
  0 1px 2px rgba(0,0,0,0.55), 0 6px 16px rgba(0,0,0,0.35),
  -13px  3px 20px -7px rgba(111, 66,255,0.75),
   -4px 10px 20px -7px rgba(190, 67,199,0.65),
    7px  8px 20px -7px rgba(211, 70,157,0.65),
   14px -3px 20px -7px rgba(255,129, 46,0.70),
    0    0   34px -12px rgba(190, 67,199,0.50);
```

Four offset shadows walk the gradient from violet on the left to orange on the right; the last is an even ambient wash. Keep this on the hero CTA only — repeating it on the header and download buttons kills it. If you'd rather implement it as a blurred gradient pseudo-element, that is fine, but match the hue order and the roughly 20px spread.

**Motion** — press 90ms · hover 140ms · state 180 / 200 / 260ms · graph 420ms. Standard easing `cubic-bezier(0.32, 0.72, 0, 1)`, press `cubic-bezier(0.2, 0, 0.4, 1)`.

## Assets

Both from the repo's `branding/` folder, copied into `assets/` here:

- `assets/Skillglass.png` — app icon, the real rendered asset. Used at 26px (header), 72px (closing card), 20px (footer). Needs a proper favicon set and an OG image for production; neither exists yet.
- `assets/forge-diamond-preview.png` — the bare diamond, no glow. Not currently placed on the page; included in case you want it for the OG image.

Vector sources, if you need them, live at `branding/Skillglass.icon/Assets/` (`forge-diamond.svg`, `forge-glow.svg`, `forge-facet-*.svg`) and in the `.icon` bundles alongside.

All nav and toolbar SVG icons inside the product shot were copied verbatim from `apps/desktop/src/renderer/AppChrome.ts` (`NavigationIcon`, 1.5px stroke, `currentColor`). Take them from there rather than redrawing.

Fonts: none to load. The stack is system-only by design.

## Copy

All copy exists in both languages inside `Landing.dc.html`, in `data-lang="es"` / `data-lang="en"` sibling blocks. **Take it verbatim from the file** — the tone is deliberate (plain, declarative, no hype, an occasional dry aside; modelled on 37signals product pages) and it is easy to flatten in translation or paraphrase.

Two things in the copy are claims about the product, so check them before launch:
- The unsigned-builds notice in the download section, taken from the repo's release docs.
- "Sin telemetría" / "No telemetry" in the footer and hero.

The repo URL used throughout is `github.com/r-bart/skillglass`, read from `AppChrome.ts`. **Verify it** — if the public repo lands elsewhere, it appears in 9 places.

## Files

In this bundle:

- `README.md` — this document.
- `Landing.dc.html` — the design. Source of truth for copy and exact values. Open in a browser to view; `support.js` must be beside it.
- `support.js` — runtime for the design file. Reference only; do not port.
- `assets/Skillglass.png`, `assets/forge-diamond-preview.png`.

In the Skillglass repo, worth reading before you start:

- `apps/desktop/src/renderer/styles/tokens.css` — the token layer. Mirror it.
- `apps/desktop/src/renderer/styles/components.css`, `shell.css` — the material recipes the product shot reproduces.
- `apps/desktop/src/renderer/AppChrome.ts` — nav icon SVGs, repo URL.
- `README.md`, `thoughts/PRODUCT.md` — the product claims the copy is built on.

## Open questions for the implementer

1. Where does this page live — a `site/` or `www/` folder in the same repo, or its own? That decides the framework.
2. Product shot: real screenshot or ported HTML? (Recommendation: screenshot.)
3. Real i18n routes, or keep the client-side toggle?
4. Is `github.com/r-bart/skillglass` the final public URL?
5. Favicon set and OG image need to be produced — neither exists yet.
