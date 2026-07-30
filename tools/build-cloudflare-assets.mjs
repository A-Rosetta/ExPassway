import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const outputDirectory = ".cloudflare-dist";
const allowedPaths = ["index.html", "pages/", "scripts/", "assets/"];
const trackedFiles = spawnSync(
  "git",
  ["ls-files", "-z", "--", ...allowedPaths],
  { encoding: "buffer" }
);

if (trackedFiles.status !== 0) {
  process.stderr.write(trackedFiles.stderr);
  process.exit(trackedFiles.status || 1);
}

const files = trackedFiles.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

await rm(outputDirectory, { recursive: true, force: true });

for (const file of files) {
  if (!(await stat(file)).isFile()) continue;
  const destination = join(outputDirectory, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(file, destination);
}

console.log(`Prepared ${files.length} tracked static assets in ${outputDirectory}.`);
