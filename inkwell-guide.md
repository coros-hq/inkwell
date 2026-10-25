# Inkwell Guide: Tips, Guidance & What's New ✒️

A living note. Keep it in your vault, and update the **What's new** and **Roadmap** sections as the app evolves.

> Everything you write is a plain `.md` file in your vault folder. No lock-in, so open it anywhere.

---

## 1. Start here (5 minutes)

- [ ] Pick a **theme** in Settings (bottom of the sidebar). There are 14 built-in themes, plus a custom theme editor.
- [ ] Create your first **folder** and drag a note into it.
- [ ] Press `⌘K` and search for something.
- [ ] Type `/` in a note and try a few commands.
- [ ] Create a **tag**, then tag a folder with it.

---

## 2. Shortcuts worth memorizing

| Action | macOS | Windows / Linux |
|---|---|---|
| Search everything | `⌘K` | `Ctrl+K` |
| Toggle sidebar | `⌘B` | `Ctrl+B` |
| Find inside the current note | `⌘F` | `Ctrl+F` |
| Open a standalone `.md` file | `⌘O` | `Ctrl+O` |
| New note (library root) | `⌘⇧N` | `Ctrl+Shift+N` |
| New folder (inside selected folder) | `⌘⇧F` | `Ctrl+Shift+F` |
| Quick-note capture popup (works even when Inkwell is unfocused) | `⌘N` | `Ctrl+N` |

All of these except quick capture can be rebound in **Settings → Shortcuts**.

---

## 3. The `/` command menu

Type `/` anywhere in a note:

| Command | Inserts |
|---|---|
| `/heading1` `/heading2` `/heading3` | Headings |
| `/bullet` `/numbered` `/todo` | Lists and checkboxes |
| `/quote` `/code` `/divider` | Blockquote, code block, rule |
| `/table` | Notion-style data table |
| `/mdtable` | Plain Markdown table |
| `/tabs` | Tab group, each tab with its own content |
| `/chart` | Bar, line, pie and more |
| `/video` | YouTube, Vimeo or Loom embed |
| `/board` `/task` | Embed a kanban board or link a task |
| `/brainstorm` | Embed a brainstorm outline (if Brainstorm is enabled) |
| `/highlight` `/bold` `/italic` | Inline formatting |

**Tip:** type `@` to link to another note.

---

## 4. Organize without friction

**Folders**
- Drag and drop to restructure anytime.
- The folder tree has a capped height, so it never pushes the rest of the sidebar away.

**Tags (folders)**
1. Press **+** in the Tags section and give the tag a name and a color.
2. Select a folder, or `⌘`/`Ctrl`-click several, then pick a tag. You can also use the folder's right-click menu.
3. Click a tag in the sidebar to filter by it.
4. Enable **group by tag** on a folder to see its contents clustered by tag.
5. Search `#tagname` in `⌘K` to jump straight to tagged folders.

**Rule of thumb:** use *folders* for where things live and *tags* for what they are about (for example `#client`, `#archive`, `#ideas`).

---

## 5. Pick the right tool

| I want to... | Use |
|---|---|
| Write and link notes | **Notes** (Edit / Split / Preview modes) |
| Track tasks | **Board** (kanban) |
| Untangle an idea | **Brainstorm** (optional, enable in Settings → Features) |
| Sketch a diagram | **Draw** (optional canvas, hand-written font by default, adapts to light and dark) |
| Back up or sync | GitHub sync (from the sync dialog) |
| Share a note | The Share dialog in the editor |

---

## 6. Make it yours

- **Themes:** Midnight, Solarized Osaka, Noir Ember, Ivory Ember, Parchment, Ink, Dusk, Forest, Gruvbox, Sepia, Fog, Graphite, Onyx, or build your own.
- **Glass mode:** the macOS frosted look. If text feels low-contrast, try a light theme with a stronger glass intensity, or switch glass off.
- **Vim mode:** available in the editor. The status bar is hidden for a cleaner look.
- **Editor font and width:** adjust in Settings.

---

## 7. Good habits

1. **One idea per note.** Link instead of making giant documents.
2. **Name notes for search.** You will find them with `⌘K` later.
3. **Tag sparingly.** Five to ten meaningful tags beat fifty vague ones.
4. **Back up the vault folder** (GitHub sync, Time Machine or any cloud drive). It is just files.
5. **Review weekly.** Skim your Board and your most recent notes, then archive what is done.

---

## 8. What's new

### v2.0.0
- **Folder tags:** colored tags, ⌘/Ctrl-click assignment, filtering, group by tag, `#tag` search.
- **Reorganized sidebar:** Quick links, Folders, Tags, Open Files.
- **Optional Brainstorm:** off by default, enable it in Settings → Features.
- **Glass mode polish:** better contrast on light themes.
- **New themes:** Solarized Osaka (with matched syntax colors), Noir Ember, Ivory Ember.
- **Better syntax highlighting** for types and operators.
- **Fixes:** Draw now adapts to light and dark, Draw defaults to the hand font, and the Vim status bar is gone.

### Earlier
- Code block display and clipboard fixes.
- Single editor width control.
- Fixed reading of moved files inside the vault.
- Checkbox rendering fix.

---

## 9. Roadmap (edit freely)

- [ ] Assign tags to individual notes
- [ ] Tag management (merge, reorder)
- [ ] Website docs refresh for v2.0.0
- [ ] Release announcement on social media
- [ ] _Your idea here_

---

## 10. Feedback & contributing

Found a bug or have an idea? Add it to the roadmap above, or open an issue on the project repository. Please include your Inkwell version (**Settings → About**), your OS, and the steps to reproduce.

*Happy writing.* ✍️
