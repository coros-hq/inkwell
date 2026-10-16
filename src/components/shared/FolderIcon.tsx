import {
  Folder, FolderOpen, Briefcase, Book, BookOpen, Star, Heart, Home, Code, Terminal,
  Lightbulb, Rocket, Target, Flag, Calendar, Camera, Music, Film, Image, Globe,
  Cloud, Zap, Flame, Leaf, Coffee, ShoppingCart, Wallet, GraduationCap, Archive,
  Inbox, Bookmark, Lock, Users, User, Palette, Wrench, FlaskConical, Plane,
  icons,
  type LucideIcon,
} from 'lucide-react'

/** Every Lucide icon, by PascalCase name — used for search and rendering. */
export const ALL_ICONS = icons as Record<string, LucideIcon>

/** Suggested set shown before the user searches. */
export const FOLDER_ICONS: Record<string, LucideIcon> = {
  Folder, FolderOpen, Briefcase, Book, BookOpen, Star, Heart, Home, Code, Terminal,
  Lightbulb, Rocket, Target, Flag, Calendar, Camera, Music, Film, Image, Globe,
  Cloud, Zap, Flame, Leaf, Coffee, ShoppingCart, Wallet, GraduationCap, Archive,
  Inbox, Bookmark, Lock, Users, User, Palette, Wrench, FlaskConical, Plane,
}

/** Icon values are stored as "lucide:Name". Missing → default folder. */
export function FolderIcon({ icon, className }: { icon?: string; className?: string }) {
  const Cmp = (icon?.startsWith('lucide:') && ALL_ICONS[icon.slice(7)]) || Folder
  return <Cmp className={className} />
}
