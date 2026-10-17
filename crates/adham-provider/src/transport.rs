//! A1: shared HTTP transport for provider gateways.
//!
//! One `reqwest::Client` per transport: redirects refused, retry disabled, no
//! ambient proxy, TLS via rustls, and a DNS-resolution bogon gate (resolved
//! addresses in private/link-local/metadata/unspecified ranges are rejected
//! for both IPv4 and IPv6 — canonicalizing v4-mapped v6). Loopback is allowed
//! (Ollama runs there) subject to endpoint URL policy.
//!
//! Boundedness: per-request total timeout + per-read deadline on streamed
//! frames, a 1 MiB protocol frame cap (never OOM), and error bodies capped and
//! redacted. Deadlines are passed in by the op layer (P0-07 runtime owns
//! wider orchestration); the transport only carries bounded semantics.

use crate::domain::endpoint::EndpointDescriptor;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde_json::Value;
use std::error::Error as StdError;
use std::fmt;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::time;

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_ERROR_BODY_BYTES: usize = 4 * 1024;

pub const DEFAULT_TOTAL_TIMEOUT: Duration = Duration::from_secs(120);
pub const DEFAULT_PER_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Prefix used to detect our own bogon rejections inside reqwest connect
/// errors (resolver errors surface flattened; the marker keeps the policy
/// kind distinguishable from a plain unreachable endpoint).
pub(crate) const BOGON_MARKER: &str = "BOGON-ADDRESS-REJECTED";

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("provider endpoint unreachable: {0}")]
    Unreachable(String),

    #[error("operation timed out: {0}")]
    Timeout(String),

    #[error("TLS handshake rejected: {0}")]
    TlsRejected(String),

    #[error("provider returned status {0}")]
    Status(u16, RedactedBody),

    #[error("endpoint policy violation: {0}")]
    Policy(String),

    #[error("protocol frame too large: {0}")]
    FrameTooLarge(String),

    #[error("protocol parse error: {0}")]
    ProtocolParse(String),
}

impl TransportError {
    /// Maps into the P0-08 seven-variant taxonomy. `Status` carries the raw
    /// code + redacted body so adapters can decide `RateLimitExceeded` vs
    /// `AuthenticationError` vs a plain transport error.
    pub fn into_provider_error(self) -> crate::domain::error::ProviderError {
        use crate::domain::error::ProviderError as P;
        match self {
            TransportError::Policy(m) => P::EndpointPolicyViolation(m),
            TransportError::FrameTooLarge(m) => P::ProtocolParseError(m),
            TransportError::ProtocolParse(m) => P::ProtocolParseError(m),
            TransportError::Status(429, body) => P::RateLimitExceeded(
                body.error_message()
                    .unwrap_or_else(|| "rate limited".into()),
            ),
            TransportError::Status(401, body) => P::AuthenticationError(
                body.error_message()
                    .unwrap_or_else(|| "authentication failed".into()),
            ),
            TransportError::Status(403, body) => P::AuthenticationError(
                body.error_message()
                    .unwrap_or_else(|| "forbidden by provider".into()),
            ),
            TransportError::Status(code, body) => P::TransportError(format!(
                "provider returned status {code}: {}",
                body.error_message().unwrap_or_default()
            )),
            TransportError::Timeout(m) => P::TransportError(format!("operation timed out: {m}")),
            TransportError::Unreachable(m) => P::TransportError(format!("unreachable: {m}")),
            TransportError::TlsRejected(m) => P::TransportError(format!("TLS rejected: {m}")),
        }
    }
}

/// An HTTP error body: capped at [`MAX_ERROR_BODY_BYTES`] and never echoed by
/// `Debug`/`Display` (redacted by construction; adapters may still extract a
/// provider-supplied error message).
#[derive(Clone, PartialEq, Eq)]
pub struct RedactedBody {
    body: Vec<u8>,
}

