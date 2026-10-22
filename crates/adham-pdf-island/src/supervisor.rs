//! Supervisor: spawns the island with a wiped environment and no inherited
//! secrets, enforces the protocol and caps on its stdout, and always kills +
//! reaps the child on timeout, cancel or fault. This is the code path the
//! real parser waves inherit unchanged; only the island's contents change.

use crate::protocol::exit;
use crate::protocol::{PAGE_PREFIX, PdfIslandOutcome, PublishedRefusal, TRUNC_LINE};
use crate::reap::{ChildEnd, reap_child, spawn_footprint_watcher, trace};
use std::io::{BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct Caps {
    pub input_bytes: usize,
    pub total_chars: usize,
    pub page_chars: usize,
    pub line_bytes: usize,
    pub clock_ms: u64,
    pub rss_bytes: u64,
}

impl Default for Caps {
    fn default() -> Self {
        Self {
            input_bytes: crate::protocol::INPUT_BYTES,
            total_chars: crate::protocol::TOTAL_CHARS,
            page_chars: crate::protocol::PAGE_CHARS,
            line_bytes: crate::protocol::LINE_BYTES,
            clock_ms: crate::protocol::CLOCK_MS,
            rss_bytes: crate::protocol::RSS_BYTES,
        }
    }
}

#[derive(Debug)]
pub struct SpawnSpec {
    pub binary_path: PathBuf,
    pub input: Vec<u8>,
    pub caps: Caps,
    /// Extra worker flags for the tests (`--sleep 60`, `--alloc-bomb`, …).
    pub modes: Vec<String>,
    /// Test only: values the supervisor plants AFTER `env_clear()`, proving
    /// that non-cleared environments are detectable. Production callers
    /// must keep this empty.
    #[doc(hidden)]
    pub test_env: Vec<(String, String)>,
}

impl Default for SpawnSpec {
    fn default() -> Self {
        Self {
            binary_path: PathBuf::from("adham-pdf-island"),
            input: Vec::new(),
            caps: Caps::default(),
            modes: Vec::new(),
            test_env: Vec::new(),
        }
    }
}

pub struct IslandRun {
    pub outcome: PdfIslandOutcome,
    pub stderr_tail: Vec<u8>,
}

impl core::fmt::Debug for IslandRun {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("IslandRun")
            .field("outcome", &self.outcome)
            .field("stderr_len", &self.stderr_tail.len())
            .finish()
    }
}

/// Watchpoint the caller holds to cancel a run between ticks.
#[derive(Debug, Default, Clone)]
pub struct Cancel {
    inner: Arc<AtomicBool>,
}

impl Cancel {
    pub fn trigger(&self) {
        self.inner.store(true, Ordering::SeqCst);
    }
}

/// One island lifetime: spawn → stream → end → reap, with no path that can
/// leak a partial success.
pub fn run(spec: SpawnSpec) -> IslandRun {
    run_with(spec, None)
}

