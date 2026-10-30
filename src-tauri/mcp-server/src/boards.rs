//! Board and ticket tools. Boards are per vault: `<vault>/.inkwell/boards.json`,
//! shaped `{ version, boards, boardColumns, boardTasks }` (see `Board`,
//! `BoardColumn` and `BoardTask` in src/types/index.ts). The app watches the
//! vault and reloads when that file changes, so edits made here show up live.

use crate::{error_content, text_content};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

const PRIORITIES: [&str; 3] = ["low", "medium", "high"];
const COLUMN_COLORS: [&str; 6] = ["blue", "amber", "green", "red", "purple", "gray"];
const DEFAULT_COLUMNS: [(&str, &str); 4] =
    [("To Do", "blue"), ("In Progress", "amber"), ("In Review", "red"), ("Done", "green")];

struct Data {
    boards: Vec<Value>,
    columns: Vec<Value>,
    tasks: Vec<Value>,
}

fn boards_path(vault: &Path) -> PathBuf {
    vault.join(".inkwell").join("boards.json")
}

fn load(path: &Path) -> Result<Data, String> {
    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Data { boards: vec![], columns: vec![], tasks: vec![] })
        }
        Err(e) => return Err(format!("could not read the boards file: {e}")),
    };
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| format!("boards.json is not valid JSON: {e}"))?;
    // Be lenient about a file that was stringified twice, like calendar.json.
    if let Value::String(inner) = &value {
        value = serde_json::from_str(inner).map_err(|e| format!("boards.json is not valid JSON: {e}"))?;
    }
    let list = |key: &str| value.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    Ok(Data { boards: list("boards"), columns: list("boardColumns"), tasks: list("boardTasks") })
}

fn save(path: &Path, data: Data) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    let text = serde_json::to_string_pretty(&json!({
        "version": 1,
        "boards": data.boards,
        "boardColumns": data.columns,
        "boardTasks": data.tasks,
    }))
    .map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.inkwell-tmp");
    fs::write(&tmp, text).map_err(|e| format!("could not write the boards file: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("could not save the boards file: {e}"))
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(|v| v.as_str())
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    str_arg(v, key).unwrap_or("")
}

fn new_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("{prefix}-{:x}{:x}{:x}", nanos, std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn now_iso() -> String {
    // Civil-from-days (Howard Hinnant), so no date crate is needed.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z", rem / 3600, rem % 3600 / 60, rem % 60)
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

fn string_list(args: &Value, key: &str) -> Option<Vec<String>> {
    args.get(key).and_then(|v| v.as_array()).map(|a| {
        a.iter().filter_map(|v| v.as_str()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect()
    })
}

// ── Lookups ───────────────────────────────────────────────────────────────────

/// Finds a board by id, or by case-insensitive name.
fn find_board<'a>(data: &'a Data, key: &str) -> Result<&'a Value, String> {
    if let Some(b) = data.boards.iter().find(|b| s(b, "id") == key) {
        return Ok(b);
    }
    let named: Vec<&Value> = data.boards.iter().filter(|b| s(b, "name").eq_ignore_ascii_case(key)).collect();
    match named.as_slice() {
        [one] => Ok(one),
        [] => Err(format!("No board '{key}'. Use list_boards to see boards.")),
        _ => Err(format!("More than one board is named '{key}'; use its id.")),
    }
}

/// Finds a column by id, or by case-insensitive name within `board_id`.
fn find_column<'a>(data: &'a Data, board_id: &str, key: &str) -> Result<&'a Value, String> {
    let cols = || data.columns.iter().filter(|c| s(c, "boardId") == board_id);
    cols()
        .find(|c| s(c, "id") == key)
        .or_else(|| cols().find(|c| s(c, "name").eq_ignore_ascii_case(key)))
        .ok_or_else(|| {
            let names: Vec<&str> = cols().map(|c| s(c, "name")).collect();
            format!("No column '{key}' on this board. Columns: {}", names.join(", "))
        })
}

fn task_index(data: &Data, id: &str) -> Result<usize, String> {
    data.tasks.iter().position(|t| s(t, "id") == id).ok_or_else(|| format!("No task with id '{id}'"))
}

fn column_index(data: &Data, id: &str) -> Option<usize> {
    data.columns.iter().position(|c| s(c, "id") == id)
}

fn board_name(data: &Data, id: &str) -> String {
    data.boards.iter().find(|b| s(b, "id") == id).map_or("?".into(), |b| s(b, "name").to_string())
}

