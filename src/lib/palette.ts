// Named colors shared by text highlights (`<mark class="hl-red">`), text colors
// (`<span class="tc-red">`), table select-option chips, and the bullet color.
// The `hl-*` / `tc-*` classes themselves live in globals.css and must stay in
// sync with the rgb values here.

export interface PaletteColor {
  name: string
  label: string
  /** Solid color — text color, bullet color, swatch dot. */
  hex: string
  /** "r g b" channels, for translucent backgrounds. */
  rgb: string
}

export const PALETTE: PaletteColor[] = [
  { name: 'gray',   label: 'Gray',   hex: '#8b8d98', rgb: '139 141 152' },
  { name: 'red',    label: 'Red',    hex: '#e5484d', rgb: '229 72 77' },
  { name: 'orange', label: 'Orange', hex: '#f76b15', rgb: '247 107 21' },
  { name: 'yellow', label: 'Yellow', hex: '#e5b400', rgb: '229 180 0' },
  { name: 'green',  label: 'Green',  hex: '#30a46c', rgb: '48 164 108' },
  { name: 'blue',   label: 'Blue',   hex: '#3e63dd', rgb: '62 99 221' },
  { name: 'purple', label: 'Purple', hex: '#8e4ec6', rgb: '142 78 198' },
  { name: 'pink',   label: 'Pink',   hex: '#d6409f', rgb: '214 64 159' },
]

export function paletteColor(name: string | undefined): PaletteColor {
  return PALETTE.find(c => c.name === name) ?? PALETTE[0]
}

/** Inline style for a tinted chip (select option, tag). */
export function chipStyle(name: string | undefined): React.CSSProperties {
  const c = paletteColor(name)
  return { background: `rgb(${c.rgb} / 0.22)`, color: c.hex }
}
