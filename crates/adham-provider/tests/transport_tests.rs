//! A1: shared HTTP transport — network policy + boundedness battery.
//!
//! Fixtures are local TCP listener stubs; no real provider endpoints are touched.
//! The transport test battery pins (per P0-08 + plan): redirects refused, no
//! ambient proxy, resolved-address bogon gate (v4+v6), 1 MiB frame cap,
//! per-read + total deadlines, bounded error bodies.

use adham_provider::transport::{
    HttpTransport, TransportError, MAX_ERROR_BODY_BYTES, MAX_FRAME_BYTES,
};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde_json::json;
use std::net::{IpAddr, SocketAddr};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const SHORT_TOTAL: Duration = Duration::from_millis(400);
const STALL: Duration = Duration::from_millis(2500);

/// Spawns a one-shot stub server; returns its base URL. `handler` writes the
/// raw HTTP/1.1 response bytes itself, so tests control framing exactly.
async fn spawn_one_shot<F, Fut>(handler: F) -> String
where
    F: FnOnce(TcpStream) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = std::io::Result<()>> + Send,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        // drain the request first: dropping a socket with unread receive data
        // sends RST and can race the client's body read with buffer flushes
        if let Err(e) = drain_request(&mut stream).await {
            tracing::debug!("stub drain error: {e}");
        }
        let stream = stream;
        if let Err(e) = handler(stream).await {
            tracing::debug!("stub server error: {e}");
        }
    });
    format!("http://{addr}")
}

/// Reads one full request (headers + Content-Length body) off the socket.
async fn drain_request(stream: &mut TcpStream) -> std::io::Result<()> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(head_end) = find_header_boundary(&buf) {
            let cl = content_length(&buf[..head_end]).unwrap_or(0);
            if buf.len() >= head_end + cl {
                return Ok(());
            }
        }
    }
    Ok(())
}

fn find_header_boundary(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

fn content_length(head: &[u8]) -> Option<usize> {
    let text = String::from_utf8_lossy(head);
    text.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.eq_ignore_ascii_case("content-length")
            .then(|| v.trim().parse().ok())
            .flatten()
    })
}

/// Spawns a stub that answers each REQUEST on its own connection (`Connection:
/// close`), counting requests. A followed redirect would surface as hit #2,
/// which lets the test assert "exactly one request" without connection-pool
/// ambiguity.
async fn spawn_counting(count: usize) -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let hits = Arc::new(AtomicUsize::new(0));
    let hits_reader = hits.clone();
    tokio::spawn(async move {
        for _ in 0..count {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            if drain_request(&mut stream).await.is_err() {
                break;
            }
            let hit = hits.fetch_add(1, Ordering::SeqCst);
            let resp = if hit == 0 {
                b"HTTP/1.1 302 Found\r\nLocation: /elsewhere\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".to_vec()
            } else {
                b"HTTP/1.1 500 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\nfollowed"
                    .to_vec()
            };
            let _ = stream.write_all(&resp).await;
            let _ = stream.flush().await;
        }
    });
    (format!("http://{addr}"), hits_reader)
}

fn response_200_ndjson(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
}

// --- 1. happy path: 200 NDJSON streams lines in order, then EOF ------------------

#[tokio::test]
async fn test_post_200_streams_lines_in_order_then_eof() {
    let url = spawn_one_shot(|mut s| async move {
        s.write_all(response_200_ndjson("first\nsecond\n").as_bytes())
            .await?;
        s.flush().await
    })
    .await;

    let transport = HttpTransport::default();
    let mut stream = transport
        .post_json(&url, &json!({"model": "m", "messages": []}))
        .await
        .expect("post_json succeeds");

    let mut lines = Vec::new();
    while let Some(line) = stream.next_line().await.expect("next_line") {
        lines.push(line);
    }
    assert_eq!(lines, vec!["first", "second"]);
}

// --- 2. total deadline: server never answers head -------------------------------

#[tokio::test]
async fn test_total_timeout_maps_to_timeout() {
    let url = spawn_one_shot(|s| async move {
        let mut r = s;
        let mut buf = [0u8; 128];
        let _ = r.read(&mut buf).await; // consume request, then never answer
        tokio::time::sleep(STALL).await;
        Ok(())
    })
    .await;

    let transport = HttpTransport::new_with_timeouts(SHORT_TOTAL, Duration::from_millis(200));
    let err = transport
        .post_json(&url, &json!({}))
        .await
        .expect_err("must time out");
    assert!(matches!(err, TransportError::Timeout(_)), "got {err:?}");
}

