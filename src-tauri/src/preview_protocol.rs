//! `ccgui-preview://` — file protocol behind the HTML preview tab.
//!
//! Tauri's asset protocol encodes a whole absolute path into a single URL
//! segment (`asset://localhost/%2FUsers%2F…%2Findex.html`), so a document
//! served through it has no directory structure left to resolve against:
//! every relative reference (`draft.css`, `<script src="draft.js">`) collapses
//! to `asset://localhost/draft.css` and 404s while the document itself renders
//! unstyled. This protocol keeps a real path shape — one encoded segment per
//! path segment — so relative references resolve exactly as they do when the
//! file is opened in a browser.
//!
//! Access model. A previewed page is untrusted (a cloned repo, an agent's
//! output), and it runs scripts, so the protocol must not be a window onto
//! the home directory:
//! - `preview_open` checks the file against the same workspace boundary as
//!   `read_file`, then issues an unguessable token for the file's directory.
//!   URLs are `/<token>/<segment>/…` and resolve only inside that directory,
//!   after canonicalization — a symlink or junction cannot lead out. The
//!   token table lives in memory and is bounded.
//! - The iframe sandbox gives the page an opaque origin (no
//!   `allow-same-origin`, see `HtmlPreview.tsx`), and responses carry no CORS
//!   grant, so the page cannot read responses as data.
//! - Every response carries a CSP that forbids connections, form posts and
//!   frames: whatever the page can see, it has nowhere to send.
//!
//! The frontend builds URLs in `src/lib/preview-url.ts`; the app CSP needs
//! `frame-src ccgui-preview: http://ccgui-preview.localhost`.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::Runtime;

/// Scheme name; Windows maps custom protocols to `http://<name>.localhost`.
pub const PROTOCOL: &str = "ccgui-preview";

/// Preview roots kept at once; the oldest is forgotten past this (its frame
/// then 404s, and reopening the tab issues a fresh token).
const MAX_ROOTS: usize = 64;
/// `Uuid::simple()` length: 32 lowercase hex digits.
const TOKEN_LEN: usize = 32;

/// No connections, posts, frames or plugins; scripts, styles and media only
/// from the preview root itself (plus inline / data: / blob:, which drafts
/// rely on). `'self'` is spelled out as the scheme and the Windows host too:
/// a sandboxed document's own origin is opaque, and engines differ on what
/// `'self'` then matches.
const PREVIEW_CSP: &str = "default-src 'none'; \
    script-src 'self' ccgui-preview: http://ccgui-preview.localhost 'unsafe-inline' 'unsafe-eval' blob:; \
    style-src 'self' ccgui-preview: http://ccgui-preview.localhost 'unsafe-inline' data: blob:; \
    img-src 'self' ccgui-preview: http://ccgui-preview.localhost data: blob:; \
    font-src 'self' ccgui-preview: http://ccgui-preview.localhost data:; \
    media-src 'self' ccgui-preview: http://ccgui-preview.localhost data: blob:; \
    worker-src 'self' ccgui-preview: http://ccgui-preview.localhost blob:; \
    connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";

/// Token → canonical directory, oldest first.
struct Roots {
    entries: VecDeque<(String, PathBuf)>,
}

impl Roots {
    const fn new() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }

    /// Token for `root`: reused while the root is still in the table (a
    /// reloaded preview keeps its URL), otherwise fresh; evicts the oldest
    /// root once the table is full.
    fn issue(&mut self, root: PathBuf) -> String {
        if let Some(index) = self.entries.iter().position(|(_, known)| *known == root) {
            let entry = self.entries.remove(index).expect("index from position");
            let token = entry.0.clone();
            self.entries.push_back(entry);
            return token;
        }
        if self.entries.len() >= MAX_ROOTS {
            self.entries.pop_front();
        }
        let token = uuid::Uuid::new_v4().simple().to_string();
        self.entries.push_back((token.clone(), root));
        token
    }

    fn lookup(&self, token: &str) -> Option<PathBuf> {
        self.entries
            .iter()
            .find(|(known, _)| known == token)
            .map(|(_, root)| root.clone())
    }
}

static ROOTS: parking_lot::Mutex<Roots> = parking_lot::Mutex::new(Roots::new());

/// What the frontend needs to build the preview URL (`src/lib/preview-url.ts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct PreviewTarget {
    pub token: String,
    /// The file's name inside its root (the URL's single path segment).
    pub name: String,
}

