use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublisherId(pub String);

impl PublisherId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

impl fmt::Display for PublisherId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustTier {
    Unverified,
    CommunityVerified,
    AdhamReviewed,
    OrganizationApproved,
}

impl fmt::Display for TrustTier {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unverified => write!(f, "unverified"),
            Self::CommunityVerified => write!(f, "community_verified"),
            Self::AdhamReviewed => write!(f, "adham_reviewed"),
            Self::OrganizationApproved => write!(f, "organization_approved"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublisherIdentity {
    pub publisher_id: PublisherId,
    pub display_name: String,
    pub key_fingerprint: Option<String>,
    pub trust_tier: TrustTier,
}

impl PublisherIdentity {
    pub fn new(
        publisher_id: impl Into<String>,
        display_name: impl Into<String>,
        key_fingerprint: Option<String>,
        trust_tier: TrustTier,
    ) -> Self {
        Self {
            publisher_id: PublisherId::new(publisher_id),
            display_name: display_name.into(),
            key_fingerprint,
            trust_tier,
        }
    }

    pub fn unverified(publisher_id: impl Into<String>, display_name: impl Into<String>) -> Self {
        Self::new(publisher_id, display_name, None, TrustTier::Unverified)
    }
}
