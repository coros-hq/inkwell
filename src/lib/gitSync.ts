/**
 * gitSync.ts — git CLI wrapper for whole-vault sync.
 *
 * All auth is delegated to the user's system git (SSH agent / credential
 * helper) — inkwell never stores a token for this feature. The shell
 * permission is scoped to the `git` binary only (see
 * src-tauri/capabilities/default.json), and every call here uses array-form
 * args, never a shell string, so there's no interpolation surface.
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export class GitNotInstalledError extends Error {
  constructor() {
    super('git is not installed, or not on PATH.')
    this.name = 'GitNotInstalledError'
  }
}

export class GitCommandError extends Error {
  constructor(public readonly args: string[], public readonly code: number | null, public readonly stderr: string) {
    super(`git ${args.join(' ')} failed (${code}): ${stderr.trim() || 'unknown error'}`)
    this.name = 'GitCommandError'
  }
}

interface GitResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Turn whatever a rejected promise handed us into a readable string — Tauri's
 *  IPC layer can reject with a plain string, an Error, or (for a denied/
 *  unregistered command) an empty/null payload that would otherwise print as
 *  the unhelpful literal "null". */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string' && e.trim()) return e
  if (e == null) {
    return 'No response from the shell plugin. This usually means the app needs a full restart — ' +
      'capability changes (like git execute permission) are only picked up when the Tauri process starts, not on a page reload.'
  }
  try { return JSON.stringify(e) } catch { return String(e) }
}

async function runGit(vaultPath: string, args: string[]): Promise<GitResult> {
  if (!isTauri) throw new GitNotInstalledError()
  let Command
  try {
    ;({ Command } = await import('@tauri-apps/plugin-shell'))
  } catch (e) {
    throw new Error(`Failed to load the shell plugin: ${describeError(e)}`)
  }
  let output
  try {
    output = await Command.create('git', args, { cwd: vaultPath }).execute()
  } catch (e) {
    const message = describeError(e)
    console.error(`[inkwell:git] git ${args.join(' ')} — spawn failed:`, message)
    // A genuinely missing binary surfaces as an OS-level "not found" message;
    // anything else (permission denial, IPC failure, etc.) should say so
    // rather than being misreported as "git not installed".
    if (/no such file|not found|enoent/i.test(message)) {
      throw new GitNotInstalledError()
    }
    throw new Error(`git ${args.join(' ')} could not run: ${message}`)
  }
  console.log(
    `[inkwell:git] git ${args.join(' ')} — exit ${output.code}` +
    (output.stdout.trim() ? `\n  stdout: ${output.stdout.trim().slice(0, 400)}` : '') +
    (output.stderr.trim() ? `\n  stderr: ${output.stderr.trim().slice(0, 400)}` : ''),
  )
  return { code: output.code, stdout: output.stdout, stderr: output.stderr }
}

async function git(vaultPath: string, args: string[]): Promise<string> {
  const result = await runGit(vaultPath, args)
  if (result.code !== 0) {
    // exit code 127 (or a null code with "not found" in stderr) means the
    // binary itself is missing, not that the git command failed logically.
    if (result.code === 127 || /command not found|no such file/i.test(result.stderr)) {
      throw new GitNotInstalledError()
    }
    throw new GitCommandError(args, result.code, result.stderr)
  }
  return result.stdout
}

export async function isGitRepo(vaultPath: string): Promise<boolean> {
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    return await exists(`${vaultPath}/.git`)
  } catch {
    return false
  }
}

const DEFAULT_GITIGNORE = `# Written by inkwell — OS cruft only; .inkwell/app.json IS tracked.
.DS_Store
Thumbs.db
`

export async function writeDefaultGitignore(vaultPath: string): Promise<void> {
  const { writeTextFile, exists } = await import('@tauri-apps/plugin-fs')
  const path = `${vaultPath}/.gitignore`
  if (await exists(path)) return
  await writeTextFile(path, DEFAULT_GITIGNORE)
}

