//! Island worker v0 (synthetic): reads stdin only, emits `PAGE <n> <text>`
//! lines to stdout, notes on stderr. Fault modes are opt-in flags used by
//! the boundary tests; the default run is the "honest extractor" stand-in.

use crate::caps;
use crate::protocol::exit;
use crate::protocol::{PAGE_PREFIX, TOTAL_CHARS, TRUNC_LINE};
use std::io::{Read, Write};

const CHUNK_BUF: usize = 8 * 1024;

/// Bounded stdin read; nothing else may be opened. Over-cap input is a
/// refusal, never a partial snapshot.
fn read_input_bounded(input_bytes_cap: usize) -> Result<Vec<u8>, i32> {
    let mut out = Vec::new();
    let mut buf = vec![0u8; CHUNK_BUF];
    let mut stdin = std::io::stdin().lock();
    loop {
        let n = match stdin.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return Err(exit::INPUT_CLOSED),
        };
        out.extend_from_slice(&buf[..n]);
        if out.len() > input_bytes_cap {
            eprintln!("INPUT_EXCEEDED above {input_bytes_cap}");
            return Err(exit::INPUT_EXCEEDED);
        }
    }
    Ok(out)
}

/// The v0 stand-in "parser": 1000-byte chunks of the synthetic input become
/// 1-indexed pages (line breaks stripped so payloads stay on one line),
/// honestly truncated at `TOTAL_CHARS`.
fn synthetic_pages(input: &[u8], page_chars: usize) -> (Vec<String>, bool) {
    let raw_len = input.len();
    let target = raw_len.min(TOTAL_CHARS);
    let mut pages = Vec::new();
    let mut start = 0usize;
    while start < target {
        let end = (start + 1000).min(target);
        let mut body: String = raw_input_to_line(&input[start..end]).collect();
        if body.len() > page_chars {
            body.truncate(page_chars);
        }
        pages.push(body);
        start = end;
    }
    (pages, raw_len > TOTAL_CHARS)
}

fn raw_input_to_line(bytes: &[u8]) -> impl Iterator<Item = char> + '_ {
    bytes
        .iter()
        .filter(|b| **b != b'\n' && **b != b'\r')
        .map(|b| *b as char)
}

fn emit_pages(pages: &[String], truncated: bool) {
    let mut stdout = std::io::stdout().lock();
    for (index, body) in pages.iter().enumerate() {
        let _ = writeln!(stdout, "{PAGE_PREFIX}{} {body}", index + 1);
    }
    if truncated {
        let _ = stdout.write_all(TRUNC_LINE.as_bytes());
        let _ = stdout.write_all(b"\n");
    }
    let _ = stdout.flush();
}

pub fn run_worker() -> i32 {
    // Memory wall first, before any use of the payload: absent a working
    // limit there is no parsing, only refusal.
    match caps::impose_self_memory_limit(crate::protocol::RSS_BYTES) {
        caps::Impose::Enforced => {}
        caps::Impose::WatchBySupervisor => {
            eprintln!("MEM_WALL_BY_SUPERVISOR");
        }
        caps::Impose::Failed => {
            eprintln!("MEMORY_LIMIT_IMPOSITION_FAILED");
            return exit::USAGE;
        }
    }

    let mut input_cap = crate::protocol::INPUT_BYTES;
    let mut page_chars = crate::protocol::PAGE_CHARS;
    let mut modes = Vec::new();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--input-bytes" => {
                input_cap = iter
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(input_cap);
            }
            "--page-chars" => {
                page_chars = iter
                    .next()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(page_chars);
            }
            other => modes.push((*other).to_string()),
        }
    }

    let mut i = 0usize;
    while i < modes.len() {
        match modes[i].as_str() {
            "--self-audit" => {
                // Prove what the island can see of its environment: with a
                // cleared spawn nothing application-owned may appear here.
                for (key, value) in std::env::vars_os() {
                    let _ = writeln!(std::io::stderr(), "ENV {key:?}={value:?}");
                }
                return exit::OK;
            }
            // The island refuses to open the filesystem by contract: the
            // probe path can only arrive as a flag and is never touched.
            "--fs-forbidden" => {
                eprintln!("FS_POLICY (island refuses filesystem access)");
                return exit::FS_POLICY;
            }
            "--alloc-bomb" => {
                if !caps::allocation_reserves_hold_up_to_limit() {
                    eprintln!("LIMIT_NOT_HELD (an allocation past the cap succeeded)");
                    return exit::USAGE;
                }
                return exit::MEMORY_LIMIT;
            }
            "--crash" => std::process::abort(),
            "--garbage" => {
                let _ = std::io::stdout().write_all(b"###not-a-protocol-line\x00\n");
                let _ = std::io::stdout().flush();
                return exit::OK;
            }
            "--spam" => {
                let mut line = Vec::new();
                line.extend_from_slice(b"PAGE 1 ");
                line.extend(std::iter::repeat_n(b'x', 10 * 1024 * 1024));
                line.push(b'\n');
                let _ = std::io::stdout().write_all(&line);
                let _ = std::io::stdout().flush();
                return exit::OK;
            }
            "--sleep" => {
                // Sleep long enough for the supervisor clock or caller to
                // kill us; a follow-up numeric modes entry is the duration.
                let secs = modes
                    .get(i + 1)
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(60);
                if secs > 0 {
                    std::thread::sleep(std::time::Duration::from_secs(secs));
                }
                return exit::OK;
            }
            "--late-crash" => {
                let input = match read_input_bounded(input_cap) {
                    Ok(input) => input,
                    Err(code) => return code,
                };
                let (pages, _) = synthetic_pages(&input, page_chars);
                emit_pages(&pages[..pages.len().min(3)], false);
                std::process::abort();
            }
            _ => {}
        }
        i += 1;
    }

    // Default run: the honest synthetic extractor. Fault mocks below exist
    // only to exercise the supervisor's own guards.
    match read_input_bounded(input_cap) {
        Ok(input) => {
            let (pages, truncated) = if modes.iter().any(|m| m == "--over-page") {
                (vec!["p".repeat(page_chars + 5)], true)
            } else if modes.iter().any(|m| m == "--ignore-total") {
                // 300 x ~908-char pages — honest lines, total over the cap.
                let pages = (0..300)
                    .map(|index| format!("page{index} {}", "q".repeat(900)))
                    .collect();
                (pages, false)
            } else {
                synthetic_pages(&input, page_chars)
            };
            emit_pages(&pages, truncated);
            exit::OK
        }
        Err(code) => code,
    }
}
