import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { TagPicker } from "../shared/TagPicker";

/** Tag pills for the open note (dot + name); the "+" opens a picker to add, remove or create tags. */
export function NoteTagsMenu({ noteId, tags }: { noteId: string; tags: string[] }) {
  const setNotesTag = useAppStore((s) => s.setNotesTag);
  const tagDefs = useAppStore((s) => s.tagDefs);
  const editorWidth = useAppStore((s) => s.editorWidth);
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
    // Same column as the editor text (see .cm-content in MarkdownEditor).
    <div className="shrink-0 px-10 pt-4 -mb-10 relative z-10" style={{ maxWidth: editorWidth, marginLeft: "auto", marginRight: "auto", width: "100%" }}>
      <div ref={ref} className="relative flex flex-wrap items-center gap-1.5">
        {tags.map((t) => {
          const color = tagDefs.find((d) => d.name === t)?.color ?? "hsl(var(--accent))";
          return (
            <button
              key={t}
              onClick={() => setOpen(true)}
              title="Edit tags"
              className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-0.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              {t}
            </button>
          );
        })}
        <button
          onClick={() => setOpen((v) => !v)}
          title="Tags"
          className={
            tags.length
              ? "w-5 h-5 flex items-center justify-center rounded text-tertiary hover:text-foreground hover:bg-surface"
              : "flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] text-tertiary hover:text-foreground hover:bg-surface transition-colors"
          }
        >
          <Plus className="w-3 h-3" />
          {!tags.length && "Add tag"}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-border-strong bg-surface p-1 shadow-lg">
            <TagPicker isOn={(t) => tags.includes(t)} onToggle={(t, on) => setNotesTag([noteId], t, on)} />
          </div>
        )}
      </div>
    </div>
  );
}
