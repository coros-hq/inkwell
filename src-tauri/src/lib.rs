#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

mod claude_mcp;
mod mac_calendar;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_LABEL: &str = "main";
const QUICK_NOTE_LABEL: &str = "quick-note";
const SETTINGS_LABEL: &str = "settings";

/// True when running as the bare portable `inkwell.exe` (unzipped, not installed).
/// An installed copy is recognisable on Windows: the NSIS installer puts
/// `uninstall.exe` beside the app, and the MSI installs under Program Files. The
/// in-app updater downloads an installer, which makes no sense for a portable copy.
#[tauri::command]
fn is_portable() -> bool {
    #[cfg(windows)]
    {
        let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) else {
            return false;
        };
        return looks_portable(&dir);
    }
    #[cfg(not(windows))]
    false
}

/// A folder that holds a bare, uninstalled `inkwell.exe`.
#[cfg_attr(not(windows), allow(dead_code))]
fn looks_portable(dir: &Path) -> bool {
    if dir.join("uninstall.exe").exists() {
        return false;
    }
    let under_program_files = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
        .iter()
        .filter_map(|k| std::env::var_os(k))
        .any(|pf| dir.starts_with(pf));
    !under_program_files
}

// ── Portable mode ─────────────────────────────────────────────────────────────
// A portable copy keeps EVERYTHING in a `data` folder beside the executable —
// the web profile (settings, themes, sign-in), canvas/calendar data, and the default
// vault — so it can be moved or deleted without leaving anything in the OS user
// profile. An installed copy is unaffected (this returns None).
//
// Layout:  data/webview   the WebView2 profile (localStorage etc.)
//          data/config    what an installed copy keeps in ~/.inkwell and %APPDATA%
//          data/Vault     the suggested first vault

/// `<exe dir>/data`, created on demand — or None if the copy is not portable or
/// its folder is read-only (then the app falls back to the normal OS locations).
fn portable_data_dir(exe_dir: &Path, portable: bool) -> Option<PathBuf> {
    if !portable {
        return None;
    }
    let dir = exe_dir.join("data");
    match std::fs::create_dir_all(dir.join("config")) {
        Ok(()) => Some(dir),
        Err(e) => {
            eprintln!("[inkwell] portable data folder {} is not writable ({e}); using the system profile", dir.display());
            None
        }
    }
}

/// Where this run keeps its data, or None for a normal installed run.
/// `INKWELL_DATA_DIR` forces a location (it is also how `inkwell --mcp` learns it).
/// Debug builds never go portable, so `tauri dev` keeps using the normal locations.
pub fn data_root() -> Option<PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
        if let Some(forced) = std::env::var_os("INKWELL_DATA_DIR").filter(|p| !p.is_empty()) {
            let dir = PathBuf::from(forced);
            return std::fs::create_dir_all(dir.join("config")).ok().map(|_| dir);
        }
        if cfg!(debug_assertions) {
            return None;
        }
        let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
        #[cfg(windows)]
        let portable = looks_portable(&exe_dir);
        #[cfg(not(windows))]
        let portable = false;
        portable_data_dir(&exe_dir, portable)
    })
    .clone()
}

/// Where inkwell's own small files live: `data/config` when portable, else `~/.inkwell`.
pub fn config_dir() -> Option<PathBuf> {
    if let Some(root) = data_root() {
        return Some(root.join("config"));
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|h| PathBuf::from(h).join(".inkwell"))
}

/// The portable data folder for the frontend (None when installed).
#[tauri::command]
fn data_root_path() -> Option<String> {
    data_root().map(|p| p.to_string_lossy().into_owned())
}

/// Every window must share one WebView2 profile, or they would each get their
/// own localStorage — so the portable profile is applied wherever a window is built.
fn with_data_dir<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    match data_root() {
        Some(root) => builder.data_directory(root.join("webview")),
        None => builder,
    }
}

