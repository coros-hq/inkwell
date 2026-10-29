import { useEffect, useRef, useState } from "react";
import { Check, Tag } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { cn } from "../../lib/utils";

/** Header dropdown listing the vault's existing tags so the open note can be tagged in one click. */
export function NoteTagsMenu({ noteId, tags }: { noteId: string; tags: string[] }) {
  const tagDefs = useAppStore((s) => s.tagDefs);
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
        <div className="absolute right-0 top-8 z-50 w-52 max-h-72 overflow-y-auto rounded-lg border border-border-strong bg-surface p-1 shadow-lg">
          {tagDefs.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              No tags yet. Create one from the sidebar's Tags section.
            </p>
          ) : (
            tagDefs.map((t) => {
              const on = tags.includes(t.name);
              return (
                <button
                  key={t.name}
                  onClick={() => setNotesTag([noteId], t.name, !on)}
                  className="w-full flex items-center gap-2 h-7 px-2 rounded-md text-[12.5px] text-foreground hover:bg-active transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="flex-1 truncate text-left">{t.name}</span>
                  {on && <Check className="w-3.5 h-3.5 text-accent" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
