-- Separate the challenge action from the shared credential's capabilities.
-- Existing Passkeys, encrypted identities, wrappers and history stay intact.
ALTER TABLE chat_webauthn_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'account-write';

INSERT OR IGNORE INTO chat_account_vault_wrappers
  (user_id,key_version,credential_id,nonce,ciphertext,updated_at)
SELECT user_id,key_version,credential_id,nonce,ciphertext,updated_at
FROM chat_account_vault_versions WHERE credential_id IS NOT NULL;
