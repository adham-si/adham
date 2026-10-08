use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use thiserror::Error;

pub const MAX_CONCURRENT_READS: u32 = 4;
pub const MAX_CONCURRENT_MUTATIONS: u32 = 1;
pub const MAX_CONCURRENT_PROCESSES: u32 = 1;
pub const MAX_PENDING_QUEUE_SIZE: usize = 64;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SchedulerError {
    #[error("Exceeded maximum concurrent read operations ({MAX_CONCURRENT_READS})")]
    ReadCapacityExceeded,
    #[error("Exceeded maximum concurrent mutation operations ({MAX_CONCURRENT_MUTATIONS})")]
    MutationCapacityExceeded,
    #[error("Exceeded maximum concurrent process operations ({MAX_CONCURRENT_PROCESSES})")]
    ProcessCapacityExceeded,
    #[error("Pending queue full ({MAX_PENDING_QUEUE_SIZE})")]
    QueueFull,
}

#[derive(Debug, Default, Clone)]
pub struct ToolScheduler {
    active_reads: Arc<AtomicU32>,
    active_mutations: Arc<AtomicU32>,
    active_processes: Arc<AtomicU32>,
}

#[derive(Debug)]
pub struct ReadSlotGuard {
    active_reads: Arc<AtomicU32>,
}

impl Drop for ReadSlotGuard {
    fn drop(&mut self) {
        self.active_reads.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug)]
pub struct MutationSlotGuard {
    active_mutations: Arc<AtomicU32>,
}

impl Drop for MutationSlotGuard {
    fn drop(&mut self) {
        self.active_mutations.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug)]
pub struct ProcessSlotGuard {
    active_processes: Arc<AtomicU32>,
}

impl Drop for ProcessSlotGuard {
    fn drop(&mut self) {
        self.active_processes.fetch_sub(1, Ordering::SeqCst);
    }
}

impl ToolScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn acquire_read_slot(&self) -> Result<ReadSlotGuard, SchedulerError> {
        let current = self.active_reads.fetch_add(1, Ordering::SeqCst);
        if current >= MAX_CONCURRENT_READS {
            self.active_reads.fetch_sub(1, Ordering::SeqCst);
            return Err(SchedulerError::ReadCapacityExceeded);
        }
        Ok(ReadSlotGuard {
            active_reads: Arc::clone(&self.active_reads),
        })
    }

    pub fn acquire_mutation_slot(&self) -> Result<MutationSlotGuard, SchedulerError> {
        let current = self.active_mutations.fetch_add(1, Ordering::SeqCst);
        if current >= MAX_CONCURRENT_MUTATIONS {
            self.active_mutations.fetch_sub(1, Ordering::SeqCst);
            return Err(SchedulerError::MutationCapacityExceeded);
        }
        Ok(MutationSlotGuard {
            active_mutations: Arc::clone(&self.active_mutations),
        })
    }

    pub fn acquire_process_slot(&self) -> Result<ProcessSlotGuard, SchedulerError> {
        let current = self.active_processes.fetch_add(1, Ordering::SeqCst);
        if current >= MAX_CONCURRENT_PROCESSES {
            self.active_processes.fetch_sub(1, Ordering::SeqCst);
            return Err(SchedulerError::ProcessCapacityExceeded);
        }
        Ok(ProcessSlotGuard {
            active_processes: Arc::clone(&self.active_processes),
        })
    }
}
