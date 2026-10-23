use adham_core_types::ContentId;
use adham_core_types::history::{
    SessionArchiveChangedV1, SessionDeletedV1, SessionPinChangedV1, SessionRenamedV1,
    SessionSummaryUpdatedV1,
};

#[test]
fn title_validation_uses_scalar_count_and_rejects_controls() {
    assert!(SessionRenamedV1 { title: "ok".into() }.validate().is_ok());
    assert!(SessionRenamedV1 { title: " ".into() }.validate().is_err());
    assert!(
        SessionRenamedV1 {
            title: "a".repeat(120)
        }
        .validate()
        .is_ok()
    );
    assert!(
        SessionRenamedV1 {
            title: "a".repeat(121)
        }
        .validate()
        .is_err()
    );
    assert!(
        SessionRenamedV1 {
            title: "a\u{0007}b".into()
        }
        .validate()
        .is_err()
    );
}

#[test]
fn summary_payload_allows_none_and_content_id() {
    assert!(
        SessionSummaryUpdatedV1 { content_id: None }
            .validate()
            .is_ok()
    );
    assert!(
        SessionSummaryUpdatedV1 {
            content_id: Some(ContentId::new_v7())
        }
        .validate()
        .is_ok()
    );
}

#[test]
fn boolean_and_deleted_payloads_are_valid() {
    assert!(SessionPinChangedV1 { pinned: true }.validate().is_ok());
    assert!(
        SessionArchiveChangedV1 { archived: false }
            .validate()
            .is_ok()
    );
    assert!(SessionDeletedV1 {}.validate().is_ok());
}
