/**
 * Injected into the page before the app loads. Replaces the Tauri IPC bridge
 * (`window.__TAURI_INTERNALS__`) with an in-memory filesystem, so the real
 * frontend can run in plain Chromium with no Rust backend.
 *
 * Exposes `window.__e2e` so tests can read/write the fake disk directly.
 */
export interface MockOptions {
  vaultPath: string
  /** Absolute path -> file contents. Parent directories are created implicitly. */
  files: Record<string, string>
  /** Pretend to be this OS (navigator.platform), e.g. 'Win32' to exercise the custom titlebar. */
  platform?: string
  /** Pretend this is the portable build, keeping its data in this folder. */
  portableRoot?: string
  /** Start with the vault already open (default). Pass false to land on the vault picker. */
  openVault?: boolean
}

export function installTauriMock({ vaultPath, files, platform, portableRoot, openVault = true }: MockOptions): void {
  if (platform) Object.defineProperty(navigator, 'platform', { get: () => platform })
  const windowCalls: string[] = []
  let maximized = false
  let dialogPath: string | null = null
  type Node = { dir: true } | { dir: false; data: Uint8Array }
  const fs = new Map<string, Node>()
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
  const mkdirp = (p: string) => {
    p = norm(p)
    while (p && p !== '/' && !fs.has(p)) {
      fs.set(p, { dir: true })
      p = parentOf(p)
    }
  }
  const writeFile = (p: string, data: Uint8Array) => {
    p = norm(p)
    mkdirp(parentOf(p))
    fs.set(p, { dir: false, data })
  }
  const children = (dir: string) => {
    dir = norm(dir)
    const prefix = dir === '/' ? '/' : dir + '/'
    return [...fs.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && k !== dir)
  }
  const missing = (p: string) => new Error(`No such file or directory (os error 2): ${p}`)

  mkdirp(vaultPath)
  for (const [path, content] of Object.entries(files)) writeFile(path, enc.encode(content))

  const info = (n: Node) => ({
    isFile: !n.dir, isDirectory: n.dir, isSymlink: false,
    size: n.dir ? 0 : n.data.length,
    mtime: Date.now(), atime: Date.now(), birthtime: Date.now(),
    readonly: false, fileAttributes: null, dev: 0, ino: 0, mode: 0o644, nlink: 1, uid: 0, gid: 0, rdev: 0, blksize: 0, blocks: 0,
  })
  const headerPath = (opts: { headers?: Record<string, string> } | undefined) =>
    decodeURIComponent(opts?.headers?.path ?? '')

  let nextRid = 1
  const callbacks = new Map<number, (v: unknown) => void>()

  // ── Two-window emulation ────────────────────────────────────────────────────
  // The Settings window is a second page in the same browser context (opened with
  // window.open). Tauri events travel between pages over a BroadcastChannel, and the
  // settings page forwards its file-system / dialog calls to the main page, which owns the
  // in-memory disk — mirroring how the real second window shares the machine's disk.
  // Resolved lazily: a window.open() popup can reuse its initial blank window object when it
  // navigates, so the init script may run before `location` has its final URL.
  const isSettings = () => new URLSearchParams(location.search).has('settings')
  const label = () => (isSettings() ? 'settings' : 'main')
  const events = new BroadcastChannel('e2e-events')
  const rpc = new BroadcastChannel('e2e-rpc')
  const listeners = new Map<number, { event: string; handler: number }>() // eventId -> listener
  const deliver = (event: string, payload: unknown, target: string | null) => {
    if (target && target !== label()) return
    for (const [eventId, l] of listeners) {
      if (l.event === event) callbacks.get(l.handler)?.({ event, id: eventId, payload })
    }
  }
  events.onmessage = (m) => deliver(m.data.event, m.data.payload, m.data.target)
  let settingsPopup: Window | null = null
  let rpcSeq = 0
  const rpcPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const FORWARDED = /^plugin:(fs|dialog)\|/

  const handlers: Record<string, (args: any, opts?: any) => unknown> = {
    'plugin:fs|read_dir': ({ path }) => {
      if (!fs.get(norm(path))) throw missing(path)
      return children(path).map((k) => ({
        name: k.slice(k.lastIndexOf('/') + 1),
        isDirectory: fs.get(k)!.dir,
        isFile: !fs.get(k)!.dir,
        isSymlink: false,
      }))
    },
    'plugin:fs|read_text_file': ({ path }) => {
      const n = fs.get(norm(path))
      if (!n || n.dir) throw missing(path)
      return Array.from(n.data)
    },
    'plugin:fs|read_file': ({ path }) => {
      const n = fs.get(norm(path))
      if (!n || n.dir) throw missing(path)
      return Array.from(n.data)
    },
    'plugin:fs|write_text_file': (body, opts) => writeFile(headerPath(opts), new Uint8Array(body as ArrayBuffer)),
    'plugin:fs|write_file': (body, opts) => writeFile(headerPath(opts), new Uint8Array(body as ArrayBuffer)),
    'plugin:fs|exists': ({ path }) => fs.has(norm(path)),
    'plugin:fs|stat': ({ path }) => {
      const n = fs.get(norm(path))
      if (!n) throw missing(path)
      return info(n)
    },
    'plugin:fs|lstat': (a) => handlers['plugin:fs|stat'](a),
    'plugin:fs|mkdir': ({ path }) => mkdirp(path),
    'plugin:fs|remove': ({ path }) => {
      path = norm(path)
      if (!fs.has(path)) throw missing(path)
      for (const k of [...fs.keys()]) if (k === path || k.startsWith(path + '/')) fs.delete(k)
    },
    'plugin:fs|rename': ({ oldPath, newPath }) => {
      oldPath = norm(oldPath); newPath = norm(newPath)
      if (!fs.has(oldPath)) throw missing(oldPath)
      mkdirp(parentOf(newPath))
      for (const k of [...fs.keys()]) {
        if (k === oldPath || k.startsWith(oldPath + '/')) {
          fs.set(newPath + k.slice(oldPath.length), fs.get(k)!)
          fs.delete(k)
        }
      }
    },
    'plugin:fs|copy_file': ({ fromPath, toPath }) => {
      const n = fs.get(norm(fromPath))
      if (!n || n.dir) throw missing(fromPath)
      writeFile(toPath, n.data.slice())
    },
    'plugin:fs|watch': () => nextRid++,
    'plugin:fs|unwatch': () => null,
    'plugin:resources|close': () => null,
    'plugin:event|listen': ({ event, handler }) => {
      const eventId = nextRid++
      listeners.set(eventId, { event, handler })
      return eventId
    },
    'plugin:event|unlisten': ({ eventId }) => { listeners.delete(eventId); return null },
    'plugin:event|emit': ({ event, payload }) => {
      events.postMessage({ event, payload, target: null })
      deliver(event, payload, null)
      return null
    },
    'plugin:event|emit_to': ({ target, event, payload }) => {
      const to = typeof target === 'string' ? target : target?.label
      events.postMessage({ event, payload, target: to })
      deliver(event, payload, to)
      return null
    },
    open_settings_window: () => {
      if (settingsPopup && !settingsPopup.closed) settingsPopup.focus()
      else settingsPopup = window.open(`${location.origin}/?settings=1`, 'inkwell-settings')
      return null
    },
    'plugin:path|resolve_directory': () => '/home/e2e/Documents',
    'plugin:path|join': ({ paths }) => (paths as string[]).join('/').replace(/\/+/g, '/'),
    'plugin:path|resolve': ({ paths }) => (paths as string[]).join('/').replace(/\/+/g, '/'),
    'plugin:window|is_maximized': () => maximized,
    'plugin:window|minimize': () => windowCalls.push('minimize'),
    'plugin:window|toggle_maximize': () => { maximized = !maximized; windowCalls.push('toggle_maximize') },
    'plugin:window|close': () => {
      windowCalls.push('close')
      if (isSettings()) window.close()
    },
    'plugin:dialog|open': () => dialogPath,
    data_root_path: () => portableRoot ?? null,
    'plugin:app|version': () => '0.0.0-e2e',
    'plugin:updater|check': () => null,
    claude_mcp_status: () => ({ enabled: false }),
    is_portable: () => false,
    list_system_fonts: () => ['Zapfino Test'],
  }

  {
    rpc.onmessage = async (m) => {
      const { id, cmd, args, opts, reply, ok, result, error } = m.data
      if (reply) {
        // An answer to a call this (settings) page forwarded.
        const p = rpcPending.get(id)
        if (!p) return
        rpcPending.delete(id)
        ok ? p.resolve(result) : p.reject(new Error(error))
        return
      }
      // A call forwarded from the settings page — only the main page owns the disk.
      if (isSettings()) return
      try {
        const h = handlers[cmd]
        rpc.postMessage({ id, reply: true, ok: true, result: h ? await h(args, opts) : null })
      } catch (e) {
        rpc.postMessage({ id, reply: true, ok: false, error: (e as Error).message })
      }
    }
  }

  ;(window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: unknown, opts: unknown) => {
      if (isSettings() && FORWARDED.test(cmd)) {
        return new Promise((resolve, reject) => {
          const id = ++rpcSeq
          rpcPending.set(id, { resolve, reject })
          rpc.postMessage({ id, cmd, args, opts })
        })
      }
      const h = handlers[cmd]
      return h ? h(args, opts) : null
    },
    transformCallback: (cb: (v: unknown) => void) => {
      const id = nextRid++
      callbacks.set(id, cb)
      return id
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    convertFileSrc: (p: string) => p,
    metadata: {
      get currentWindow() { return { label: label() } },
      get currentWebview() { return { windowLabel: label(), label: label() } },
    },
  }
  ;(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }

  try {
    if (openVault) localStorage.setItem('inkwell-last-vault', vaultPath)
    localStorage.setItem('inkwell-updates-disabled', 'true')
  } catch { /* storage unavailable */ }

  ;(window as any).__e2e = {
    read: (p: string) => {
      const n = fs.get(norm(p))
      return n && !n.dir ? dec.decode(n.data) : null
    },
    exists: (p: string) => fs.has(norm(p)),
    bytes: (p: string) => { const n = fs.get(norm(p)); return n && !n.dir ? Array.from(n.data) : null },
    list: (dir: string) => children(dir).map((k) => k.slice(k.lastIndexOf('/') + 1)),
    windowCalls: () => windowCalls.slice(),
    setDialogPath: (p: string | null) => { dialogPath = p },
    write: (p: string, s: string) => writeFile(p, enc.encode(s)),
  }
}
