import { useState, useCallback, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  LayoutGrid,
  Trash2,
  FolderPlus,
  Search,
  PenLine,
  PenSquare,
  FileInput,
  ArrowUpCircle,
  ArrowRight,
  MoreHorizontal,
} from "lucide-react";
import { SettingsDialog } from '../settings/SettingsDialog'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

// Prefer pointer-within (exact hit) then fall back to rect intersection.
// This eliminates false "over" readings caused by the dragged item's rect
// overlapping multiple droppables near row edges.
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};
import { useAppStore } from "../../store/useAppStore";
import { ThemeToggle } from "../shared/ThemeToggle";
import { ContextMenu } from "../shared/ContextMenu";
import type { Folder as FolderType, Note } from "../../types";
import { cn, glassBg } from "../../lib/utils";
import {
  confirmDeleteFolderItem,
  confirmDeleteNote,
  confirmDeleteSelectedNotes,
} from "../../lib/deleteActions";
import { handleNoteSelect } from "../../lib/noteSelection";

// ─── Types ───────────────────────────────────────────────────────────────────

type DragItemData =
  | { type: "note"; id: string; folderId: string | null }
  | { type: "folder"; id: string; parentId: string | null };

type DropPosition = "before" | "after" | "into";

interface DropIndicator {
  /** The droppable id being hovered */
  overId: string;
  position: DropPosition;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_PADDING = 8;
const CHEVRON_WIDTH = 14;
const FOLDER_ICON_WIDTH = 14;
const ITEM_GAP = 2;

function folderPadding(depth: number): number {
  if (depth === 0) return ROW_PADDING;
  return folderIconOffset(depth - 1);
}
function folderIconOffset(depth: number): number {
  return folderPadding(depth) + CHEVRON_WIDTH + ITEM_GAP;
}
function notePadding(depth: number): number {
  return folderIconOffset(depth) + FOLDER_ICON_WIDTH + ITEM_GAP;
}

const treeRowClass = cn(
  "flex items-center gap-1.5 h-[30px] pr-1.5 rounded-md transition-colors min-w-0 text-[13px] font-medium",
);

/** Drop insertion line — dot + rule, like Finder/VSCode. */
function DropLine({ pos }: { pos: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "absolute left-0 right-0 z-10 pointer-events-none flex items-center",
        pos === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
      )}
    >
      <span className="w-2 h-2 rounded-full bg-accent shrink-0 ml-1.5" />
      <div className="flex-1 h-[1.5px] bg-accent" />
    </div>
  );
}

// ─── NoteRow ──────────────────────────────────────────────────────────────────

interface NoteRowProps {
  note: Note;
  isSelected: boolean;
  orderedIds: string[];
  paddingLeft: number;
  onContextMenu: (e: React.MouseEvent) => void;
  dropBefore: boolean;
  dropAfter: boolean;
  onDelete: () => void;
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
}

