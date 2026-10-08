-- Receipt actor for full idempotency-tuple comparison (P0 repair).
-- Older receipts without actor compare as conflict unless explicitly migrated.
-- SQLite has no IF NOT EXISTS for ADD COLUMN, so guard in code by PRAGMA check.
-- This file is executed conditionally; see identity::ensure_receipt_actor_column.
-- Kept as canonical DDL for fresh databases inspected via schema dump.
ALTER TABLE command_receipts ADD COLUMN actor_id TEXT NOT NULL DEFAULT '';