impl RedactedBody {
    pub fn bounded(raw: &[u8]) -> Self {
        Self {
            body: raw[..raw.len().min(MAX_ERROR_BODY_BYTES)].to_vec(),
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.body
    }

    /// Best-effort provider error message (`{"error": "..."}` JSON shape).
    pub fn error_message(&self) -> Option<String> {
        serde_json::from_slice::<serde_json::Value>(&self.body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
    }
}

fn body_fmt(f: &mut fmt::Formatter<'_>, len: usize) -> fmt::Result {
    write!(f, "(error body: {len} bytes, redacted)")
}

impl fmt::Debug for RedactedBody {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // never echo bytes — key material / PII must not reach logs
        body_fmt(f, self.body.len())
    }
}

impl fmt::Display for RedactedBody {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        body_fmt(f, self.body.len())
    }
}

struct BogonRejection(String);

impl fmt::Debug for BogonRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self}")
    }
}

impl fmt::Display for BogonRejection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{BOGON_MARKER}: {}", self.0)
    }
}

impl StdError for BogonRejection {}

/// DNS-resolution gate: rejects when ANY resolved address is a bogon
/// (fail-closed), otherwise passes everything through.
struct BogonResolver {
    inner: Arc<dyn Resolve>,
}

impl Resolve for BogonResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let inner = self.inner.clone();
        Box::pin(async move {
            let addrs = inner.resolve(name).await?;
            let mut validated = Vec::new();
            for addr in addrs {
                if let Some(reason) = bogon_reject_reason(addr.ip()) {
                    return Err(Box::new(BogonRejection(format!("{addr} {reason}")))
                        as Box<dyn StdError + Send + Sync>);
                }
                validated.push(addr);
            }
            Ok(Box::new(validated.into_iter()) as Addrs)
        })
    }
}

/// Naive system resolver over tokio's GAI path (reqwest's own `GaiResolver`
/// is not publicly re-exported).
struct SystemResolver;

impl Resolve for SystemResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs = tokio::net::lookup_host((host.as_str(), 9)).await?;
            Ok(Box::new(addrs.collect::<Vec<_>>().into_iter()) as Addrs)
        })
    }
}

fn bogon_reject_reason(ip: IpAddr) -> Option<&'static str> {
    // canonicalize ::ffff:a.b.c.d to plain v4 so mapped private ranges are caught
    let canonical = match ip {
        IpAddr::V6(v6) => v6.to_canonical(),
        v4 => v4,
    };
    // loopback stays allowed (Ollama-on-loopback); everything else is gated
    if canonical.is_loopback() {
        return None;
    }
    let is_bogon = match canonical {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                // 100.64.0.0/10 (CGNAT/shared space) — `is_shared()` is still
                // unstable on the pinned toolchain series; check the range
                || (o[0] == 100 && (64..=127).contains(&o[1]))
        }
        IpAddr::V6(v6) => {
            let o = v6.octets();
            v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_unspecified()
                || v6.is_multicast()
                // 2001:db8::/32 documentation space — `is_documentation()` too
                || (o[0] == 0x20 && o[1] == 0x01 && o[2] == 0x0d && o[3] == 0xb8)
        }
    };
    const IPV4_REASON: &str = "private/link-local/metadata/multicast/broadcast v4 address";
    const V6_REASON: &str = "unique-local/link-local/multicast v6 address";
    let reason = match canonical {
        IpAddr::V4(_) => IPV4_REASON,
        IpAddr::V6(_) => V6_REASON,
    };
    is_bogon.then_some(reason)
}

#[derive(Clone)]
pub struct HttpTransport {
    client: reqwest::Client,
    total: Duration,
    per_read: Duration,
}

impl Default for HttpTransport {
    fn default() -> Self {
        Self::new_with_timeouts(DEFAULT_TOTAL_TIMEOUT, DEFAULT_PER_READ_TIMEOUT)
    }
}

impl HttpTransport {
    /// Builds a transport with explicit op-scoped bounds. The underlying
    /// client is created per transport; ops share one transport instance.
    pub fn new_with_timeouts(total: Duration, per_read: Duration) -> Self {
        Self {
            client: client_new(None),
            total,
            per_read,
        }
    }

