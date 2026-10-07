use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelResponse {
    pub text: String,
    pub tokens_used: u32,
}

pub trait ModelPort: Send + Sync {
    fn request_completion(
        &self,
        prompt: &str,
    ) -> impl std::future::Future<Output = Result<ModelResponse, String>> + Send;
}

pub struct FakeModelAdapter {
    canned_responses: Mutex<Vec<ModelResponse>>,
}

impl FakeModelAdapter {
    pub fn new(responses: Vec<ModelResponse>) -> Self {
        Self {
            canned_responses: Mutex::new(responses),
        }
    }

    pub fn with_default_response(text: &str) -> Self {
        Self::new(vec![ModelResponse {
            text: text.to_string(),
            tokens_used: 42,
        }])
    }
}

impl ModelPort for FakeModelAdapter {
    async fn request_completion(&self, _prompt: &str) -> Result<ModelResponse, String> {
        let mut guard = self.canned_responses.lock().map_err(|e| e.to_string())?;
        if guard.is_empty() {
            Ok(ModelResponse {
                text: "Default response from fake model".to_string(),
                tokens_used: 10,
            })
        } else {
            Ok(guard.remove(0))
        }
    }
}
