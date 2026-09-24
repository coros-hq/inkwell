#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_LABEL: &str = "main";
const QUICK_NOTE_LABEL: &str = "quick-note";

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
            if let Err(e) = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None) {
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
        .plugin(tauri_plugin_process::init());

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
        .invoke_handler(tauri::generate_handler![set_vibrancy, list_system_fonts])
        .setup(|app| {
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
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
