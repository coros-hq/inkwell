//! Minimal MCP "streamable HTTP" transport, for clients that only accept a URL
//! (ChatGPT's developer-mode connectors).
//!
//! The server binds to 127.0.0.1 only. A secret token guards every request; it
//! is accepted either as the last URL segment (`/mcp/<token>`, because ChatGPT's
//! "no authentication" connectors can't send headers) or as `Authorization: Bearer`.
//! Every POST gets a plain JSON response — no SSE streaming is needed because
//! the tools are all request/response.

use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

/// Serve until `stop` is set. Blocks the calling thread.
pub fn serve(port: u16, token: String, stop: Arc<AtomicBool>) -> io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    listener.set_nonblocking(true)?;
    eprintln!("[inkwell-mcp] HTTP server listening on 127.0.0.1:{port}");
    while !stop.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let token = token.clone();
                thread::spawn(move || {
                    let _ = handle_connection(stream, &token);
                });
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
            Err(e) => {
                eprintln!("[inkwell-mcp] accept error: {e}");
                thread::sleep(Duration::from_millis(200));
            }
        }
    }
    eprintln!("[inkwell-mcp] HTTP server stopped");
    Ok(())
}

struct HttpRequest {
    method: String,
    path: String,
    bearer: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> io::Result<HttpRequest> {
    let bad = |m: &str| io::Error::new(io::ErrorKind::InvalidData, m.to_string());
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > MAX_HEADER_BYTES {
            return Err(bad("headers too large"));
        }
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Err(bad("connection closed"));
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let method = first.next().ok_or_else(|| bad("no method"))?.to_string();
    let path = first.next().ok_or_else(|| bad("no path"))?.to_string();

    let mut content_length = 0usize;
    let mut bearer = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => content_length = value.parse().map_err(|_| bad("bad content-length"))?,
            "authorization" => {
                bearer = value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer ")).map(|t| t.trim().to_string());
            }
            _ => {}
        }
    }
    if content_length > MAX_BODY_BYTES {
        return Err(bad("body too large"));
    }

    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Err(bad("body truncated"));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(content_length);
    Ok(HttpRequest { method, path, bearer, body })
}

fn respond(stream: &mut TcpStream, status: &str, extra_headers: &str, body: &[u8]) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\n\
         {extra_headers}\r\n",
        body.len()
    )?;
    stream.write_all(body)?;
    stream.flush()
}

/// Compare without bailing at the first differing byte.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = (a.len() != b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

/// `/mcp` or `/mcp/<token>`, ignoring any query string. Returns the token segment, if any.
fn route(path: &str) -> Option<Option<&str>> {
    let path = path.split('?').next().unwrap_or("");
    let rest = path.strip_prefix("/mcp")?;
    match rest {
        "" | "/" => Some(None),
        _ => rest.strip_prefix('/').map(|t| Some(t.trim_end_matches('/'))),
    }
}

fn handle_connection(mut stream: TcpStream, token: &str) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    stream.set_write_timeout(Some(Duration::from_secs(15)))?;
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err(_) => return respond(&mut stream, "400 Bad Request", "", b""),
    };

    if req.method == "OPTIONS" {
        return respond(&mut stream, "204 No Content", "", b"");
    }

    let Some(url_token) = route(&req.path) else {
        return respond(&mut stream, "404 Not Found", "", b"");
    };
    let authorised = url_token.map_or(false, |t| constant_time_eq(t, token))
        || req.bearer.as_deref().map_or(false, |t| constant_time_eq(t, token));
    if !authorised {
        return respond(&mut stream, "401 Unauthorized", "", b"");
    }

    if req.method != "POST" {
        return respond(&mut stream, "405 Method Not Allowed", "Allow: POST\r\n", b"");
    }

    let msg: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            let body = json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32700, "message": "Parse error" } });
            return respond(&mut stream, "400 Bad Request", "Content-Type: application/json\r\n", body.to_string().as_bytes());
        }
    };

    // A JSON array is a batch of messages.
    let result = match msg {
        Value::Array(items) => {
            let responses: Vec<Value> = items.into_iter().filter_map(crate::handle_message).collect();
            (!responses.is_empty()).then(|| Value::Array(responses))
        }
        single => crate::handle_message(single),
    };

    match result {
        Some(v) => respond(&mut stream, "200 OK", "Content-Type: application/json\r\n", v.to_string().as_bytes()),
        None => respond(&mut stream, "202 Accepted", "", b""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_token_compare() {
        assert_eq!(route("/mcp"), Some(None));
        assert_eq!(route("/mcp/abc"), Some(Some("abc")));
        assert_eq!(route("/mcp/abc/?x=1"), Some(Some("abc")));
        assert_eq!(route("/other"), None);
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }

    #[test]
    fn serves_initialize_and_rejects_bad_token() {
        let port = 48731;
        let stop = Arc::new(AtomicBool::new(false));
        let s = stop.clone();
        thread::spawn(move || serve(port, "secret".into(), s).unwrap());
        thread::sleep(Duration::from_millis(300));

        let post = |path: &str, body: &str| -> String {
            let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(c, "POST {path} HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };
        assert!(post("/mcp/wrong", "{}").starts_with("HTTP/1.1 401"));
        let ok = post("/mcp/secret", r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
        assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("list_notes"), "{ok}");
        let note = post("/mcp/secret", r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert!(note.starts_with("HTTP/1.1 202"), "{note}");
        stop.store(true, Ordering::Relaxed);
    }
}
