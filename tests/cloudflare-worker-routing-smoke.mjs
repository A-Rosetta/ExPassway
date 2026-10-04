import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

const env = {
  AUTH_SECRET: "test-only-auth-secret-with-at-least-32-bytes",
  ASSETS: {
    fetch() {
      return new Response("asset fallback", { status: 404 });
    },
  },
};

const response = await worker.fetch(new Request("https://expassway.test/api/paper-builder/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ curriculumVersion: "bio-version", sections: [] }),
}), env);

const payload = await response.json();
assert.equal(response.status, 401);
assert.equal(payload.error.code, "UNAUTHORIZED");

const searchResponse = await worker.fetch(
  new Request("https://expassway.test/api/paper-builder/questions?subjectCode=0610"),
  env,
);
const searchPayload = await searchResponse.json();
assert.equal(searchResponse.status, 401);
assert.equal(searchPayload.error.code, "UNAUTHORIZED");

const practiceResponse = await worker.fetch(new Request("https://expassway.test/api/structured-practice/papers/9618_s24_qp_13"), env);
assert.equal(practiceResponse.status, 401);
assert.equal((await practiceResponse.json()).error.code, "UNAUTHORIZED");

console.log("Cloudflare paper-builder worker routing checks passed.");