fn describe_task(data: &Data, t: &Value) -> String {
    let col = data.columns.iter().find(|c| s(c, "id") == s(t, "columnId")).map_or("?", |c| s(c, "name"));
    let mut line = format!("{} | [{}] {} | {} priority", s(t, "id"), col, s(t, "title"), s(t, "priority"));
    if let Some(d) = str_arg(t, "dueDate") {
        line.push_str(&format!(" | due {}", d.get(..10).unwrap_or(d)));
    }
    if let Some(a) = str_arg(t, "assignee") {
        line.push_str(&format!(" | @{a}"));
    }
    let tags: Vec<&str> =
        t.get("tags").and_then(|v| v.as_array()).map_or(vec![], |a| a.iter().filter_map(|v| v.as_str()).collect());
    if !tags.is_empty() {
        line.push_str(&format!(" | #{}", tags.join(" #")));
    }
    let subs = t.get("subtasks").and_then(|v| v.as_array()).map_or(&[][..], |a| a.as_slice());
    if !subs.is_empty() {
        let done = subs.iter().filter(|x| x.get("completed").and_then(|v| v.as_bool()) == Some(true)).count();
        line.push_str(&format!(" | subtasks {done}/{}", subs.len()));
    }
    line
}

// ── Task mutation ─────────────────────────────────────────────────────────────

/// Copies the validated fields of `args` onto `task`. An empty string clears an
/// optional field. `column` (id or name) is resolved separately by the caller.
fn apply_task_fields(task: &mut Map<String, Value>, args: &Value) -> Result<(), String> {
    if let Some(t) = str_arg(args, "title") {
        if t.trim().is_empty() {
            return Err("title cannot be empty".into());
        }
        task.insert("title".into(), json!(t.trim()));
    }
    if let Some(d) = str_arg(args, "description") {
        task.insert("description".into(), json!(d));
    }
    if let Some(p) = str_arg(args, "priority") {
        if !PRIORITIES.contains(&p) {
            return Err(format!("priority must be one of {}, got '{p}'", PRIORITIES.join(", ")));
        }
        task.insert("priority".into(), json!(p));
    }
    if let Some(a) = str_arg(args, "assignee") {
        if a.trim().is_empty() {
            task.remove("assignee");
        } else {
            task.insert("assignee".into(), json!(a.trim()));
        }
    }
    if let Some(d) = str_arg(args, "due_date") {
        if d.is_empty() {
            task.remove("dueDate");
        } else if is_date(d) {
            task.insert("dueDate".into(), json!(d));
        } else {
            return Err(format!("due_date must be YYYY-MM-DD, got '{d}'"));
        }
    }
    if let Some(tags) = string_list(args, "tags") {
        task.insert("tags".into(), json!(tags));
    }
    if let Some(subs) = args.get("subtasks").and_then(|v| v.as_array()) {
        // Entries are titles, or { title, completed }. Ids of existing subtasks
        // are kept when the title matches, so progress isn't reset by a rewrite.
        let old: Vec<Value> = task.get("subtasks").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let mut out = Vec::new();
        for sub in subs {
            let (title, completed) = match sub {
                Value::String(t) => (t.trim().to_string(), None),
                other => (s(other, "title").trim().to_string(), other.get("completed").and_then(|v| v.as_bool())),
            };
            if title.is_empty() {
                return Err("subtask titles cannot be empty".into());
            }
            let prev = old.iter().find(|o| s(o, "title") == title);
            let id = prev.map_or_else(|| new_id("sub"), |o| s(o, "id").to_string());
            let was = prev.and_then(|o| o.get("completed")).and_then(|v| v.as_bool()).unwrap_or(false);
            out.push(json!({ "id": id, "title": title, "completed": completed.unwrap_or(was) }));
        }
        task.insert("subtasks".into(), Value::Array(out));
    }
    Ok(())
}

