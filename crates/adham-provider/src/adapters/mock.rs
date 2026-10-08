use crate::domain::error::ProviderError;
use crate::domain::request::ProviderRequestV1;
use crate::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};

pub struct MockProviderAdapter {
    canned_deltas: Vec<String>,
    simulated_error: Option<ProviderError>,
}

impl MockProviderAdapter {
    pub fn new(canned_deltas: Vec<String>) -> Self {
        Self {
            canned_deltas,
            simulated_error: None,
        }
    }

    pub fn with_error(err: ProviderError) -> Self {
        Self {
            canned_deltas: Vec::new(),
            simulated_error: Some(err),
        }
    }

    pub fn execute_stream(
        &self,
        _request: &ProviderRequestV1,
    ) -> Result<Vec<NormalizedStreamEvent>, ProviderError> {
        if let Some(err) = &self.simulated_error {
            return Err(err.clone());
        }

        let mut events = vec![NormalizedStreamEvent::StreamStarted];

        let mut total_chars = 0;
        for delta in &self.canned_deltas {
            total_chars += delta.len() as u32;
            events.push(NormalizedStreamEvent::TextDelta(delta.clone()));
        }

        events.push(NormalizedStreamEvent::Progress(StreamUsage {
            prompt_tokens: 15,
            completion_tokens: total_chars / 4 + 1,
            total_tokens: 15 + total_chars / 4 + 1,
        }));

        events.push(NormalizedStreamEvent::StreamCompleted(
            StreamCompletionOutcome::Stop,
        ));

        Ok(events)
    }
}
