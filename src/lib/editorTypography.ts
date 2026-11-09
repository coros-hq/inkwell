export const EDITOR_FONT_FAMILY = 'var(--font-app)'
export const EDITOR_FONT_SIZE = '15px'
export const EDITOR_LINE_HEIGHT = '1.7'

export const editorFontStyles = {
  fontFamily: EDITOR_FONT_FAMILY,
  fontSize: EDITOR_FONT_SIZE,
  lineHeight: EDITOR_LINE_HEIGHT,
  fontWeight: '400',
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1',
} as const
