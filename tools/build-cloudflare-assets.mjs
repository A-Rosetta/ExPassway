import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const outputDirectory = ".cloudflare-dist";
const allowedPaths = ["_headers", "index.html", "pages/", "scripts/", "assets/"];
const safeDirectory = resolve(".").replaceAll("\\", "/");
const trackedFiles = spawnSync(
  "git",
  ["-c", `safe.directory=${safeDirectory}`, "ls-files", "-z", "--", ...allowedPaths],
  {
    encoding: "buffer",
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "safe.directory",
      GIT_CONFIG_VALUE_0: safeDirectory,
    },
  }
);

if (trackedFiles.status !== 0) {
  process.stderr.write(trackedFiles.stderr);
  process.exit(trackedFiles.status || 1);
}

const files = trackedFiles.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

for (const generatedFile of [
  "pages/chat.html",
  "scripts/chat.js",
  "scripts/chat-notifications.js",
  "scripts/chat-crypto-worker.js",
  "assets/vendor/chat-crypto-worker.js",
  "pages/paper-builder.html",
  "assets/paper-builder.css",
]) {
  if (!files.includes(generatedFile)) files.push(generatedFile);
}

await rm(outputDirectory, { recursive: true, force: true });

for (const file of files) {
  if (!(await stat(file)).isFile()) continue;
  const destination = join(outputDirectory, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(file, destination);
}

await build({
  entryPoints: ["scripts/paper-builder.js"],
  bundle: true,
  format: "iife",
  minify: true,
  platform: "browser",
  target: "es2022",
  outfile: join(outputDirectory, "scripts/paper-builder.bundle.js"),
});

console.log(`Prepared ${files.length} tracked static assets in ${outputDirectory}.`);
