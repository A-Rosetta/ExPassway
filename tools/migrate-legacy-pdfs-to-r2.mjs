import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DATABASE = "expassway-db";
const CONTENT_BUCKET = "expassway-content";
const EXPECTED_PAPER_COUNT = 69;
const LEGACY_BASE_URL = String(process.env.LEGACY_API_BASE_URL || "http://127.0.0.1:3002").replace(/\/+$/, "");
const VERIFY_BASE_URL = String(process.env.R2_VERIFY_BASE_URL || "").replace(/\/+$/, "");
const execute = process.argv.includes("--execute");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function wrangler(args) {
  return execFileAsync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function publishedPapers() {
  const { stdout } = await wrangler([
    "d1", "execute", DATABASE, "--remote", "--json", "--command",
    "SELECT slug FROM exam_papers WHERE status = 'published' ORDER BY slug",
  ]);
  const payload = JSON.parse(stdout);
  return payload.flatMap((part) => part.results || []);
}

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function downloadSource(workDirectory, item) {
  const url = `${LEGACY_BASE_URL}/api/catalog/papers/${encodeURIComponent(item.slug)}/download/${item.type}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${item.slug}/${item.type}: legacy API returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`${item.slug}/${item.type}: legacy API did not return a PDF`);
  }
  const file = join(workDirectory, `${item.slug}-${item.type}.pdf`);
  await writeFile(file, bytes);
  return {
    ...item,
    sourceUrl: url,
    r2Key: `papers/${item.slug}/${item.type}.pdf`,
    byteSize: bytes.length,
    sha256: sha256(bytes),
    file,
  };
}

async function uploadAndVerify(workDirectory, item) {
  await wrangler([
    "r2", "object", "put", `${CONTENT_BUCKET}/${item.r2Key}`,
    "--remote", "--force", "--file", item.file, "--content-type", "application/pdf",
  ]);
  let verifiedBytes;
  if (VERIFY_BASE_URL) {
    const response = await fetch(
      `${VERIFY_BASE_URL}/api/catalog/papers/${encodeURIComponent(item.slug)}/download/${item.type}`
    );
    if (!response.ok) throw new Error(`${item.r2Key}: Worker verification returned ${response.status}`);
    verifiedBytes = Buffer.from(await response.arrayBuffer());
  } else {
    const verifiedFile = join(workDirectory, `verified-${item.slug}-${item.type}.pdf`);
    await wrangler([
      "r2", "object", "get", `${CONTENT_BUCKET}/${item.r2Key}`,
      "--remote", "--file", verifiedFile,
    ]);
    verifiedBytes = await readFile(verifiedFile);
  }
  const verifiedSha256 = sha256(verifiedBytes);
  if (verifiedSha256 !== item.sha256) {
    throw new Error(`${item.r2Key}: uploaded R2 hash does not match the legacy source`);
  }
  return { ...item, verifiedSha256 };
}

const startedAt = new Date().toISOString();
const workDirectory = await mkdtemp(join(tmpdir(), "expassway-pdf-migration-"));
try {
  const papers = await publishedPapers();
  if (papers.length !== EXPECTED_PAPER_COUNT) {
    throw new Error(`Expected ${EXPECTED_PAPER_COUNT} published papers but D1 returned ${papers.length}`);
  }
  const documents = papers.flatMap(({ slug }) => ["qp", "ms"].map((type) => ({ slug, type })));
  console.log(`Validating ${documents.length} PDFs for ${papers.length} published papers.`);
  const downloaded = await mapLimit(documents, 6, (item) => downloadSource(workDirectory, item));
  let verified = downloaded;
  if (execute) {
    console.log(`Uploading validated PDFs to ${CONTENT_BUCKET}.`);
    verified = await mapLimit(downloaded, 4, async (item) => {
      const result = await uploadAndVerify(workDirectory, item);
      console.log(`Verified ${item.r2Key}`);
      return result;
    });
  }
  const manifest = {
    startedAt,
    completedAt: new Date().toISOString(),
    mode: execute ? "uploaded-and-verified" : "validated-only",
    database: DATABASE,
    bucket: CONTENT_BUCKET,
    verifyBaseUrl: VERIFY_BASE_URL || null,
    legacyBaseUrl: LEGACY_BASE_URL,
    paperCount: papers.length,
    documentCount: verified.length,
    totalBytes: verified.reduce((total, item) => total + item.byteSize, 0),
    documents: verified.map(({ file: _file, sourceUrl, ...item }) => ({ ...item, sourceUrl })),
  };
  const stamp = startedAt.replace(/[:.]/g, "-");
  const manifestPath = join(tmpdir(), `expassway-pdf-migration-${stamp}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${execute ? "Uploaded and verified" : "Validated"} ${verified.length} PDFs. Manifest: ${manifestPath}`);
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
