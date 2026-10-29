//! inkwell MCP Server (Rust)
//!
//! Protocol: JSON-RPC 2.0 over stdio, newline-delimited.
//! Claude Desktop spawns this binary and talks to it via stdin/stdout.
//! We log diagnostics to stderr only — stdout is reserved for the protocol.
//!
//! Flow:
//!   Claude → stdin  → we parse JSON-RPC → run handler → write response → stdout → Claude
//!
//! Tools exposed:
//!   list_notes      — list all .md files in the vault
//!   read_note       — read a specific note's content
//!   create_note     — create a new .md note
//!   update_note     — overwrite an existing note
//!   search_notes    — find notes containing a query string
//!   list/create/update/delete_calendar_event — the app-wide calendar (see calendar.rs)
//!
//! Vault path resolution (in priority order):
//!   1. ~/.inkwell/active-vault  — written by the app on every vault open (always current)
//!   2. INKWELL_VAULT_PATH env var — static fallback from Claude Desktop config
//!
//! Note format: each .md file has YAML frontmatter (id, created, updated, pinned, tags).
//! The MCP server strips frontmatter before returning content to Claude, and preserves
//! existing frontmatter when updating notes.
mod calendar;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

// ── Frontmatter helpers ───────────────────────────────────────────────────────

/// Strip YAML frontmatter from a .md file's raw content.
/// Returns just the body (content after the closing ---).
fn strip_frontmatter(raw: &str) -> &str {
    if !raw.starts_with("---") {
        return raw;
    }
    // Find the closing ---
    if let Some(end) = raw[3..].find("\n---") {
        let after = &raw[3 + end + 4..]; // skip "\n---"
        after.trim_start_matches('\n')
    } else {
        raw
    }
}

/// Extract the frontmatter block (the --- ... --- section) from raw content.
/// Returns None if there is no valid frontmatter.
fn extract_frontmatter(raw: &str) -> Option<&str> {
    if !raw.starts_with("---") { return None; }
    let end = raw[3..].find("\n---")?;
    Some(&raw[..3 + end + 4]) // includes both --- delimiters
}

/// Rebuild a file: keep existing frontmatter but replace the body.
/// If there's no existing frontmatter, write body as-is.
fn rebuild_with_body(existing_raw: &str, new_body: &str) -> String {
    if let Some(fm) = extract_frontmatter(existing_raw) {
        format!("{}\n\n{}", fm, new_body)
    } else {
        new_body.to_string()
    }
}

// ── JSON-RPC types ────────────────────────────────────────────────────────────

/// An incoming request from Claude.
#[derive(Debug, Deserialize)]
struct Request {
    #[allow(dead_code)]
    jsonrpc: String,
    /// Requests have an id; notifications don't (we ignore notifications).
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

/// Every response we send back.
#[derive(Debug, Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

impl Response {
    fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }
    fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(RpcError { code, message: message.into() }),
        }
    }
}

// ── Tool result helpers ───────────────────────────────────────────────────────

/// Wraps a string in the MCP content format Claude expects.
fn text_content(text: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": text.into() }] })
}

fn error_content(text: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": text.into() }], "isError": true })
}

// ── Tool definitions ──────────────────────────────────────────────────────────

/// Returns the full tools/list payload — what Claude sees when it asks
/// "what can this server do?"
fn tools_list() -> Value {
    let mut list = tools_list_notes();
    list["tools"].as_array_mut().unwrap().extend(calendar::tools());
    list
}

