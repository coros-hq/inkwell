import { useAppStore } from '../../store/useAppStore'

interface TagChipProps {
  tag: string
}

/** Calendar-card style (flat solid fill, no border) for defined tags; board labels etc. keep the theme chip. */
export function TagChip({ tag }: TagChipProps) {
  const color = useAppStore((s) => s.tagDefs.find((d) => d.name === tag)?.color)
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium ${color ? 'rounded-lg text-white' : 'rounded-full bg-tag-bg text-tag-text'}`}
      style={color ? {
        background: color,
      } : undefined}
    >
      {tag}
    </span>
  )
}
