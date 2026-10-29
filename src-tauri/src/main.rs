// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `inkwell --mcp`: serve MCP over stdio for Claude Desktop instead of opening the UI.
    if std::env::args().any(|a| a == "--mcp") {
        inkwell_lib::run_mcp();
        return;
    }
    inkwell_lib::run()
}