/// Scope a preview to `file`'s directory. `file` must already have passed the
/// workspace boundary; it is canonicalized again here so the stored root has
/// the same form request paths are canonicalized to.
fn open_root(file: &Path, roots: &mut Roots) -> Result<PreviewTarget, String> {
    let file = std::fs::canonicalize(file).map_err(|error| format!("preview: {error}"))?;
    crate::paths::RelayToolsBoundary::new()?.ensure_path(&file)?;
    if !file.is_file() {
        return Err("preview: not a file".to_string());
    }
    let name = file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "preview: file name is not valid UTF-8".to_string())?
        .to_string();
    let root = file
        .parent()
        .ok_or_else(|| "preview: file has no directory".to_string())?
        .to_path_buf();
    Ok(PreviewTarget {
        token: roots.issue(root),
        name,
    })
}

/// Issue a preview root for `path`. Same boundary as `read_file`: workspace
/// roots, granted directories and the pasted-images sandbox only. Desktop
/// only — the web bridge has no route for it.
#[tauri::command]
pub(crate) async fn preview_open(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    path: String,
) -> Result<PreviewTarget, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let file = crate::files::ensure_allowed(&path, &db)?;
        open_root(&file, &mut ROOTS.lock())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decode one `%XX`-escaped URL segment. A decoded `/`, `\`, NUL or dot
/// segment would change the path structure the browser resolved against —
/// reject it instead of silently retargeting the request at another file.
/// On Windows a `:` would name a drive or an alternate data stream.
fn decode_segment(segment: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(segment.len());
    let mut input = segment.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let high = hex_digit(input.next()?)?;
            let low = hex_digit(input.next()?)?;
            bytes.push(high * 16 + low);
        } else {
            bytes.push(byte);
        }
    }
    let decoded = String::from_utf8(bytes).ok()?;
    if decoded.is_empty()
        || decoded.contains(['/', '\\', '\0'])
        || (cfg!(windows) && decoded.contains(':'))
        || matches!(decoded.as_str(), "." | "..")
    {
        return None;
    }
    Some(decoded)
}

/// URI path `/<token>/<seg>/…` → (token, decoded segments relative to the
/// root). The token must have the exact shape `issue` produces.
fn parse_request_path(uri_path: &str) -> Option<(&str, Vec<String>)> {
    let rest = uri_path.strip_prefix('/')?;
    let (token, rest) = rest.split_once('/')?;
    let well_formed = token.len() == TOKEN_LEN
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !well_formed {
        return None;
    }
    let segments = rest
        .split('/')
        .map(decode_segment)
        .collect::<Option<Vec<_>>>()?;
    Some((token, segments))
}

/// `root` joined with `segments`, canonicalized (following symlinks and
/// junctions) and required to still lie inside `root`.
fn resolve_in_root(root: &Path, segments: &[String]) -> Result<PathBuf, StatusCode> {
    let mut candidate = root.to_path_buf();
    candidate.extend(segments);
    let resolved = std::fs::canonicalize(&candidate).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    })?;
    if !resolved.starts_with(root) {
        return Err(StatusCode::FORBIDDEN);
    }
    crate::paths::RelayToolsBoundary::new()
        .and_then(|boundary| boundary.ensure_path(&resolved))
        .map_err(|_| StatusCode::FORBIDDEN)?;
    if !resolved.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(resolved)
}

/// By extension only. Anything unlisted is `application/octet-stream`: a
/// `.log` or extension-less file must never be served as `text/html`.
fn mime_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    match extension.as_deref() {
        Some("html" | "htm") => "text/html",
        Some("xhtml") => "application/xhtml+xml",
        Some("css") => "text/css",
        Some("js" | "mjs" | "cjs") => "text/javascript",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("txt" | "md") => "text/plain",
        Some("csv") => "text/csv",
        Some("xml") => "application/xml",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// Single-range request (`bytes=0-99`, `bytes=100-`, `bytes=-50`). Multi-range
/// requests are ignored — serving the full body is a legal answer and rallying
/// a multipart body buys nothing for HTML drafts.
fn parse_single_range(value: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.trim().split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.trim().parse().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), len - 1));
    }
    let start: u64 = start.trim().parse().ok()?;
    if start >= len {
        return None;
    }
    let end = match end.trim() {
        "" => len - 1,
        end => end.parse::<u64>().ok()?.min(len - 1),
    };
    (end >= start).then_some((start, end))
}

/// Headers every preview response carries, error pages included.
fn secured(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header(header::CONTENT_SECURITY_POLICY, PREVIEW_CSP)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::REFERRER_POLICY, "no-referrer")
        // Drafts are edited and refreshed in place; never replay a stale copy.
        .header(header::CACHE_CONTROL, "no-store")
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    eprintln!("[preview] {message}");
    secured(Response::builder())
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .expect("static preview response")
}

fn handle<F: Fn(&str) -> Option<PathBuf>>(
    request: &Request<Vec<u8>>,
    root_for: F,
) -> Response<Vec<u8>> {
    let Some((token, segments)) = parse_request_path(request.uri().path()) else {
        return error_response(StatusCode::BAD_REQUEST, "invalid preview path");
    };
    let Some(root) = root_for(token) else {
        return error_response(StatusCode::NOT_FOUND, "unknown or expired preview");
    };
    let path = match resolve_in_root(&root, &segments) {
        Ok(path) => path,
        Err(StatusCode::NOT_FOUND) => {
            return error_response(StatusCode::NOT_FOUND, "preview file not found");
        }
        Err(status) => return error_response(status, "preview path leaves its directory"),
    };

    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return error_response(StatusCode::FORBIDDEN, "preview file not readable");
        }
        Err(error) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("preview open failed: {error}"),
            );
        }
    };
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let builder = secured(Response::builder())
        .header(header::CONTENT_TYPE, mime_for(&path))
        .header(header::ACCEPT_RANGES, "bytes");

    if request.method() == Method::HEAD {
        return builder
            .header(header::CONTENT_LENGTH, len)
            .body(Vec::new())
            .expect("static preview response");
    }

    let requested_range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_single_range(value, len));
    if let Some((start, end)) = requested_range {
        let nbytes = end + 1 - start;
        let mut buffer = Vec::with_capacity(nbytes as usize);
        if file.seek(SeekFrom::Start(start)).is_err()
            || file.take(nbytes).read_to_end(&mut buffer).is_err()
        {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "preview range read failed",
            );
        }
        return builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, nbytes)
            .body(buffer)
            .expect("static preview response");
    }

    let mut buffer = Vec::with_capacity(len as usize);
    if file.read_to_end(&mut buffer).is_err() {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, "preview read failed");
    }
    builder
        .header(header::CONTENT_LENGTH, len)
        .body(buffer)
        .expect("static preview response")
}

pub(crate) fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(PROTOCOL, |_context, request, responder| {
        // Off the webview thread: file reads are blocking, and drafts can pull
        // in media along with their stylesheets.
        tauri::async_runtime::spawn(async move {
            let response = handle(&request, |token| ROOTS.lock().lookup(token));
            responder.respond(response);
        });
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn get(uri_path: &str) -> Request<Vec<u8>> {
        Request::builder()
            .method(Method::GET)
            .uri(uri_path)
            .body(Vec::new())
            .unwrap()
    }

    /// The frontend contract (`previewUrl`): the token, then each segment
    /// percent-encoded the way `encodeURIComponent` does.
    fn encode_segment(segment: &str) -> String {
        let mut out = String::new();
        for byte in segment.bytes() {
            let safe =
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
            if safe {
                out.push(byte as char);
            } else {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
        out
    }

    fn url(relative: &[&str]) -> String {
        let segments: Vec<String> = relative.iter().map(|s| encode_segment(s)).collect();
        format!("/{TOKEN}/{}", segments.join("/"))
    }

    /// A scratch preview root with `index.html`, a sibling and a nested file,
    /// plus a secret one level up that must stay out of reach.
    struct Scratch {
        base: PathBuf,
        root: PathBuf,
    }

    impl Scratch {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir()
                .join(format!("ccgui preview {tag} {}", uuid::Uuid::new_v4()));
            let root = base.join("draft dir");
            std::fs::create_dir_all(root.join("assets")).unwrap();
            std::fs::write(root.join("index.html"), "<link rel=stylesheet href=draft.css>")
                .unwrap();
            std::fs::write(root.join("draft.css"), ".x{color:red}").unwrap();
            std::fs::write(root.join("assets").join("logo.svg"), "<svg/>").unwrap();
            std::fs::write(root.join("notes.log"), "<script>alert(1)</script>").unwrap();
            std::fs::write(root.join("README"), "<b>plain</b>").unwrap();
            std::fs::write(base.join("secret.json"), "{\"token\":\"s3cret\"}").unwrap();
            let root = std::fs::canonicalize(root).unwrap();
            Self { base, root }
        }

        fn lookup(&self) -> impl Fn(&str) -> Option<PathBuf> + '_ {
            move |token| (token == TOKEN).then(|| self.root.clone())
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    #[test]
    fn ancestor_preview_token_cannot_serve_relay_credentials() {
        let scratch = Scratch::new("relay-boundary");
        let secret = scratch.root.join("relay-tools/.auth-fixture/home/.wrangler/config/default.toml");
        std::fs::create_dir_all(secret.parent().unwrap()).unwrap();
        std::fs::write(&secret, b"fake-oauth-token").unwrap();
        crate::paths::with_test_app_home(&scratch.root, || {
            let mut roots = Roots::new();
            assert!(open_root(&secret, &mut roots).is_err());
            let response = handle(
                &get(&url(&["relay-tools", ".auth-fixture", "home", ".wrangler", "config", "default.toml"])),
                scratch.lookup(),
            );
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            assert_eq!(handle(&get(&url(&["index.html"])), scratch.lookup()).status(), StatusCode::OK);
        });
    }

    #[test]
    fn issues_one_token_per_root_and_forgets_the_oldest_past_the_cap() {
        let mut roots = Roots::new();
        let first = roots.issue(PathBuf::from("/a"));
        assert_eq!(first.len(), TOKEN_LEN);
        assert!(parse_request_path(&format!("/{first}/x.html")).is_some());
        // Reopening the same directory keeps its URL stable.
        assert_eq!(roots.issue(PathBuf::from("/a")), first);
        assert_ne!(roots.issue(PathBuf::from("/b")), first);
        assert_eq!(roots.lookup(&first), Some(PathBuf::from("/a")));

        for index in 0..MAX_ROOTS {
            roots.issue(PathBuf::from(format!("/fill/{index}")));
        }
        assert_eq!(roots.entries.len(), MAX_ROOTS);
        assert_eq!(roots.lookup(&first), None, "oldest root must be evicted");
    }

    #[test]
    fn parses_token_and_relative_segments_only() {
        assert_eq!(
            parse_request_path(&format!("/{TOKEN}/a%20b/%E4%B8%AD.css")),
            Some((TOKEN, vec!["a b".to_string(), "中.css".to_string()]))
        );
        for uri_path in [
            "",
            "/",
            "/index.html",
            "/Users/a/index.html",
            "/0123/index.html",
            "/0123456789ABCDEF0123456789ABCDEF/index.html",
            &format!("/{TOKEN}"),
            &format!("/{TOKEN}/"),
            &format!("/{TOKEN}/../secret.json"),
            &format!("/{TOKEN}/%2E%2E/secret.json"),
            &format!("/{TOKEN}/a/./b"),
            &format!("/{TOKEN}/a%2Fb"),
            &format!("/{TOKEN}/a%5Cb"),
            &format!("/{TOKEN}/a%00b"),
            &format!("/{TOKEN}/a//b"),
            &format!("/{TOKEN}/%zz"),
        ] {
            assert_eq!(parse_request_path(uri_path), None, "accepted {uri_path}");
        }
    }

    #[test]
    fn serves_the_document_and_its_siblings_inside_the_root() {
        let scratch = Scratch::new("serve");
        let document = handle(&get(&url(&["index.html"])), scratch.lookup());
        assert_eq!(document.status(), StatusCode::OK);
        assert_eq!(document.headers()[header::CONTENT_TYPE], "text/html");
        assert!(String::from_utf8(document.into_body())
            .unwrap()
            .contains("draft.css"));

        let sibling = handle(&get(&url(&["draft.css"])), scratch.lookup());
        assert_eq!(sibling.status(), StatusCode::OK);
        assert_eq!(sibling.headers()[header::CONTENT_TYPE], "text/css");
        assert_eq!(sibling.into_body(), b".x{color:red}");

        let nested = handle(&get(&url(&["assets", "logo.svg"])), scratch.lookup());
        assert_eq!(nested.status(), StatusCode::OK);
        assert_eq!(nested.headers()[header::CONTENT_TYPE], "image/svg+xml");

        assert_eq!(
            handle(&get(&url(&["missing.css"])), scratch.lookup()).status(),
            StatusCode::NOT_FOUND
        );
        // A directory is not a file to serve.
        assert_eq!(
            handle(&get(&url(&["assets"])), scratch.lookup()).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn never_serves_outside_the_root_or_without_a_known_token() {
        let scratch = Scratch::new("escape");
        // The old URL shape: any absolute path under $HOME.
        for absolute in ["/Users/u/.codex/auth.json", "/C:/Users/u/.claude/.credentials.json"] {
            assert_eq!(
                handle(&get(absolute), scratch.lookup()).status(),
                StatusCode::BAD_REQUEST,
                "{absolute}"
            );
        }
        assert_eq!(
            handle(
                &get(&format!("/{TOKEN}/%2E%2E/secret.json")),
                scratch.lookup()
            )
            .status(),
            StatusCode::BAD_REQUEST
        );
        let other_token = "ffffffffffffffffffffffffffffffff";
        assert_eq!(
            handle(&get(&format!("/{other_token}/index.html")), scratch.lookup()).status(),
            StatusCode::NOT_FOUND
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_the_root_cannot_lead_out() {
        let scratch = Scratch::new("symlink");
        std::os::unix::fs::symlink(scratch.base.join("secret.json"), scratch.root.join("link.json"))
            .unwrap();
        std::os::unix::fs::symlink(&scratch.base, scratch.root.join("up")).unwrap();
        for relative in [&["link.json"][..], &["up", "secret.json"][..]] {
            let response = handle(&get(&url(relative)), scratch.lookup());
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{relative:?}");
            assert!(!String::from_utf8_lossy(response.body()).contains("s3cret"));
        }
    }

    #[test]
    fn every_response_forbids_outbound_requests_and_cors_reads() {
        let scratch = Scratch::new("headers");
        for response in [
            handle(&get(&url(&["index.html"])), scratch.lookup()),
            handle(&get(&url(&["missing.css"])), scratch.lookup()),
            handle(&get("/bad"), scratch.lookup()),
        ] {
            let headers = response.headers();
            let csp = headers[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
            assert!(csp.contains("connect-src 'none'"), "{csp}");
            assert!(csp.contains("form-action 'none'"), "{csp}");
            assert!(csp.contains("frame-src 'none'"), "{csp}");
            assert!(!csp.contains("https:"), "no remote origin may be allowed: {csp}");
            assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
            // An opaque-origin frame sends `Origin: null`; `ACAO: null` would
            // hand it every response as readable data.
            assert!(headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        }
    }

    #[test]
    fn unknown_types_are_never_served_as_html() {
        let scratch = Scratch::new("mime");
        for relative in ["notes.log", "README"] {
            let response = handle(&get(&url(&[relative])), scratch.lookup());
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()[header::CONTENT_TYPE],
                "application/octet-stream",
                "{relative}"
            );
        }
        assert_eq!(mime_for(Path::new("a.HTM")), "text/html");
        assert_eq!(mime_for(Path::new("a.mjs")), "text/javascript");
    }

    #[test]
    fn opening_a_preview_scopes_it_to_the_file_directory() {
        let scratch = Scratch::new("open");
        let mut roots = Roots::new();
        let target = open_root(&scratch.root.join("index.html"), &mut roots).unwrap();
        assert_eq!(target.name, "index.html");
        assert_eq!(roots.lookup(&target.token), Some(scratch.root.clone()));
        // Opening a sibling reuses the directory's token.
        let sibling = open_root(&scratch.root.join("draft.css"), &mut roots).unwrap();
        assert_eq!(sibling.token, target.token);
        assert!(open_root(&scratch.root.join("assets"), &mut roots).is_err());
        assert!(open_root(&scratch.root.join("missing.html"), &mut roots).is_err());
    }

    #[test]
    fn serves_single_ranges_only() {
        assert_eq!(parse_single_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_single_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_single_range("bytes=-50", 1000), Some((950, 999)));
        // Clamped to the file, and multi-range falls back to a full body.
        assert_eq!(parse_single_range("bytes=900-2000", 1000), Some((900, 999)));
        assert_eq!(parse_single_range("bytes=0-1,5-6", 1000), None);
        assert_eq!(parse_single_range("bytes=-0", 1000), None);
        assert_eq!(parse_single_range("bytes=5-3", 1000), None);
        assert_eq!(parse_single_range("bytes=1000-", 1000), None);
        assert_eq!(parse_single_range("items=0-1", 1000), None);
        assert_eq!(parse_single_range("bytes=0-10", 0), None);
    }

    #[test]
    fn answers_head_and_ranges_without_a_body_where_expected() {
        let scratch = Scratch::new("range");
        std::fs::write(scratch.root.join("draft.js"), "0123456789").unwrap();

        let head = Request::builder()
            .method(Method::HEAD)
            .uri(url(&["draft.js"]))
            .body(Vec::new())
            .unwrap();
        let response = handle(&head, scratch.lookup());
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_LENGTH], "10");
        assert!(response.into_body().is_empty());

        let ranged = Request::builder()
            .method(Method::GET)
            .uri(url(&["draft.js"]))
            .header(header::RANGE, "bytes=2-4")
            .body(Vec::new())
            .unwrap();
        let response = handle(&ranged, scratch.lookup());
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 2-4/10");
        assert_eq!(response.into_body(), b"234");
    }
}