function NoteRow({
  note,
  isSelected,
  orderedIds,
  paddingLeft,
  onContextMenu,
  dropBefore,
  dropAfter,
  onDelete,
  renamingId,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: NoteRowProps) {
  const dndId = `note:${note.id}`;
  const isRenaming = renamingId === note.id;
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: dndId,
    data: { type: "note", id: note.id, folderId: note.folder } satisfies DragItemData,
    // External files aren't part of the folder tree — moveNote()/reorderNote()
    // assume vault-relative paths, so dragging one into a folder would try to
    // relocate the real file under the vault. Keep them out of the DnD tree entirely.
    disabled: isRenaming || note.external,
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: dndId,
    data: { type: "note", id: note.id, folderId: note.folder } satisfies DragItemData,
  });

  // Auto-select all text when rename input mounts
  useLayoutEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div ref={setDropRef} className="relative group">
      {dropBefore && <DropLine pos="top" />}
      <div
        ref={setDragRef}
        className={cn(
          treeRowClass,
          note.external ? "pr-1" : "cursor-grab active:cursor-grabbing pr-1",
          !isSelected && "hover:bg-surface",
          isSelected && "bg-active",
          isDragging && "opacity-20 pointer-events-none",
          isRenaming && "cursor-default",
        )}
        style={{ paddingLeft }}
        onClick={(e) => !isRenaming && handleNoteSelect(e, note.id, orderedIds)}
        onDoubleClick={(e) => { e.stopPropagation(); onStartRename(note.id); }}
        onContextMenu={onContextMenu}
        {...(isRenaming ? {} : { ...attributes, ...listeners })}
      >
        <FileText
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            isSelected ? "text-accent" : "text-muted-foreground",
          )}
        />

        {isRenaming ? (
          <input
            ref={inputRef}
            defaultValue={note.title}
            className="flex-1 bg-transparent text-foreground text-[13px] outline-none border-b border-accent min-w-0"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onCommitRename(note.id, e.currentTarget.value); }
              if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
              e.stopPropagation();
            }}
            onBlur={(e) => onCommitRename(note.id, e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={cn(
              "truncate flex-1",
              isSelected ? "text-accent font-medium" : "text-foreground",
            )}
          >
            {note.title}
          </span>
        )}

        {!isRenaming && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted"
              onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
              onPointerDown={(e) => e.stopPropagation()}
              tabIndex={-1}
              title="More options"
            >
              <MoreHorizontal className="w-3 h-3" />
            </button>
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              onPointerDown={(e) => e.stopPropagation()}
              tabIndex={-1}
              title={note.external ? "Remove from library" : "Delete note"}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {dropAfter && <DropLine pos="bottom" />}
    </div>
  );
}

// ─── FolderRow ────────────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: FolderType;
  depth?: number;
  siblingFolderIds: string[];
  onFolderContextMenu: (e: React.MouseEvent, folder: FolderType) => void;
  onNoteContextMenu: (e: React.MouseEvent, noteId: string, noteTitle: string) => void;
  dropIndicator: DropIndicator | null;
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelRename: () => void;
}