// --- 3. plain HTTP to non-loopback is rejected before any socket ----------------

#[tokio::test]
async fn test_plain_http_non_loopback_rejected_before_socket() {
    let transport = HttpTransport::default();
    for url in ["http://169.254.1.1:8080/v1", "http://example.com/v1"] {
        let err = transport
            .post_json(url, &json!({}))
            .await
            .expect_err("policy must reject");
        assert!(matches!(err, TransportError::Policy(_)), "got {err:?}");
    }
}

// --- 4. redirects are refused; exactly one request hits the wire -----------------

#[tokio::test]
async fn test_redirect_302_not_followed() {
    let (url, hits) = spawn_counting(3).await;

    let transport = HttpTransport::default();
    let err = transport
        .post_json(&url, &json!({}))
        .await
        .expect_err("302 must surface as error");
    assert!(matches!(err, TransportError::Status(302, _)), "got {err:?}");
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "the transport must never issue a second request"
    );
}

// --- 5. ambient proxy environment is ignored --------------------------------------

#[tokio::test]
async fn test_ambient_proxy_env_ignored() {
    // Point every proxy-var family at a black hole (non-routable private addr).
    // Set BEFORE building the transport — worst case. Restore afterwards.
    let saved: Vec<(&str, Option<String>)> = [
        ("HTTP_PROXY", std::env::var("HTTP_PROXY").ok()),
        ("HTTPS_PROXY", std::env::var("HTTPS_PROXY").ok()),
        ("ALL_PROXY", std::env::var("ALL_PROXY").ok()),
    ]
    .to_vec();
    for (k, _) in &saved {
        std::env::set_var(k, "http://10.255.255.1:9");
    }

    let url = spawn_one_shot(|mut s| async move {
        s.write_all(response_200_ndjson("ok\n").as_bytes()).await?;
        s.flush().await
    })
    .await;

    let transport = HttpTransport::default();
    let mut stream = transport
        .post_json(&url, &json!({}))
        .await
        .expect("proxy env must not affect a loopback request");

    let line = stream.next_line().await.expect("line").expect("some");
    assert_eq!(line, "ok");

    for (k, v) in saved {
        match v {
            Some(val) => std::env::set_var(k, val),
            None => std::env::remove_var(k),
        }
    }
}

// --- 6. resolved-address bogon gate ------------------------------------------------

struct FakeResolver(Vec<SocketAddr>);

impl Resolve for FakeResolver {
    fn resolve(&self, _name: Name) -> Resolving {
        let addrs = self.0.clone();
        Box::pin(async move { Ok(Box::new(addrs.into_iter()) as Addrs) })
    }
}

#[tokio::test]
async fn test_resolved_bogon_addresses_rejected() {
    let bogons: Vec<IpAddr> = [
        "10.0.0.5",
        "172.16.9.9",
        "192.168.5.5",
        "100.64.0.1",      // CGNAT range
        "169.254.169.254", // cloud metadata
        "0.0.0.0",         // unspecified
        "255.255.255.255", // broadcast
        "224.0.0.1",       // v4 multicast
        "fd00::5",         // v6 unique-local
        "fe80::5",         // v6 link-local
        "::",              // v6 unspecified (canonicalized)
        "::ffff:10.0.0.5", // v6-mapped private
    ]
    .iter()
    .map(|s| s.parse().expect("parse ip"))
    .collect();

    for ip in bogons {
        let transport =
            HttpTransport::with_resolver(Arc::new(FakeResolver(vec![SocketAddr::new(ip, 11434)])));
        let err = transport
            .post_json("https://fake-provider.invalid:11434/api/chat", &json!({}))
            .await
            .expect_err("bogon resolution must be rejected");
        assert!(
            matches!(err, TransportError::Policy(ref m) if m.contains("restricted address")),
            "ip {ip}: unexpected {err:?}"
        );
    }
}

#[tokio::test]
async fn test_resolved_loopback_is_allowed() {
    // The gate must allow loopback resolutions (Ollama-on-loopback). Nothing
    // listens on port 9, so a successful gate pass ends as Unreachable, not
    // Policy — proving the gate let the address through, deterministically.
    let transport = HttpTransport::with_resolver(Arc::new(FakeResolver(vec!["127.0.0.1:9"
        .parse()
        .expect("parse")])));
    let err = transport
        .post_json("https://fake-provider.invalid:9/api/chat", &json!({}))
        .await
        .expect_err("port 9 refused locally");
    assert!(matches!(err, TransportError::Unreachable(_)), "got {err:?}");
}

// --- 7. frame cap: a 2 MiB line is a protocol error, bounded memory ----------------

