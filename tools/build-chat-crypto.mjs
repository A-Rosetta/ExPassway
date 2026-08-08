import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("assets/vendor", { recursive: true });
await build({
  entryPoints: ["scripts/chat-crypto-worker.js"],
  outfile: "assets/vendor/chat-crypto-worker.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  legalComments: "eof",
  minify: true,
});
