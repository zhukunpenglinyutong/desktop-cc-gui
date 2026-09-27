//! Raw-path parsing and one response policy shared by Tauri and the web bridge.

use axum::http::{header, Method, Response, StatusCode};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::Url;

use super::assets::{self, AssetContent, AssetError, AssetSource};

struct AssetRequest {
    plugin_id: String,
    source: AssetSource,
}

fn decode_segment(segment: &str) -> Result<String, AssetError> {
    let mut bytes = Vec::with_capacity(segment.len());
    let mut input = segment.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let high = input
                .next()
                .and_then(|b| (b as char).to_digit(16))
                .ok_or(AssetError::BadRequest)?;
            let low = input
                .next()
                .and_then(|b| (b as char).to_digit(16))
                .ok_or(AssetError::BadRequest)?;
            bytes.push((high * 16 + low) as u8);
        } else {
            bytes.push(byte);
        }
    }
    let decoded = String::from_utf8(bytes).map_err(|_| AssetError::BadRequest)?;
    if decoded.contains(['/', '\\', '\0']) || matches!(decoded.as_str(), "." | "..") {
        return Err(AssetError::BadRequest);
    }
    Ok(decoded)
}

fn decode_relative_path(path: &str) -> Result<String, AssetError> {
    let decoded = path
        .split('/')
        .map(decode_segment)
        .collect::<Result<Vec<_>, _>>()?
        .join("/");
    super::storage::safe_relative_path(&decoded).map_err(|_| AssetError::BadRequest)?;
    Ok(decoded)
}

fn parse_request(path: &str, query: Option<&str>) -> Result<AssetRequest, AssetError> {
    let mut parts = path
        .strip_prefix('/')
        .ok_or(AssetError::BadRequest)?
        .splitn(3, '/');
    let id = parts.next().ok_or(AssetError::BadRequest)?;
    super::manifest::require_valid_id(id).map_err(|_| AssetError::BadRequest)?;
    let origin = parts.next().ok_or(AssetError::BadRequest)?;
    let rest = parts.next().ok_or(AssetError::BadRequest)?;
    let source = match origin {
        "bundle" => AssetSource::Bundle(decode_relative_path(rest)?),
        "doc" => AssetSource::Document(decode_relative_path(rest)?),
        "dir" => {
            let (grant_id, relative) = rest.split_once('/').ok_or(AssetError::BadRequest)?;
            uuid::Uuid::parse_str(grant_id).map_err(|_| AssetError::BadRequest)?;
            AssetSource::Directory {
                grant_id: grant_id.into(),
                relative: decode_relative_path(relative)?,
            }
        }
        "remote" => {
            let (encoded_origin, relative) = rest.split_once('/').ok_or(AssetError::BadRequest)?;
            let origin = String::from_utf8(
                URL_SAFE_NO_PAD
                    .decode(encoded_origin)
                    .map_err(|_| AssetError::BadRequest)?,
            )
            .map_err(|_| AssetError::BadRequest)?;
            let base = Url::parse(&origin).map_err(|_| AssetError::BadRequest)?;
            if !matches!(base.scheme(), "http" | "https")
                || !base.username().is_empty()
                || base.password().is_some()
                || base.origin().ascii_serialization() != origin
            {
                return Err(AssetError::BadRequest);
            }
            // The validated origin fixes the authority; grants cover that
            // host, not a local directory. Preserve escaped upstream paths,
            // including encoded slashes used by object-storage services.
            let mut target = format!("{origin}/{relative}");
            if let Some(query) = query {
                target.push('?');
                target.push_str(query);
            }
            AssetSource::Remote(Url::parse(&target).map_err(|_| AssetError::BadRequest)?)
        }
        _ => return Err(AssetError::BadRequest),
    };
    Ok(AssetRequest {
        plugin_id: id.into(),
        source,
    })
}