    /// Test seam: substitute the system resolver (the bogon gate is always
    /// applied on top of whatever resolver backs the transport).
    pub fn with_resolver(resolver: Arc<dyn Resolve>) -> Self {
        Self {
            client: client_new(Some(resolver)),
            total: DEFAULT_TOTAL_TIMEOUT,
            per_read: DEFAULT_PER_READ_TIMEOUT,
        }
    }

    /// POST JSON; on 2xx returns a streaming byte iterable. Any non-2xx
    /// (including 3xx — redirects are never followed) surfaces as
    /// `TransportError::Status` with a bounded, redacted body.
    pub async fn post_json(&self, url: &str, body: &Value) -> Result<ByteStream, TransportError> {
        // endpoint policy first — no socket is opened for rejected URLs
        EndpointDescriptor::validate_url(url).map_err(|e| TransportError::Policy(e.to_string()))?;

        let response = self
            .client
            .post(url)
            .json(body)
            .timeout(self.total)
            .send()
            .await
            .map_err(classify)?;

        if !response.status().is_success() {
            return Err(read_error_status(response, self.per_read).await);
        }

        Ok(ByteStream {
            response,
            per_read: self.per_read,
            buf: Vec::new(),
            done: false,
        })
    }

    /// GET JSON: a whole small document (discovery-style endpoints), bounded
    /// by the same frame cap and per-read deadline as streaming reads.
    pub async fn get_json(&self, url: &str) -> Result<Value, TransportError> {
        EndpointDescriptor::validate_url(url).map_err(|e| TransportError::Policy(e.to_string()))?;
        let response = self
            .client
            .get(url)
            .timeout(self.total)
            .send()
            .await
            .map_err(classify)?;
        document_from(response, self.per_read).await
    }

    /// POST JSON expecting a whole small document back (not a stream).
    pub async fn post_json_document(
        &self,
        url: &str,
        body: &Value,
    ) -> Result<Value, TransportError> {
        EndpointDescriptor::validate_url(url).map_err(|e| TransportError::Policy(e.to_string()))?;
        let response = self
            .client
            .post(url)
            .json(body)
            .timeout(self.total)
            .send()
            .await
            .map_err(classify)?;
        document_from(response, self.per_read).await
    }
}

/// Bounded error-body read for any non-2xx response (shared by all methods).
async fn read_error_status(mut response: reqwest::Response, per_read: Duration) -> TransportError {
    let status = response.status().as_u16();
    let mut collected: Vec<u8> = Vec::new();
    while collected.len() < MAX_ERROR_BODY_BYTES {
        match time::timeout(per_read, response.chunk()).await {
            Err(_elapsed) => return TransportError::Timeout("error body read stalled".into()),
            Ok(Ok(Some(bytes))) => collected.extend_from_slice(&bytes),
            Ok(Ok(None)) => break,
            Ok(Err(e)) => {
                // a connection death mid-drain must not mask the status when
                // we already hold a (bounded) partial error body
                if collected.is_empty() {
                    return classify(e);
                }
                break;
            }
        }
    }
    collected.truncate(MAX_ERROR_BODY_BYTES);
    TransportError::Status(status, RedactedBody { body: collected })
}

