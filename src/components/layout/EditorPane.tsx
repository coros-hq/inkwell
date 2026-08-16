import {
  Pin,
  MoreHorizontal,
  PenLine,
  Trash2,
  PanelLeftOpen,
  Link2,
  Paperclip,
  Plus,
  GitBranch,
  Columns2,
} from "lucide-react";
import { ShareDialog } from "../editor/ShareDialog";
import { GitHubSyncDialog } from "../shared/GitHubSyncDialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import {
  confirmDeleteNote,
  confirmDeleteSelectedNotes,
} from "../../lib/deleteActions";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { SplitView } from "../editor/SplitView";
import { EditorToolbar } from "../editor/EditorToolbar";
import { NoteSearchBar } from "../editor/NoteSearchBar";
import { LinksPanel } from "../editor/LinksPanel";
import { MediaPanel } from "../editor/MediaPanel";
import { EditorViewProvider } from "../editor/EditorViewContext";
import { StructureRail } from "../editor/StructureRail";
import { cn, glassBg } from "../../lib/utils";
import { formatDate } from "../../lib/utils";
import { comboMatches } from "../../lib/shortcuts";

export function EditorPane() {
  const {
    notes,
    folders,
    selectedNoteIds,
    lastSelectedNoteId,
    selectedFolderId,
    getEditorMode,
    setNoteEditorMode,
    pinNote,
    saveStatus,
    createNote,
    createFolder,
    openPrompt,
    renameNote,
    sidebarOpen,
    toggleSidebar,
    vaultPath,
    bodyGlass,
    glassOpacity,
  } = useAppStore();

  const primaryNoteId = lastSelectedNoteId ?? selectedNoteIds[0] ?? null;
  const note = notes.find((n) => n.id === primaryNoteId);
  const editorMode = note ? getEditorMode(note.id) : "normal";
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    setEditingTitle(note?.title ?? "");
  }, [note?.id, note?.title]);

  // Close panels when switching notes
  useEffect(() => {
    setLinksOpen(false);
    setMediaOpen(false);
  }, [note?.id]);

  // ── Links panel ───────────────────────────────────────────────────────────
  const [linksOpen, setLinksOpen] = useState(false);

  // ── Media panel ───────────────────────────────────────────────────────────
  const [mediaOpen, setMediaOpen] = useState(false);

  // ── GitHub sync dialog ────────────────────────────────────────────────────
  const [githubSyncOpen, setGithubSyncOpen] = useState(false);

  // ── Structure rail scroller ──────────────────────────────────────────────
  const [scrollerEl, setScrollerEl] = useState<HTMLElement | null>(null);
  // Reset on cleanup (when the old note/mode goes away), not in the effect
  // body — the body runs after the editor's own mount effect (child effects
  // fire before parent effects) and would immediately null out the real
  // scroller it just registered via onScrollerReady.
  useEffect(() => () => setScrollerEl(null), [note?.id, editorMode]);

  // ── In-note search ────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);

  // All char offsets of matches in note.content
  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 1 || !note) return [];
    const content = note.content.toLowerCase();
    const q = searchQuery.toLowerCase();
    const offsets: number[] = [];
    let i = content.indexOf(q);
    while (i !== -1) {
      offsets.push(i);
      i = content.indexOf(q, i + 1);
    }
    return offsets;
  }, [searchQuery, note?.content]);

  // Reset match index when query or note changes
  useEffect(() => {
    setSearchMatchIndex(0);
  }, [searchQuery, note?.id]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatchIndex(0);
  }, []);

  const goNext = useCallback(() => {
    if (!searchMatches.length) return;
    setSearchMatchIndex((i) => (i + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const goPrev = useCallback(() => {
    if (!searchMatches.length) return;
    setSearchMatchIndex(
      (i) => (i - 1 + searchMatches.length) % searchMatches.length,
    );
  }, [searchMatches.length]);

  // Find in note — user-remappable, see Settings > Shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { shortcuts, recordingShortcut } = useAppStore.getState();
      if (recordingShortcut) return;
      if (comboMatches(e, shortcuts.findInNote)) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openSearch]);

  const folder = selectedFolderId
    ? (function findFolder(fs: typeof folders): (typeof folders)[0] | null {
        for (const f of fs) {
          if (f.id === selectedFolderId) return f;
          const found = findFolder(f.children);
          if (found) return found;
        }
        return null;
      })(folders)
    : null;

  const parentFolder = folder?.parentId
    ? (function findFolder(fs: typeof folders): (typeof folders)[0] | null {
        for (const f of fs) {
          if (f.id === folder.parentId) return f;
          const found = findFolder(f.children);
          if (found) return found;
        }
        return null;
      })(folders)
    : null;

  const handleNewNote = () => {
    if (selectedFolderId) {
      createNote(selectedFolderId);
      return;
    }
    openPrompt({
      title: "New Folder",
      description: "Create a folder for your first note.",
      placeholder: "Folder name",
      confirmLabel: "Create",
      onConfirm: (name) => {
        createFolder(name, null);
        const folderId = useAppStore.getState().selectedFolderId;
        if (folderId) createNote(folderId);
      },
    });
  };

  if (!note) {
    return (
      <div
        className={cn("flex-1 flex flex-col items-center justify-center gap-5", bodyGlass ? "backdrop-blur-2xl" : "bg-background")}
        style={bodyGlass ? glassBg('background', glassOpacity) : undefined}
      >
        <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-surface border border-border-strong shadow-sm">
          <PenLine className="w-7 h-7 text-muted-foreground" strokeWidth={1.75} />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-foreground">Nothing open</p>
          <p className="text-[13px] text-muted-foreground mt-1">Pick a note from the list, or start a new one.</p>
        </div>
        <button
          onClick={handleNewNote}
          className="flex items-center gap-1.5 h-9 px-4 rounded-full bg-accent text-accent-foreground text-[13px] font-semibold shadow-sm hover:opacity-90 transition-opacity"
          title="New note"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          New note
        </button>
      </div>
    );
  }

  const saveLabel = saveStatus === "saving" ? "Saving..." : "Saved just now";

  const commitTitle = () => {
    if (!note) return;
    const trimmed = editingTitle.trim() || "Untitled";
    if (trimmed !== note.title) {
      renameNote(note.id, trimmed);
    } else {
      setEditingTitle(note.title);
    }
  };

  return (
    <div
      className={cn("flex-1 flex overflow-hidden min-w-0", bodyGlass ? "backdrop-blur-2xl" : "bg-background")}
      style={bodyGlass ? glassBg('background', glassOpacity) : undefined}
    >
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar — minimal: breadcrumb + title left, actions tucked right, no divider */}
        <div className="h-12 shrink-0 flex items-center px-5 gap-3" data-tauri-drag-region>
          {!sidebarOpen && (
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors shrink-0"
              onClick={toggleSidebar}
              title="Show sidebar (⌘B)"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
          {selectedNoteIds.length > 1 && (
            <span className="text-xs text-accent font-medium shrink-0">
              {selectedNoteIds.length} notes selected
            </span>
          )}
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground min-w-0 flex-1">
            {parentFolder && (
              <>
                <span className="hover:text-foreground transition-colors truncate max-w-[120px]">{parentFolder.name}</span>
                <span className="text-tertiary">›</span>
              </>
            )}
            {folder && (
              <>
                <span className="hover:text-foreground transition-colors truncate max-w-[120px]">{folder.name}</span>
                <span className="text-tertiary">›</span>
              </>
            )}
            <input
              type="text"
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setEditingTitle(note.title);
                  e.currentTarget.blur();
                }
              }}
              placeholder="Untitled"
              className={cn(
                "min-w-[4ch] max-w-[280px] flex-1 truncate",
                "text-[12.5px] font-medium text-foreground bg-transparent",
                "border-none outline-none p-0",
                "placeholder:text-muted-foreground placeholder:font-normal",
                "focus:ring-0",
              )}
            />
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] text-tertiary mr-1">{saveLabel}</span>

            {/* Markdown mode toggle — small escape hatch, not a primary control */}
            <button
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-md transition-colors",
                editorMode === "markdown"
                  ? "text-accent bg-active"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface",
              )}
              onClick={() =>
                setNoteEditorMode(note.id, editorMode === "markdown" ? "normal" : "markdown")
              }
              title={editorMode === "markdown" ? "Switch to Normal mode" : "Switch to Markdown mode"}
            >
              <Columns2 className="w-3.5 h-3.5" />
            </button>

            <button
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-md transition-colors",
                note.pinned
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface",
              )}
              onClick={() => pinNote(note.id)}
              title={note.pinned ? "Unpin" : "Pin"}
            >
              <Pin className={cn("w-3.5 h-3.5", note.pinned && "fill-accent")} />
            </button>

            <button
              onClick={() => setLinksOpen((v) => !v)}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-md transition-colors",
                linksOpen
                  ? "text-accent bg-active"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface",
              )}
              title="Links"
            >
              <Link2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setMediaOpen((v) => !v)}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-md transition-colors",
                mediaOpen
                  ? "text-accent bg-active"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface",
              )}
              title="Media & attachments"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>

            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() =>
                selectedNoteIds.length > 1
                  ? confirmDeleteSelectedNotes()
                  : confirmDeleteNote(note.id, note.title)
              }
              title="Delete note"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <ShareDialog note={note} vaultPath={vaultPath ?? undefined} />

            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              onClick={() => setGithubSyncOpen(true)}
              title="Sync with GitHub"
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>

            <button className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Meta line */}
        {editorMode === "markdown" && (
          <div className="px-10 pt-2 pb-0 shrink-0">
            <p className="text-xs text-muted-foreground">
              {parentFolder && `${parentFolder.name} / `}
              {folder?.name} · Edited {formatDate(note.updatedAt)} ·{" "}
              {note.wordCount.toLocaleString()} words
            </p>
          </div>
        )}

        {/* Editor body */}
        <EditorViewProvider>
          {searchOpen && (
            <NoteSearchBar
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onClose={closeSearch}
              matchIndex={searchMatchIndex}
              matches={searchMatches}
              onNext={goNext}
              onPrev={goPrev}
            />
          )}
          <div className="flex-1 overflow-hidden relative">
            {editorMode === "normal" && (
              <MarkdownEditor noteId={note.id} content={note.content} onScrollerReady={setScrollerEl} />
            )}
            {editorMode === "markdown" && (
              <SplitView noteId={note.id} content={note.content} />
            )}

            {editorMode === "normal" && <EditorToolbar />}
            {editorMode === "normal" && <StructureRail content={note.content} scrollerEl={scrollerEl} />}
          </div>
        </EditorViewProvider>
      </div>

      {/* Right panels */}
      {linksOpen && (
        <LinksPanel noteId={note.id} onClose={() => setLinksOpen(false)} />
      )}
      {mediaOpen && (
        <MediaPanel noteId={note.id} onClose={() => setMediaOpen(false)} />
      )}

      <GitHubSyncDialog
        open={githubSyncOpen}
        onClose={() => setGithubSyncOpen(false)}
        noteId={note.id}
      />
    </div>
  );
}