#[tokio::test]
async fn test_single_frame_over_cap_is_protocol_error_not_oom() {
    let url = spawn_one_shot(|mut s| async move {
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2000000\r\n\r\n")
            .await?;
        // 2 MiB of 'x' with no newline anywhere
        let big = vec![b'x'; 2_000_000];
        s.write_all(&big).await?;
        s.flush().await
    })
    .await;

    let transport =
        HttpTransport::new_with_timeouts(Duration::from_secs(5), Duration::from_secs(2));
    let mut stream = transport.post_json(&url, &json!({})).await.expect("head");
    let err = stream
        .next_line()
        .await
        .expect_err("a 2 MiB frame must error, not load");
    assert!(
        matches!(err, TransportError::FrameTooLarge(_)),
        "got {err:?}"
    );
    // cap is exactly the documented bound
    assert_eq!(MAX_FRAME_BYTES, 1024 * 1024);
}

// --- 8. per-read deadline fires on a stalled body -----------------------------------

#[tokio::test]
async fn test_per_read_deadline_fires_on_stalled_body() {
    let url = spawn_one_shot(|mut s| async move {
        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 64\r\n\r\nhello\n")
            .await?;
        s.flush().await?;
        // stall: the second chunk never arrives
        tokio::time::sleep(STALL).await;
        Ok(())
    })
    .await;

    let transport =
        HttpTransport::new_with_timeouts(Duration::from_secs(5), Duration::from_millis(300));
    let mut stream = transport.post_json(&url, &json!({})).await.expect("head");
    let first = stream.next_line().await.expect("first line").expect("some");
    assert_eq!(first, "hello");

    let err = stream.next_line().await.expect_err("stall must time out");
    assert!(matches!(err, TransportError::Timeout(_)), "got {err:?}");
}

// --- 10. JSON document fetches (GET + bounded POST) ----------------------------

#[tokio::test]
async fn test_get_json_parses_document() {
    let url =
        spawn_one_shot(|mut s: tokio::net::TcpStream| async move {
            // spawn_one_shot drains the request before the handler runs
            let body = br#"{"models":[{"name":"m:latest","digest":"sha256:x"}]}"#;
            s.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            )
            .await?;
            s.write_all(body).await?;
            s.flush().await
        })
        .await;

    let transport = HttpTransport::default();
    let doc = transport.get_json(&url).await.expect("get_json");
    assert_eq!(doc["models"][0]["digest"], "sha256:x");
}

#[tokio::test]
async fn test_get_json_malformed_document_is_protocol_parse_error() {
    let url = spawn_one_shot(|mut s| async move {
        let body: &[u8] = b"{partial";
        s.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n\r\n",
                body.len()
            )
            .as_bytes(),
        )
        .await?;
        s.write_all(body).await?;
        s.flush().await
    })
    .await;

    let err = HttpTransport::default()
        .get_json(&url)
        .await
        .expect_err("must fail");
    assert!(
        matches!(err, TransportError::ProtocolParse(_)),
        "got {err:?}"
    );
}

#[tokio::test]
async fn test_document_over_cap_is_frame_too_large() {
    let url = spawn_one_shot(|mut s| async move {
        let big = vec![b'a'; 2_000_000];
        s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", big.len()).as_bytes())
            .await?;
        s.write_all(&big).await?;
        s.flush().await
    })
    .await;

    let err = HttpTransport::default()
        .get_json(&url)
        .await
        .expect_err("doc cap");
    assert!(
        matches!(err, TransportError::FrameTooLarge(_)),
        "got {err:?}"
    );
}

#[tokio::test]
async fn test_status_error_body_bounded_and_redacted() {
    let url = spawn_one_shot(|mut s| async move {
        let body = "A".repeat(8 * 1024);
        let head = format!(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        s.write_all(head.as_bytes()).await?;
        s.write_all(body.as_bytes()).await?;
        s.flush().await
    })
    .await;

    let transport = HttpTransport::default();
    let err = transport
        .post_json(&url, &json!({}))
        .await
        .expect_err("500 must surface");
    match err {
        TransportError::Status(500, body) => {
            assert!(
                body.as_bytes().len() <= MAX_ERROR_BODY_BYTES,
                "error body must be capped at {MAX_ERROR_BODY_BYTES}"
            );
            // redaction: Debug/Display never leak raw bytes
            let debugged = format!("{body:?}");
            assert!(
                !debugged.contains('A'),
                "Debug must not leak body bytes: {debugged}"
            );
        }
        other => panic!("expected Status(500, ...), got {other:?}"),
    }
}
