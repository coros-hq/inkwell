#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

mod claude_mcp;
mod mac_calendar;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_LABEL: &str = "main";
const QUICK_NOTE_LABEL: &str = "quick-note";

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
        if dir.join("uninstall.exe").exists() {
            return false;
        }
        let under_program_files = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
            .iter()
            .filter_map(|k| std::env::var_os(k))
            .any(|pf| dir.starts_with(pf));
        return !under_program_files;
    }
    #[cfg(not(windows))]
    false
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
    inkwell_mcp::run()
}

fn show_quick_note_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(QUICK_NOTE_LABEL) {
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    let builder = WebviewWindowBuilder::new(
        app,
        QUICK_NOTE_LABEL,
        WebviewUrl::App("index.html?quicknote=1".into()),
    )
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

    match builder.build() {
        Ok(win) => {
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[inkwell] failed to create quick-note window: {e}"),
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
        .invoke_handler(tauri::generate_handler![set_vibrancy, list_system_fonts, is_portable, claude_mcp_status, claude_mcp_set_enabled, mac_calendar::mac_calendar_status, mac_calendar::mac_calendar_request_access, mac_calendar::mac_calendar_list, mac_calendar::mac_calendar_ensure_inkwell, mac_calendar::mac_calendar_fetch, mac_calendar::mac_calendar_upsert, mac_calendar::mac_calendar_delete])
        .setup(|app| {
            claude_mcp::sync_on_startup();

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
