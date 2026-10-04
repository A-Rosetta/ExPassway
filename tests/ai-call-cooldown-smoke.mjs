import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { aiCallCooldownError, reserveAiCallStatement } from "../cloudflare/ai-call-cooldown.js";

const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "ai-cooldown-test" },
  modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
try {
  const db = await mf.getD1Database("DB");
  for (const name of ["0001_initial.sql", "0002_supabase_auth.sql", "0003_admin_platform.sql",
    "0019_9618_structured_content.sql", "0020_structured_practice.sql"]) {
    for (const statement of unstable_splitSqlQuery(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"))) {
      await db.prepare(statement).run();
    }
  }
  await db.prepare("INSERT INTO users(id, display_name) VALUES ('student','Student'), ('other','Other')").run();
  await db.prepare(`INSERT INTO exam_papers(slug,subject_code,year,season,paper_number,variant,qp_file_name,ms_file_name)
    VALUES ('9618_s24_qp_13','9618',2024,'s',1,3,'qp.pdf','ms.pdf')`).run();
  await db.prepare(`INSERT INTO question_bank(id,board,subject,paper,stem,subject_code,paper_slug)
    VALUES ('fixture','CIE','Computer Science','Structured','Fixture','9618','9618_s24_qp_13')`).run();
  await db.prepare(`INSERT INTO ai_hint_generation_events(id,user_id,question_id,language,created_at)
    VALUES ('old-hint','student','fixture','en','2026-01-01T00:00:00.000Z')`).run();
  await db.prepare(`INSERT INTO structured_practice_attempts(id,user_id,request_id,question_id,paper_slug,
    input_hash,question_fingerprint,language,answers,status,ai_called,created_at)
    VALUES ('old-grade','student','old-request','fixture','9618_s24_qp_13','hash','fingerprint','en','[]','failed',1,'2026-01-01T00:00:10.000Z')`).run();
  const before = (await db.prepare("SELECT * FROM structured_practice_attempts").all()).results;
  for (const statement of unstable_splitSqlQuery(await readFile(new URL("../migrations/0022_ai_call_cooldown.sql", import.meta.url), "utf8"))) {
    await db.prepare(statement).run();
  }
  assert.deepEqual((await db.prepare("SELECT * FROM structured_practice_attempts").all()).results, before);
  const seeded = await db.prepare("SELECT called_at FROM ai_call_cooldowns WHERE user_id='student'").first();
  assert(Math.abs(seeded.called_at - Date.parse("2026-01-01T00:00:10.000Z")) <= 1);

  const hintId = crypto.randomUUID(); const gradeId = crypto.randomUUID();
  const concurrent = await Promise.all([
    reserveAiCallStatement(db, "student", hintId).run(),
    reserveAiCallStatement(db, "student", gradeId, "new-request").run(),
  ]);
  assert.deepEqual(concurrent.map((result) => result.meta.changes).sort(), [0, 1], "Hints and grading share one atomic slot.");
  assert.equal((await reserveAiCallStatement(db, "other", "independent-user").run()).meta.changes, 1);
  const error = await aiCallCooldownError(db, "student", "AI_HINT_RATE_LIMITED");
  assert.equal(error.status, 429); assert(error.details.retryAfterSeconds > 0 && error.details.retryAfterSeconds <= 30);

  const originalNow = Date.now;
  const clock = originalNow();
  try {
    Date.now = () => clock;
    await db.prepare("UPDATE ai_call_cooldowns SET called_at=? WHERE user_id='student'").bind(clock - 29999).run();
    assert.equal((await reserveAiCallStatement(db, "student", "early").run()).meta.changes, 0);
    await db.prepare("UPDATE ai_call_cooldowns SET called_at=? WHERE user_id='student'").bind(clock - 30000).run();
    assert.equal((await reserveAiCallStatement(db, "student", "boundary").run()).meta.changes, 1, "Exactly 30 seconds permits the next call.");
    await db.prepare("UPDATE ai_call_cooldowns SET called_at=? WHERE user_id='student'").bind(clock - 60000).run();
    assert.equal((await reserveAiCallStatement(db, "student", "replay", "old-request").run()).meta.changes, 0);
    assert.equal((await db.prepare("SELECT reservation_id FROM ai_call_cooldowns WHERE user_id='student'").first()).reservation_id, "boundary", "A duplicate request does not consume the cooldown.");
  } finally { Date.now = originalNow; }
  const beforeRollback = await db.prepare("SELECT * FROM ai_call_cooldowns WHERE user_id='student'").first();
  await assert.rejects(db.batch([reserveAiCallStatement(db, "student", "rolled-back"),
    db.prepare("INSERT INTO ai_hint_generation_events(id,user_id,question_id,language) VALUES ('invalid','student','not-a-question','en')")]), /FOREIGN KEY/);
  assert.deepEqual(await db.prepare("SELECT * FROM ai_call_cooldowns WHERE user_id='student'").first(), beforeRollback);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  console.log("AI cooldown migration preservation, shared concurrency, 30-second boundary, user isolation, replay and atomic rollback checks passed.");
} finally { await mf.dispose(); }
