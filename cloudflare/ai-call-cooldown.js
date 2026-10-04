import { AuthError } from "./auth-api.js";

export const AI_CALL_COOLDOWN_MS = 30000;

// Run this and the owning request reservation in one D1 batch. A single row
// serializes new hint and grading requests across tabs and Worker instances.
export function reserveAiCallStatement(db, userId, reservationId, requestId = null) {
  const guard = requestId ? `NOT EXISTS (
    SELECT 1 FROM structured_practice_attempts WHERE user_id = ? AND request_id = ?
  )` : "1";
  const bindings = [userId, reservationId, Date.now()];
  if (requestId) bindings.push(userId, requestId);
  bindings.push(AI_CALL_COOLDOWN_MS);
  return db.prepare(`
    INSERT INTO ai_call_cooldowns (user_id, reservation_id, called_at)
    SELECT ?, ?, ? WHERE ${guard}
    ON CONFLICT(user_id) DO UPDATE SET
      reservation_id = excluded.reservation_id, called_at = excluded.called_at
    WHERE ai_call_cooldowns.called_at <= excluded.called_at - ?
  `).bind(...bindings);
}

export async function aiCallCooldownError(db, userId, code) {
  const row = await db.prepare("SELECT called_at FROM ai_call_cooldowns WHERE user_id = ?")
    .bind(userId).first();
  const retryAfterSeconds = Math.max(1, Math.min(30,
    Math.ceil((Number(row?.called_at || Date.now()) + AI_CALL_COOLDOWN_MS - Date.now()) / 1000)));
  return new AuthError(429, `Please wait ${retryAfterSeconds} seconds before another AI request.`, code,
    { retryAfterSeconds, cooldownSeconds: 30 });
}
