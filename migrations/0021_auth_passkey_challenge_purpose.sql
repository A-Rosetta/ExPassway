-- Bind new login/registration challenges to their purpose. Invalidate unfinished
-- challenges issued before this migration; credentials and encrypted vaults stay intact.
ALTER TABLE auth_passkey_challenges ADD COLUMN purpose TEXT
  CHECK(purpose IN ('register', 'authenticate'));
UPDATE auth_passkey_challenges
SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE used_at IS NULL;
CREATE INDEX idx_auth_passkey_challenges_user_purpose
  ON auth_passkey_challenges(user_id, purpose, challenge, used_at, expires_at);
