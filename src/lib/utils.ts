import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatWordCount(count: number): string {
  return count.toLocaleString() + ' words'
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function extractTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) {
    const title = match[1].trim()
    return title || 'Untitled'
  }
  return 'Untitled'
}

/** Convert Uint8Array → base64 string without stack-overflowing on large files. */
export function uint8ToBase64(bytes: Uint8Array): string {
  let str = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(str)
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'untitled'
}

export function setContentTitle(content: string, title: string): string {
  const trimmed = title.trim() || 'Untitled'
  if (/^#\s+/m.test(content)) {
    return content.replace(/^#\s+.*$/m, `# ${trimmed}`)
  }
  if (!content.trim()) {
    return `# ${trimmed}\n\n`
  }
  return `# ${trimmed}\n\n${content}`
}

// Glass/vibrancy backgrounds need a continuous, user-adjustable opacity — Tailwind's
// bg-x/NN opacity utilities are generated at build time from static class strings, so
// they can't represent an arbitrary runtime slider value. Use an inline style instead;
// the CSS variables (--sidebar, --background, --panel, ...) are always raw "h s l"
// triplets (see globals.css), so wrapping in hsl(var(--x) / alpha) is always valid.
//
// `intensityPercent` is the glass strength: 0 = solid panel, 100 = most see-through
// (tint alpha stays within 0.1–0.9 so text stays readable).
//
// A light wallpaper's colours bleed straight through a light tint and wreck text
// contrast, so on the light theme the tint never drops below a floor: panes keep
// a milky 0.45, the editor card (where long text lives) a near-opaque 0.88.
export function glassBg(
  cssVar: string,
  intensityPercent: number,
  theme: 'light' | 'dark' = 'dark',
  role: 'pane' | 'card' = 'pane',
): { backgroundColor: string } {
  // Maps 0..100 → 0.9..0.1 so even the strongest setting keeps text legible.
  const raw = 0.9 - (Math.min(100, Math.max(0, intensityPercent)) / 100) * 0.8
  const floor = theme === 'light' ? (role === 'card' ? 0.88 : 0.45) : role === 'card' ? 0.6 : 0
  const alpha = Math.max(raw, floor)
  return { backgroundColor: `hsl(var(--${cssVar}) / ${alpha})` }
}