pub fn run_with(spec: SpawnSpec, cancel: Option<&Cancel>) -> IslandRun {
    let mut command = Command::new(&spec.binary_path);
    let args = caps_args(&spec.caps);
    command
        .args(&args)
        .args(&spec.modes)
        .env_clear()
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped());
    for (key, value) in &spec.test_env {
        command.env(key, value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = match command.spawn() {
        Ok(child) => {
            trace(&format!("spawn: pid {}", child.id()));
            child
        }
        Err(err) => {
            return IslandRun {
                outcome: PdfIslandOutcome::Refused {
                    code: PublishedRefusal::SpawnFailed,
                    detail: format!("spawn failed: {err}"),
                },
                stderr_tail: Vec::new(),
            };
        }
    };

    let stdout_pipe = child.stdout.take().expect("piped stdout");
    let stderr_pipe = child.stderr.take().expect("piped stderr");
    let mut stdin_pipe = child.stdin.take().expect("piped stdin");
    let watcher_rss = spec.caps.rss_bytes;
    let (wall_tripped, footprint_watch) = spawn_footprint_watcher(child.id(), watcher_rss);

    let input_handle = {
        let payload = spec.input;
        std::thread::Builder::new()
            .name("island-stdin".into())
            .spawn(move || {
                let _ = stdin_pipe.write_all(&payload);
                let _ = stdin_pipe.flush();
                drop(stdin_pipe);
            })
    };

    let stderr_handle = std::thread::Builder::new()
        .name("island-stderr".into())
        .spawn(move || {
            let mut tail = Vec::new();
            let mut closed = stderr_pipe;
            let _ = closed.read_to_end(&mut tail);
            tail
        });

    let (stream_handle, child_end, wall_tripped) = {
        let caps = spec.caps;
        let deadline = Instant::now() + Duration::from_millis(caps.clock_ms);
        let line_cap = caps.line_bytes;
        let (tx, rx) = mpsc::channel::<StreamEvent>();
        let reader_thread = std::thread::Builder::new()
            .name("island-stdout".into())
            .spawn(move || stream_lines(stdout_pipe, line_cap, tx))
            .expect("reader thread");
        let target = drive_stream(rx, deadline, caps, cancel);
        // Reap the child BEFORE joining the reader: killing the island
        // closes its pipes and unblocks the reader; joining first would
        // deadlock on a hung island that keeps the pipe open.
        let child_end = reap_child(&mut child);
        reader_thread.join().expect("reader joins");
        (target, child_end, wall_tripped)
    };

    let _ = input_handle.expect("input thread").join();
    let mut outcome = match stream_handle {
        StreamTarget::Refused { code, detail } => PdfIslandOutcome::Refused { code, detail },
        StreamTarget::Pages { pages, truncated } => match child_end {
            ChildEnd::Clean => PdfIslandOutcome::Pages { pages, truncated },
            ChildEnd::Exited { code, note } => {
                if code == exit::OK {
                    PdfIslandOutcome::Pages { pages, truncated }
                } else {
                    // A real island that says 42 meant the wall held.
                    map_exit_code(code, note)
                }
            }
        },
    };
    // Darwin has no in-process memory cap the island can set or trust: the
    // footprint watcher spawned before the stream kills the island the
    // moment its physical footprint passes the cap. Whatever the stream
    // said, an over-limit death is a MemoryLimit refusal — no partial leak.
    if wall_tripped.load(Ordering::SeqCst) {
        outcome = PdfIslandOutcome::Refused {
            code: PublishedRefusal::MemoryLimit,
            detail: "physical footprint over cap (kill-on-limit watcher)".into(),
        };
    }
    if let Some(watch) = footprint_watch {
        let _ = watch.join();
    }
    let stderr_tail = stderr_handle
        .expect("stderr thread")
        .join()
        .unwrap_or_default();
    IslandRun {
        outcome,
        stderr_tail,
    }
}

fn caps_args(caps: &Caps) -> Vec<String> {
    vec![
        "--input-bytes".into(),
        caps.input_bytes.to_string(),
        "--page-chars".into(),
        caps.page_chars.to_string(),
        "--total-chars".into(),
        caps.total_chars.to_string(),
    ]
}

enum StreamEvent {
    Line {
        page: Option<(u32, String)>,
        truncated: bool,
    },
    /// Worker stdout violated the caps/line contract.
    Breach(PublishedRefusal, String),
    Closed,
}

enum StreamTarget {
    /// Sheet of clean pages.
    Pages {
        pages: Vec<(u32, String)>,
        truncated: bool,
    },
    /// Everything failed: never surface partial output.
    Refused {
        code: PublishedRefusal,
        detail: String,
    },
}

fn stream_lines(pipe: ChildStdout, line_cap: usize, sender: Sender<StreamEvent>) {
    let mut reader = BufReader::new(pipe);
    let mut pending: Vec<u8> = Vec::with_capacity(1 << 14);
    let mut buf = vec![0u8; 16 * 1024];
    let mut done = false;
    // Pump stdout with a per-line byte budget: a protocol line over the cap
    // is a breach and the reader stops immediately; nothing oversized is
    // ever buffered defensively.
    while !done {
        let n = match reader.read(&mut buf) {
            Ok(0) => {
                done = true;
                0
            }
            Ok(n) => n,
            Err(_) => {
                let _ = sender.send(StreamEvent::Breach(
                    PublishedRefusal::MalformedOutput,
                    "stdout read error".into(),
                ));
                return;
            }
        };
        for segment in buf[..n].split_inclusive(|b| *b == b'\n') {
            let ends_line = segment.last() == Some(&b'\n');
            pending.extend_from_slice(segment);
            if ends_line {
                while pending.last() == Some(&b'\n') || pending.last() == Some(&b'\r') {
                    pending.pop();
                }
                if pending.len() > line_cap {
                    let _ = sender.send(StreamEvent::Breach(
                        PublishedRefusal::OutputCap,
                        "line over cap".into(),
                    ));
                    return;
                }
                match classify_line(&pending) {
                    Ok(event) => {
                        if sender.send(event).is_err() {
                            return;
                        }
                    }
                    Err((code, detail)) => {
                        let _ = sender.send(StreamEvent::Breach(code, detail));
                        return;
                    }
                }
                pending.clear();
            } else if pending.len() > line_cap {
                let _ = sender.send(StreamEvent::Breach(
                    PublishedRefusal::OutputCap,
                    "line over cap (unterminated)".into(),
                ));
                return;
            }
        }
    }
    // A well-formed island always ends with a newline; an unterminated tail
    // is still classified once, then the stream closes.
    if !pending.is_empty() {
        while pending.last() == Some(&b'\r') {
            pending.pop();
        }
        match classify_line(&pending) {
            Ok(event) => {
                let _ = sender.send(event);
            }
            Err((code, detail)) => {
                let _ = sender.send(StreamEvent::Breach(code, detail));
                return;
            }
        }
    }
    let _ = sender.send(StreamEvent::Closed);
}

fn classify_line(raw: &[u8]) -> Result<StreamEvent, (PublishedRefusal, String)> {
    let line = String::from_utf8_lossy(raw);
    if line == TRUNC_LINE {
        return Ok(StreamEvent::Line {
            page: None,
            truncated: true,
        });
    }
    let body = line.strip_prefix(PAGE_PREFIX).ok_or_else(|| {
        (
            PublishedRefusal::MalformedOutput,
            format!("bad line: {line:?}"),
        )
    })?;
    let (num, rest) = body.split_once(' ').ok_or_else(|| {
        (
            PublishedRefusal::MalformedOutput,
            "page line missing body".into(),
        )
    })?;
    let page: u32 = num.parse().map_err(|_| {
        (
            PublishedRefusal::MalformedOutput,
            format!("bad page number {num:?}"),
        )
    })?;
    Ok(StreamEvent::Line {
        page: Some((page, rest.to_owned())),
        truncated: false,
    })
}

/// Pump events off the reader, honoring the wall clock and cancellation.
fn drive_stream(
    rx: Receiver<StreamEvent>,
    deadline: Instant,
    caps: Caps,
    cancel: Option<&Cancel>,
) -> StreamTarget {
    let mut pages: Vec<(u32, String)> = Vec::new();
    let mut total_chars = 0usize;
    let mut truncated = false;
    let mut refused: Option<StreamTarget> = None;
    let tick = Duration::from_millis(50);
    let mut last_page = 0u32;
    trace("drive: enter");
    loop {
        if let Some(flag) = cancel {
            if flag.inner.load(Ordering::SeqCst) {
                trace("drive: cancel tripped");
                refused = Some(StreamTarget::Refused {
                    code: PublishedRefusal::Timeout,
                    detail: "cancelled by caller".into(),
                });
                break;
            }
        }
        if Instant::now() >= deadline {
            trace("drive: wall clock hit");
            refused = Some(StreamTarget::Refused {
                code: PublishedRefusal::Timeout,
                detail: "wall clock exceeded".into(),
            });
            break;
        }
        match rx.recv_timeout(tick) {
            Ok(StreamEvent::Breach(code, detail)) => {
                trace("drive: breach");
                refused = Some(StreamTarget::Refused { code, detail });
                break;
            }
            Ok(StreamEvent::Closed) => {
                trace("drive: closed");
                break;
            }
            Ok(StreamEvent::Line {
                page,
                truncated: trunc_marker,
            }) => {
                if trunc_marker {
                    truncated = true;
                    continue;
                }
                let Some((page, body)) = page else {
                    continue;
                };
                if page != last_page + 1 {
                    refused = Some(StreamTarget::Refused {
                        code: PublishedRefusal::MalformedOutput,
                        detail: format!("page ordering broke at {page}"),
                    });
                    break;
                }
                last_page = page;
                let body_chars = body.chars().count();
                if body_chars > caps.page_chars {
                    refused = Some(StreamTarget::Refused {
                        code: PublishedRefusal::OutputCap,
                        detail: format!("page {page} over per-page cap"),
                    });
                    break;
                }
                total_chars += body_chars;
                if total_chars > caps.total_chars {
                    refused = Some(StreamTarget::Refused {
                        code: PublishedRefusal::OutputCap,
                        detail: "total char cap exceeded".into(),
                    });
                    break;
                }
                pages.push((page, body));
            }
            Err(RecvTimeoutError::Disconnected) => {
                trace("drive: disconnected");
                break;
            }
            Err(RecvTimeoutError::Timeout) => continue,
        }
    }
    match refused {
        Some(target) => target,
        None => StreamTarget::Pages { pages, truncated },
    }
}

fn map_exit_code(code: i32, note: String) -> PdfIslandOutcome {
    match code_mapping(code) {
        Some(refusal) => PdfIslandOutcome::Refused {
            code: refusal,
            detail: note,
        },
        None => PdfIslandOutcome::Refused {
            code: PublishedRefusal::Crash,
            detail: format!("island exit {code}: {note}"),
        },
    }
}

fn code_mapping(code: i32) -> Option<PublishedRefusal> {
    match code {
        exit::MEMORY_LIMIT => Some(PublishedRefusal::MemoryLimit),
        exit::INPUT_EXCEEDED => Some(PublishedRefusal::InputExceeded),
        exit::FS_POLICY => Some(PublishedRefusal::FsPolicy),
        _ => None,
    }
}