fn tools_list_notes() -> Value {
    json!({
        "tools": [
            {
                "name": "get_vault_info",
                "description": "ALWAYS call this first before any other tool. Returns the currently active vault name and absolute path so you can confirm to the user exactly where notes will be read from or written to. Never assume which vault is active — always verify.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "list_notes",
                "description": "List all notes in the currently active inkwell vault. Call get_vault_info first so you know which vault you are listing. Returns note names and relative paths.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "folder": {
                            "type": "string",
                            "description": "Optional subfolder to list. Leave empty to list all notes."
                        }
                    }
                }
            },
            {
                "name": "read_note",
                "description": "Read the full content of a note from the active vault. Call get_vault_info first to confirm the vault, then tell the user which vault you are reading from.",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path to the note inside the vault, e.g. 'ideas/feature-ideas.md'"
                        }
                    }
                }
            },
            {
                "name": "create_note",
                "description": "Create a new note. Path rules: (1) If the user gave an absolute path (starts with '/'), use it exactly as given — do NOT join it to the vault root. (2) If the user gave a relative path or no path, join it to the active vault from get_vault_info. Always call get_vault_info first when no explicit absolute path was given, and confirm the destination with the user before writing.",
                "inputSchema": {
                    "type": "object",
                    "required": ["path", "content"],
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path (e.g. '/Users/me/Desktop/vault/note.md') OR relative path within the active vault (e.g. 'ideas/note.md'). Absolute paths are used as-is; relative paths are joined to the vault root."
                        },
                        "content": {
                            "type": "string",
                            "description": "Markdown content for the note"
                        }
                    }
                }
            },
            {
                "name": "update_note",
                "description": "Overwrite an existing note. Same path rules as create_note: absolute paths are used as-is, relative paths are joined to the active vault. Call get_vault_info first when path is relative.",
                "inputSchema": {
                    "type": "object",
                    "required": ["path", "content"],
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute or relative path to the note to update"
                        },
                        "content": {
                            "type": "string",
                            "description": "New markdown content"
                        }
                    }
                }
            },
            {
                "name": "search_notes",
                "description": "Search for notes containing a query string in the active vault. Returns matching file names and the lines that matched.",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Text to search for (case-insensitive)"
                        }
                    }
                }
            }
        ]
    })
}

// ── Path resolution ───────────────────────────────────────────────────────────

/// Resolve a note path:
///   - Absolute path (starts with '/') → used as-is, ignores vault root.
///   - Relative path → joined to the vault root.
///
/// This lets users say "create a note at /Users/me/Desktop/note.md" and have
/// it land exactly there, while bare names like "ideas/note.md" still go into
/// the active vault.
fn resolve_note_path(vault: &Path, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        vault.join(path)
    }
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

fn handle_get_vault_info(vault: &Path) -> Value {
    let vault_name = vault
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");
    let vault_path = vault.to_string_lossy();

    // Count notes so Claude has a quick sense of vault size
    let mut notes: Vec<String> = Vec::new();
    collect_md_files(vault, vault, &mut notes);

    text_content(format!(
        "Active vault\n\
         Name: {vault_name}\n\
         Path: {vault_path}\n\
         Notes: {} .md file(s)\n\n\
         All operations (create, read, update, list, search) will use this vault.",
        notes.len()
    ))
}

fn handle_list_notes(vault: &Path, args: &Value) -> Value {
    let subfolder = args.get("folder").and_then(|v| v.as_str()).unwrap_or("");
    let root = if subfolder.is_empty() {
        vault.to_path_buf()
    } else {
        vault.join(subfolder)
    };

    let mut notes: Vec<String> = Vec::new();
    collect_md_files(&root, vault, &mut notes);

    if notes.is_empty() {
        return text_content("No notes found in vault.");
    }
    notes.sort();
    text_content(format!("{} notes found:\n\n{}", notes.len(), notes.join("\n")))
}

/// Recursively collect .md files relative to vault root.
fn collect_md_files(dir: &Path, vault: &Path, acc: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        // Skip hidden files/dirs (e.g. .git, .DS_Store)
        if path.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        if path.is_dir() {
            collect_md_files(&path, vault, acc);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(rel) = path.strip_prefix(vault) {
                acc.push(rel.to_string_lossy().into_owned());
            }
        }
    }
}

fn handle_read_note(vault: &Path, args: &Value) -> Value {
    let Some(rel_path) = args.get("path").and_then(|v| v.as_str()) else {
        return error_content("Missing required argument: path");
    };
    let full_path = resolve_note_path(vault, rel_path);
    match fs::read_to_string(&full_path) {
        Ok(raw) => {
            let body = strip_frontmatter(&raw);
            text_content(format!("# {}\n\n{body}", full_path.display()))
        }
        Err(e) => error_content(format!("Could not read '{}': {e}", full_path.display())),
    }
}

