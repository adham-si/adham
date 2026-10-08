use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationVerdict {
    Pass,
    PassWithWarnings(String),
    Fail(String),
    Blocked(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionContract {
    pub task_id: String,
    pub required_evidence_count: usize,
}

pub trait VerificationPort: Send + Sync {
    fn verify_completion(
        &self,
        contract: &CompletionContract,
        evidence: &[String],
    ) -> impl std::future::Future<Output = Result<VerificationVerdict, String>> + Send;
}

pub struct FakeVerificationAdapter {
    verdict: VerificationVerdict,
}

impl FakeVerificationAdapter {
    pub fn new(verdict: VerificationVerdict) -> Self {
        Self { verdict }
    }
}

impl VerificationPort for FakeVerificationAdapter {
    async fn verify_completion(
        &self,
        contract: &CompletionContract,
        evidence: &[String],
    ) -> Result<VerificationVerdict, String> {
        if evidence.len() < contract.required_evidence_count {
            Ok(VerificationVerdict::Fail(format!(
                "Insufficient evidence: required {}, found {}",
                contract.required_evidence_count,
                evidence.len()
            )))
        } else {
            Ok(self.verdict.clone())
        }
    }
}
