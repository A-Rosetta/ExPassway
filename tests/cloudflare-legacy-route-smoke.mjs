import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

const env = {
  ASSETS: {
    fetch() {
      throw new Error("Legacy routes must redirect before reading static assets.");
    },
  },
};

for (const [source, expected] of [
  ["https://expassway.test/alevel", "https://expassway.test/"],
  ["https://expassway.test/alevel/pages/review.html", "https://expassway.test/pages/review.html"],
  ["https://expassway.test/alevel/pages/review.html?from=bookmark", "https://expassway.test/pages/review.html?from=bookmark"],
]) {
  const response = await worker.fetch(new Request(source), env);
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), expected);
}

console.log("Cloudflare legacy /alevel route compatibility checks passed.");
