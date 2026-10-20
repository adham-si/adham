use super::*;

#[tokio::test]
async fn missing_done_reason_on_terminal_frame_stays_stop() {
    // legacy compatibility: an older daemon sends done:true without a reason
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":"tail"},"done":false}"#,
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":""},"done":true}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(
            &pinned("llama3.2:latest", "sha256:aaa"),
            &request("llama3.2:latest"),
        )
        .await
        .expect("chat started");
    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        got.push(event.expect("stream events"));
    }
    assert_eq!(
        got.last(),
        Some(&NormalizedStreamEvent::StreamCompleted(
            StreamCompletionOutcome::Stop
        )),
        "a missing reason on a valid done:true frame keeps the legacy stop"
    );
}

#[tokio::test]
async fn explicit_unknown_done_reason_is_not_stop() {
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":"tail"},"done":false}"#,
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":""},"done":true,"done_reason":"cuda"}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(
            &pinned("llama3.2:latest", "sha256:aaa"),
            &request("llama3.2:latest"),
        )
        .await
        .expect("chat started");
    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        got.push(event.expect("stream events"));
    }
    assert_eq!(
        got.last(),
        Some(&NormalizedStreamEvent::StreamCompleted(
            StreamCompletionOutcome::Unknown {
                reason: "cuda".to_string(),
            }
        )),
        "an explicit unknown reason terminates (never hangs) but is not a successful stop"
    );
}

// --- 9. real qwen3.5 thinking-model shape: contentless frames must not panic ---

#[tokio::test]
async fn thinking_frames_do_not_panic_and_stream_continues() {
    // qwen3.5:0.8b (live shape, 2026-10-17): thinking runs emit frames with
    // empty content and a `thinking` string. The old `expect("events queued")`
    // panicked on the first of these, aborting the whole completion op; now
    // they normalize to a payload-free activity marker and the answer streams.
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":"","thinking":"let me think"},"done":false}"#,
                r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":"","thinking":"more"},"done":false}"#,
                r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":"OK"},"done":false}"#,
                r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":9,"eval_count":4}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(
            &pinned("qwen3.5:0.8b", "sha256:bbb"),
            &request("qwen3.5:0.8b"),
        )
        .await
        .expect("chat started");
    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        got.push(event.expect("stream events"));
    }
    assert_eq!(
        got,
        vec![
            NormalizedStreamEvent::StreamStarted,
            NormalizedStreamEvent::ThinkingActivity,
            NormalizedStreamEvent::ThinkingActivity,
            NormalizedStreamEvent::TextDelta("OK".into()),
            NormalizedStreamEvent::Progress(StreamUsage {
                prompt_tokens: 9,
                completion_tokens: 4,
                total_tokens: 13,
            }),
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ],
        "each thinking frame becomes a payload-free marker, the answer still streams: {got:?}"
    );
    assert!(
        !format!("{got:?}").contains("let me think") && !format!("{got:?}").contains("more"),
        "reasoning text never leaves the parser: {got:?}"
    );
}

#[tokio::test]
async fn tool_call_frames_emit_structured_activity_without_payload() {
    // A tool-only frame (no text) is structured output, not an empty answer.
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"m","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"search","arguments":{"q":"secret needle"}}}]},"done":false}"#,
                r#"{"model":"m","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(&pinned("m", "sha256:ddd"), &request("m"))
        .await
        .expect("chat started");
    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        got.push(event.expect("stream events"));
    }
    assert_eq!(
        got,
        vec![
            NormalizedStreamEvent::StreamStarted,
            NormalizedStreamEvent::StructuredActivity,
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ],
        "tool presence becomes a payload-free activity marker: {got:?}"
    );
    assert!(
        !format!("{got:?}").contains("secret needle"),
        "tool arguments never leave the parser: {got:?}"
    );
}

// --- 10. bare heartbeat frames (no thinking field) are equally inert -----------

#[tokio::test]
async fn heartbeat_frames_are_skipped_without_events() {
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"m","message":{"role":"assistant","content":""},"done":false}"#,
                r#"{"model":"m","message":{"role":"assistant","content":"hi"},"done":false}"#,
                r#"{"model":"m","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop"}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(&pinned("m", "sha256:ccc"), &request("m"))
        .await
        .expect("chat started");
    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        got.push(event.expect("stream events"));
    }
    assert_eq!(
        got,
        vec![
            NormalizedStreamEvent::StreamStarted,
            NormalizedStreamEvent::TextDelta("hi".into()),
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ]
    );
}
