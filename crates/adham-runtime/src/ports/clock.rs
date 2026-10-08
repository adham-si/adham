use std::sync::atomic::{AtomicI64, Ordering};
use time::OffsetDateTime;

pub trait Clock: Send + Sync {
    fn now_utc_us(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_utc_us(&self) -> i64 {
        (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
    }
}

pub struct MockClock {
    current_time_us: AtomicI64,
}

impl MockClock {
    pub fn new(initial_us: i64) -> Self {
        Self {
            current_time_us: AtomicI64::new(initial_us),
        }
    }

    pub fn advance_us(&self, delta: i64) {
        self.current_time_us.fetch_add(delta, Ordering::SeqCst);
    }

    pub fn set_us(&self, value: i64) {
        self.current_time_us.store(value, Ordering::SeqCst);
    }
}

impl Clock for MockClock {
    fn now_utc_us(&self) -> i64 {
        self.current_time_us.load(Ordering::SeqCst)
    }
}
