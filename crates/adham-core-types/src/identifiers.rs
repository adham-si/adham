use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use ts_rs::TS;
use uuid::Uuid;

macro_rules! define_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
        #[ts(export, type = "string")]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new_v7() -> Self {
                Self(Uuid::now_v7())
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn from_string(s: &str) -> Result<Self, uuid::Error> {
                Uuid::parse_str(s).map(Self)
            }

            pub fn from_client_str(s: &str) -> Self {
                Uuid::parse_str(s).map(Self).unwrap_or_else(|_| Self::new_v7())
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(s).map(Self)
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new_v7()
            }
        }
    };
}

define_id!(InstallationId);
define_id!(ActorId);
define_id!(WorkspaceId);
define_id!(ProjectId);
define_id!(SessionId);
define_id!(MessageId);
define_id!(RequestId);
define_id!(CorrelationId);
define_id!(ContentId);
define_id!(EventId);
define_id!(StreamId);