export async function gitInit(vaultPath: string): Promise<void> {
  await git(vaultPath, ['init'])
  await writeDefaultGitignore(vaultPath)
}

/**
 * Add or update the `origin` remote — safe to call any time, independent of
 * `gitInit`, so a missing/wrong remote can be fixed on an already-initialized
 * repo (init only runs once; without this, a repo that somehow ended up
 * without a remote would never get one).
 */
export async function setGitRemote(vaultPath: string, remoteUrl: string): Promise<void> {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return
  const existing = await gitRemoteUrl(vaultPath)
  if (existing) {
    if (existing !== trimmed) await git(vaultPath, ['remote', 'set-url', 'origin', trimmed])
  } else {
    await git(vaultPath, ['remote', 'add', 'origin', trimmed])
  }
}

/** Porcelain status lines — empty string means a clean working tree. */
export async function gitStatus(vaultPath: string): Promise<string> {
  return git(vaultPath, ['status', '--porcelain'])
}

export async function gitAddAll(vaultPath: string): Promise<void> {
  await git(vaultPath, ['add', '-A'])
}

export async function gitCommit(vaultPath: string, message: string): Promise<void> {
  await git(vaultPath, ['commit', '-m', message])
}

/**
 * True if `branch` exists on `origin`. Distinguishes "remote reachable, branch
 * just doesn't exist yet" (exit 2 — the normal case for a brand-new repo, or
 * before the first push) from a real failure (bad URL, auth, network).
 */
export async function gitHasRemoteBranch(vaultPath: string, branch: string): Promise<boolean> {
  const args = ['ls-remote', '--exit-code', '--heads', 'origin', branch]
  const result = await runGit(vaultPath, args)
  if (result.code === 0) return true
  if (result.code === 2) return false
  if (result.code === 127 || /command not found|no such file/i.test(result.stderr)) {
    throw new GitNotInstalledError()
  }
  throw new GitCommandError(args, result.code, result.stderr)
}

/**
 * True if the pull left unresolved conflict markers (caller should stop and
 * surface this). Always targets `origin/<branch>` explicitly — plain `git
 * pull` with no args fails on a fresh clone/remote because no upstream
 * tracking branch is configured yet (we never run `git branch --set-upstream`).
 */
export async function gitPull(vaultPath: string, branch: string): Promise<{ conflict: boolean }> {
  const args = ['pull', '--no-rebase', 'origin', branch]
  const result = await runGit(vaultPath, args)
  if (result.code === 0) return { conflict: false }
  if (result.code === 127 || /command not found|no such file/i.test(result.stderr)) {
    throw new GitNotInstalledError()
  }
  // A merge conflict is a normal, expected failure mode of `pull` — surface it
  // as a status rather than throwing, so callers can show a conflict banner
  // instead of a raw error.
  const conflictStatus = await gitStatus(vaultPath).catch(() => '')
  if (/^(UU|AA|DD|AU|UA|UD|DU) /m.test(conflictStatus)) {
    return { conflict: true }
  }
  throw new GitCommandError(args, result.code, result.stderr)
}

/** `-u` sets/refreshes the upstream tracking branch — safe to pass every time. */
export async function gitPush(vaultPath: string, branch: string): Promise<void> {
  await git(vaultPath, ['push', '-u', 'origin', branch])
}

export async function gitRemoteUrl(vaultPath: string): Promise<string | null> {
  try {
    const out = await git(vaultPath, ['remote', 'get-url', 'origin'])
    return out.trim() || null
  } catch (e) {
    // Expected (not an error) when no remote is configured yet — but log it
    // so a genuine failure here doesn't look identical to "no remote set".
    console.log('[inkwell:git] no origin remote:', describeError(e))
    return null
  }
}

/** Null before the first commit — a fresh `git init` has no branch until then. */
export async function gitCurrentBranch(vaultPath: string): Promise<string | null> {
  try {
    const out = await git(vaultPath, ['branch', '--show-current'])
    return out.trim() || null
  } catch {
    return null
  }
}
