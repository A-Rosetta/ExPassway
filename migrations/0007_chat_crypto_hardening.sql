PRAGMA foreign_keys = ON;

ALTER TABLE chat_key_backups ADD COLUMN source_device_id TEXT REFERENCES chat_devices(id) ON DELETE CASCADE;
ALTER TABLE chat_key_backups ADD COLUMN backup_version TEXT NOT NULL DEFAULT '1';
ALTER TABLE chat_key_backups ADD COLUMN restore_operation_id TEXT;
ALTER TABLE chat_key_backups ADD COLUMN restored_device_id TEXT REFERENCES chat_devices(id) ON DELETE SET NULL;
ALTER TABLE chat_key_backups ADD COLUMN consumed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_key_backups_restore_operation
  ON chat_key_backups(restore_operation_id)
  WHERE restore_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_key_backups_source_device
  ON chat_key_backups(source_device_id, consumed_at);

CREATE INDEX IF NOT EXISTS idx_chat_device_prekeys_available_count
  ON chat_device_prekeys(device_id, consumed_at, created_at);
