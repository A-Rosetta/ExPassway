CREATE TABLE email_otp_cooldowns (
  email_hash TEXT PRIMARY KEY,
  available_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

