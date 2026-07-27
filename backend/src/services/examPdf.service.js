import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPublishedImportFile } from "../db/repositories/examImports.repository.js";

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_ROOT = path.resolve(SERVICE_DIR, "../../imports");
const CHEMISTRY_ROOTS = {
  qp: "/home/ubuntu/chemis/pdf",
  ms: "/home/ubuntu/chemis/answer/paper2_s23_w23",
};
const COORDINATED_SCIENCES_ROOT = "/home/ubuntu/ig_coorinate_science";
const SEASON_DIRECTORIES = { m: "march", s: "summer", w: "winter" };

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function validatePdf(candidatePath, approvedRoot) {
  try {
    const [resolvedPath, resolvedRoot] = await Promise.all([
      realpath(candidatePath),
      realpath(approvedRoot),
    ]);
    if (!isInsideRoot(resolvedPath, resolvedRoot) || path.extname(resolvedPath).toLowerCase() !== ".pdf") {
      return "";
    }
    const details = await stat(resolvedPath);
    return details.isFile() ? resolvedPath : "";
  } catch (_err) {
    return "";
  }
}

function validPublishedFileName(fileName) {
  return path.basename(fileName) === fileName && /^[a-z0-9_]+\.pdf$/i.test(fileName);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findLegacyChemistryPdf(fileName, documentType) {
  const root = CHEMISTRY_ROOTS[documentType];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const baseName = fileName.slice(0, -4);
    const suffix = documentType === "qp" ? "(?:\\(\\d+\\))?" : "(?:-[^.]+)?";
    const expectedName = new RegExp(`^${escapeRegExp(baseName)}${suffix}\\.pdf$`, "i");
    const match = entries
      .filter((entry) => entry.isFile() && expectedName.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))[0];
    return match ? path.join(root, match.name) : "";
  } catch (_err) {
    return "";
  }
}

function legacyCandidate(paper, fileName) {
  if (paper.subjectCode === "0654") {
    const seasonDirectory = SEASON_DIRECTORIES[paper.season];
    return seasonDirectory
      ? path.join(COORDINATED_SCIENCES_ROOT, String(paper.year), seasonDirectory, fileName)
      : "";
  }
  return "";
}

export async function resolvePublishedPaperPdf(paper, documentType) {
  const fileName = documentType === "qp" ? paper.qpFileName : paper.msFileName;
  if (!validPublishedFileName(fileName)) return null;

  const storedPath = await getPublishedImportFile(paper.slug, documentType);
  if (storedPath) {
    const resolvedStoredPath = await validatePdf(storedPath, IMPORT_ROOT);
    if (resolvedStoredPath) return { filePath: resolvedStoredPath, fileName };
  }

  if (paper.subjectCode === "0620") {
    const chemistryPath = await findLegacyChemistryPdf(fileName, documentType);
    const resolvedChemistryPath = await validatePdf(chemistryPath, CHEMISTRY_ROOTS[documentType]);
    return resolvedChemistryPath ? { filePath: resolvedChemistryPath, fileName } : null;
  }

  const candidate = legacyCandidate(paper, fileName);
  const resolvedCandidate = candidate
    ? await validatePdf(candidate, COORDINATED_SCIENCES_ROOT)
    : "";
  return resolvedCandidate ? { filePath: resolvedCandidate, fileName } : null;
}
