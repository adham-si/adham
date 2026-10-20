-- Local like/dislike feedback keyed to the exact answer row (CONVERSATION-01
-- lines 66-67). Local state, not an event: nothing is uploaded, and a verdict
-- never affects inference authorization. Keyed by (session, message) so each
-- attempt is rated on its own — a retry's new attempt starts unrated. The
-- message id is validated against that session's rows before any write; last
-- write wins per answer.
CREATE TABLE IF NOT EXISTS answer_feedback (
    session_id          TEXT NOT NULL,
    message_id          TEXT NOT NULL,
    verdict             TEXT NOT NULL CHECK (verdict IN ('like', 'dislike')),
    reason              TEXT,
    updated_at_us       INTEGER NOT NULL,
    PRIMARY KEY (session_id, message_id)
);
