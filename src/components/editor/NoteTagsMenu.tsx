import { useEffect, useRef, useState } from "react";
import { Tag } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { TagPicker } from "../shared/TagPicker";
import { cn } from "../../lib/utils";

/** Header dropdown to tag the open note: pick an existing tag or type a new name to create one. */
export function NoteTagsMenu({ noteId, tags }: { noteId: string; tags: string[] }) {
  const setNotesTag = useAppStore((s) => s.setNotesTag);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className={cn(
          "h-7 flex items-center gap-1 rounded-md px-1.5 transition-colors",
          open || tags.length
            ? "text-accent bg-active"
            : "text-muted-foreground hover:text-foreground hover:bg-surface",
        )}
        onClick={() => setOpen((v) => !v)}
        title="Tags"
      >
        <Tag className="w-3.5 h-3.5" />
        {tags.length > 0 && <span className="text-[11px] font-medium">{tags.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-border-strong bg-surface p-1 shadow-lg">
          <TagPicker isOn={(t) => tags.includes(t)} onToggle={(t, on) => setNotesTag([noteId], t, on)} />
        </div>
      )}
    </div>
  );
}
