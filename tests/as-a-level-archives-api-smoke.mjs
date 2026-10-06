import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleAdminApiRequest } from "../cloudflare/admin-api.js";
import { handleContentRequest } from "../cloudflare/content-api.js";
import { handleReadApiRequest } from "../cloudflare/read-api.js";
import { handleLearningApiRequest } from "../cloudflare/learning-api.js";

const AUTH_SECRET = "archive-tests-only-secret-with-at-least-32-bytes";
const archiveCodes = ["9702", "9701", "9708", "9700", "9696"];
const mf = new Miniflare({
  compatibilityDate: "2026-07-29", d1Databases: { DB: "archive-api-test" },
  r2Buckets: { CONTENT_BUCKET: "archive-content-test" }, modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});

async function issueToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: "admin", iat: now, exp: now + 3600 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
}

try {
  const db = await mf.getD1Database("DB");
  const bucket = await mf.getR2Bucket("CONTENT_BUCKET");
  for (const file of ["0001_initial.sql", "0002_supabase_auth.sql", "0003_admin_platform.sql", "0019_9618_structured_content.sql", "0020_structured_practice.sql", "0028_as_a_level_subject_archives.sql"]) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  await db.prepare("INSERT INTO users(id,display_name,role) VALUES ('admin','Archive Admin','admin')").run();
  await db.prepare("INSERT INTO exam_subjects(code,name,asset_key) VALUES ('0610','Biology','biology-0610')").run();
  const headers = { Authorization: `Bearer ${await issueToken()}` };
  const env = { DB: db, CONTENT_BUCKET: bucket, AUTH_SECRET };
  const call = async (handler, path, options = {}) => {
    const response = await handler(new Request(`https://expassway.test${path}`, options), env);
    return { response, payload: await response.clone().json().catch(() => null) };
  };

  const initial = (await call(handleReadApiRequest, "/api/catalog/subjects")).payload.data;
  const meta = (await call(handleReadApiRequest, "/api/meta/capabilities")).payload.data;
  for (const code of archiveCodes) {
    const subject = initial.find((item) => item.code === code);
    assert(subject, `${code} registered`);
    assert.equal(subject.qualification, "AS & A Level");
    assert.equal(subject.capabilities.resources, true);
    assert.equal(subject.capabilities.components, true);
    for (const key of ["manualPaperBuilder", "smartPaperBuilder", "equivalentPaperBuilder", "onlinePractice", "structuredAiGrading", "aiHints"]) {
      assert.equal(subject.capabilities[key], false, `${code}/${key} stays unavailable without a question bank`);
      assert.equal(meta.subjects[code][key], false);
    }
    assert.equal((await call(handleReadApiRequest, `/api/catalog/subjects/${code}/overview`)).response.status, 401);
    const empty = (await call(handleReadApiRequest, `/api/catalog/subjects/${code}/overview`, { headers })).payload.data;
    assert.equal(empty.readiness.syllabus, false);
    assert.equal(empty.readiness.manualPaperBuilder, false);
    const p5 = empty.components.find((item) => item.paperNumber === 5);
    if (["9700", "9701", "9702"].includes(code)) {
      assert(p5, `${code} includes Paper 5`);
      assert.equal(empty.components.find((item) => item.paperNumber === 3).paperType, "practical");
      assert.equal(empty.components.find((item) => item.paperNumber === 4).paperType, "structured");
    }

    const paperNumber = p5 ? 5 : 4;
    const slug = `${code}_s26_qp_${paperNumber}2`;
    const storage = `archive-fixtures/${code}`;
    await db.batch([
      db.prepare(`INSERT INTO exam_papers(slug,subject_code,year,season,paper_number,variant,paper_type,source_question_count,valid_question_count,total_marks,qp_file_name,ms_file_name,metadata)
        VALUES (?,?,2026,'s',?,2,'structured',2,0,30,?,?,?)`)
        .bind(slug, code, paperNumber, `${slug}.pdf`, `${slug.replace("_qp_", "_ms_")}.pdf`, JSON.stringify({ qpStorageKey: `${storage}/qp.pdf`, msStorageKey: `${storage}/ms.pdf` })),
      db.prepare(`INSERT INTO subject_resources(id,subject_code,kind,title,exam_year_start,exam_year_end,storage_key,content_type)
        VALUES (?,?,'syllabus','Official syllabus fixture',2025,2027,?,'application/pdf')`)
        .bind(`${code}-syllabus`, code, `${storage}/syllabus.pdf`),
    ]);
    for (const kind of ["qp", "ms", "syllabus"]) await bucket.put(`${storage}/${kind}.pdf`, `%PDF-fixture-${code}-${kind}`);
    const full = (await call(handleReadApiRequest, `/api/catalog/subjects/${code}/overview`, { headers })).payload.data;
    assert.equal(full.counts.syllabus, 1);
    assert.equal(full.counts.papers, 1);
    assert.equal(full.counts.questions, 0);
    assert.equal(full.readiness.syllabus, true);
    assert.equal(full.readiness.papers, true);
    assert.equal(full.readiness.manualPaperBuilder, false);
    assert.equal(full.syllabusResources[0].examYearEnd, 2027);
    for (const kind of ["qp", "ms"]) {
      const download = (await call(handleContentRequest, `/api/catalog/papers/${slug}/download/${kind}`)).response;
      assert.equal(download.status, 200, `${slug}/${kind}`);
      assert.equal(await download.text(), `%PDF-fixture-${code}-${kind}`);
      const preview = (await call(handleContentRequest, `/api/catalog/papers/${slug}/download/${kind}?inline=1`, { method: "HEAD" })).response;
      assert.equal(preview.status, 200);
      assert.match(preview.headers.get("Content-Disposition"), /^inline;/);
      assert.equal(await preview.text(), "");
    }
    const resourcePath = `/api/content/resources/${code}-syllabus`;
    assert.equal((await call(handleContentRequest, resourcePath)).response.status, 401);
    const resource = (await call(handleContentRequest, resourcePath, { headers })).response;
    assert.equal(resource.status, 200);
    assert.equal(resource.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await call(handleContentRequest, `/api/catalog/subjects/9618/resources/${code}-syllabus`, { headers })).response.status, 404);
    const rejected = await call(handleAdminApiRequest, "/api/admin/imports", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ subjectCode: code }),
    });
    assert.equal(rejected.payload.error.code, "UNSUPPORTED_IMPORT_TYPE");
    await db.prepare("UPDATE exam_papers SET status = 'draft' WHERE slug = ?").bind(slug).run();
    assert.equal((await call(handleContentRequest, `/api/catalog/papers/${slug}/download/qp`)).response.status, 404);
    await db.prepare("UPDATE exam_papers SET status = 'published' WHERE slug = ?").bind(slug).run();
  }
  const adminSubjects = (await call(handleAdminApiRequest, "/api/admin/subjects", { headers })).payload.data;
  for (const code of archiveCodes) {
    const subject = adminSubjects.find((item) => item.code === code);
    assert.equal(subject.importMode, "resource-package");
    assert.deepEqual(subject.contentCounts, { syllabus: 1, textbooks: 0, papers: 1, questions: 0 });
  }
  const curriculum = (await call(handleReadApiRequest, "/api/meta/curriculum")).payload.data;
  for (const subject of initial.filter((item) => archiveCodes.includes(item.code))) {
    assert.deepEqual(curriculum.boards.CIE[`AS & A Level ${subject.name}`], []);
  }
  const builderSubjects = (await call(handleLearningApiRequest, "/api/paper-builder/subjects", { headers })).payload.data;
  assert(builderSubjects.some((subject) => subject.code === "9618"));
  assert(builderSubjects.some((subject) => subject.code === "0610"));
  assert(!builderSubjects.some((subject) => archiveCodes.includes(subject.code)));
  assert.deepEqual(builderSubjects.find((subject) => subject.code === "9618").capabilities, { manual: true, smart: false, equivalent: false, practice: false, hints: false });
  assert.deepEqual(builderSubjects.find((subject) => subject.code === "0610").capabilities, { manual: true, smart: true, equivalent: true, practice: true, hints: true });
  console.log("Five AS & A Level archives: registration, paper types, Paper 5 QP/MS downloads, source-only readiness, and resource authorization passed.");
} finally {
  await mf.dispose();
}
