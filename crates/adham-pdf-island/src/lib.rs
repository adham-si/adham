//! Island crate: a disposable child process that will one day host the PDF
//! parser. Stage 1 ships a synthetic worker plus the supervisor that proves
//! the process boundary (caps, stream guards, kill/reap, no secrets) before
//! any parser dependency exists.

pub mod caps;
pub mod protocol;
mod reap;
pub mod supervisor;

pub use protocol::{PdfIslandOutcome, PublishedRefusal};
pub use supervisor::{Cancel, Caps, IslandRun, SpawnSpec};

#[cfg(test)]
mod source_policy_tests {
    /// The island must not gain filesystem or network code silently. Reads
    /// its own sources and rejects imports/uses the contract forbids; this
    /// is a policy tripwire, not an OS sandbox (recorded honestly as such).
    #[test]
    fn island_sources_contain_no_net_or_fs_io() {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let mut offenders = Vec::new();
        for (file, path) in [
            ("caps.rs", format!("{manifest}/src/caps.rs")),
            ("worker.rs", format!("{manifest}/src/worker.rs")),
            ("main.rs", format!("{manifest}/src/main.rs")),
        ] {
            let source = std::fs::read_to_string(&path).expect("source readable");
            for banned in [
                "std::net",
                "TcpStream",
                "UdpSocket",
                "fs::read",
                "fs::write",
                "OpenOptions",
            ] {
                if source.contains(banned) {
                    offenders.push(format!("{file} uses {banned}"));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "island sources must stay net/fs-free by contract: {offenders:?}"
        );
    }
}
