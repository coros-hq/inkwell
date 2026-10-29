//! Calendar tools. The calendar is app-wide (not per vault): a single
//! `calendar.json` in the Tauri app data directory, shaped `{ version, events }`
//! (see `CalendarEvent` in src/types/index.ts). The app watches that file and
//! reloads when it changes, so edits made here show up live.

use crate::{error_content, text_content};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;

const APP_IDENTIFIER: &str = "com.ayphone.inkwell";

fn calendar_path() -> Result<PathBuf, String> {
    let home = || {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .ok_or_else(|| "could not determine the home directory".to_string())
    };
    #[cfg(target_os = "macos")]
    let base = home()?.join("Library/Application Support");
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or("APPDATA is not set")?;
    #[cfg(not(any(target_os = "macos", windows)))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .map_or_else(|| home().map(|h| h.join(".local/share")), Ok)?;
    Ok(base.join(APP_IDENTIFIER).join("calendar.json"))
}

fn load(path: &PathBuf) -> Result<Vec<Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("could not read the calendar: {e}")),
    };
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| format!("calendar.json is not valid JSON: {e}"))?;
    // Older builds stringified the file twice.
    if let Value::String(inner) = &value {
        value = serde_json::from_str(inner).map_err(|e| format!("calendar.json is not valid JSON: {e}"))?;
    }
    Ok(value.get("events").and_then(|e| e.as_array()).cloned().unwrap_or_default())
}