fn handle_create_note(vault: &Path, args: &Value) -> Value {
    let (Some(note_path), Some(content)) = (
        args.get("path").and_then(|v| v.as_str()),
        args.get("content").and_then(|v| v.as_str()),
    ) else {
        return error_content("Missing required arguments: path, content");
    };

    let full_path = resolve_note_path(vault, note_path);

    // Don't overwrite existing notes
    if full_path.exists() {
        return error_content(format!(
            "'{}' already exists. Use update_note to overwrite.",
            full_path.display()
        ));
    }

    // Create parent directories if needed
    if let Some(parent) = full_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return error_content(format!("Could not create directories: {e}"));
        }
    }

    // Generate a timestamp-based ID and ISO timestamp for frontmatter
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let note_id = unique_note_id();
    let ts = format_timestamp(now_secs);

    let file_content = format!(
        "---\nid: {note_id}\ncreated: {ts}\nupdated: {ts}\npinned: false\ntags: []\n---\n\n{content}"
    );

    match fs::write(&full_path, &file_content) {
        Ok(_) => text_content(format!("Created note at: {}", full_path.display())),
        Err(e) => error_content(format!("Could not write '{}': {e}", full_path.display())),
    }
}

/// Notes created in a burst (e.g. a whole folder at once) land in the same second,
/// so the id combines nanoseconds with a process-wide counter to stay unique.
fn unique_note_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("note-{nanos:x}-{:x}-{seq:x}", std::process::id())
}

/// Format a Unix timestamp as a minimal ISO 8601 string (UTC).
/// Avoids the chrono crate dependency.
fn format_timestamp(secs: u64) -> String {
    // Days from epoch to target, then decompose
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let h = time_of_day / 3600;
    let m = (time_of_day % 3600) / 60;
    let s = time_of_day % 60;

    // Gregorian calendar decomposition from days since 1970-01-01
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };

    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

fn handle_update_note(vault: &Path, args: &Value) -> Value {
    let (Some(note_path), Some(new_body)) = (
        args.get("path").and_then(|v| v.as_str()),
        args.get("content").and_then(|v| v.as_str()),
    ) else {
        return error_content("Missing required arguments: path, content");
    };

    let full_path = resolve_note_path(vault, note_path);

    if !full_path.exists() {
        return error_content(format!(
            "'{}' does not exist. Use create_note to create it.",
            full_path.display()
        ));
    }

    // Read the existing file to preserve frontmatter
    let existing_raw = fs::read_to_string(&full_path).unwrap_or_default();
    let file_content = rebuild_with_body(&existing_raw, new_body);

    match fs::write(&full_path, &file_content) {
        Ok(_) => text_content(format!("Updated note at: {}", full_path.display())),
        Err(e) => error_content(format!("Could not write '{}': {e}", full_path.display())),
    }
}

fn handle_search_notes(vault: &Path, args: &Value) -> Value {
    let Some(query) = args.get("query").and_then(|v| v.as_str()) else {
        return error_content("Missing required argument: query");
    };
    let query_lower = query.to_lowercase();

    let mut all_notes: Vec<String> = Vec::new();
    collect_md_files(vault, vault, &mut all_notes);

    let mut results: Vec<String> = Vec::new();

    for rel_path in &all_notes {
        let full_path = vault.join(rel_path);
        let Ok(content) = fs::read_to_string(&full_path) else { continue };

        // Strip frontmatter before searching so YAML fields don't pollute results
        let body = strip_frontmatter(&content);
        let matching_lines: Vec<String> = body
            .lines()
            .enumerate()
            .filter(|(_, line)| line.to_lowercase().contains(&query_lower))
            .map(|(i, line)| format!("  L{}: {}", i + 1, line.trim()))
            .take(3) // show at most 3 matching lines per file
            .collect();

        if !matching_lines.is_empty() {
            results.push(format!("📄 {}\n{}", rel_path, matching_lines.join("\n")));
        }
    }

    if results.is_empty() {
        return text_content(format!("No notes found containing '{query}'."));
    }

    text_content(format!(
        "Found '{}' in {} note(s):\n\n{}",
        query,
        results.len(),
        results.join("\n\n")
    ))
}

// ── Vault resolution ──────────────────────────────────────────────────────────

