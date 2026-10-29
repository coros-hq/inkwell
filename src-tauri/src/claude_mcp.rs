//! Registers inkwell's MCP server with Claude Desktop.
//!
//! Claude Desktop only launches local MCP servers itself, from the `mcpServers`
//! map in `claude_desktop_config.json`. So rather than keeping a server running,
//! inkwell writes an entry that points back at its own executable with `--mcp`
//! (see `run_mcp`). Claude spawns that process on demand, and it reads the active
//! vault from `~/.inkwell/active-vault`, so it always follows the vault open in
//! the app.

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;

const SERVER_NAME: &str = "inkwell";

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return home_dir().map(|h| h.join("Library/Application Support/Claude/claude_desktop_config.json"));
    #[cfg(windows)]
    return std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Claude").join("claude_desktop_config.json"));
    #[cfg(not(any(target_os = "macos", windows)))]
    return home_dir().map(|h| h.join(".config/Claude/claude_desktop_config.json"));
}

/// Marker file: present once the user has switched the integration off, so the
/// startup sync doesn't re-add the entry.
fn disabled_marker() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".inkwell").join("claude-mcp-disabled"))
}

/// The binary Claude should launch. AppImages run from a throwaway mount, so
/// prefer the stable `$APPIMAGE` path there.
fn app_executable() -> Result<String, String> {
    if let Some(p) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(p).to_string_lossy().into_owned());
    }
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("could not locate the inkwell executable: {e}"))
}

fn desired_entry() -> Result<Value, String> {
    Ok(json!({ "command": app_executable()?, "args": ["--mcp"] }))
}

/// Read the config as a JSON object. A missing file is an empty object; a file
/// we can't parse is an error, so we never overwrite a config we don't understand.
fn read_config(path: &PathBuf) -> Result<Map<String, Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    };
    if raw.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(m)) => Ok(m),
        _ => Err(format!("{} is not a valid JSON object; fix it and try again", path.display())),
    }
}

fn write_config(path: &PathBuf, config: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.inkwell-tmp");
    fs::write(&tmp, text + "\n").map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("could not update {}: {e}", path.display()))
}

fn is_registered(config: &Map<String, Value>, desired: &Value) -> bool {
    config
        .get("mcpServers")
        .and_then(|s| s.get(SERVER_NAME))
        .map_or(false, |e| e == desired)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMcpStatus {
    /// Claude Desktop appears to be installed (its config folder exists).
    installed: bool,
    /// The user hasn't switched the integration off.
    enabled: bool,
    /// The config currently points at this copy of inkwell.
    registered: bool,
    config_path: Option<String>,
    command: Option<String>,
}

pub fn status() -> ClaudeMcpStatus {
    let path = config_path();
    let installed = path.as_ref().and_then(|p| p.parent()).map_or(false, |d| d.exists());
    let enabled = !disabled_marker().map_or(false, |m| m.exists());
    let command = app_executable().ok();
    let registered = match (&path, desired_entry()) {
        (Some(p), Ok(d)) => read_config(p).map_or(false, |c| is_registered(&c, &d)),
        _ => false,
    };
    ClaudeMcpStatus {
        installed,
        enabled,
        registered,
        config_path: path.map(|p| p.to_string_lossy().into_owned()),
        command,
    }
}

fn register() -> Result<(), String> {
    let path = config_path().ok_or("could not determine Claude Desktop's config location")?;
    if !path.parent().map_or(false, |d| d.exists()) {
        return Err("Claude Desktop doesn't appear to be installed".into());
    }
    let mut config = read_config(&path)?;
    let desired = desired_entry()?;
    if is_registered(&config, &desired) {
        return Ok(());
    }
    let servers = config
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("\"mcpServers\" in the Claude Desktop config is not an object")?;
    servers.insert(SERVER_NAME.into(), desired);
    write_config(&path, &config)
}

fn unregister() -> Result<(), String> {
    let Some(path) = config_path() else { return Ok(()) };
    if !path.exists() {
        return Ok(());
    }
    let mut config = read_config(&path)?;
    let removed = config
        .get_mut("mcpServers")
        .and_then(|s| s.as_object_mut())
        .map_or(false, |s| s.remove(SERVER_NAME).is_some());
    if removed {
        write_config(&path, &config)?;
    }
    Ok(())
}

pub fn set_enabled(enabled: bool) -> Result<ClaudeMcpStatus, String> {
    let marker = disabled_marker().ok_or("could not determine the home directory")?;
    if enabled {
        register()?;
        let _ = fs::remove_file(&marker);
    } else {
        unregister()?;
        if let Some(dir) = marker.parent() {
            let _ = fs::create_dir_all(dir);
        }
        fs::write(&marker, "").map_err(|e| format!("could not save the setting: {e}"))?;
    }
    Ok(status())
}

/// Called on launch: keep the Claude Desktop entry pointing at this install
/// (it moves when the app is updated or relocated). Skipped in dev builds so a
/// `tauri dev` run doesn't point Claude at a debug binary.
pub fn sync_on_startup() {
    if cfg!(debug_assertions) {
        return;
    }
    let s = status();
    if s.installed && s.enabled && !s.registered {
        if let Err(e) = register() {
            eprintln!("[inkwell] Claude Desktop MCP registration failed: {e}");
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn registers_and_unregisters_without_touching_other_servers() {
        let home = std::env::temp_dir().join(format!("inkwell-mcp-test-{}", std::process::id()));
        let dir = home.join("Library/Application Support/Claude");
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("HOME", &home);
        let cfg = dir.join("claude_desktop_config.json");
        fs::write(&cfg, r#"{"theme":"dark","mcpServers":{"other":{"command":"x"}}}"#).unwrap();

        assert!(status().installed && !status().registered);
        set_enabled(true).unwrap();
        assert!(status().registered);
        let v: Value = serde_json::from_str(&fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(v["mcpServers"]["inkwell"]["args"][0], "--mcp");

        set_enabled(false).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(v["mcpServers"].get("inkwell").is_none());
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert!(!status().enabled);

        fs::write(&cfg, "{ not json").unwrap();
        assert!(set_enabled(true).is_err());
        assert_eq!(fs::read_to_string(&cfg).unwrap(), "{ not json");
        let _ = fs::remove_dir_all(&home);
    }
}