fn save(path: &PathBuf, events: Vec<Value>) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    let text = serde_json::to_string_pretty(&json!({ "version": 1, "events": events })).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.inkwell-tmp");
    fs::write(&tmp, text).map_err(|e| format!("could not write the calendar: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("could not save the calendar: {e}"))
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && s[..4].parse::<u32>().is_ok()
        && s[5..7].parse::<u32>().map_or(false, |m| (1..=12).contains(&m))
        && s[8..].parse::<u32>().map_or(false, |d| (1..=31).contains(&d))
}

fn is_time(s: &str) -> bool {
    s.len() == 5
        && s.as_bytes()[2] == b':'
        && s[..2].parse::<u32>().map_or(false, |h| h < 24)
        && s[3..].parse::<u32>().map_or(false, |m| m < 60)
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

/// Checks the string fields of `args` and copies them onto `event`. An empty
/// string clears an optional field.
fn apply_fields(event: &mut Map<String, Value>, args: &Value) -> Result<(), String> {
    for (arg, field, check) in [
        ("date", "date", is_date as fn(&str) -> bool),
        ("end_date", "endDate", is_date),
        ("start_time", "startTime", is_time),
        ("end_time", "endTime", is_time),
    ] {
        let Some(v) = str_arg(args, arg) else { continue };
        if v.is_empty() && arg != "date" {
            event.remove(field);
        } else if check(v) {
            event.insert(field.into(), json!(v));
        } else {
            let want = if field.ends_with("Date") || field == "date" { "YYYY-MM-DD" } else { "HH:MM (24-hour)" };
            return Err(format!("{arg} must be {want}, got '{v}'"));
        }
    }
    for (arg, field) in [("notes", "notes"), ("color", "color")] {
        match str_arg(args, arg) {
            Some("") => { event.remove(field); }
            Some(v) => { event.insert(field.into(), json!(v)); }
            None => {}
        }
    }
    if let Some(t) = str_arg(args, "title") {
        if t.trim().is_empty() {
            return Err("title cannot be empty".into());
        }
        event.insert("title".into(), json!(t.trim()));
    }
    if let Some(d) = args.get("done").and_then(|v| v.as_bool()) {
        event.insert("done".into(), json!(d));
    }
    // A multi-day event ends on or after its first day; a same-day end date is just noise.
    let date = event.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if let Some(end) = event.get("endDate").and_then(|v| v.as_str()) {
        if end < date.as_str() {
            return Err(format!("end_date {end} is before date {date}"));
        }
        if end == date {
            event.remove("endDate");
        }
    }
    if let (Some(s), Some(e)) = (
        event.get("startTime").and_then(|v| v.as_str()),
        event.get("endTime").and_then(|v| v.as_str()),
    ) {
        if e <= s {
            return Err(format!("end_time {e} must be after start_time {s}"));
        }
    }
    Ok(())
}

fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("cal-{:x}{:x}", nanos, std::process::id())
}

fn describe(e: &Value) -> String {
    let s = |k: &str| e.get(k).and_then(|v| v.as_str());
    let mut when = s("date").unwrap_or("?").to_string();
    if let Some(end) = s("endDate") {
        when = format!("{when} → {end}");
    }
    match (s("startTime"), s("endTime")) {
        (Some(a), Some(b)) => when = format!("{when} {a}-{b}"),
        (Some(a), None) => when = format!("{when} {a}"),
        _ => when.push_str(" (all day)"),
    }
    let done = if e.get("done").and_then(|v| v.as_bool()) == Some(true) { " [done]" } else { "" };
    let notes = s("notes").map_or(String::new(), |n| format!("\n    notes: {n}"));
    format!("{} | {when} | {}{done}{notes}", s("id").unwrap_or("?"), s("title").unwrap_or("(untitled)"))
}

pub fn tools() -> Vec<Value> {
    let fields = json!({
        "date": { "type": "string", "description": "Day, YYYY-MM-DD (local time)." },
        "end_date": { "type": "string", "description": "Last day of a multi-day event, YYYY-MM-DD. Omit for a single day." },
        "start_time": { "type": "string", "description": "HH:MM, 24-hour. Omit for an all-day event." },
        "end_time": { "type": "string", "description": "HH:MM, 24-hour, after start_time." },
        "notes": { "type": "string", "description": "Free-text notes." },
        "color": { "type": "string", "description": "One of #6366f1, #10b981, #f59e0b, #ef4444, #ec4899, #06b6d4." }
    });
    let with = |extra: Value| {
        let mut p = fields.as_object().unwrap().clone();
        p.extend(extra.as_object().unwrap().clone());
        Value::Object(p)
    };
    vec![
        json!({
            "name": "list_calendar_events",
            "description": "List events on the user's inkwell calendar (shared across all vaults), sorted by date and time. With from/to, returns events overlapping that range.",
            "inputSchema": { "type": "object", "properties": {
                "from": { "type": "string", "description": "First day to include, YYYY-MM-DD." },
                "to": { "type": "string", "description": "Last day to include, YYYY-MM-DD." }
            } }
        }),
        json!({
            "name": "create_calendar_event",
            "description": "Add an event to the user's inkwell calendar. Returns the new event id.",
            "inputSchema": { "type": "object", "required": ["title", "date"],
                "properties": with(json!({ "title": { "type": "string" } })) }
        }),
        json!({
            "name": "update_calendar_event",
            "description": "Change an existing calendar event by id (get ids from list_calendar_events). Only the fields you pass change; pass an empty string to clear an optional field. Set done=true to tick an event off.",
            "inputSchema": { "type": "object", "required": ["id"],
                "properties": with(json!({
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "done": { "type": "boolean" }
                })) }
        }),
        json!({
            "name": "delete_calendar_event",
            "description": "Permanently delete a calendar event by id. Confirm with the user first.",
            "inputSchema": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" } } }
        }),
    ]
}

/// Returns None when `name` isn't a calendar tool.
pub fn call(name: &str, args: &Value) -> Option<Value> {
    let run = || -> Result<Value, String> {
        let path = calendar_path()?;
        let mut events = load(&path)?;
        let find = |events: &[Value], id: &str| events.iter().position(|e| str_arg(e, "id") == Some(id));
        match name {
            "list_calendar_events" => {
                let from = str_arg(args, "from").unwrap_or("");
                let to = str_arg(args, "to").unwrap_or("");
                for (k, v) in [("from", from), ("to", to)] {
                    if !v.is_empty() && !is_date(v) {
                        return Err(format!("{k} must be YYYY-MM-DD, got '{v}'"));
                    }
                }
                let mut hits: Vec<&Value> = events
                    .iter()
                    .filter(|e| {
                        let start = str_arg(e, "date").unwrap_or("");
                        let end = str_arg(e, "endDate").filter(|d| *d > start).unwrap_or(start);
                        (from.is_empty() || end >= from) && (to.is_empty() || start <= to)
                    })
                    .collect();
                hits.sort_by_key(|e| (str_arg(e, "date").unwrap_or("").to_string(), str_arg(e, "startTime").unwrap_or("").to_string()));
                if hits.is_empty() {
                    return Ok(text_content("No calendar events found."));
                }
                let lines: Vec<String> = hits.into_iter().map(describe).collect();
                Ok(text_content(format!("{} event(s):\n\n{}", lines.len(), lines.join("\n"))))
            }
            "create_calendar_event" => {
                if str_arg(args, "title").map_or(true, |t| t.trim().is_empty()) {
                    return Err("title is required".into());
                }
                if str_arg(args, "date").map_or(true, str::is_empty) {
                    return Err("date is required (YYYY-MM-DD)".into());
                }
                let id = new_id();
                let mut event = Map::new();
                event.insert("id".into(), json!(id));
                event.insert("done".into(), json!(false));
                apply_fields(&mut event, args)?;
                let event = Value::Object(event);
                let summary = describe(&event);
                events.push(event);
                save(&path, events)?;
                Ok(text_content(format!("Created: {summary}")))
            }
            "update_calendar_event" => {
                let id = str_arg(args, "id").ok_or("id is required")?;
                let i = find(&events, id).ok_or_else(|| format!("No event with id '{id}'"))?;
                let mut event = events[i].as_object().cloned().unwrap_or_default();
                apply_fields(&mut event, args)?;
                events[i] = Value::Object(event);
                let summary = describe(&events[i]);
                save(&path, events)?;
                Ok(text_content(format!("Updated: {summary}")))
            }
            "delete_calendar_event" => {
                let id = str_arg(args, "id").ok_or("id is required")?;
                let i = find(&events, id).ok_or_else(|| format!("No event with id '{id}'"))?;
                let gone = events.remove(i);
                save(&path, events)?;
                Ok(text_content(format!("Deleted: {}", describe(&gone))))
            }
            _ => unreachable!(),
        }
    };
    if !matches!(name, "list_calendar_events" | "create_calendar_event" | "update_calendar_event" | "delete_calendar_event") {
        return None;
    }
    Some(run().unwrap_or_else(error_content))
}
