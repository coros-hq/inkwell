import { isDarkTheme, THEMES, loadCustomThemes, type CustomTheme } from './themes'
import { deriveThemeVars, applyCustomThemeVars, clearCustomThemeVars } from './themeUtils'

/** The saved theme id, with the old 'dark'/'light' values migrated. */
export function resolveSavedThemeName(): string {
  const saved = localStorage.getItem('inkwell-theme')
  return saved === 'dark' ? 'midnight'
    : saved === 'light' ? 'parchment'
    : (saved && THEMES.find(t => t.id === saved)) ? saved
    : saved ?? 'midnight' // may be a custom theme id
}

/** Paints a theme onto <html> (dark class, data-theme or custom CSS variables). */
export function applyThemeToDom(name: string, customThemes: CustomTheme[]): { dark: boolean } {
  const custom = customThemes.find(t => t.id === name)
  const dark = custom ? custom.dark : isDarkTheme(name)
  document.documentElement.classList.toggle('dark', dark)
  if (custom) {
    delete document.documentElement.dataset.theme
    applyCustomThemeVars(deriveThemeVars(custom.colors, dark))
  } else {
    clearCustomThemeVars()
    document.documentElement.dataset.theme = name
  }
  return { dark }
}

/** Apply the saved theme before first paint — used by windows that don't mount AppShell. */
export function restoreSavedTheme() {
  const customThemes = loadCustomThemes()
  const themeName = resolveSavedThemeName()
  const { dark } = applyThemeToDom(themeName, customThemes)
  return { themeName, theme: (dark ? 'dark' : 'light') as 'dark' | 'light', customThemes }
}