/// Toggle macOS NSVisualEffectView (native sidebar glass) on the main window.
/// No-op on non-macOS platforms.
///
/// `dark` is inkwell's *in-app* theme (light/dark), which is independent of the
/// OS system appearance. NSVisualEffectView's blur material otherwise follows
/// the window's NSAppearance, which defaults to the OS system setting — so if
/// those two are out of sync (e.g. OS in dark mode, an inkwell light theme
/// selected), the native blur renders the wrong tint underneath the CSS overlay,
/// producing a washed-out, low-contrast look. Explicitly setting the window's
/// theme to match keeps the vibrancy material in sync with whichever theme is
/// actually showing.
#[tauri::command]
fn set_vibrancy(window: tauri::WebviewWindow, enabled: bool, dark: bool) {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            let theme = if dark { tauri::Theme::Dark } else { tauri::Theme::Light };
            if let Err(e) = window.set_theme(Some(theme)) {
                eprintln!("[inkwell] set_theme failed: {e}");
            }
            if let Err(e) = apply_vibrancy(
                &window,
                // Sidebar is the material Finder itself uses: a light, even blur that
                // follows the window appearance, so light and dark both read as
                // native glass. (HudWindow was far too dark/opaque.)
                NSVisualEffectMaterial::Sidebar,
                // Stay blurred when the window loses focus instead of flattening.
                Some(NSVisualEffectState::Active),
                None,
            ) {
                eprintln!("[inkwell] apply_vibrancy failed: {e}");
            } else {
                eprintln!("[inkwell] apply_vibrancy OK");
            }
        } else {
            // Let the window appearance follow the OS system setting again now
            // that there's no vibrancy material to keep in sync with.
            if let Err(e) = window.set_theme(None) {
                eprintln!("[inkwell] set_theme reset failed: {e}");
            }
            match clear_vibrancy(&window) {
                Ok(cleared) => eprintln!("[inkwell] clear_vibrancy OK (cleared={cleared})"),
                Err(e) => eprintln!("[inkwell] clear_vibrancy failed: {e}"),
            }
        }
    }
    // Suppress unused variable warning on non-macOS
    #[cfg(not(target_os = "macos"))]
    let _ = (window, enabled, dark);
}

/// Show the quick-note popup, focusing an existing instance instead of
/// spawning a duplicate. This is invoked from the global shortcut and from
/// the tray menu, so it works even while the main window is hidden.
/// List the family names of every font installed on the system, sorted and
/// de-duplicated, so the editor can offer local fonts. WKWebView/WebView2 can
/// render any installed family by name, so the name alone is enough.
#[tauri::command]
async fn list_system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut families: Vec<String> = db
        .faces()
        .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
        .filter(|name| !name.starts_with('.'))
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

#[tauri::command]
fn claude_mcp_status() -> claude_mcp::ClaudeMcpStatus {
    claude_mcp::status()
}

#[tauri::command]
fn claude_mcp_set_enabled(enabled: bool) -> Result<claude_mcp::ClaudeMcpStatus, String> {
    claude_mcp::set_enabled(enabled)
}

/// Serve inkwell's MCP tools over stdio (launched by Claude Desktop as `inkwell --mcp`).
pub fn run_mcp() {
    // Let the MCP server find the same files as the app (it only knows the OS locations).
    if let Some(root) = data_root() {
        std::env::set_var("INKWELL_DATA_DIR", root);
    }
    inkwell_mcp::run()
}

fn show_quick_note_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(QUICK_NOTE_LABEL) {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let builder = with_data_dir(WebviewWindowBuilder::new(
        app,
        QUICK_NOTE_LABEL,
        WebviewUrl::App("index.html?quicknote=1".into()),
    ))
    .title("Quick Note")
    .inner_size(420.0, 320.0)
    .min_inner_size(300.0, 220.0)
    .resizable(true)
    .always_on_top(true)
    .center()
    .visible(true);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // Windows draws its own chrome (see TitleBar / QuickNoteCapture), so drop
    // the native frame here too.
    #[cfg(windows)]
    let builder = builder.decorations(false);

    match builder.build() {
        Ok(win) => {
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[inkwell] failed to create quick-note window: {e}"),
    }
}

/// Open Settings in its own native window (like an IDE's preferences), or bring
/// the existing one to the front. The window loads the same frontend with
/// `?settings=1`; it mirrors the main window's state over events (see
/// src/lib/settingsSync.ts), so there is only ever one source of truth.
#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return;
    }

    let builder = with_data_dir(WebviewWindowBuilder::new(
        &app,
        SETTINGS_LABEL,
        WebviewUrl::App("index.html?settings=1".into()),
    ))
    .title("Settings")
    .inner_size(860.0, 640.0)
    .min_inner_size(640.0, 460.0)
    .resizable(true)
    .center()
    .visible(true);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // Windows draws its own titlebar (see TitleBar.tsx), like the main window.
    #[cfg(windows)]
    let builder = builder.decorations(false);

    match builder.build() {
        Ok(win) => {
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[inkwell] failed to create settings window: {e}"),
    }
}

