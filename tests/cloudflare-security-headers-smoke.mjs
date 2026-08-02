import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

const env = {
  ASSETS: {
    fetch(request) {
      return new Response(`<h1>${new URL(request.url).pathname}</h1>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  },
};

for (const path of ["/", "/pages/login.html", "/assets/styles.css"]) {
  const response = await worker.fetch(new Request(`https://expassway.test${path}`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") || "", /camera=\(\)/);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy") || "", /script-src 'self'/);
}

const redirect = await worker.fetch(
  new Request("https://expassway.test/alevel/pages/review.html"),
  env,
);
assert.equal(redirect.status, 308);
assert.equal(redirect.headers.get("x-frame-options"), "DENY");

console.log("Cloudflare security header checks passed.");
