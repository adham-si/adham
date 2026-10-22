//! Stage-1 boundary proofs for the island: every test spawns a real child
//! process and asserts both the refusal (never a partial success) and that
//! the child was reaped (a follow-up run works).

use adham_pdf_island::{Cancel, Caps, IslandRun, PdfIslandOutcome, PublishedRefusal, SpawnSpec};
use std::path::PathBuf;

fn bin_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_adham-pdf-island"))
}

fn spec(modes: &[&str], input: Vec<u8>) -> SpawnSpec {
    SpawnSpec {
        binary_path: bin_path(),
        input,
        caps: Caps::default(),
        modes: modes.iter().map(|m| (*m).to_owned()).collect(),
        test_env: Vec::new(),
    }
}

fn refusal_of(run: &IslandRun) -> PublishedRefusal {
    match &run.outcome {
        PdfIslandOutcome::Refused { code, .. } => *code,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

fn healthy_run_after(run: &IslandRun, label: &str) {
    let followup = adham_pdf_island::supervisor::run(spec(&[], b"healthy".to_vec()));
    match followup.outcome {
        adham_pdf_island::PdfIslandOutcome::Pages { pages, .. } => {
            assert!(!pages.is_empty(), "{label}: follow-up spawning still works")
        }
        other => panic!("{label}: island reaping failed before this outcome {other:?}"),
    }
    let _ = run;
}

#[test]
fn memory_limit_enforced_before_parsing() {
    let run = adham_pdf_island::supervisor::run(spec(&["--alloc-bomb"], Vec::new()));
    let code = refusal_of(&run);
    assert_eq!(code, PublishedRefusal::MemoryLimit, "got run {run:?}");
    healthy_run_after(&run, "alloc-bomb");
}

#[test]
fn input_is_bounded_and_refused() {
    let payload = vec![b'z'; 5 * 1024 * 1024 + 1];
    let run = adham_pdf_island::supervisor::run(spec(&[], payload));
    assert_eq!(refusal_of(&run), PublishedRefusal::InputExceeded);
    healthy_run_after(&run, "input-bound");
}

#[test]
fn healthy_run_streams_pages_in_caps() {
    let input = b"h".repeat(5000);
    let run = adham_pdf_island::supervisor::run(spec(&[], input));
    match run.outcome.clone() {
        PdfIslandOutcome::Pages { pages, truncated } => {
            assert_eq!(pages.len(), 5, "1000-char synthetic pages");
            assert_eq!(pages[0].0, 1, "pages are 1-indexed");
            assert_eq!(pages[4].0, 5);
            assert_eq!(pages[0].1, "h".repeat(1000));
            assert!(!truncated);
        }
        other => panic!("healthy run refused: {other:?}"),
    }
    assert!(
        run.stderr_tail.is_empty()
            || String::from_utf8_lossy(&run.stderr_tail)
                .lines()
                .all(|l| l == "MEM_WALL_BY_SUPERVISOR"),
        "no unexpected stderr chatter on the clean path: {:?}",
        String::from_utf8_lossy(&run.stderr_tail)
    );
}

#[test]
fn no_secrets_reach_the_island() {
    // The contract: the supervisor clears the environment and adds only its
    // explicit plant list. So the child's audit must show exactly that list
    // and nothing else — including canaries parked in the parent process.
    unsafe {
        std::env::set_var("PARENT_SECRET_CANARY", "never-travelling");
        std::env::set_var("PARENT_TOKEN", "host-side-only");
    }
    let mut s = spec(&["--self-audit"], Vec::new());
    s.test_env = vec![(
        "BENIGN_AUDIT_MARKER".to_owned(),
        "deliberate-plant".to_owned(),
    )];
    let run = adham_pdf_island::supervisor::run(s);
    let stderr = String::from_utf8(run.stderr_tail.clone()).unwrap_or_default();
    assert!(
        !stderr.contains("PARENT_SECRET_CANARY") && !stderr.contains("host-side-only"),
        "host canaries must not travel: {stderr}"
    );
    assert!(
        stderr.contains("BENIGN_AUDIT_MARKER"),
        "the deliberate plant is the only env the island sees: {stderr}"
    );
    let env_lines: Vec<&str> = stderr.lines().filter(|l| l.starts_with("ENV ")).collect();
    assert_eq!(env_lines.len(), 1, "exactly the planted env: {env_lines:?}");
}

#[test]
fn island_refuses_filesystem_actions() {
    let run = adham_pdf_island::supervisor::run(spec(&["--fs-forbidden"], Vec::new()));
    assert_eq!(refusal_of(&run), PublishedRefusal::FsPolicy, "{run:?}");
    healthy_run_after(&run, "fs-policy");
}

#[test]
fn timeout_terminates_and_reaps() {
    let mut s = spec(&["--sleep", "60"], Vec::new());
    s.caps.clock_ms = 300;
    let started = std::time::Instant::now();
    let run = adham_pdf_island::supervisor::run(s);
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert_eq!(refusal_of(&run), PublishedRefusal::Timeout);
    healthy_run_after(&run, "timeout");
}

#[test]
fn explicit_cancel_terminates_and_reaps() {
    let mut s = spec(&["--sleep", "60"], Vec::new());
    s.caps.clock_ms = 30_000;
    let cancel = Cancel::default();
    let trigger = cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(120));
        trigger.trigger();
    });
    let run = adham_pdf_island::supervisor::run_with(s, Some(&cancel));
    assert_eq!(refusal_of(&run), PublishedRefusal::Timeout);
    healthy_run_after(&run, "cancel");
}

#[test]
fn crash_refuses_without_partial_success() {
    let run = adham_pdf_island::supervisor::run(spec(&["--crash"], Vec::new()));
    assert_eq!(refusal_of(&run), PublishedRefusal::Crash);
    healthy_run_after(&run, "crash");
}

#[test]
fn garbage_output_refuses_without_partial_success() {
    let run = adham_pdf_island::supervisor::run(spec(&["--garbage"], Vec::new()));
    assert_eq!(refusal_of(&run), PublishedRefusal::MalformedOutput);
    healthy_run_after(&run, "garbage");
}

#[test]
fn late_crash_never_leaks_partial_pages() {
    let input = b"l".repeat(3000); // exactly 3 synthetic pages
    let run = adham_pdf_island::supervisor::run(spec(&["--late-crash"], input));
    assert_eq!(refusal_of(&run), PublishedRefusal::Crash);
    match run.outcome {
        PdfIslandOutcome::Refused { .. } => {}
        other => panic!("partial pages must not surface: {other:?}"),
    }
    healthy_run_after(&run, "late-crash");
}

#[test]
fn per_page_cap_is_enforced() {
    let input = b"o".repeat(4); // content irrelevant under the fault mock
    let mut s = spec(&["--over-page"], input);
    s.caps.page_chars = 100;
    let run = adham_pdf_island::supervisor::run(s);
    assert_eq!(refusal_of(&run), PublishedRefusal::OutputCap);
    // Caps mismatch is the supervisor's own defense; the island is honestly
    // killed and reaped.
    healthy_run_after(&run, "per-page");
}

#[test]
fn total_char_cap_is_enforced() {
    let s = spec(&["--ignore-total"], Vec::new());
    let run = adham_pdf_island::supervisor::run(s);
    assert_eq!(refusal_of(&run), PublishedRefusal::OutputCap);
    healthy_run_after(&run, "total-cap");
}