/// Show and focus the main window (used by the tray "Open inkwell" item).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // inkwell://join/<token> vault invite links (see src/lib/team.ts).
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    {
        // Updater isn't available on mobile targets.
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

                    if event.state() != ShortcutState::Pressed {
                        return;
                    }

                    #[cfg(target_os = "macos")]
                    let modifier = Modifiers::SUPER;
                    #[cfg(not(target_os = "macos"))]
                    let modifier = Modifiers::CONTROL;

                    if shortcut == &Shortcut::new(Some(modifier), Code::KeyN) {
                        show_quick_note_window(app);
                    }
                })
                .build(),
        );
    }

    builder
        .invoke_handler(tauri::generate_handler![open_settings_window, data_root_path, set_vibrancy, list_system_fonts, is_portable, claude_mcp_status, claude_mcp_set_enabled, mac_calendar::mac_calendar_status, mac_calendar::mac_calendar_request_access, mac_calendar::mac_calendar_list, mac_calendar::mac_calendar_ensure_inkwell, mac_calendar::mac_calendar_fetch, mac_calendar::mac_calendar_upsert, mac_calendar::mac_calendar_delete])
        .setup(|app| {
            // A portable copy must not write into Claude Desktop's config (outside its folder)
            // unprompted; the Claude settings toggle still works if the user wants it.
            if data_root().is_none() {
                claude_mcp::sync_on_startup();
            }

            // Windows' config sets `create: false` for the main window so it can be built here
            // with the portable profile folder (config can't express an absolute path).
            for cfg in app.config().app.windows.iter().filter(|w| !w.create) {
                match WebviewWindowBuilder::from_config(app.handle(), cfg) {
                    Ok(builder) => {
                        if let Err(e) = with_data_dir(builder).build() {
                            eprintln!("[inkwell] failed to create window '{}': {e}", cfg.label);
                        }
                    }
                    Err(e) => eprintln!("[inkwell] bad window config '{}': {e}", cfg.label),
                }
            }

            #[cfg(desktop)]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
                use tauri::tray::TrayIconBuilder;
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

                // Register Cmd+N (macOS) / Ctrl+N (Windows/Linux) globally so
                // quick-note capture works even while inkwell is hidden.
                #[cfg(target_os = "macos")]
                let modifier = Modifiers::SUPER;
                #[cfg(not(target_os = "macos"))]
                let modifier = Modifiers::CONTROL;
                if let Err(e) = app
                    .global_shortcut()
                    .register(Shortcut::new(Some(modifier), Code::KeyN))
                {
                    eprintln!("[inkwell] failed to register global shortcut: {e}");
                }

                // Menu bar tray icon — keeps inkwell reachable (and the
                // shortcut alive) once the main window has been hidden.
                let open_item = MenuItemBuilder::with_id("open", "Open inkwell").build(app)?;
                let new_note_item = MenuItemBuilder::with_id("new-note", "New Quick Note")
                    .accelerator("CmdOrCtrl+N")
                    .build(app)?;
                let separator = PredefinedMenuItem::separator(app)?;
                let quit_item = MenuItemBuilder::with_id("quit", "Quit inkwell").build(app)?;

                let tray_menu = MenuBuilder::new(app)
                    .items(&[&open_item, &new_note_item, &separator, &quit_item])
                    .build()?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&tray_menu)
                    .tooltip("inkwell")
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "open" => show_main_window(app),
                        "new-note" => show_quick_note_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window hides it instead of quitting the app,
            // so the tray icon and global shortcut keep working. Cmd+Q / the
            // tray "Quit" item still fully exit via app.exit().
            if window.label() == MAIN_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    // Hiding a macOS fullscreen window leaves its empty
                    // fullscreen Space behind (black screen). Leave fullscreen
                    // first and hide once the exit animation has finished.
                    if window.is_fullscreen().unwrap_or(false) {
                        let _ = window.set_fullscreen(false);
                        let win = window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(800));
                            let _ = win.hide();
                        });
                    } else {
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // The main window is only hidden on close, so clicking the Dock
            // icon (or relaunching from Finder/Launchpad) must bring it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main_window(_app);
            }
        });
}

#[cfg(test)]
mod portable_tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("inkwell-portable-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn portable_copy_gets_a_data_folder_next_to_the_exe() {
        let exe_dir = scratch("portable");
        let data = portable_data_dir(&exe_dir, true).expect("portable");
        assert_eq!(data, exe_dir.join("data"));
        assert!(data.join("config").is_dir(), "config subfolder is created up front");
        std::fs::remove_dir_all(&exe_dir).unwrap();
    }

    #[test]
    fn an_installed_copy_gets_no_data_folder() {
        let exe_dir = scratch("installed");
        assert_eq!(portable_data_dir(&exe_dir, false), None);
        assert!(!exe_dir.join("data").exists(), "nothing is created for an installed copy");
        std::fs::remove_dir_all(&exe_dir).unwrap();
    }

    #[test]
    fn a_read_only_location_falls_back_instead_of_failing() {
        let exe_dir = scratch("readonly");
        // A *file* named `data` makes the folder impossible to create, like a read-only drive.
        std::fs::write(exe_dir.join("data"), "x").unwrap();
        assert_eq!(portable_data_dir(&exe_dir, true), None);
        std::fs::remove_dir_all(&exe_dir).unwrap();
    }

    #[test]
    fn the_nsis_installer_is_recognised_as_installed() {
        let dir = scratch("nsis");
        std::fs::write(dir.join("uninstall.exe"), "").unwrap();
        assert!(!looks_portable(&dir), "uninstall.exe beside the app means it was installed");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
