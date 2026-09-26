import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

const response = await worker.fetch(
  new Request("https://expassway.test/api/paper-builder/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ curriculumVersion: "bio-version", sections: [] }),
  }),
  {
    AUTH_SECRET: "test-only-auth-secret-with-at-least-32-bytes",
    ASSETS: {
      fetch() {
        return new Response("asset fallback", { status: 404 });
      },
    },
  },
);

const payload = await response.json();
assert.equal(response.status, 401);
assert.equal(payload.error.code, "UNAUTHORIZED");

console.log("Cloudflare paper-builder worker routing checks passed.");
