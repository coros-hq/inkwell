<div align="center">
  <img src="src/assets/inkwell-icon.svg" width="100" height="100" alt="inkwell logo" />

  <h1>inkwell</h1>
  <p>A focused, beautiful markdown note-taking app for macOS.</p>

  ![Version](https://img.shields.io/badge/version-0.7.8-orange?style=flat-square)
  ![Platform](https://img.shields.io/badge/platform-macOS-black?style=flat-square)
  ![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square&color=c47d2e)
</div>

---

## Overview

inkwell is a local-first markdown editor built as a native macOS desktop app. Notes are stored as plain `.md` files in a vault folder you own — no cloud, no accounts, no lock-in.

It pairs a distraction-free writing environment with a rich live preview, a Kanban board, a canvas drawing tool, a suite of themes, and deep integrations: a native MCP server so Claude can read and write your notes, and built-in GitHub sync to push your docs to any repository.

---

## Features

**Writing**
- Distraction-free CodeMirror 6 editor with markdown syntax decoration
- Live split-view preview with full GFM rendering (tables, task lists, strikethrough)
- Syntax-highlighted code blocks that adapt to the active theme
- LaTeX math via KaTeX *(new in v0.7.8)* — inline `$…$`, display `$$…$$`, and fenced ` ```math ` / ` ```latex ` blocks, rendered live in the editor and preview
- Inline code, blockquotes, ==highlights==, and embedded images
- Attach files to any note — images, PDFs, and documents stored alongside your vault
- Embed attachments inline with `![[filename]]` syntax

**Organisation**
- Vault-based storage — notes live as real `.md` files on disk (Obsidian-compatible)
- Nested folders that map 1:1 to real filesystem directories
- Create a folder anywhere — the New Folder dialog lets you pick its parent (or the library root)
- Inline rename of notes and folders directly in the sidebar (double-click or right-click → Rename)
- Drag-and-drop to reorder, nest, and un-nest notes and folders — the drop target follows the cursor, and moving a folder relocates its whole subtree on disk
- YAML frontmatter on every note (`id`, `created`, `updated`, `pinned`, `tags`)
- Automatic migration from legacy JSON storage on first open
- Kanban board view with columns, cards, due dates, subtasks, and comments
- Note links panel — link notes to each other and track references
- Full-text search across all notes (⌘K)
- Pinned notes and trash with soft-delete

**Canvas** *(new in v0.4)*
- Custom HTML5 canvas drawing engine — no third-party drawing libraries
- Tools: select, pen, rectangle, ellipse, line, arrow, text
- Shape styling: 12-colour palette, fill toggle, three stroke widths, corner radius, font family/size/bold/italic
- Multi-selection with rubber-band lasso, shift-click toggle, ⌘A select all
- Resize handles on selected shapes, drag-move single and multi-selection
- Duplicate (⌘D), undo/redo (⌘Z / ⌘⇧Z), zoom and pan (scroll or pinch)
- Diagram notes — a slide-in half-panel with a full CodeMirror markdown editor and Edit/Preview tabs, saved to `{vault}/.inkwell/canvas-notes.md`
- Diagram templates — Flowchart and Mind Map starters with one click
- Canvas state auto-saved to `{vault}/.inkwell/canvas.json`

**Themes**
- 8 built-in themes: Midnight, Parchment, Ink, Dusk, Forest, Sepia, Gruvbox, Fog
- Custom theme builder with live preview
- Syntax highlight colours automatically follow the active theme

**Export & Share**
- Export notes as Markdown, standalone HTML, or PDF
- Rendered math and code highlighting carried into HTML/PDF exports
- Live preview before exporting
- One-click copy to clipboard

**GitHub Sync** *(new in v0.3)*
- Connect your GitHub account once in Settings → GitHub
- Push any note directly to a repository as a `.md` file
- Pull the latest version of a file back into inkwell with one click
- Works with any repo — great for keeping project READMEs and docs in sync

**Claude MCP Integration** *(new in v0.3)*
- A native Rust MCP server ships inside the app (`inkwell-mcp`)
- Exposes `list_notes`, `read_note`, `create_note`, `update_note`, `search_notes`, `get_vault_info` tools
- Claude can read, write, and search your vault directly — no copy-paste
- Notes written by Claude land as proper `.md` files with YAML frontmatter

**macOS**
- Native window with overlay title bar
- Optional frosted-glass sidebar (Settings → Appearance → Glass sidebar)
- Smooth scrolling, native vibrancy, system font stack

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri v2](https://tauri.app) (Rust) |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS v3 |
| Editor | CodeMirror 6 |
| Canvas | HTML5 Canvas 2D API (custom engine) |
| State | Zustand |
| Markdown | react-markdown + remark-gfm + rehype-highlight + remark-math / rehype-katex (KaTeX) |
| Drag & drop | @dnd-kit/core |
| MCP server | Rust (stdio JSON-RPC 2.0) |
| Build | Vite |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [pnpm](https://pnpm.io)
- [Rust](https://rustup.rs) (stable toolchain)
- Xcode Command Line Tools (`xcode-select --install`)

### Development

```bash
# Clone and install dependencies
git clone https://github.com/your-username/inkwell.git
cd inkwell
pnpm install

# Start the dev server (hot-reload on frontend changes, recompile on Rust changes)
pnpm tauri dev
```

### Build for production

```bash
pnpm tauri build
```

The output `.app` and `.dmg` are written to `src-tauri/target/release/bundle/macos/`.

To update an existing installation, drag the new `.app` onto the old one in `/Applications` and click **Replace**.

### Build the MCP server

```bash
cd src-tauri
cargo build --release -p inkwell-mcp
```

Then add it to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "inkwell": {
      "command": "/path/to/inkwell-mcp"
    }
  }
}
```

The MCP server reads the active vault path from `~/.inkwell/active-vault`, which inkwell writes automatically when you open a vault.

---

## Project Structure

```
inkwell/
├── src/
│   ├── components/
│   │   ├── editor/       # MarkdownEditor, RichPreview, AttachmentsBar, MediaPanel, ShareDialog
│   │   ├── layout/       # AppShell, Sidebar, NoteList, EditorPane
│   │   ├── board/        # Kanban BoardView, KanbanColumn, TaskCard, TaskDrawer
│   │   ├── canvas/       # CanvasView, CanvasToolbar, CanvasNotesSheet, canvasTypes, canvasTemplates
│   │   ├── settings/     # SettingsDialog, ThemeEditor
│   │   └── shared/       # Search, ContextMenu, DatePicker, GitHubSyncDialog, VaultPicker
│   ├── store/            # Zustand store (useAppStore)
│   ├── lib/              # vault.ts, github.ts, export.ts, themes, attachments, utils
│   ├── styles/           # globals.css — CSS variables & theme definitions
│   └── types/            # TypeScript interfaces
└── src-tauri/
    ├── src/lib.rs         # Tauri commands (vibrancy, file rename, etc.)
    ├── mcp-server/        # inkwell-mcp — Rust MCP server for Claude
    └── tauri.conf.json    # Window config, permissions
```

---

## License

MIT
