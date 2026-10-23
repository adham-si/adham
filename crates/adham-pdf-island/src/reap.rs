//! Reaping, kill paths and the macOS footprint watcher. Kill is a means of
//! ending a run, never an outcome claim: everything here reports what the
//! OS actually observed, and the stream's refusal (clock, cancel, breach)
//! stays the semantic authority.

use std::process::Child;
use std::sync::atomic::AtomicBool;
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// Ad-hoc trace for the harness; prints only when `ISLAND_TRACE` is set.
pub(crate) fn trace(msg: &str) {
    if std::env::var_os("ISLAND_TRACE").is_some() {
        eprintln!("[island-sup {}] {}", std::process::id(), msg);
    }
}

pub(super) enum ChildEnd {
    Clean,
    Exited { code: i32, note: String },
}

pub(super) fn reap_child(child: &mut Child) -> ChildEnd {
    trace(&format!("reap: try_wait pid {}", child.id()));
    match child.try_wait() {
        Ok(Some(status)) => classify_status(status),
        Ok(None) => {
            // Grace: a healthy island exits immediately after its stdout is
            // drained; on slow schedulers the exit may only land a moment
            // after our poll. Give it a moment, then treat any linger as a
            // contract breach and kill.
            let started = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => return classify_status(status),
                    Ok(None) => {
                        if started.elapsed() > Duration::from_millis(200) {
                            trace(&format!(
                                "reap: pid {} lingered after drain — killing",
                                child.id()
                            ));
                            kill_everything(child);
                            match child.wait() {
                                Ok(status) => return classify_status(status),
                                Err(_) => {
                                    return ChildEnd::Exited {
                                        code: -1,
                                        note: "unreapable after kill".into(),
                                    };
                                }
                            }
                        }
                    }
                    Err(_) => {
                        return ChildEnd::Exited {
                            code: -1,
                            note: "unreapable after poll error".into(),
                        };
                    }
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        Err(_) => {
            kill_everything(child);
            ChildEnd::Exited {
                code: -1,
                note: "unreapable after poll error".into(),
            }
        }
    }
}

#[cfg(unix)]
fn kill_everything(child: &mut Child) {
    let pid = child.id();
    let _ = child.kill();
    // Best effort whole group kill: the island never forks in v0; the
    // parser waves will not either, so the single kill is authoritative.
    unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL) };
}

#[cfg(windows)]
fn kill_everything(child: &mut Child) {
    let _ = child.kill();
}

#[cfg(unix)]
fn classify_status(status: std::process::ExitStatus) -> ChildEnd {
    use std::os::unix::process::ExitStatusExt;
    match status.signal() {
        // SIGKILL (9) is the only signal the supervisor (or watcher) itself
        // arms; it is reaped as the violence it was, not as a timeout claim.
        Some(9) => ChildEnd::Exited {
            code: 137,
            note: "island killed by supervisor (SIGKILL)".into(),
        },
        Some(signal) => ChildEnd::Exited {
            code: 128 + signal,
            note: format!("island died on signal {signal}"),
        },
        None => match status.code() {
            Some(0) => ChildEnd::Clean,
            Some(code) => ChildEnd::Exited {
                code,
                note: "unusual island exit".into(),
            },
            None => ChildEnd::Exited {
                code: -1,
                note: "unknown island exit".into(),
            },
        },
    }
}

#[cfg(windows)]
fn classify_status(status: std::process::ExitStatus) -> ChildEnd {
    match status.code() {
        Some(0) => ChildEnd::Clean,
        Some(code) => ChildEnd::Exited {
            code,
            note: "unusual island exit".into(),
        },
        None => ChildEnd::Exited {
            code: -1,
            note: "unknown island exit".into(),
        },
    }
}

/// Darwin enforces no per-process memory rlimit (setrlimit AS/DATA fails
/// EINVAL): the supervisor itself watches the island's physical footprint
/// and SIGKILLs the moment it passes the cap (kill-on-limit).
#[cfg(target_os = "macos")]
pub(super) fn spawn_footprint_watcher(
    child_id: u32,
    rss_bytes: u64,
) -> (
    std::sync::Arc<AtomicBool>,
    Option<std::thread::JoinHandle<()>>,
) {
    let tripped = std::sync::Arc::new(AtomicBool::new(false));
    let flag = tripped.clone();
    let pid = child_id as libc::pid_t;
    let watcher = std::thread::Builder::new()
        .name("island-footprint".into())
        .spawn(move || {
            loop {
                let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
                let rv = unsafe {
                    libc::proc_pid_rusage(
                        pid,
                        libc::RUSAGE_INFO_V4,
                        core::ptr::from_mut(&mut info).cast(),
                    )
                };
                if rv != 0 {
                    // Child is gone (reaped or never started); nothing to watch.
                    break;
                }
                if info.ri_phys_footprint > rss_bytes {
                    flag.store(true, Ordering::SeqCst);
                    trace(&format!(
                        "watcher: trip at {} bytes",
                        info.ri_phys_footprint
                    ));
                    unsafe { libc::kill(pid, libc::SIGKILL) };
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        })
        .expect("footprint watcher");
    (tripped, Some(watcher))
}

/// Other targets enforce memory inside the island itself (rlimit / Job
/// Object); no watcher is needed.
#[cfg(not(target_os = "macos"))]
pub(super) fn spawn_footprint_watcher(
    _child_id: u32,
    _rss_bytes: u64,
) -> (
    std::sync::Arc<AtomicBool>,
    Option<std::thread::JoinHandle<()>>,
) {
    (std::sync::Arc::new(AtomicBool::new(false)), None)
}