function FolderRow({
  folder,
  depth = 0,
  siblingFolderIds: _siblingFolderIds,
  onFolderContextMenu,
  onNoteContextMenu,
  dropIndicator,
  renamingId,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: FolderRowProps) {
  const { selectedFolderId, selectedNoteIds, selectFolder, toggleFolder, activeView, setActiveView, createNote } =
    useAppStore();
  const isRenamingThis = renamingId === folder.id;
  const folderInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (isRenamingThis && folderInputRef.current) {
      folderInputRef.current.focus();
      folderInputRef.current.select();
    }
  }, [isRenamingThis]);

  const isSelected = selectedFolderId === folder.id;
  const hasSelectedNote = folder.notes.some((n) =>
    selectedNoteIds.includes(n.id),
  );
  const isFolderActive = isSelected || hasSelectedNote;
  const noteOrderedIds = folder.notes.map((n) => n.id);
  const paddingLeft = folderPadding(depth);
  const dndId = `folder:${folder.id}`;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: dndId,
    data: {
      type: "folder",
      id: folder.id,
      parentId: folder.parentId,
    } satisfies DragItemData,
    disabled: isRenamingThis,
  });

  // Droppable on the outer header wrapper — covers the full row height
  // including inter-row margins, eliminating gap flicker.
  const { setNodeRef: setDropRef } = useDroppable({
    id: dndId,
    data: {
      type: "folder",
      id: folder.id,
      parentId: folder.parentId,
    } satisfies DragItemData,
  });

  // Determine this folder header's drop state
  const myIndicator =
    dropIndicator?.overId === dndId ? dropIndicator.position : null;
  const dropBefore = myIndicator === "before";
  const dropAfter = myIndicator === "after";
  const dropInto = myIndicator === "into";

  const childFolderIds = folder.children.map((c) => c.id);

  return (
    <div>
      {/* Folder header row — droppable wraps the visible row */}
      <div ref={setDropRef} className="relative group">
        {dropBefore && <DropLine pos="top" />}
        <div
          ref={setDragRef}
          className={cn(
            treeRowClass,
            "cursor-pointer",
            !isFolderActive && !dropInto && "hover:bg-surface",
            isFolderActive && !dropInto && "bg-active",
            dropInto && "ring-2 ring-accent bg-accent/15",
            isDragging && "opacity-20 pointer-events-none",
          )}
          style={{ paddingLeft }}
          onClick={() => {
            if (isRenamingThis) return;
            toggleFolder(folder.id);
            selectFolder(folder.id);
            if (activeView !== 'notes') setActiveView('notes');
          }}
          onDoubleClick={(e) => { e.stopPropagation(); onStartRename(folder.id); }}
          onContextMenu={(e) => onFolderContextMenu(e, folder)}
          {...(isRenamingThis ? {} : { ...attributes, ...listeners })}
        >
          <span
            className={cn(
              "w-4 h-4 flex items-center justify-center shrink-0",
              isFolderActive ? "text-accent" : "text-muted-foreground",
            )}
          >
            {folder.expanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
          <Folder
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              isFolderActive ? "text-accent" : "text-muted-foreground",
            )}
          />
          {isRenamingThis ? (
            <input
              ref={folderInputRef}
              defaultValue={folder.name}
              className="flex-1 bg-transparent text-foreground text-[13px] outline-none border-b border-accent min-w-0"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onCommitRename(folder.id, e.currentTarget.value); }
                if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
                e.stopPropagation();
              }}
              onBlur={(e) => onCommitRename(folder.id, e.currentTarget.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className={cn(
                "truncate",
                isFolderActive
                  ? "text-accent font-medium"
                  : depth === 0
                    ? "text-foreground font-medium"
                    : "text-foreground",
              )}
            >
              {folder.name}
            </span>
          )}

          {!isRenamingThis && (
            <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); createNote(folder.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                tabIndex={-1}
                title="New note in this folder"
              >
                <PenLine className="w-3 h-3" />
              </button>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); onFolderContextMenu(e, folder); }}
                onPointerDown={(e) => e.stopPropagation()}
                tabIndex={-1}
                title="More options"
              >
                <MoreHorizontal className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        {dropAfter && <DropLine pos="bottom" />}
      </div>

      {folder.expanded && (
        <div className="mt-1">
          {folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              siblingFolderIds={childFolderIds}
              onFolderContextMenu={onFolderContextMenu}
              onNoteContextMenu={onNoteContextMenu}
              dropIndicator={dropIndicator}
              renamingId={renamingId}
              onStartRename={onStartRename}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          ))}

          {folder.notes.map((note) => {
            const isNoteSelected = selectedNoteIds.includes(note.id);
            const noteId = `note:${note.id}`;
            return (
              <NoteRow
                key={note.id}
                note={note}
                isSelected={isNoteSelected}
                orderedIds={noteOrderedIds}
                paddingLeft={notePadding(depth)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onNoteContextMenu(e, note.id, note.title);
                }}
                dropBefore={
                  dropIndicator?.overId === noteId &&
                  dropIndicator.position === "before"
                }
                dropAfter={
                  dropIndicator?.overId === noteId &&
                  dropIndicator.position === "after"
                }
                onDelete={() => confirmDeleteNote(note.id, note.title)}
                renamingId={renamingId}
                onStartRename={onStartRename}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    folders,
    notes,
    activeView,
    selectedNoteIds,
    setSearchOpen,
    setActiveView,
    createNote,
    createFolder,
    openExternalNote,
    moveNotes,
    reorderNote,
    moveFolder,
    renameNote,
    renameFolder,
    openPrompt,
    selectedFolderId,
    clearFolderSelection,
    sidebarGlass,
    glassOpacity,
    canvasEnabled,
    updateInfo,
    updateInstallState,
    installUpdate,
    // dismissUpdateNotice,
  } = useAppStore();

  console.log(updateInfo)

  // ── Inline rename state ─────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const startRename = useCallback((id: string) => {
    setContextMenu(null);
    setRenamingId(id);
  }, []);

  const commitRename = useCallback((id: string, rawName: string) => {
    if (!renamingId) return;
    setRenamingId(null);
    const trimmed = rawName.trim();
    if (!trimmed) return;
    // Determine if it's a note or folder id
    const isNote = notes.some((n) => n.id === id);
    if (isNote) {
      renameNote(id, trimmed);
    } else {
      renameFolder(id, trimmed);
    }
  }, [renamingId, notes, renameNote, renameFolder]);

  const cancelRename = useCallback(() => setRenamingId(null), []);

  // Keyboard shortcut: Delete/Backspace deletes selected notes (when not typing)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      // Let the canvas view handle its own deletions
      if (activeView === 'canvas') return;
      if (useAppStore.getState().recordingShortcut) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (selectedNoteIds.length > 0) {
        e.preventDefault();
        confirmDeleteSelectedNotes();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNoteIds, activeView]);

  const pinnedNotes = notes.filter((n) => n.pinned);
  const rootNotes = notes.filter((n) => n.folder === null && !n.external);
  const externalNotes = notes.filter((n) => n.external);
  const rootFolderIds = folders.map((f) => f.id);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: { label: string; destructive?: boolean; onClick: () => void }[];
  } | null>(null);

  const [activeItem, setActiveItem] = useState<{
    type: "note" | "folder";
    label: string;
  } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  // Ref mirror so handleDragEnd never reads a stale closure value
  const dropIndicatorRef = useRef<DropIndicator | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only trigger a re-render when the indicator actually changes
  const updateDropIndicator = useCallback((next: DropIndicator | null) => {
    const prev = dropIndicatorRef.current;
    if (next?.overId === prev?.overId && next?.position === prev?.position) return;
    dropIndicatorRef.current = next;
    setDropIndicator(next);
  }, []);

  const sensors = useSensors(
    // 8 px prevents accidental drags on clicks
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ── Root drop zone ──────────────────────────────────────────────────────────
  const { setNodeRef: setRootRef, isOver: isRootOver } = useDroppable({
    id: "root",
    data: { type: "root" },
  });

  // ── Destination label shown in DragOverlay ──────────────────────────────────
  const dropDestinationLabel = useMemo(() => {
    if (isRootOver) return "Library";
    if (!dropIndicator) return null;
    const { overId, position } = dropIndicator;
    if (overId.startsWith("folder:")) {
      const folderId = overId.slice(7);
      const folder = flatFolders(folders).find((f) => f.id === folderId);
      if (!folder) return null;
      if (position === "into") return folder.name;
      if (folder.parentId) {
        return (
          flatFolders(folders).find((f) => f.id === folder.parentId)?.name ??
          "Library"
        );
      }
      return "Library";
    }
    if (overId.startsWith("note:")) {
      const noteId = overId.slice(5);
      const note = notes.find((n) => n.id === noteId);
      if (!note) return null;
      if (!note.folder) return "Library";
      return (
        flatFolders(folders).find((f) => f.id === note.folder)?.name ??
        "Library"
      );
    }
    return null;
  }, [dropIndicator, isRootOver, folders, notes]);

  // ── DnD handlers ───────────────────────────────────────────────────────────

  const handleDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as DragItemData;
    const label =
      data.type === "note"
        ? (notes.find((n) => n.id === data.id)?.title ?? "Note")
        : (flatFolders(folders).find((f) => f.id === data.id)?.name ??
          "Folder");
    setActiveItem({ type: data.type, label });
  };

  const handleDragOver = ({
    active,
    over,
    delta,
    activatorEvent,
  }: DragOverEvent) => {
    if (!over || over.id === "root") {
      updateDropIndicator(null);
      return;
    }

    const activeData = active.data.current as DragItemData;
    const overData = over.data.current as DragItemData;
    const overId = over.id as string;

    // Pointer Y = activation point + cumulative delta (both from @dnd-kit)
    const rect = over.rect;
    const pointerY = (activatorEvent as PointerEvent).clientY + delta.y;
    const ratio = (pointerY - rect.top) / rect.height;

    let position: DropPosition;

    if (overData.type === "folder") {
      if (activeData.type === "note") {
        position = "into";
      } else {
        // Wider edge zones (20 % / 80 %) keep "into" stable in the middle
        position = ratio < 0.20 ? "before" : ratio > 0.80 ? "after" : "into";
      }
    } else {
      position = ratio < 0.5 ? "before" : "after";
    }

    updateDropIndicator({ overId, position });

    // Auto-expand collapsed folder after 700 ms of hovering "into" it
    if (overData.type === "folder" && position === "into") {
      const folder = flatFolders(folders).find((f) => f.id === overData.id);
      if (folder && !folder.expanded && !expandTimerRef.current) {
        expandTimerRef.current = setTimeout(() => {
          useAppStore.getState().toggleFolder(overData.id);
          expandTimerRef.current = null;
        }, 700);
      }
    } else {
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    }
  };

  const clearExpandTimer = () => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveItem(null);
    clearExpandTimer();

    // Read from ref — guaranteed current even if state batching delayed the update
    const indicator = dropIndicatorRef.current;
    updateDropIndicator(null);

    if (!over) return;

    const activeData = active.data.current as DragItemData;

    // ── Drop on root — no indicator needed ─────────────────────────────────
    if (over.id === "root") {
      if (activeData.type === "note") {
        moveNotes([activeData.id], null);
      } else {
        moveFolder(activeData.id, null, null);
      }
      return;
    }

    if (!indicator) return;

    const overData = over.data.current as DragItemData;
    const { position } = indicator;

    // ── Note being dragged ──────────────────────────────────────────────────
    if (activeData.type === "note") {
      if (overData.type === "folder") {
        // Move note into folder
        if (overData.id !== activeData.folderId) {
          moveNotes([activeData.id], overData.id);
        }
      } else {
        // Reorder note relative to another note
        const targetNote = notes.find((n) => n.id === overData.id);
        if (!targetNote) return;
        const targetFolderId = targetNote.folder;

        if (position === "before") {
          reorderNote(activeData.id, targetFolderId, overData.id);
        } else {
          // Find the note after the target
          const siblings =
            targetFolderId === null
              ? notes.filter((n) => n.folder === null)
              : folders.reduce<Note[]>((acc, f) => {
                const found = findNotesInFolder(f, targetFolderId);
                return found ?? acc;
              }, []);
          const idx = siblings.findIndex((n) => n.id === overData.id);
          const insertBeforeId = siblings[idx + 1]?.id ?? null;
          reorderNote(activeData.id, targetFolderId, insertBeforeId);
        }
      }
      return;
    }

    // ── Folder being dragged ────────────────────────────────────────────────
    if (activeData.type === "folder") {
      if (activeData.id === overData.id) return;

      if (overData.type === "folder") {
        if (position === "into") {
          moveFolder(activeData.id, overData.id, null);
        } else if (position === "before") {
          const parentId =
            overData.type === "folder" ? overData.parentId : null;
          moveFolder(activeData.id, parentId, overData.id);
        } else {
          // after: insert after this folder in its parent
          const parentId =
            overData.type === "folder" ? overData.parentId : null;
          const siblings =
            parentId === null
              ? folders
              : (findFolderChildren(folders, parentId) ?? []);
          const idx = siblings.findIndex((f) => f.id === overData.id);
          const insertBeforeId = siblings[idx + 1]?.id ?? null;
          moveFolder(activeData.id, parentId, insertBeforeId);
        }
      }
    }
  };

  const handleDragCancel = () => {
    setActiveItem(null);
    updateDropIndicator(null);
    clearExpandTimer();
  };

  // ── Context menus ───────────────────────────────────────────────────────────

  const openFolderContextMenu = (e: React.MouseEvent, folder: FolderType) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "New note", onClick: () => createNote(folder.id) },
        { label: "Rename", onClick: () => startRename(folder.id) },
        {
          label: "Delete folder",
          destructive: true,
          onClick: () => confirmDeleteFolderItem(folder),
        },
      ],
    });
  };

  const openNoteContextMenu = (
    e: React.MouseEvent,
    noteId: string,
    noteTitle: string,
    external?: boolean,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Rename", onClick: () => startRename(noteId) },
        external
          ? {
            label: "Remove from library",
            onClick: () => confirmDeleteNote(noteId, noteTitle, true),
          }
          : {
            label: "Delete note",
            destructive: true,
            onClick: () => confirmDeleteNote(noteId, noteTitle),
          },
      ],
    });
  };

  const handleNewFolder = () => {
    openPrompt({
      title: selectedFolderId ? "New Subfolder" : "New Folder",
      placeholder: "Folder name",
      confirmLabel: "Create",
      onConfirm: (name) => createFolder(name, selectedFolderId),
    });
  };

  // Always creates at the library root — creating inside a specific folder is
  // done via that folder's right-click context menu ("New note").
  const handleNewNote = () => {
    createNote(null);
  };

  const pinnedOrderedIds = pinnedNotes.map((n) => n.id);
  const rootNoteOrderedIds = rootNotes.map((n) => n.id);
  const externalOrderedIds = externalNotes.map((n) => n.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div
        className={cn(
          "w-[224px] shrink-0 flex flex-col h-full overflow-hidden relative border-r border-border-strong",
          // backdrop-blur + semi-transparent bg = frosted glass against the macOS desktop
          sidebarGlass ? "backdrop-blur-2xl" : "bg-sidebar",
        )}
        style={sidebarGlass ? glassBg('sidebar', glassOpacity) : undefined}
      >
        <div className="h-8 shrink-0" data-tauri-drag-region />

        <div className="flex items-center justify-between px-3 pb-3.5">
          <span className="font-sans text-[17px] font-bold text-foreground tracking-tight">
            Inkwell
          </span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              onClick={handleNewFolder}
              title={selectedFolderId ? "New subfolder" : "New folder"}
            >
              <FolderPlus className="w-4 h-4" strokeWidth={2.25} />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              onClick={handleNewNote}
              title="New note"
            >
              <PenLine className="w-4 h-4" strokeWidth={2.25} />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
              onClick={() => openExternalNote()}
              title="Open file... (⌘O)"
            >
              <FileInput className="w-4 h-4" strokeWidth={2.25} />
            </button>
          </div>
        </div>

        <div className="px-3 pb-3.5">
          <button
            className="w-full flex items-center gap-2 h-8 px-2.5 bg-muted border border-border-strong rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:border-accent/40 transition-colors"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="w-3.5 h-3.5" strokeWidth={2.25} />
            <span className="flex-1 text-left">Search</span>
            <span className="text-[10px] font-semibold text-tertiary">⌘K</span>
          </button>
        </div>

        {selectedNoteIds.length > 1 && (
          <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/25 px-2 py-1.5">
            <span className="text-[11px] font-medium text-accent flex-1">
              {selectedNoteIds.length === 1
                ? "1 note"
                : `${selectedNoteIds.length} notes`}{" "}
              selected
            </span>
            <button
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors shrink-0"
              onClick={confirmDeleteSelectedNotes}
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 space-y-4">
          {pinnedNotes.length > 0 && (
            <div>
              <p className="uppercase text-[10.5px] font-semibold tracking-wider text-tertiary px-2 mb-1">
                Pinned
              </p>
              {pinnedNotes.map((note) => {
                const isNoteSelected = selectedNoteIds.includes(note.id);
                const noteId = `note:${note.id}`;
                return (
                  <NoteRow
                    key={note.id}
                    note={note}
                    isSelected={isNoteSelected}
                    orderedIds={pinnedOrderedIds}
                    paddingLeft={ROW_PADDING}
                    onContextMenu={(e) => openNoteContextMenu(e, note.id, note.title, note.external)}
                    dropBefore={dropIndicator?.overId === noteId && dropIndicator.position === "before"}
                    dropAfter={dropIndicator?.overId === noteId && dropIndicator.position === "after"}
                    onDelete={() => confirmDeleteNote(note.id, note.title, note.external)}
                    renamingId={renamingId}
                    onStartRename={startRename}
                    onCommitRename={commitRename}
                    onCancelRename={cancelRename}
                  />
                );
              })}
            </div>
          )}

          <div>
            {/* Library heading — click to deselect folder, DnD root drop zone */}
            <div
              ref={setRootRef}
              className={cn(
                "flex items-center px-2 py-1 mb-1 rounded-md transition-colors cursor-pointer select-none",
                selectedFolderId === null && !isRootOver && "bg-surface",
                isRootOver && "bg-accent/15 ring-2 ring-accent/50",
              )}
              onClick={clearFolderSelection}
            >
              <p
                className={cn(
                  "uppercase text-[10.5px] font-semibold tracking-wider flex-1",
                  selectedFolderId === null
                    ? "text-foreground"
                    : "text-tertiary",
                )}
              >
                Library
              </p>
              {isRootOver && (
                <span className="text-[9px] text-accent font-medium">
                  drop here
                </span>
              )}
            </div>

            {/* Root (unfiled) notes */}
            {rootNotes.map((note) => {
              const isNoteSelected = selectedNoteIds.includes(note.id);
              const noteId = `note:${note.id}`;
              return (
                <NoteRow
                  key={note.id}
                  note={note}
                  isSelected={isNoteSelected}
                  orderedIds={rootNoteOrderedIds}
                  paddingLeft={ROW_PADDING}
                  onContextMenu={(e) => openNoteContextMenu(e, note.id, note.title)}
                  dropBefore={dropIndicator?.overId === noteId && dropIndicator.position === "before"}
                  dropAfter={dropIndicator?.overId === noteId && dropIndicator.position === "after"}
                  onDelete={() => confirmDeleteNote(note.id, note.title)}
                  renamingId={renamingId}
                  onStartRename={startRename}
                  onCommitRename={commitRename}
                  onCancelRename={cancelRename}
                />
              );
            })}

            {/* Folders */}
            {folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                siblingFolderIds={rootFolderIds}
                onFolderContextMenu={openFolderContextMenu}
                onNoteContextMenu={openNoteContextMenu}
                dropIndicator={dropIndicator}
                renamingId={renamingId}
                onStartRename={startRename}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
              />
            ))}

            {folders.length === 0 && rootNotes.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                No notes yet
              </p>
            )}
          </div>

          {externalNotes.length > 0 && (
            <div>
              <p className="uppercase text-[10.5px] font-semibold tracking-wider text-tertiary px-2 mb-1">
                Open Files
              </p>
              {externalNotes.map((note) => {
                const isNoteSelected = selectedNoteIds.includes(note.id);
                return (
                  <NoteRow
                    key={note.id}
                    note={note}
                    isSelected={isNoteSelected}
                    orderedIds={externalOrderedIds}
                    paddingLeft={ROW_PADDING}
                    onContextMenu={(e) => openNoteContextMenu(e, note.id, note.title, true)}
                    dropBefore={false}
                    dropAfter={false}
                    onDelete={() => confirmDeleteNote(note.id, note.title, true)}
                    renamingId={renamingId}
                    onStartRename={startRename}
                    onCommitRename={commitRename}
                    onCancelRename={cancelRename}
                  />
                );
              })}
            </div>
          )}

          <div>
            <p className="uppercase text-[10.5px] font-semibold tracking-wider text-tertiary px-2 mb-1">
              Quick Access
            </p>
            <div
              className={cn(
                treeRowClass,
                "px-2 cursor-pointer hover:bg-surface",
                activeView === "board" && "bg-active",
              )}
              onClick={() => setActiveView("board")}
            >
              <LayoutGrid
                className={cn(
                  "w-3.5 h-3.5",
                  activeView === "board"
                    ? "text-accent"
                    : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  activeView === "board"
                    ? "text-accent font-medium"
                    : "text-foreground",
                )}
              >
                Board
              </span>
            </div>

            {canvasEnabled && (
              <div
                className={cn(
                  treeRowClass,
                  "px-2 cursor-pointer hover:bg-surface",
                  activeView === "canvas" && "bg-active",
                )}
                onClick={() => setActiveView("canvas")}
              >
                <PenSquare
                  className={cn(
                    "w-3.5 h-3.5",
                    activeView === "canvas"
                      ? "text-accent"
                      : "text-muted-foreground",
                  )}
                />
                <span
                  className={cn(
                    activeView === "canvas"
                      ? "text-accent font-medium"
                      : "text-foreground",
                  )}
                >
                  Draw
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Update notice — quiet, dismissible, never a modal */}
        {updateInfo && (
          <div className="px-2 pt-2">
            <button
              onClick={() => { if (updateInstallState !== 'installing') installUpdate() }}
              disabled={updateInstallState === 'installing'}
              title={
                updateInstallState === 'installing'
                  ? 'Downloading and installing — the app will restart automatically'
                  : `Install version ${updateInfo.version}`
              }
              className="w-full flex items-center gap-2 rounded-md bg-accent/10 border border-accent/20 px-2 py-3 -mt-14 hover:bg-accent/15 transition-colors disabled:opacity-70 disabled:cursor-default"
            >
              <ArrowUpCircle className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="flex-1 text-left text-[11px] font-medium text-accent truncate">
                {updateInstallState === 'installing'
                  ? 'Installing update…'
                  : updateInstallState === 'error'
                    ? 'Update failed — click to retry'
                    : `Update available · v${updateInfo.version}`}
              </span>
              {/* <button
                onClick={dismissUpdateNotice}
                title="Dismiss until the next update"
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                </button> */}
              <ArrowRight className="w-4 h-4 text-accent shrink-0" />
            </button>
          </div>
        )}

        {/* Settings button */}
        <div className={cn("px-2 py-2 border-t border-border", !updateInfo && "mt-auto")}>
          <SettingsDialog />
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}

      </div>

      {/* Drag overlay — looks like the actual row + destination badge */}
      <DragOverlay dropAnimation={{ duration: 120, easing: "ease-out" }}>
        {activeItem && (
          <div className="flex flex-col gap-1 pointer-events-none w-[196px]">
            {/* Row preview */}
            <div
              className={cn(
                treeRowClass,
                "px-2 bg-sidebar border border-border/70 shadow-lg shadow-black/25 rounded-md",
              )}
            >
              {activeItem.type === "note" ? (
                <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
              ) : (
                <>
                  <span className="w-4 h-4 flex items-center justify-center shrink-0">
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </span>
                  <Folder className="w-3.5 h-3.5 text-accent shrink-0" />
                </>
              )}
              <span className="truncate text-foreground">
                {activeItem.label}
              </span>
            </div>
            {/* Destination badge */}
            {dropDestinationLabel && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-accent text-[10px] font-medium rounded-md mx-1 w-fit">
                <span className="opacity-70">→</span>
                <span className="truncate max-w-[140px]">
                  {dropDestinationLabel}
                </span>
              </div>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findNotesInFolder(
  folder: FolderType,
  folderId: string,
): Note[] | null {
  if (folder.id === folderId) return folder.notes;
  for (const child of folder.children) {
    const found = findNotesInFolder(child, folderId);
    if (found) return found;
  }
  return null;
}

function findFolderChildren(
  folders: FolderType[],
  parentId: string,
): FolderType[] | null {
  for (const f of folders) {
    if (f.id === parentId) return f.children;
    const found = findFolderChildren(f.children, parentId);
    if (found) return found;
  }
  return null;
}

function flatFolders(folders: FolderType[]): FolderType[] {
  return folders.flatMap((f) => [f, ...flatFolders(f.children)]);
}