/// Return the currently active vault path.
///
/// Priority:
///   1. ~/.inkwell/active-vault (written by the app on every vault open)
///   2. INKWELL_VAULT_PATH env var (static fallback)
fn resolve_vault(fallback: Option<&PathBuf>) -> Result<PathBuf, String> {
    // Try ~/.inkwell/active-vault first
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let state_file = PathBuf::from(home).join(".inkwell").join("active-vault");
        if let Ok(contents) = fs::read_to_string(&state_file) {
            let p = PathBuf::from(contents.trim());
            if p.exists() {
                eprintln!("[inkwell-mcp] vault from active-vault file: {}", p.display());
                return Ok(p);
            } else {
                eprintln!("[inkwell-mcp] active-vault file points to missing path: {}", p.display());
            }
        }
    }

    // Fall back to the static env var / startup path
    if let Some(p) = fallback {
        if p.exists() {
            eprintln!("[inkwell-mcp] vault from env var: {}", p.display());
            return Ok(p.clone());
        }
    }

    Err("No valid vault path found. Open a vault in Inkwell first.".to_string())
}

// ── Request dispatcher ────────────────────────────────────────────────────────

fn handle(request: Request, fallback_vault: Option<&PathBuf>) -> Option<Response> {
    let id = request.id.clone().unwrap_or(Value::Null);
    let params = request.params.unwrap_or(json!({}));

    match request.method.as_str() {
        // ── MCP lifecycle ────────────────────────────────────────────────────
        "initialize" => Some(Response::ok(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "serverInfo": { "name": "inkwell-mcp", "version": "0.1.0" },
                "capabilities": { "tools": {} }
            }),
        )),

        // Claude sends this after initialize — no response needed
        "notifications/initialized" => None,

        // ── Tool discovery ───────────────────────────────────────────────────
        "tools/list" => Some(Response::ok(id, tools_list())),

        // ── Tool execution ───────────────────────────────────────────────────
        "tools/call" => {
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));

            // The calendar is app-wide, so these tools don't need a vault.
            if let Some(result) = calendar::call(tool_name, &args) {
                return Some(Response::ok(id, result));
            }

            // Resolve vault on every call so switching vaults in the app is
            // immediately reflected without restarting the MCP server.
            let vault = match resolve_vault(fallback_vault) {
                Ok(p) => p,
                Err(e) => return Some(Response::ok(id, error_content(e))),
            };

            let result = match tool_name {
                "get_vault_info" => handle_get_vault_info(&vault),
                "list_notes"     => handle_list_notes(&vault, &args),
                "read_note"      => handle_read_note(&vault, &args),
                "create_note"    => handle_create_note(&vault, &args),
                "update_note"    => handle_update_note(&vault, &args),
                "search_notes"   => handle_search_notes(&vault, &args),
                unknown => error_content(format!("Unknown tool: {unknown}")),
            };

            Some(Response::ok(id, result))
        }

        // Ignore any other notifications (no id = notification, not a request)
        _ if request.id.is_none() => None,

        // Unknown method
        other => Some(Response::err(id, -32601, format!("Method not found: {other}"))),
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Run the stdio server until stdin closes. Called by the standalone
/// `inkwell-mcp` binary and by the app itself when launched with `--mcp`.
pub fn run() {
    // Optional static fallback — used only when ~/.inkwell/active-vault doesn't exist.
    // If neither is set the server still starts; it will return a clear error on
    // tool calls until the user opens a vault in the app.
    let fallback_vault: Option<PathBuf> = std::env::var("INKWELL_VAULT_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists());

    eprintln!(
        "[inkwell-mcp] started — fallback vault: {}",
        fallback_vault.as_deref().map(|p| p.display().to_string()).unwrap_or_else(|| "(none)".into())
    );

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    // Read one JSON-RPC message per line from stdin
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            _ => continue,
        };

        // Parse the request
        let request: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[inkwell-mcp] parse error: {e} — line: {line}");
                continue;
            }
        };

        eprintln!("[inkwell-mcp] ← {}", request.method);

        // Dispatch and optionally respond
        if let Some(response) = handle(request, fallback_vault.as_ref()) {
            let json = serde_json::to_string(&response).unwrap();
            eprintln!("[inkwell-mcp] → response sent");
            writeln!(stdout, "{json}").unwrap();
            stdout.flush().unwrap();
        }
    }

    eprintln!("[inkwell-mcp] stdin closed, shutting down");
}
