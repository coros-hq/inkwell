// ─── HSL ↔ Hex conversion ─────────────────────────────────────────────────────

interface HslParts {
  h: number
  s: number
  l: number
}

export function hexToHslParts(hex: string): HslParts {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }

  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  return { h, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslPartsToString({ h, s, l }: HslParts): string {
  return `${h} ${s}% ${l}%`
}

export function hslStringToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/)
  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }

  const toHex = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

// ─── Theme var derivation ──────────────────────────────────────────────────────
// Derives a full set of CSS variables from 5 key colors.
// Produces reasonable values for all 19 variables in the inkwell design system.

export interface ThemeColors {
  background: string       // hex
  foreground: string       // hex
  sidebar: string          // hex
  accent: string           // hex
  border: string           // hex
  mutedForeground?: string // hex — overrides derived secondary text/icon color
  borderStrong?: string    // hex — overrides derived separator color
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

export function deriveThemeVars(
  colors: ThemeColors,
  dark: boolean,
): Record<string, string> {
  const bg = hexToHslParts(colors.background)
  const fg = hexToHslParts(colors.foreground)
  const sb = hexToHslParts(colors.sidebar)
  const ac = hexToHslParts(colors.accent)
  const bd = hexToHslParts(colors.border)

  const h = (p: HslParts) => hslPartsToString(p)
  const d = dark ? 1 : -1   // direction: +L for dark (lighten), −L for light (darken)

  return {
    '--background':        h(bg),
    '--foreground':        h(fg),
    '--card':              h({ ...sb, l: clamp(sb.l + d * 2, 2, 98) }),
    '--card-foreground':   h(fg),
    '--sidebar':           h(sb),
    '--panel':             h({ ...sb, l: clamp(sb.l + d * 1, 2, 98) }),
    '--surface':           h({ ...bg, l: clamp(bg.l + d * 5, 2, 98) }),
    '--active':            h({
      h: ac.h,
      s: clamp(Math.round(ac.s * 0.4), 4, 55),
      l: dark
        ? clamp(Math.round(ac.l * 0.38), 8, 30)
        : clamp(Math.round(ac.l * 1.55), 72, 95),
    }),
    '--border':            h(bd),
    '--border-strong':     colors.borderStrong
      ? h(hexToHslParts(colors.borderStrong))
      : h({ ...bd, l: clamp(bd.l + d * 10, 2, 98) }),
    '--input':             h(bd),
    '--accent':            h(ac),
    '--accent-foreground': dark ? h(bg) : '0 0% 100%',
    '--muted':             h({ ...bg, l: clamp(bg.l + d * 5, 2, 98) }),
    '--muted-foreground':  colors.mutedForeground
      ? h(hexToHslParts(colors.mutedForeground))
      : h({
        h: fg.h,
        s: clamp(Math.round(fg.s * 0.35), 2, 28),
        l: dark ? 58 : 48,
      }),
    '--tertiary':          colors.mutedForeground
      ? h({ ...hexToHslParts(colors.mutedForeground), l: clamp(hexToHslParts(colors.mutedForeground).l + d * -10, 2, 98) })
      : h({
        h: fg.h,
        s: clamp(Math.round(fg.s * 0.18), 2, 18),
        l: dark ? 40 : 65,
      }),
    '--code-bg':           h({ ...sb, l: clamp(sb.l + d * 1, 2, 98) }),
    '--tag-bg':            h({
      h: ac.h,
      s: clamp(Math.round(ac.s * 0.22), 3, 28),
      l: dark
        ? clamp(bg.l + 6, 7, 28)
        : clamp(bg.l - 4, 82, 97),
    }),
    '--tag-text':          h({ ...ac, l: clamp(ac.l + (dark ? 12 : -8), 24, 82) }),
    '--code-block-bg':     h({ ...sb, l: clamp(sb.l - (dark ? 4 : -3), 2, 96) }),
  }
}

// ─── Apply / clear inline CSS vars ───────────────────────────────────────────

const ALL_VAR_NAMES = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--sidebar', '--panel', '--surface', '--active',
  '--border', '--border-strong', '--input', '--accent', '--accent-foreground',
  '--muted', '--muted-foreground', '--tertiary',
  '--code-bg', '--tag-bg', '--tag-text', '--code-block-bg',
]

export function applyCustomThemeVars(vars: Record<string, string>): void {
  const el = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value)
  }
}

export function clearCustomThemeVars(): void {
  const el = document.documentElement
  for (const name of ALL_VAR_NAMES) {
    el.style.removeProperty(name)
  }
}
