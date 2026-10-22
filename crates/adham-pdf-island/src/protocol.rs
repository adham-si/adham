//! Island protocol v0: shared caps, line framing, exit codes and outcomes.
//!
//! Stage 1 is synthetic: the worker emits fake pages so the process
//! boundary (spawn, caps, stream guards, kill/reap) can be proven before
//! any PDF parser exists. Types and constants here are the contract the
//! real parser waves will reuse unchanged.

/// Hard caps mirror the #32 attachment service so the numbers never drift:
/// `MAX_ATTACHMENT_BYTES` = 5 MiB input, `MAX_EXTRACTED_CHARS` = 200 000 output.
pub const INPUT_BYTES: usize = 5 * 1024 * 1024;
pub const TOTAL_CHARS: usize = 200_000;
pub const PAGE_CHARS: usize = 20_000;
/// One stdout line may not exceed this; a bigger line is a protocol fault,
/// not something to buffer defensively.
pub const LINE_BYTES: usize = 1024 * 1024;
/// Wall-clock budget for one island run.
pub const CLOCK_MS: u64 = 30_000;
/// Self-imposed island RSS limit (rlimit AS / Job Object process memory).
pub const RSS_BYTES: u64 = 512 * 1024 * 1024;

/// Worker exit codes. Anything not in this table is an island fault.
pub mod exit {
    pub const OK: i32 = 0;
    /// The self-imposed memory limit tripped (allocation failed).
    pub const MEMORY_LIMIT: i32 = 42;
    /// stdin exceeded the input cap; nothing was parsed.
    pub const INPUT_EXCEEDED: i32 = 43;
    /// A forbidden filesystem action was attempted inside the island.
    pub const FS_POLICY: i32 = 44;
    /// Worker-side limit-imposition or usage failure; parsing refused.
    pub const USAGE: i32 = 65;
    /// stdin closed before the whole input arrived.
    pub const INPUT_CLOSED: i32 = 66;
}

/// One worker stdout line: `PAGE <n> <text>` with 1-indexed n, or the single
/// line `TRUNC` after any capped page. Page bodies never contain newlines.
pub const PAGE_PREFIX: &str = "PAGE ";
pub const TRUNC_LINE: &str = "TRUNC";

/// Result of one supervisor-managed island run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdfIslandOutcome {
    /// Clean run: pages in file order (1-indexed), `truncated` set only by
    /// the worker's explicit `TRUNC` line under the agreed caps.
    Pages {
        pages: Vec<(u32, String)>,
        truncated: bool,
    },
    /// The attachment must be refused: nothing partial leaks forward.
    Refused {
        code: PublishedRefusal,
        detail: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishedRefusal {
    /// Memory cap tripped (rlimit/job) — never spent the budget parsing.
    MemoryLimit,
    /// stdin over the input cap.
    InputExceeded,
    /// Wall clock expired before completion; killed and reaped.
    Timeout,
    /// Island died (abort, nonprotocol exit) or produced garbage protocol.
    Crash,
    /// Worker stdout violated the line/caps contract.
    MalformedOutput,
    /// Island violated caps it was told to honor.
    OutputCap,
    /// Island code attempted filesystem access outside its argv contract.
    FsPolicy,
    /// The island binary itself could not be launched.
    SpawnFailed,
}

impl PublishedRefusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MemoryLimit => "memoryLimit",
            Self::InputExceeded => "inputExceeded",
            Self::Timeout => "islandTimeout",
            Self::Crash => "islandFailure",
            Self::MalformedOutput => "malformedOutput",
            Self::OutputCap => "outputCap",
            Self::FsPolicy => "fsPolicy",
            Self::SpawnFailed => "spawnFailed",
        }
    }
}
