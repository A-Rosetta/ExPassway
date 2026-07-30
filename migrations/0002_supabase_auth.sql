ALTER TABLE users ADD COLUMN supabase_user_id TEXT;

CREATE UNIQUE INDEX idx_users_supabase_user_id
ON users(supabase_user_id)
WHERE supabase_user_id IS NOT NULL;