/// Moves a task to `column_id` (appended to the end), keeping both columns'
/// ordered `taskIds` consistent.
fn move_task(data: &mut Data, task_id: &str, column_id: &str) {
    for c in data.columns.iter_mut() {
        if let Some(ids) = c.get_mut("taskIds").and_then(|v| v.as_array_mut()) {
            ids.retain(|i| i.as_str() != Some(task_id));
        }
    }
    if let Some(i) = column_index(data, column_id) {
        let ids = data.columns[i].as_object_mut().unwrap().entry("taskIds").or_insert_with(|| json!([]));
        if let Some(a) = ids.as_array_mut() {
            a.push(json!(task_id));
        }
    }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

pub fn tools() -> Vec<Value> {
    let task_fields = json!({
        "description": { "type": "string", "description": "Ticket body (markdown)." },
        "priority": { "type": "string", "enum": PRIORITIES },
        "assignee": { "type": "string", "description": "Who owns it. Empty string clears." },
        "due_date": { "type": "string", "description": "YYYY-MM-DD. Empty string clears." },
        "tags": { "type": "array", "items": { "type": "string" }, "description": "Replaces the tag list." },
        "subtasks": {
            "type": "array",
            "description": "Replaces the checklist. Each item is a title string or { title, completed }.",
            "items": {}
        }
    });
    let with = |extra: Value| {
        let mut p = task_fields.as_object().unwrap().clone();
        p.extend(extra.as_object().unwrap().clone());
        Value::Object(p)
    };
    vec![
        json!({
            "name": "list_boards",
            "description": "List the kanban boards in the active inkwell vault, with their columns and ticket counts. Call this first to learn board and column names.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "list_board_tasks",
            "description": "List tickets on a board, grouped by column in board order. Optionally filter to one column. Returns ticket ids needed by the other ticket tools.",
            "inputSchema": { "type": "object", "required": ["board"], "properties": {
                "board": { "type": "string", "description": "Board id or name." },
                "column": { "type": "string", "description": "Only this column (id or name)." }
            } }
        }),
        json!({
            "name": "read_board_task",
            "description": "Read one ticket in full: description, subtasks and comments.",
            "inputSchema": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" } } }
        }),
        json!({
            "name": "create_board",
            "description": "Create a board. Without `columns` it gets the standard To Do / In Progress / In Review / Done columns.",
            "inputSchema": { "type": "object", "required": ["name"], "properties": {
                "name": { "type": "string" },
                "columns": { "type": "array", "items": { "type": "string" }, "description": "Custom column names, in order." }
            } }
        }),
        json!({
            "name": "rename_board",
            "description": "Rename a board.",
            "inputSchema": { "type": "object", "required": ["board", "name"], "properties": {
                "board": { "type": "string", "description": "Board id or name." },
                "name": { "type": "string" }
            } }
        }),
        json!({
            "name": "delete_board",
            "description": "Permanently delete a board along with all its columns and tickets. Confirm with the user first.",
            "inputSchema": { "type": "object", "required": ["board"], "properties": {
                "board": { "type": "string", "description": "Board id or name." }
            } }
        }),
        json!({
            "name": "create_board_task",
            "description": "Create a ticket in a column of a board. Returns the new ticket id.",
            "inputSchema": { "type": "object", "required": ["board", "title"],
                "properties": with(json!({
                    "board": { "type": "string", "description": "Board id or name." },
                    "column": { "type": "string", "description": "Column id or name. Defaults to the board's first column." },
                    "title": { "type": "string" }
                })) }
        }),
        json!({
            "name": "update_board_task",
            "description": "Change a ticket by id (get ids from list_board_tasks). Only the fields you pass change. Pass `column` to move it to another column of the same board (it lands at the bottom).",
            "inputSchema": { "type": "object", "required": ["id"],
                "properties": with(json!({
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "column": { "type": "string", "description": "Move to this column (id or name)." }
                })) }
        }),
        json!({
            "name": "comment_on_board_task",
            "description": "Add a comment to a ticket, posted as Claude.",
            "inputSchema": { "type": "object", "required": ["id", "content"], "properties": {
                "id": { "type": "string" },
                "content": { "type": "string" }
            } }
        }),
        json!({
            "name": "delete_board_task",
            "description": "Permanently delete a ticket by id. Confirm with the user first.",
            "inputSchema": { "type": "object", "required": ["id"], "properties": { "id": { "type": "string" } } }
        }),
    ]
}

const TOOL_NAMES: [&str; 10] = [
    "list_boards",
    "list_board_tasks",
    "read_board_task",
    "create_board",
    "rename_board",
    "delete_board",
    "create_board_task",
    "update_board_task",
    "comment_on_board_task",
    "delete_board_task",
];

/// Returns None when `name` isn't a board tool.
pub fn call(name: &str, args: &Value, vault: &Path) -> Option<Value> {
    if !TOOL_NAMES.contains(&name) {
        return None;
    }
    Some(run(name, args, vault).unwrap_or_else(error_content))
}

fn run(name: &str, args: &Value, vault: &Path) -> Result<Value, String> {
    let path = boards_path(vault);
    let mut data = load(&path)?;
    let req = |key: &str| str_arg(args, key).filter(|v| !v.trim().is_empty()).ok_or_else(|| format!("{key} is required"));

    match name {
        "list_boards" => {
            if data.boards.is_empty() {
                return Ok(text_content("No boards in this vault."));
            }
            let lines: Vec<String> = data
                .boards
                .iter()
                .map(|b| {
                    let cols: Vec<String> = b
                        .get("columnIds")
                        .and_then(|v| v.as_array())
                        .map_or(vec![], |ids| ids.iter().filter_map(|i| i.as_str()).collect())
                        .into_iter()
                        .filter_map(|id| data.columns.iter().find(|c| s(c, "id") == id))
                        .map(|c| {
                            let n = c.get("taskIds").and_then(|v| v.as_array()).map_or(0, |a| a.len());
                            format!("{} ({n})", s(c, "name"))
                        })
                        .collect();
                    format!("{} | {} | columns: {}", s(b, "id"), s(b, "name"), cols.join(", "))
                })
                .collect();
            Ok(text_content(format!("{} board(s):\n\n{}", lines.len(), lines.join("\n"))))
        }
        "list_board_tasks" => {
            let board = find_board(&data, req("board")?)?;
            let board_id = s(board, "id");
            let only = match str_arg(args, "column").filter(|c| !c.is_empty()) {
                Some(c) => Some(s(find_column(&data, board_id, c)?, "id").to_string()),
                None => None,
            };
            let order: Vec<&str> = board
                .get("columnIds")
                .and_then(|v| v.as_array())
                .map_or(vec![], |ids| ids.iter().filter_map(|i| i.as_str()).collect());
            let mut out = Vec::new();
            for col_id in order {
                if only.as_deref().map_or(false, |o| o != col_id) {
                    continue;
                }
                let Some(col) = data.columns.iter().find(|c| s(c, "id") == col_id) else { continue };
                let tasks: Vec<String> = col
                    .get("taskIds")
                    .and_then(|v| v.as_array())
                    .map_or(vec![], |ids| ids.iter().filter_map(|i| i.as_str()).collect())
                    .into_iter()
                    .filter_map(|id| data.tasks.iter().find(|t| s(t, "id") == id))
                    .map(|t| format!("  {}", describe_task(&data, t)))
                    .collect();
                let body = if tasks.is_empty() { "  (empty)".to_string() } else { tasks.join("\n") };
                out.push(format!("## {} ({})\n{body}", s(col, "name"), tasks.len()));
            }
            Ok(text_content(format!("Board: {}\n\n{}", s(board, "name"), out.join("\n\n"))))
        }
        "read_board_task" => {
            let i = task_index(&data, req("id")?)?;
            let t = &data.tasks[i];
            let mut out = format!("{}\nBoard: {}\n", describe_task(&data, t), board_name(&data, s(t, "boardId")));
            let desc = s(t, "description");
            out.push_str(&format!("\nDescription:\n{}\n", if desc.is_empty() { "(none)" } else { desc }));
            for sub in t.get("subtasks").and_then(|v| v.as_array()).into_iter().flatten() {
                let mark = if sub.get("completed").and_then(|v| v.as_bool()) == Some(true) { "x" } else { " " };
                out.push_str(&format!("\n- [{mark}] {}", s(sub, "title")));
            }
            for c in t.get("comments").and_then(|v| v.as_array()).into_iter().flatten() {
                out.push_str(&format!("\n\n{} ({}): {}", s(c, "author"), s(c, "createdAt"), s(c, "content")));
            }
            Ok(text_content(out))
        }
        "create_board" => {
            let board_name = req("name")?.trim().to_string();
            let defs: Vec<(String, &str)> = match string_list(args, "columns") {
                Some(names) if !names.is_empty() => {
                    names.into_iter().enumerate().map(|(i, n)| (n, COLUMN_COLORS[i % COLUMN_COLORS.len()])).collect()
                }
                _ => DEFAULT_COLUMNS.iter().map(|(n, c)| (n.to_string(), *c)).collect(),
            };
            let board_id = new_id("board");
            let mut column_ids = Vec::new();
            for (n, color) in &defs {
                let id = new_id("col");
                column_ids.push(json!(id));
                data.columns.push(json!({ "id": id, "boardId": board_id, "name": n, "color": color, "taskIds": [] }));
            }
            data.boards.push(json!({ "id": board_id, "name": board_name, "columnIds": column_ids }));
            save(&path, data)?;
            let names: Vec<&str> = defs.iter().map(|(n, _)| n.as_str()).collect();
            Ok(text_content(format!("Created board '{board_name}' ({board_id}) with columns: {}", names.join(", "))))
        }
        "rename_board" => {
            let new_name = req("name")?.trim().to_string();
            let id = s(find_board(&data, req("board")?)?, "id").to_string();
            let b = data.boards.iter_mut().find(|b| s(b, "id") == id).unwrap();
            b["name"] = json!(new_name);
            save(&path, data)?;
            Ok(text_content(format!("Renamed board {id} to '{new_name}'")))
        }
        "delete_board" => {
            let board = find_board(&data, req("board")?)?;
            let (id, name) = (s(board, "id").to_string(), s(board, "name").to_string());
            let before = data.tasks.len();
            data.boards.retain(|b| s(b, "id") != id);
            data.columns.retain(|c| s(c, "boardId") != id);
            data.tasks.retain(|t| s(t, "boardId") != id);
            let removed = before - data.tasks.len();
            save(&path, data)?;
            Ok(text_content(format!("Deleted board '{name}' and its {removed} ticket(s)")))
        }
        "create_board_task" => {
            let title = req("title")?.trim().to_string();
            let board = find_board(&data, req("board")?)?;
            let board_id = s(board, "id").to_string();
            let column = match str_arg(args, "column").filter(|c| !c.is_empty()) {
                Some(c) => find_column(&data, &board_id, c)?,
                None => board
                    .get("columnIds")
                    .and_then(|v| v.as_array())
                    .and_then(|ids| ids.first())
                    .and_then(|i| i.as_str())
                    .and_then(|id| data.columns.iter().find(|c| s(c, "id") == id))
                    .ok_or("This board has no columns")?,
            };
            let column_id = s(column, "id").to_string();
            let id = new_id("btask");
            let mut task = Map::new();
            task.insert("id".into(), json!(id));
            task.insert("boardId".into(), json!(board_id));
            task.insert("columnId".into(), json!(column_id));
            task.insert("title".into(), json!(title));
            task.insert("description".into(), json!(""));
            task.insert("priority".into(), json!("medium"));
            task.insert("tags".into(), json!([]));
            task.insert("subtasks".into(), json!([]));
            task.insert("comments".into(), json!([]));
            task.insert("createdAt".into(), json!(now_iso()));
            apply_task_fields(&mut task, args)?;
            let task = Value::Object(task);
            let summary = describe_task(&data, &task);
            data.tasks.push(task);
            move_task(&mut data, &id, &column_id);
            save(&path, data)?;
            Ok(text_content(format!("Created: {summary}")))
        }
        "update_board_task" => {
            let i = task_index(&data, req("id")?)?;
            let mut task = data.tasks[i].as_object().cloned().unwrap_or_default();
            apply_task_fields(&mut task, args)?;
            let id = s(&data.tasks[i], "id").to_string();
            let mut new_column = None;
            if let Some(c) = str_arg(args, "column").filter(|c| !c.is_empty()) {
                let col = find_column(&data, s(&data.tasks[i], "boardId"), c)?;
                if s(col, "id") != s(&data.tasks[i], "columnId") {
                    new_column = Some(s(col, "id").to_string());
                }
            }
            if let Some(col) = &new_column {
                task.insert("columnId".into(), json!(col));
            }
            data.tasks[i] = Value::Object(task);
            if let Some(col) = new_column {
                move_task(&mut data, &id, &col);
            }
            let summary = describe_task(&data, &data.tasks[i]);
            save(&path, data)?;
            Ok(text_content(format!("Updated: {summary}")))
        }
        "comment_on_board_task" => {
            let content = req("content")?.trim().to_string();
            let i = task_index(&data, req("id")?)?;
            let comment = json!({
                "id": new_id("comment"),
                "author": "Claude",
                "avatar": "C",
                "content": content,
                "createdAt": now_iso(),
            });
            let task = data.tasks[i].as_object_mut().unwrap();
            let comments = task.entry("comments").or_insert_with(|| json!([]));
            if let Some(a) = comments.as_array_mut() {
                a.push(comment);
            }
            let title = s(&data.tasks[i], "title").to_string();
            save(&path, data)?;
            Ok(text_content(format!("Commented on '{title}'")))
        }
        "delete_board_task" => {
            let i = task_index(&data, req("id")?)?;
            let gone = data.tasks.remove(i);
            for c in data.columns.iter_mut() {
                if let Some(ids) = c.get_mut("taskIds").and_then(|v| v.as_array_mut()) {
                    ids.retain(|t| t.as_str() != Some(s(&gone, "id")));
                }
            }
            let summary = describe_task(&data, &gone);
            save(&path, data)?;
            Ok(text_content(format!("Deleted: {summary}")))
        }
        _ => unreachable!(),
    }
}
