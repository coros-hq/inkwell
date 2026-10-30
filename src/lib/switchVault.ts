import { readVaultFS, addRecentVault, writeBoardsFile } from './vault'
import { stopVaultSync } from './sync/vaultSession'
import { useAppStore } from '../store/useAppStore'

/**
 * Switches the app to the vault at `path`. `empty` skips reading the folder so
 * a new vault is seeded with the welcome note. Throws if the folder can't be read.
 */
export async function switchVault(path: string, empty = false): Promise<void> {
  // Flush the current vault's boards to disk BEFORE reading the new vault
  const { vaultPath: currentPath, boards, boardColumns, boardTasks, openVault } = useAppStore.getState()
  if (currentPath && currentPath !== path) {
    await writeBoardsFile(currentPath, { version: 1, boards, boardColumns, boardTasks })
    await stopVaultSync()
  }
  const data = empty ? null : await readVaultFS(path)
  addRecentVault(path)
  openVault(path, data) // AppShell starts syncing it if it's a shared vault
}
