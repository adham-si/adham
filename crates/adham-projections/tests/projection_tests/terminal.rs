use super::*;

#[tokio::test]
async fn test_interrupted_failed_and_length_markers_survive_rebuild() {
    let mut h = Harness::new().await;

    h.put_assistant(
        OperationId::new_v7(),
        MessageId::new_v7(),
        "interrupted partial",
        MessageCompletionV1::Interrupted,
        None,
    )
    .await;

    h.put_assistant(
        OperationId::new_v7(),
        MessageId::new_v7(),
        "failed partial",
        MessageCompletionV1::Failed,
        None,
    )
    .await;

    h.put_assistant(
        OperationId::new_v7(),
        MessageId::new_v7(),
        "cut at limit",
        MessageCompletionV1::Completed { truncated: true },
        Some(MessageUsageV1 {
            prompt_tokens: Some(8),
            completion_tokens: Some(2),
            total_tokens: Some(10),
        }),
    )
    .await;

    let replayed = ConversationProjection::rebuild(&h.pool)
        .await
        .expect("rebuild");
    assert_eq!(replayed, 3);

    let view = h.messages().await;
    assert_eq!(view.len(), 3);
    assert_eq!(view[0].content, "interrupted partial");
    assert_eq!(view[0].completion, Some(MessageCompletionV1::Interrupted));
    assert_eq!(view[1].content, "failed partial");
    assert_eq!(view[1].completion, Some(MessageCompletionV1::Failed));
    assert_eq!(view[2].content, "cut at limit");
    assert_eq!(
        view[2].completion,
        Some(MessageCompletionV1::Completed { truncated: true })
    );
    assert_eq!(view[2].usage.as_ref().unwrap().completion_tokens, Some(2));
}

#[tokio::test]
async fn test_double_terminal_write_yields_single_first_won_row() {
    let mut h = Harness::new().await;

    // Stop racing completion: two terminals exist in the log for one op.
    let op_id = OperationId::new_v7();
    let message_id = MessageId::new_v7();
    h.put_assistant(
        op_id,
        message_id,
        "first body",
        MessageCompletionV1::Completed { truncated: false },
        None,
    )
    .await;
    h.put_assistant(
        op_id,
        message_id,
        "second body",
        MessageCompletionV1::Interrupted,
        None,
    )
    .await;

    // an unrelated op must still be replayed normally
    h.put_assistant(
        OperationId::new_v7(),
        MessageId::new_v7(),
        "other",
        MessageCompletionV1::Completed { truncated: false },
        None,
    )
    .await;

    ConversationProjection::rebuild(&h.pool)
        .await
        .expect("rebuild");
    let view = h.messages().await;
    assert_eq!(view.len(), 2, "double terminal collapses to one row");
    let first_op_rows: Vec<_> = view.iter().filter(|m| m.op_id == Some(op_id)).collect();
    assert_eq!(first_op_rows.len(), 1, "exactly one terminal row per op");
    assert_eq!(
        first_op_rows[0].completion,
        Some(MessageCompletionV1::Completed { truncated: false }),
        "first terminal in global order wins"
    );
    assert_eq!(first_op_rows[0].content, "first body");
}

#[tokio::test]
async fn test_unknown_completion_value_is_rejected_by_rebuild() {
    let mut h = Harness::new().await;
    h.put_user("Question").await;

    let raw = serde_json::json!({
        "op_id": uuid::Uuid::now_v7().to_string(),
        "message_id": uuid::Uuid::now_v7().to_string(),
        "content_id": uuid::Uuid::now_v7().to_string(),
        "content_kind": "assistant_text",
        "size_bytes": 4,
        "completion": { "TotallyUnknown": null },
        "usage": null
    });
    h.append(EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED, &raw).await;

    let err = ConversationProjection::rebuild(&h.pool).await;
    let msg = format!(
        "{:?}",
        err.expect_err("unknown completion must be rejected")
    );
    assert!(msg.contains("Invalid MessageCompletedV1 payload"), "{msg}");
}
