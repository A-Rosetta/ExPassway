import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleStructuredPracticeRequest } from "../cloudflare/structured-practice-api.js";
import { prepareStructuredGradingContext, officialAnswerParts } from "../cloudflare/structured-grading.js";
import { SUBJECT_HUBS } from "../shared/subject-catalogue.js";

const secret = "multi-subject-practice-fixture-at-least-32-bytes";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=", "base64");
const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "multi-subject-practice" }, r2Buckets: { CONTENT_BUCKET: "multi-subject-assets" }, modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
const originalFetch = globalThis.fetch;
try {
  const db = await mf.getD1Database("DB"); const bucket = await mf.getR2Bucket("CONTENT_BUCKET");
  for (const file of ["0001_initial.sql", "0002_supabase_auth.sql", "0003_admin_platform.sql", "0019_9618_structured_content.sql", "0020_structured_practice.sql", "0022_ai_call_cooldown.sql", "0028_as_a_level_subject_archives.sql", "0029_as_a_level_practice_capabilities.sql"]) {
    for (const sql of unstable_splitSqlQuery(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"))) await db.prepare(sql).run();
  }
  await db.prepare("INSERT INTO users(id,display_name) VALUES ('student','Student')").run();
  const now = Math.floor(Date.now() / 1000); const payload = Buffer.from(JSON.stringify({ sub: "student", iat: now, exp: now + 3600 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const token = `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const env = { DB: db, CONTENT_BUCKET: bucket, AUTH_SECRET: secret, OPENAI_API_KEY: "local-fixture", OPENAI_API_BASE_URL: "https://fixture.test" };
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("MCQ must not call AI."); };
  for (const [code, component, type] of [["9702", 5, "structured"], ["9701", 3, "practical"], ["9708", 4, "structured"], ["9700", 4, "structured"], ["9696", 4, "structured"]]) {
    const slug = `${code}_s26_qp_${component}4`; const id = `CIE-ASAL-${code}-${slug}-01`;
    const asset = `question-images/cie-as-a-level-${SUBJECT_HUBS[code].assetKey}/${slug}/q01-01.png`;
    const content = { parts: [{ id: "a", label: "(a)", maxMarks: 1 }], images: [{ url: `/api/content/${asset}`, storageKey: asset, page: 2, order: 0 }] };
    const markScheme = { parts: [{ partId: "a", blocks: [{ type: "text", text: "Official point." }] }] };
    await db.batch([
      db.prepare("INSERT INTO exam_papers(slug,subject_code,year,season,paper_number,variant,paper_type,source_question_count,valid_question_count,total_marks,qp_file_name,ms_file_name) VALUES (?,?,2026,'s',?,4,?,1,1,1,'qp.pdf','ms.pdf')").bind(slug, code, component, type),
      db.prepare("INSERT INTO question_bank(id,board,subject,paper,stem,subject_code,paper_slug,question_no,question_type,max_marks,structured_content,mark_scheme) VALUES (?,'CIE',?,'Structured','Official fixture',?,?,1,'structured',1,?,?)").bind(id, SUBJECT_HUBS[code].name, code, slug, JSON.stringify(content), JSON.stringify(markScheme)),
    ]);
    await bucket.put(asset, png);
    const response = await handleStructuredPracticeRequest(new Request(`https://local.test/api/structured-practice/papers/${slug}`, { headers }), env);
    assert.equal(response.status, 200, `${code} component ${component}`);
    const question = (await response.json()).data.questions[0];
    question.content.sourceMaterialLinks = [{ title: "Verified original source", url: "https://source.example/figure" }];
    const parts = officialAnswerParts(question);
    const context = await prepareStructuredGradingContext(env, question, parts, [{ partId: "a", text: "", imageDataUrl: `data:image/png;base64,${png.toString("base64")}` }]);
    assert.equal(context.filter((item) => item.type === "input_image").length, 2, "Official question and student drawing both enter grading.");
    const wrong = structuredClone(question); wrong.content.images[0].url = wrong.content.images[0].url.replace(SUBJECT_HUBS[code].assetKey, "computer-science-9618");
    await assert.rejects(() => prepareStructuredGradingContext(env, wrong, parts, []), (error) => error.code === "GRADING_ASSET_INVALID");
  }
  const slug = "9708_s26_qp_14"; const id = `CIE-ASAL-9708-${slug}-01`;
  const content = { gradingMode: "official-mcq", parts: [{ id: "a", label: "Question 1", maxMarks: 1, answerFormat: "choice", choices: ["A", "B", "C", "D"] }] };
  const scheme = { parts: [{ partId: "a", correctChoice: "B", blocks: [{ type: "text", text: "Official answer B, 1 mark." }] }] };
  await db.batch([
    db.prepare("INSERT INTO exam_papers(slug,subject_code,year,season,paper_number,variant,paper_type,source_question_count,valid_question_count,total_marks,qp_file_name,ms_file_name) VALUES (?,'9708',2026,'s',1,4,'mcq',1,1,1,'qp.pdf','ms.pdf')").bind(slug),
    db.prepare("INSERT INTO question_bank(id,board,subject,paper,stem,subject_code,paper_slug,question_no,question_type,max_marks,structured_content,mark_scheme) VALUES (?,'CIE','Economics','MCQ','Official fixture','9708',?,1,'structured',1,?,?)").bind(id, slug, JSON.stringify(content), JSON.stringify(scheme)),
  ]);
  const grade = async (choice, requestId = crypto.randomUUID()) => {
    const response = await handleStructuredPracticeRequest(new Request(`https://local.test/api/structured-practice/questions/${id}/grade`, { method: "POST", headers, body: JSON.stringify({ requestId, language: "en", answers: [{ partId: "a", text: choice }] }) }), { ...env, OPENAI_API_KEY: "" });
    return { response, body: await response.json() };
  };
  const requestId = crypto.randomUUID(); const correct = await grade("B", requestId);
  assert.equal(correct.response.status, 200); assert.equal(correct.body.data.earnedMarks, 1); assert.equal(correct.body.data.model, "official-answer-key");
  assert.equal((await grade("B", requestId)).body.data.id, correct.body.data.id, "MCQ replay is idempotent.");
  assert.equal((await grade("C")).body.data.earnedMarks, 0);
  assert.equal((await grade("")).body.data.earnedMarks, 0);
  assert.equal((await grade("B or C")).response.status, 400);
  assert.equal(calls, 0); assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM ai_call_cooldowns").first()).count, 0);
  const capabilities = JSON.parse((await db.prepare("SELECT capabilities FROM exam_subject_components WHERE subject_code='9708' AND paper_number=1").first()).capabilities);
  assert.equal(capabilities.onlinePractice, true); assert.equal(capabilities.officialAnswerKeyGrading, true); assert.equal(capabilities.structuredAiGrading, false);
  await db.prepare("UPDATE question_bank SET structured_content=json_set(structured_content,'$.gradingUnavailableReason','source-material-missing') WHERE id=?").bind(id).run();
  assert.equal((await grade("B")).response.status, 422, "Incomplete source context cannot receive a misleading grade.");
  console.log("Five-subject practice, cross-subject asset binding, student drawings, official MCQ scores and replays passed.");
} finally { globalThis.fetch = originalFetch; await mf.dispose(); }
