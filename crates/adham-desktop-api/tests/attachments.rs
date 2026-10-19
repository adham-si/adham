//! Attachment ingestion contract: bounded text/code files, scope-checked
//! dispatch selection, and a message chip only when the link is real.
//! Synthetic canary content only; disposable DB per test.

mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::service::attachment::{MAX_ATTACHMENT_BYTES, MAX_EXTRACTED_CHARS};
use adham_desktop_api::*;

fn scope(ws: &str, proj: &str, sess: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(sess.to_string()),
    }
}

fn envelope<T>(context: CommandContext, payload: T) -> CommandEnvelope<T> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: RequestId::new_v7().to_string(),
        context,
        payload,
    }
}

async fn ingest(
    ctx: &ApiContext,
    context: CommandContext,
    file_name: &str,
    text: &str,
) -> Result<CommandResult<AttachmentDto>, String> {
    handle_ingest_attachment(
        ctx,
        envelope(
            context,
            IngestAttachmentPayload {
                file_name: file_name.to_string(),
                text: text.to_string(),
            },
        ),
    )
    .await
}

#[tokio::test]
async fn ingests_a_text_file_and_links_it_to_the_submitted_message() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "W").await;
    let proj = create_test_project(&ctx, &ws, "P").await;
    let sess = create_test_session(&ctx, &ws, &proj, Some("S")).await;
    let scoped = scope(&ws, &proj, &sess);

    let ingested = ingest(&ctx, scoped.clone(), "../../notes.md", "# Hello\nbody")
        .await
        .expect("ingest");
    assert_eq!(ingested.data.file_name, "notes.md");
    assert_eq!(ingested.data.media_type, "text/markdown");
    assert_eq!(ingested.data.byte_size, 12);
    assert_eq!(ingested.data.extracted_chars, 12);
    assert!(!ingested.data.truncated);
    assert_eq!(ingested.data.text, "# Hello\nbody");
    assert_eq!(ingested.data.hash_algorithm, "blake3");
    assert_eq!(ingested.data.content_hash.len(), 64);
    assert_eq!(ingested.data.retention, "session");

    // Attachment-only send: no text, the file carries the content.
    let submitted = handle_submit_message(
        &ctx,
        envelope(
            scoped.clone(),
            SubmitMessagePayload {
                text: String::new(),
                attachment_ids: vec![ingested.data.attachment_id.clone()],
            },
        ),
    )
    .await
    .expect("submit");

    let page = handle_get_conversation(&ctx, scoped.clone())
        .await
        .expect("read");
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].message_id, submitted.data.message_id);
    assert_eq!(page.items[0].text, "");
    assert_eq!(page.items[0].attachments.len(), 1);
    let chip = &page.items[0].attachments[0];
    assert_eq!(chip.attachment_id, ingested.data.attachment_id);
    assert_eq!(chip.file_name, "notes.md");
    assert_eq!(chip.extracted_chars, 12);

    let reread = handle_read_attachment_text(
        &ctx,
        envelope(
            scoped,
            ReadAttachmentPayload {
                attachment_id: ingested.data.attachment_id.clone(),
            },
        ),
    )
    .await
    .expect("read text");
    assert_eq!(reread.data.text, "# Hello\nbody");

    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn refuses_a_foreign_attachment_and_writes_nothing() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "W").await;
    let proj = create_test_project(&ctx, &ws, "P").await;
    let sess_a = create_test_session(&ctx, &ws, &proj, Some("A")).await;
    let sess_b = create_test_session(&ctx, &ws, &proj, Some("B")).await;
    let scope_a = scope(&ws, &proj, &sess_a);
    let scope_b = scope(&ws, &proj, &sess_b);

    let ingested = ingest(&ctx, scope_a.clone(), "notes.md", "canary")
        .await
        .expect("ingest");

    // Session B cannot submit with A's attachment id: the whole send refuses.
    let err = handle_submit_message(
        &ctx,
        envelope(
            scope_b.clone(),
            SubmitMessagePayload {
                text: "hi".to_string(),
                attachment_ids: vec![ingested.data.attachment_id.clone()],
            },
        ),
    )
    .await
    .expect_err("foreign attachment must refuse");
    assert!(err.contains("attachment.notFound"), "unexpected: {err}");

    // Session B cannot read it either, and neither session gained a message.
    let err = handle_read_attachment_text(
        &ctx,
        envelope(
            scope_b.clone(),
            ReadAttachmentPayload {
                attachment_id: ingested.data.attachment_id.clone(),
            },
        ),
    )
    .await
    .expect_err("foreign read must refuse");
    assert!(err.contains("attachment.notFound"), "unexpected: {err}");
    assert!(
        handle_get_conversation(&ctx, scope_b)
            .await
            .expect("read b")
            .items
            .is_empty()
    );
    assert!(
        handle_get_conversation(&ctx, scope_a)
            .await
            .expect("read a")
            .items
            .is_empty()
    );

    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn refuses_unsupported_binary_and_oversized_files_with_specific_codes() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "W").await;
    let proj = create_test_project(&ctx, &ws, "P").await;
    let sess = create_test_session(&ctx, &ws, &proj, Some("S")).await;
    let scoped = scope(&ws, &proj, &sess);

    let err = ingest(&ctx, scoped.clone(), "photo.png", "not really a png")
        .await
        .expect_err("unknown type");
    assert!(
        err.contains("attachment.unsupportedType"),
        "unexpected: {err}"
    );

    let err = ingest(&ctx, scoped.clone(), "sneaky.txt", "a\0b")
        .await
        .expect_err("binary");
    assert!(
        err.contains("attachment.binaryContent"),
        "unexpected: {err}"
    );

    let oversized = "a".repeat(MAX_ATTACHMENT_BYTES + 1);
    let err = ingest(&ctx, scoped, "big.txt", &oversized)
        .await
        .expect_err("too large");
    assert!(err.contains("attachment.tooLarge"), "unexpected: {err}");

    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn dropped_files_are_read_by_rust_with_honest_encoding_refusals() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "W").await;
    let proj = create_test_project(&ctx, &ws, "P").await;
    let sess = create_test_session(&ctx, &ws, &proj, Some("S")).await;
    let scoped = scope(&ws, &proj, &sess);
    let dir = std::env::temp_dir().join(format!("adham_attach_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).expect("temp dir");

    let good = dir.join("lib.rs");
    std::fs::write(&good, "fn main() {}").expect("write");
    let ingested = handle_ingest_attachment_path(
        &ctx,
        envelope(
            scoped.clone(),
            IngestAttachmentPathPayload {
                file_path: good.to_string_lossy().into_owned(),
            },
        ),
    )
    .await
    .expect("ingest dropped file");
    assert_eq!(ingested.data.file_name, "lib.rs");
    assert_eq!(ingested.data.media_type, "text/x-rust");
    assert_eq!(ingested.data.text, "fn main() {}");

    let invalid = dir.join("invalid.txt");
    std::fs::write(&invalid, [0xFFu8, 0xFE]).expect("write");
    let err = handle_ingest_attachment_path(
        &ctx,
        envelope(
            scoped.clone(),
            IngestAttachmentPathPayload {
                file_path: invalid.to_string_lossy().into_owned(),
            },
        ),
    )
    .await
    .expect_err("invalid utf-8");
    assert!(err.contains("attachment.notUtf8"), "unexpected: {err}");

    // A directory is not a file: refuse, never walk it.
    let err = handle_ingest_attachment_path(
        &ctx,
        envelope(
            scoped,
            IngestAttachmentPathPayload {
                file_path: dir.to_string_lossy().into_owned(),
            },
        ),
    )
    .await
    .expect_err("directory");
    assert!(
        err.contains("attachment.unsupportedSource"),
        "unexpected: {err}"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn truncates_large_text_at_the_extraction_cap() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "W").await;
    let proj = create_test_project(&ctx, &ws, "P").await;
    let sess = create_test_session(&ctx, &ws, &proj, Some("S")).await;

    // Multibyte characters must not be split by the cap.
    let text = "é".repeat(MAX_EXTRACTED_CHARS + 5);
    let ingested = ingest(&ctx, scope(&ws, &proj, &sess), "notes.txt", &text)
        .await
        .expect("ingest");
    assert!(ingested.data.truncated);
    assert_eq!(ingested.data.extracted_chars as usize, MAX_EXTRACTED_CHARS);
    assert_eq!(ingested.data.text.chars().count(), MAX_EXTRACTED_CHARS);

    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn refuses_a_selection_over_the_per_dispatch_cap() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "W").await;
    let proj = create_test_project(&ctx, &ws, "P").await;
    let sess = create_test_session(&ctx, &ws, &proj, Some("S")).await;
    let scoped = scope(&ws, &proj, &sess);

    let first = ingest(&ctx, scoped.clone(), "a.txt", &"a".repeat(200_000))
        .await
        .expect("ingest a");
    let second = ingest(&ctx, scoped.clone(), "b.txt", &"b".repeat(41_000))
        .await
        .expect("ingest b");

    let err = handle_submit_message(
        &ctx,
        envelope(
            scoped,
            SubmitMessagePayload {
                text: "two files".to_string(),
                attachment_ids: vec![
                    first.data.attachment_id.clone(),
                    second.data.attachment_id.clone(),
                ],
            },
        ),
    )
    .await
    .expect_err("selection too large");
    assert!(
        err.contains("attachment.selectionTooLarge"),
        "unexpected: {err}"
    );

    let _ = std::fs::remove_file(&db);
}
