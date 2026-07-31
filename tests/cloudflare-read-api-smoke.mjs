import assert from "node:assert/strict";

const workerBaseUrl = String(
  process.env.WORKER_API_BASE_URL || "http://127.0.0.1:8787"
).replace(/\/+$/, "");
const legacyBaseUrl = String(
  process.env.LEGACY_API_BASE_URL || "http://127.0.0.1:3002"
).replace(/\/+$/, "");

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function assertParity(path) {
  const [worker, legacy] = await Promise.all([
    request(workerBaseUrl, path),
    request(legacyBaseUrl, path),
  ]);
  assert.equal(worker.response.status, legacy.response.status, path);
  assert.deepEqual(worker.payload, legacy.payload, path);
}

await assertParity("/api/catalog/subjects");
await assertParity("/api/catalog/papers/0610_s23_qp_22");
await assertParity("/api/questions/CIE-IGCSE-0610-0610_s23_qp_22-01");
await assertParity("/api/questions/CIE-IGCHEM-SET-0620_s23_qp_21-01");
await assertParity("/api/questions/CIE-IGCHEM-SET-0620_s23_qp_22-08");
await assertParity("/api/meta/curriculum");
await assertParity("/api/catalog/subjects/abc/papers");
await assertParity("/api/catalog/papers/missing");

const legacySubjects = await request(legacyBaseUrl, "/api/catalog/subjects");
let checkedPapers = 0;
let checkedQuestions = 0;
for (const subject of legacySubjects.payload.data) {
  const papersPath = `/api/catalog/subjects/${encodeURIComponent(subject.code)}/papers`;
  await assertParity(papersPath);
  const legacyPapers = await request(legacyBaseUrl, papersPath);
  for (const paper of legacyPapers.payload.data) {
    const questionsPath = `/api/catalog/papers/${encodeURIComponent(paper.slug)}/questions`;
    await assertParity(questionsPath);
    checkedPapers += 1;
    checkedQuestions += Number(paper.validQuestionCount);
  }
}
assert.equal(checkedPapers, 69);
assert.equal(checkedQuestions, 2749);

const storage = await request(workerBaseUrl, "/api/meta/storage");
assert.equal(storage.response.status, 200);
assert.deepEqual(storage.payload, { ok: true, data: { mode: "d1" } });

const unavailable = await request(workerBaseUrl, "/api/curriculum/0610/chapters");
assert.equal(unavailable.response.status, 401);
assert.equal(unavailable.payload?.error?.code, "UNAUTHORIZED");

const wrongMethod = await request(workerBaseUrl, "/api/catalog/subjects", { method: "POST" });
assert.equal(wrongMethod.response.status, 404);
assert.equal(wrongMethod.payload?.error?.code, "NOT_FOUND");

const headResponse = await fetch(`${workerBaseUrl}/api/catalog/subjects`, { method: "HEAD" });
assert.equal(headResponse.status, 200);
assert.equal(await headResponse.text(), "");

const preflightResponse = await fetch(`${workerBaseUrl}/api/questions/example`, {
  method: "OPTIONS",
  headers: {
    Origin: "http://127.0.0.1:8080",
    "Access-Control-Request-Headers": "authorization",
    "Access-Control-Request-Method": "GET",
  },
});
assert.equal(preflightResponse.status, 204);
assert.match(preflightResponse.headers.get("access-control-allow-methods") || "", /GET/);
assert.match(preflightResponse.headers.get("access-control-allow-headers") || "", /Authorization/i);

console.log(`Cloudflare D1 read API parity checks passed for ${checkedPapers} papers and ${checkedQuestions} questions.`);