/// A whole JSON document body, bounded at [`MAX_FRAME_BYTES`]; parse failure
/// is a protocol error, never a guess.
async fn document_from(
    mut response: reqwest::Response,
    per_read: Duration,
) -> Result<Value, TransportError> {
    if !response.status().is_success() {
        return Err(read_error_status(response, per_read).await);
    }
    let mut doc: Vec<u8> = Vec::new();
    loop {
        match time::timeout(per_read, response.chunk()).await {
            Err(_elapsed) => return Err(TransportError::Timeout("document read stalled".into())),
            Ok(Ok(Some(bytes))) => {
                if doc.len() + bytes.len() > MAX_FRAME_BYTES {
                    return Err(TransportError::FrameTooLarge(format!(
                        "document exceeded {MAX_FRAME_BYTES} bytes"
                    )));
                }
                doc.extend_from_slice(&bytes);
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => return Err(classify(e)),
        }
    }
    serde_json::from_slice(&doc).map_err(|e| TransportError::ProtocolParse(e.to_string()))
}

fn client_new(custom: Option<Arc<dyn Resolve>>) -> reqwest::Client {
    let inner: Arc<dyn Resolve> = custom.unwrap_or_else(|| Arc::new(SystemResolver));
    let resolver: Arc<dyn Resolve> = Arc::new(BogonResolver { inner });
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_proxy()
        .dns_resolver(resolver)
        .build()
        .expect("static reqwest client configuration")
}

/// Classifies a reqwest error into the transport taxonomy. Resolver-level
/// bogon rejections are preserved via the `BOGON-ADDRESS-REJECTED` marker.
fn classify(e: reqwest::Error) -> TransportError {
    if e.is_timeout() {
        return TransportError::Timeout(format!("deadline exceeded: {e}"));
    }

    let mut chain = String::new();
    let mut current: Option<&(dyn StdError + 'static)> = Some(&e);
    let mut depth = 0;
    while let Some(err) = current {
        chain.push_str(&err.to_string());
        chain.push_str("; ");
        depth += 1;
        if depth > 8 {
            chain.push('…');
            break;
        }
        current = err.source();
    }
    let chain = chain.trim_end_matches("; ").to_string();
    let lowered = chain.to_lowercase();

    if chain.contains(BOGON_MARKER) {
        let detail = chain
            .split(BOGON_MARKER)
            .nth(1)
            .map(|s| s.trim_start_matches([':', ' ']).to_string())
            .unwrap_or_else(|| chain.clone());
        return TransportError::Policy(format!("resolved to a restricted address: {detail}"));
    }
    if ["certificate", "handshake", "tls"]
        .iter()
        .any(|m| lowered.contains(m))
    {
        return TransportError::TlsRejected(chain);
    }
    if e.is_connect() {
        return TransportError::Unreachable(chain);
    }
    if e.is_decode() {
        return TransportError::Unreachable(format!("connection ended prematurely: {chain}"));
    }
    TransportError::Unreachable(format!("transport failure: {chain}"))
}

/// A streaming HTTP response body with per-read deadlines and a protocol
/// frame cap. `next_line` is the NDJSON/SSE-friendly framing primitive.
pub struct ByteStream {
    response: reqwest::Response,
    per_read: Duration,
    buf: Vec<u8>,
    done: bool,
}

impl fmt::Debug for ByteStream {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ByteStream")
            .field("buffered", &self.buf.len())
            .field("done", &self.done)
            .finish()
    }
}

impl ByteStream {
    /// Next `\n`-terminated protocol frame (CRLF tolerated). At clean EOF
    /// with an empty buffer returns `None`; a final unterminated partial
    /// line is returned as-is so the adapter owns truncated-stream terminal
    /// semantics (never silently completed).
    pub async fn next_line(&mut self) -> Result<Option<String>, TransportError> {
        loop {
            if let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
                let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
                line.pop(); // '\n'
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return Ok(Some(String::from_utf8_lossy(&line).into_owned()));
            }
            if self.buf.len() > MAX_FRAME_BYTES {
                self.buf.clear();
                return Err(TransportError::FrameTooLarge(format!(
                    "frame exceeded {MAX_FRAME_BYTES} bytes without a newline"
                )));
            }
            if self.done {
                if self.buf.is_empty() {
                    return Ok(None);
                }
                let partial = String::from_utf8_lossy(&self.buf).into_owned();
                self.buf.clear();
                return Ok(Some(partial));
            }
            self.refill().await?;
        }
    }

    async fn refill(&mut self) -> Result<(), TransportError> {
        match time::timeout(self.per_read, self.response.chunk()).await {
            Err(_elapsed) => Err(TransportError::Timeout(
                "per-read deadline exceeded awaiting frame".into(),
            )),
            Ok(Ok(Some(bytes))) => {
                self.buf.extend_from_slice(&bytes);
                Ok(())
            }
            Ok(Ok(None)) => {
                self.done = true;
                Ok(())
            }
            Ok(Err(e)) => Err(classify(e)),
        }
    }
}
