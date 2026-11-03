import { useAppStore } from "../store/useAppStore";
import type { Folder } from "../types";

/** Opens the "New Folder" prompt with an explicit destination picker, so the
 *  sidebar button and the keyboard shortcut behave identically. */
export function openNewFolderPrompt() {
  const { folders, selectedFolderId, openPrompt, createFolder } =
    useAppStore.getState();

  const flatten = (
    list: Folder[],
    depth: number,
  ): { id: string | null; label: string }[] =>
    list.flatMap((f) => [
      { id: f.id, label: `${"  ".repeat(depth)}${f.name}` },
      ...flatten(f.children, depth + 1),
    ]);

  openPrompt({
    title: "New Folder",
    placeholder: "Folder name",
    confirmLabel: "Create",
    destinations: [{ id: null, label: "Library (root)" }, ...flatten(folders, 0)],
    initialDestinationId: selectedFolderId ?? null,
    onConfirm: (name, destinationId) => createFolder(name, destinationId ?? null),
  });
}
