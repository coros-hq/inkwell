//! Exposes inkwell's MCP tools to ChatGPT over local HTTP.
//!
//! Unlike Claude Desktop, ChatGPT can't spawn a local process: its developer-mode
//! connectors take a remote HTTPS URL. So while the integration is on, inkwell runs
//! a small HTTP MCP server on 127.0.0.1 (see `inkwell_mcp::http`), guarded by a secret
//! token in the URL. To reach it ChatGPT needs a public HTTPS address, which the user
//! provides with a tunnel (e.g. `cloudflared tunnel --url http://127.0.0.1:8765`).
//! Settings persist in `chatgpt-mcp.json` in the config folder.

use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

const DEFAULT_PORT: u16 = 8765;

#[derive(Serialize, Deserialize, Clone)]
struct Saved {
    enabled: bool,
    port: u16,
    token: String,
}

struct Running {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

fn settings_path() -> Option<PathBuf> {
    crate::config_dir().map(|d| d.join("chatgpt-mcp.json"))
}

fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| format!("could not generate a token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn load() -> Result<Saved, String> {
    let path = settings_path().ok_or("could not determine the config folder")?;
    if let Some(saved) = std::fs::read_to_string(&path).ok().and_then(|r| serde_json::from_str::<Saved>(&r).ok()) {
        if !saved.token.is_empty() {
            return Ok(saved);
        }
    }
    Ok(Saved { enabled: false, port: DEFAULT_PORT, token: new_token()? })
}

fn save(saved: &Saved) -> Result<(), String> {
    let path = settings_path().ok_or("could not determine the config folder")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let text = serde_json::to_string_pretty(saved).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("could not save the setting: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptMcpStatus {
    enabled: bool,
    running: bool,
    port: u16,
    /// Local address of the server, token included. Treat as a secret.
    url: String,
}

pub fn status() -> Result<ChatgptMcpStatus, String> {
    let saved = load()?;
    let running = RUNNING.lock().map_err(|e| e.to_string())?.is_some();
    Ok(ChatgptMcpStatus {
        enabled: saved.enabled,
        running,
        url: format!("http://127.0.0.1:{}/mcp/{}", saved.port, saved.token),
        port: saved.port,
    })
}

fn stop() {
    let running = RUNNING.lock().ok().and_then(|mut r| r.take());
    if let Some(r) = running {
        r.stop.store(true, Ordering::Relaxed);
        let _ = r.handle.join();
    }
}

fn start(saved: &Saved) -> Result<(), String> {
    stop();
    // Fail with a readable message if the port is taken, instead of dying in the thread.
    TcpListener::bind(("127.0.0.1", saved.port))
        .map_err(|e| format!("port {} is not available: {e}", saved.port))?;
    // Let the MCP tools find the same files as the app.
    if let Some(root) = crate::data_root() {
        std::env::set_var("INKWELL_DATA_DIR", root);
    }
    let flag = Arc::new(AtomicBool::new(false));
    let (port, token, f) = (saved.port, saved.token.clone(), flag.clone());
    let handle = std::thread::spawn(move || {
        if let Err(e) = inkwell_mcp::http::serve(port, token, f) {
            eprintln!("[inkwell] ChatGPT MCP server failed: {e}");
        }
    });
    *RUNNING.lock().map_err(|e| e.to_string())? = Some(Running { stop: flag, handle });
    Ok(())
}

pub fn set_enabled(enabled: bool) -> Result<ChatgptMcpStatus, String> {
    let mut saved = load()?;
    if enabled {
        start(&saved)?;
    } else {
        stop();
    }
    saved.enabled = enabled;
    save(&saved)?;
    status()
}

/// Replace the secret token (invalidates any URL already shared with ChatGPT).
pub fn regenerate_token() -> Result<ChatgptMcpStatus, String> {
    let mut saved = load()?;
    saved.token = new_token()?;
    save(&saved)?;
    if saved.enabled {
        start(&saved)?;
    }
    status()
}

/// Called on launch: bring the server back up if the user left it on.
pub fn start_on_launch() {
    match load() {
        Ok(saved) if saved.enabled => {
            if let Err(e) = start(&saved) {
                eprintln!("[inkwell] ChatGPT MCP server not started: {e}");
            }
        }
        _ => {}
    }
}
