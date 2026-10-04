import { readFile } from "node:fs/promises";
import { validateResourcePackage } from "../shared/structured-content.js";

const path = process.argv[2];
if (!path) throw new Error("Usage: node tools/validate-resource-package.mjs <package.json>");
const result = validateResourcePackage(JSON.parse(await readFile(path, "utf8")));
if (!result.valid) {
  for (const error of result.errors) console.error(`${error.path}: ${error.message}`);
  process.exitCode = 1;
} else console.log("Resource package v1 is valid. No files were uploaded or records published.");
