-- Bind each short-lived WebAuthn ceremony to the relying-party configuration
-- and the PRF input that the browser receives in its publicKey options.
ALTER TABLE chat_webauthn_challenges ADD COLUMN rp_id TEXT;
ALTER TABLE chat_webauthn_challenges ADD COLUMN origin TEXT;
ALTER TABLE chat_webauthn_challenges ADD COLUMN prf_salt TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_webauthn_challenges_user_kind
  ON chat_webauthn_challenges(user_id, kind, expires_at, used_at);
