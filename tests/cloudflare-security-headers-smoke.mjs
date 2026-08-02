import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

const env = {
  ASSETS: {
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      const contentType = pathname.endsWith(".js")
        ? "text/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/html; charset=utf-8";
      return new Response(`<h1>${pathname}</h1>`, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    },
  },
};

for (const path of ["/", "/pages/login.html"]) {
  const response = await worker.fetch(new Request(`https://expassway.test${path}`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") || "", /camera=\(\)/);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy") || "", /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy") || "", /connect-src 'self'(?:;|$)/);
  assert.doesNotMatch(response.headers.get("content-security-policy") || "", /connect-src[^;]*https:/);
  assert.match(response.headers.get("content-security-policy") || "", /style-src-elem 'self' https:\/\/fonts\.googleapis\.com/);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("origin-agent-cluster"), "?1");
  assert.equal(response.headers.get("cache-control"), "no-store");
}

const unversionedAsset = await worker.fetch(
  new Request("https://expassway.test/assets/styles.css"),
  env,
);
assert.equal(unversionedAsset.headers.get("cache-control"), "public, max-age=3600, must-revalidate");

const versionedAsset = await worker.fetch(
  new Request("https://expassway.test/scripts/app.js?v=20260803-1"),
  env,
);
assert.equal(versionedAsset.headers.get("cache-control"), "public, max-age=31536000, immutable");

const redirect = await worker.fetch(
  new Request("https://expassway.test/alevel/pages/review.html"),
  env,
);
assert.equal(redirect.status, 308);
assert.equal(redirect.headers.get("x-frame-options"), "DENY");

console.log("Cloudflare security header checks passed.");
