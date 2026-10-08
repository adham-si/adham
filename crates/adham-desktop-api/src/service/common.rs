pub fn conflict_msg() -> String {
    "REQUEST_ID_CONFLICT: request_id reused with differing command, scope, actor, or payload"
        .to_string()
}
