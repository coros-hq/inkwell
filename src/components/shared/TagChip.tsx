import { useAppStore } from '../../store/useAppStore'

interface TagChipProps {
  tag: string
}

/** Calendar-card style (tinted fill + soft border in the tag's colour) for defined tags; board labels etc. keep the theme chip. */
export function TagChip({ tag }: TagChipProps) {
  const color = useAppStore((s) => s.tagDefs.find((d) => d.name === tag)?.color)
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium ${color ? 'rounded-lg border text-foreground' : 'rounded-full bg-tag-bg text-tag-text'}`}
      style={color ? {
        background: `color-mix(in srgb, ${color} 38%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 75%, transparent)`,
      } : undefined}
    >
      #{tag}
    </span>
  )
}
