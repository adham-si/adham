-- Content scope binding for AEAD associated data (P0 repair).
-- Nullable for back-compat with pre-AEAD rows (protection=identity/none).
-- New AEAD rows must set all four; readers verify expected scope via AD.
ALTER TABLE content_records ADD COLUMN installation_id TEXT;
ALTER TABLE content_records ADD COLUMN workspace_id TEXT;
ALTER TABLE content_records ADD COLUMN project_id TEXT;
ALTER TABLE content_records ADD COLUMN session_id TEXT;