fn safe_mime(mime: &str, bundle: bool) -> &str {
    let mime = mime.split(';').next().unwrap_or("").trim();
    if bundle {
        return mime;
    }
    // Positive allowlist: unknown types (including HTML, JS, SVG, XML, PDF,
    // CSS and wasm) stay opaque, even if upstream labels them executable.
    match mime {
        "application/json"
        | "application/octet-stream"
        | "text/plain"
        | "image/png"
        | "image/jpeg"
        | "image/gif"
        | "image/webp"
        | "image/avif"
        | "image/bmp"
        | "image/x-icon"
        | "audio/mpeg"
        | "audio/ogg"
        | "audio/wav"
        | "audio/mp4"
        | "audio/webm"
        | "video/mp4"
        | "video/webm"
        | "video/ogg"
        | "font/woff"
        | "font/woff2"
        | "font/ttf"
        | "font/otf" => mime,
        _ => "application/octet-stream",
    }
}

fn response(status: StatusCode, body: Vec<u8>, mime: &str, bundle: bool) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, safe_mime(mime, bundle))
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Accept, Content-Type");
    if !bundle {
        builder = builder.header(
            "content-security-policy",
            "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
        );
    }
    builder
        .body(body)
        .expect("asset response uses validated headers")
}

fn proxy_redirect(prefix: &str, id: &str, target: &Url) -> Result<String, AssetError> {
    let mut path = format!(
        "{prefix}/{id}/remote/{}{}",
        URL_SAFE_NO_PAD.encode(target.origin().ascii_serialization()),
        target.path()
    );
    if let Some(query) = target.query() {
        path.push('?');
        path.push_str(query);
    }
    // Redirects must remain representable by the same strict public route.
    let route = path.strip_prefix(prefix).ok_or(AssetError::BadGateway)?;
    let (route, query) = route
        .split_once('?')
        .map_or((route, None), |(path, query)| (path, Some(query)));
    parse_request(route, query)?;
    Ok(path)
}

fn asset_response(
    result: Result<AssetContent, AssetError>,
    prefix: &str,
    id: &str,
) -> Response<Vec<u8>> {
    match result {
        Ok(AssetContent::Bytes(bytes)) => {
            response(StatusCode::OK, bytes.body, &bytes.mime, bytes.bundle)
        }
        Ok(AssetContent::Redirect(target)) => match proxy_redirect(prefix, id, &target) {
            Ok(location) => match location.parse() {
                Ok(location) => {
                    let mut response = response(
                        StatusCode::TEMPORARY_REDIRECT,
                        Vec::new(),
                        "text/plain",
                        false,
                    );
                    response.headers_mut().insert(header::LOCATION, location);
                    response
                }
                Err(_) => asset_response(Err(AssetError::BadGateway), prefix, id),
            },
            Err(error) => asset_response(Err(error), prefix, id),
        },
        Err(error) => rejection(error.status()),
    }
}

pub(crate) fn rejection(status: StatusCode) -> Response<Vec<u8>> {
    response(
        status,
        status
            .canonical_reason()
            .unwrap_or("Asset error")
            .as_bytes()
            .to_vec(),
        "text/plain",
        false,
    )
}

/// `path` is the raw URI path *after* the web credential prefix, never an
/// axum Path extractor (which would have already percent-decoded it).
pub(crate) async fn handle(
    method: &Method,
    path: &str,
    query: Option<&str>,
    prefix: &str,
) -> Response<Vec<u8>> {
    if method == Method::OPTIONS {
        return response(StatusCode::NO_CONTENT, Vec::new(), "text/plain", false);
    }
    if method != Method::GET && method != Method::HEAD {
        let mut response = response(
            StatusCode::METHOD_NOT_ALLOWED,
            Vec::new(),
            "text/plain",
            false,
        );
        response
            .headers_mut()
            .insert(header::ALLOW, "GET, HEAD, OPTIONS".parse().unwrap());
        return response;
    }
    let mut response = match parse_request(path, query) {
        Ok(request) => {
            let id = request.plugin_id;
            let result = assets::read_asset(id.clone(), request.source).await;
            asset_response(result, prefix, &id)
        }
        Err(error) => asset_response(Err(error), prefix, ""),
    };
    if method == Method::HEAD {
        response.body_mut().clear();
    }
    response
}

pub(crate) fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(
        "pluginasset",
        |_context, request, responder| {
            tauri::async_runtime::spawn(async move {
                let response = handle(
                    request.method(),
                    request.uri().path(),
                    request.uri().query(),
                    "",
                )
                .await;
                responder.respond(response);
            });
        },
    )
}

