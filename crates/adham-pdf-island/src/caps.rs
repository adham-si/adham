//! Self-imposed island memory wall, armed before any parsing.
//!
//! The island limits itself the moment it starts: unix uses
//! `setrlimit(RLIMIT_AS)`, Windows assigns its own process to a Job Object
//! with a process-memory cap (an over-limit allocation then fails instead
//! of silently expanding). Worker allocations go through raw allocators so
//! a trip is a clean exit code, never a panicked parser in charge.

/// Allocate until the reserved total exceeds the imposed limit.
/// Returns `false` when an allocation failed — the wall held. Pages are
/// spot-touched so a reservation turns into a real footprint (Darwin's
/// watcher counts only touched memory).
pub fn allocation_reserves_hold_up_to_limit() -> bool {
    const CHUNK: u64 = 64 * 1024 * 1024;
    let mut held: Vec<RawChunk> = Vec::new();
    for _ in 0..32 {
        match RawChunk::new(CHUNK as usize) {
            Some(chunk) => {
                chunk.spot_touch();
                held.push(chunk);
            }
            None => return true,
        }
    }
    false
}

/// Raw reservation pages that surface allocation failure as `None`
/// instead of hitting the boxed allocator's abort path.
pub struct RawChunk {
    ptr: *mut core::ffi::c_void,
    len: usize,
}

impl RawChunk {
    pub fn new(len: usize) -> Option<Self> {
        Some(Self {
            ptr: alloc_raw(len)?,
            len,
        })
    }

    /// Visit every page of the span once so the OS counts the reservation
    /// as real, resident memory (Darwin's watcher reads physical footprint;
    /// reserved-but-untouched pages would hide from it).
    pub fn spot_touch(&self) {
        if self.len == 0 {
            return;
        }
        let base = self.ptr.cast::<u8>();
        let mut offset = 0usize;
        while offset < self.len {
            unsafe { base.add(offset).write_volatile(1) };
            offset += 4096;
        }
        unsafe { base.add(self.len.wrapping_sub(1)).write_volatile(1) };
    }
}

impl Drop for RawChunk {
    fn drop(&mut self) {
        free_raw(self.ptr, self.len);
    }
}

#[cfg(unix)]
fn alloc_raw(len: usize) -> Option<*mut core::ffi::c_void> {
    let ptr = unsafe { libc::malloc(len) };
    (!ptr.is_null()).then_some(ptr)
}

#[cfg(unix)]
fn free_raw(ptr: *mut core::ffi::c_void, _len: usize) {
    unsafe { libc::free(ptr) };
}

/// What the island could do to cap its own memory.
///
/// Variant use is per-target-triple: Linux constructs `Enforced`, Windows
/// constructs `Enforced`/`Failed`, macOS constructs only
/// `WatchBySupervisor`/`Failed`. The per-triple dead variants are expected.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Impose {
    /// The OS kernel enforces the limit inside this process (Linux rlimit,
    /// Windows Job Object) and any over-limit allocation surfaces here.
    Enforced,
    /// Darwin enforces no per-process memory rlimit; the supervisor instead
    /// watches the child's physical footprint and kills on limit. The island
    /// treats "no cap" as true for parsing but the parent owns kill-on-limit.
    WatchBySupervisor,
    /// The impose syscall itself failed — parsing must refuse.
    Failed,
}

#[cfg(unix)]
pub fn impose_self_memory_limit(bytes: u64) -> Impose {
    #[cfg(target_os = "macos")]
    {
        let _ = &bytes;
        // Darwin:setrlimit(RLIMIT_AS/DATA) fails on EINVAL; there is no
        // per-process memory wall to install. The supervisor's footprint
        // watcher is the kill-on-limit.
        Impose::WatchBySupervisor
    }
    #[cfg(not(target_os = "macos"))]
    {
        let lim = libc::rlimit {
            rlim_cur: bytes,
            rlim_max: bytes,
        };
        let ok = unsafe { libc::setrlimit(libc::RLIMIT_AS, &lim) == 0 };
        if ok { Impose::Enforced } else { Impose::Failed }
    }
}

#[cfg(windows)]
fn alloc_raw(len: usize) -> Option<*mut core::ffi::c_void> {
    use windows_sys::Win32::System::Memory::{
        MEM_COMMIT, MEM_RESERVE, PAGE_READWRITE, VirtualAlloc,
    };
    let ptr = unsafe {
        VirtualAlloc(
            std::ptr::null_mut(),
            len,
            MEM_RESERVE | MEM_COMMIT,
            PAGE_READWRITE,
        )
    };
    (!ptr.is_null()).then_some(ptr)
}

#[cfg(windows)]
fn free_raw(_ptr: *mut core::ffi::c_void, _len: usize) {}

#[cfg(windows)]
pub fn impose_self_memory_limit(bytes: u64) -> Impose {
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Impose::Failed;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = core::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
        info.ProcessMemoryLimit = bytes as usize;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            core::ptr::from_ref(&info).cast(),
            core::mem::size_of_val(&info) as u32,
        ) != 0
            && AssignProcessToJobObject(job, GetCurrentProcess()) != 0;
        windows_sys::Win32::Foundation::CloseHandle(job);
        if ok { Impose::Enforced } else { Impose::Failed }
    }
}