#[cfg(test)]
mod tests {
    use super::super::assets::AssetBytes;
    use super::*;

    #[test]
    fn strict_paths_reject_encoded_escape_without_decoding_twice() {
        for rest in [
            "%2e%2e/secret",
            "a/%2E%2e/secret",
            "a%2fb",
            "a%5Cb",
            "%00",
            "x%3Astream",
            "%zz",
            "x%",
            "a//b",
            "a/./b",
            "a/../b",
        ] {
            assert!(
                parse_request(&format!("/vendor.one/bundle/{rest}"), None).is_err(),
                "accepted {rest}"
            );
        }
        let parsed = parse_request("/vendor.one/bundle/assets/100%25%20%C3%A9.bin", None).unwrap();
        assert!(matches!(parsed.source, AssetSource::Bundle(path) if path == "assets/100% é.bin"));
    }

    #[test]
    fn remote_paths_and_query_keep_relative_dependency_base() {
        let origin = URL_SAFE_NO_PAD.encode("https://example.com:8443");
        let parsed = parse_request(
            &format!("/vendor.one/remote/{origin}/models/a/model.json"),
            Some("v=1&x=%2F"),
        )
        .unwrap();
        let AssetSource::Remote(url) = parsed.source else {
            panic!("remote source expected")
        };
        assert_eq!(
            url.as_str(),
            "https://example.com:8443/models/a/model.json?v=1&x=%2F"
        );
        assert_eq!(
            proxy_redirect("/plugin-asset/credential", "vendor.one", &url).unwrap(),
            format!(
                "/plugin-asset/credential/vendor.one/remote/{origin}/models/a/model.json?v=1&x=%2F"
            )
        );
        let encoded = parse_request(
            &format!("/vendor.one/remote/{origin}/objects/folder%2Fmodel.json"),
            None,
        )
        .unwrap();
        let AssetSource::Remote(encoded) = encoded.source else {
            panic!("remote source expected")
        };
        assert_eq!(encoded.path(), "/objects/folder%2Fmodel.json");
        for origin in [
            "https://user:pass@example.com",
            "file:///tmp",
            "https://example.com/path",
            "https://example.com?q=1",
        ] {
            assert!(parse_request(
                &format!("/vendor.one/remote/{}/a", URL_SAFE_NO_PAD.encode(origin)),
                None
            )
            .is_err());
        }
    }

    #[test]
    fn local_media_paths_keep_their_mime_in_asset_responses() {
        for (path, expected) in [
            ("sound.mp3", "audio/mpeg"),
            ("sound.wav", "audio/wav"),
            ("sound.ogg", "audio/ogg"),
            ("sound.m4a", "audio/mp4"),
            ("clip.mp4", "video/mp4"),
            ("clip.webm", "video/webm"),
        ] {
            let response = asset_response(
                Ok(AssetContent::Bytes(AssetBytes {
                    body: vec![0, 255],
                    mime: crate::web::content_type(path).into(),
                    bundle: false,
                })),
                "",
                "vendor.one",
            );
            assert_eq!(response.headers()["content-type"], expected, "{path}");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(response.body(), &[0, 255]);
        }
    }

    #[test]
    fn only_bundle_responses_have_executable_mime_and_all_have_security_headers() {
        for mime in [
            "application/javascript",
            "text/html",
            "image/svg+xml",
            "application/wasm",
            "application/xml",
        ] {
            let response = asset_response(
                Ok(AssetContent::Bytes(AssetBytes {
                    body: vec![0, 255],
                    mime: mime.into(),
                    bundle: false,
                })),
                "",
                "vendor.one",
            );
            assert_eq!(
                response.headers()["content-type"],
                "application/octet-stream"
            );
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(response.headers()["referrer-policy"], "no-referrer");
            assert_eq!(response.headers()["access-control-allow-origin"], "*");
            assert_eq!(response.body(), &[0, 255]);
        }
        let response = asset_response(
            Ok(AssetContent::Bytes(AssetBytes {
                body: vec![],
                mime: "application/wasm".into(),
                bundle: true,
            })),
            "",
            "vendor.one",
        );
        assert_eq!(response.headers()["content-type"], "application/wasm");
    }
}
