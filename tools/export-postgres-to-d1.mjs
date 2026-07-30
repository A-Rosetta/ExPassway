import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const { Client } = requireFromBackend("pg");

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDir = path.join(repoRoot, ".d1-export");
const sqlDir = path.join(outputDir, "sql");
const importDir = path.join(outputDir, "import");
const targetFileBytes = 50_000;
const maxRowsPerFile = 50;
const targetImportFileBytes = 500_000;
const importStatements = [];

const columns = (definitions) => definitions.map(([name, type]) => ({ name, type }));

const tables = [
  {
    name: "users",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["email", "text"], ["display_name", "text"], ["role", "text"],
      ["grade", "text"], ["target_score", "integer"], ["created_at", "timestamp"],
      ["updated_at", "timestamp"], ["password_hash", "redacted"], ["language", "text"],
      ["disabled_at", "timestamp"], ["pet_enabled", "boolean"], ["pet_skin", "text"],
      ["pet_position_x", "real"], ["pet_position_y", "real"]
    ])
  },
  {
    name: "exam_subjects",
    orderBy: "code",
    columns: columns([
      ["code", "text"], ["board", "text"], ["qualification", "text"], ["name", "text"],
      ["name_zh", "text"], ["asset_key", "text"], ["active", "boolean"],
      ["created_at", "timestamp"], ["updated_at", "timestamp"]
    ])
  },
  {
    name: "exam_papers",
    orderBy: "slug",
    columns: columns([
      ["slug", "text"], ["subject_code", "text"], ["year", "integer"], ["season", "text"],
      ["paper_number", "integer"], ["variant", "integer"], ["paper_type", "text"],
      ["duration_minutes", "integer"], ["source_question_count", "integer"],
      ["valid_question_count", "integer"], ["discounted_questions", "json"],
      ["qp_file_name", "text"], ["ms_file_name", "text"], ["data_url", "text"],
      ["status", "text"], ["metadata", "json"], ["published_at", "timestamp"],
      ["created_at", "timestamp"], ["updated_at", "timestamp"]
    ])
  },
  {
    name: "question_bank",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["board", "text"], ["subject", "text"], ["paper", "text"],
      ["difficulty", "text"], ["topic", "text"], ["year", "text"], ["stem", "text"],
      ["options", "json"], ["answer", "integer"], ["mistake_type", "text"],
      ["template_id", "text"], ["skills", "json"], ["hints", "json"], ["images", "json"],
      ["source", "json"], ["subject_code", "text"], ["paper_slug", "text"],
      ["question_no", "integer"], ["active", "boolean"]
    ])
  },
  {
    name: "practice_sessions",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["user_id", "text"], ["grade", "text"], ["board", "text"],
      ["subject", "text"], ["paper", "text"], ["difficulty", "text"], ["topics", "json"],
      ["requested_count", "integer"], ["fallback_applied", "boolean"],
      ["generated_questions", "json"], ["answers", "json"], ["result", "json"],
      ["wrong_log", "json"], ["status", "text"], ["created_at", "timestamp"],
      ["submitted_at", "timestamp"], ["practice_mode", "text"]
    ])
  },
  {
    name: "wrong_notebook_entries",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["user_id", "text"], ["question_key", "text"], ["board", "text"],
      ["subject", "text"], ["paper", "text"], ["topic", "text"], ["year", "text"],
      ["stem", "text"], ["answer", "integer"], ["answer_text", "text"],
      ["last_selected", "integer"], ["last_selected_text", "text"], ["wrong_count", "integer"],
      ["first_wrong_at", "timestamp"], ["last_wrong_at", "timestamp"],
      ["mastered", "boolean"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
    ])
  },
  {
    name: "discussion_threads",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["question_key", "text"], ["title", "text"], ["board", "text"],
      ["subject", "text"], ["paper", "text"], ["topic", "text"], ["tags", "json"],
      ["status", "text"], ["sticky", "boolean"], ["approved", "boolean"],
      ["author_id", "text"], ["created_at", "timestamp"], ["updated_at", "timestamp"],
      ["last_post_at", "timestamp"], ["subject_code", "text"], ["paper_slug", "text"],
      ["question_no", "integer"]
    ])
  },
  {
    name: "discussion_posts",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["thread_id", "text"], ["author_id", "text"], ["body", "text"],
      ["approved", "boolean"], ["hidden", "boolean"], ["created_at", "timestamp"],
      ["updated_at", "timestamp"]
    ])
  },
  {
    name: "discussion_post_likes",
    orderBy: "post_id, user_id",
    columns: columns([["post_id", "text"], ["user_id", "text"], ["created_at", "timestamp"]])
  },
  {
    name: "discussion_thread_follows",
    orderBy: "thread_id, user_id",
    columns: columns([
      ["thread_id", "text"], ["user_id", "text"], ["last_read_at", "timestamp"],
      ["created_at", "timestamp"]
    ])
  },
  {
    name: "discussion_flags",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["post_id", "text"], ["user_id", "text"], ["reason", "text"],
      ["created_at", "timestamp"]
    ])
  },
  {
    name: "question_hint_sets",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["question_id", "text"], ["language", "text"],
      ["prompt_version", "text"], ["question_fingerprint", "text"], ["hints", "json"],
      ["status", "text"], ["model", "text"], ["response_id", "text"],
      ["reviewed_by", "text"], ["reviewed_at", "timestamp"], ["created_at", "timestamp"],
      ["updated_at", "timestamp"]
    ])
  },
  {
    name: "exam_import_jobs",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["subject_code", "text"], ["created_by", "text"], ["status", "text"],
      ["input_dir", "text"], ["staging_dir", "text"], ["manifest_path", "text"],
      ["summary", "json"], ["created_at", "timestamp"], ["started_at", "timestamp"],
      ["completed_at", "timestamp"], ["published_at", "timestamp"]
    ])
  },
  {
    name: "exam_import_files",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["job_id", "text"], ["file_name", "text"], ["document_type", "text"],
      ["paper_slug", "text"], ["byte_size", "integer"], ["sha256", "text"],
      ["stored_path", "text"], ["created_at", "timestamp"]
    ])
  },
  {
    name: "exam_import_issues",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["job_id", "text"], ["paper_slug", "text"], ["severity", "text"],
      ["code", "text"], ["message", "text"], ["details", "json"], ["created_at", "timestamp"]
    ])
  },
  {
    name: "question_import_jobs",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["status", "text"], ["input_dir", "text"], ["output_json", "text"],
      ["report_json", "text"], ["total_candidates", "integer"], ["published_count", "integer"],
      ["review_count", "integer"], ["summary", "json"], ["created_at", "timestamp"],
      ["completed_at", "timestamp"]
    ])
  },
  {
    name: "question_review_queue",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["job_id", "text"], ["question_id", "text"], ["board", "text"],
      ["subject", "text"], ["paper", "text"], ["year", "text"], ["source_file", "text"],
      ["question_no", "integer"], ["stem", "text"], ["options", "json"], ["images", "json"],
      ["reasons", "json"], ["quality", "json"], ["source", "json"], ["created_at", "timestamp"]
    ])
  },
  {
    name: "curriculum_versions",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["subject_code", "text"], ["qualification", "text"],
      ["exam_year_start", "integer"], ["exam_year_end", "integer"], ["version", "text"],
      ["active", "boolean"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
    ])
  },
  {
    name: "curriculum_sections",
    orderBy: "id",
    selfParentColumn: "parent_id",
    columns: columns([
      ["id", "text"], ["curriculum_version_id", "text"], ["syllabus_code", "text"],
      ["title_en", "text"], ["title_zh", "text"], ["level", "text"], ["parent_id", "text"],
      ["core_level", "text"], ["sort_order", "integer"], ["created_at", "timestamp"],
      ["updated_at", "timestamp"]
    ])
  },
  {
    name: "coursebook_chapters",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["book_key", "text"], ["chapter_no", "integer"], ["title_en", "text"],
      ["title_zh", "text"], ["pdf_start_page", "integer"], ["pdf_end_page", "integer"],
      ["printed_start_page", "integer"], ["printed_end_page", "integer"],
      ["sort_order", "integer"], ["created_at", "timestamp"], ["updated_at", "timestamp"]
    ])
  },
  {
    name: "coursebook_sections",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["coursebook_chapter_id", "text"], ["section_code", "text"],
      ["title_en", "text"], ["title_zh", "text"], ["pdf_start_page", "integer"],
      ["pdf_end_page", "integer"], ["printed_start_page", "integer"],
      ["printed_end_page", "integer"], ["sort_order", "integer"],
      ["created_at", "timestamp"], ["updated_at", "timestamp"]
    ])
  },
  {
    name: "coursebook_section_mappings",
    orderBy: "coursebook_section_id, curriculum_section_id",
    columns: columns([["coursebook_section_id", "text"], ["curriculum_section_id", "text"]])
  },
  {
    name: "question_section_mappings",
    orderBy: "question_id, curriculum_section_id",
    columns: columns([
      ["question_id", "text"], ["curriculum_section_id", "text"],
      ["coursebook_section_id", "text"], ["is_primary", "boolean"], ["confidence", "real"],
      ["status", "text"], ["reviewed_by", "text"], ["reviewed_at", "timestamp"],
      ["source", "text"], ["similar_question_group", "text"], ["created_at", "timestamp"],
      ["updated_at", "timestamp"]
    ])
  },
  {
    name: "question_attempts",
    orderBy: "id",
    columns: columns([
      ["id", "text"], ["user_id", "text"], ["question_id", "text"],
      ["practice_session_id", "text"], ["curriculum_section_id", "text"],
      ["coursebook_section_id", "text"], ["mode", "text"], ["selected_index", "integer"],
      ["correct", "boolean"], ["first_exposure", "boolean"], ["elapsed_seconds", "integer"],
      ["hints_used", "integer"], ["attempted_at", "timestamp"],
      ["similar_question_group", "text"]
    ])
  }
];

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
  )).join(",")}}`;
}

function transformValue(value, type) {
  if (value === null || value === undefined || type === "redacted") return null;
  if (type === "boolean") return value ? 1 : 0;
  if (type === "integer") return Number(value);
  if (type === "real") return Number(value);
  if (type === "timestamp") {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) {
      return value;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${value}`);
    return date.toISOString();
  }
  if (type === "json") {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return canonicalStringify(parsed);
  }
  return String(value);
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot export non-finite number: ${value}`);
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function topologicalOrder(rows, idColumn, parentColumn) {
  const byId = new Map(rows.map((row) => [row[idColumn], row]));
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(row) {
    const id = row[idColumn];
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cycle found in ${parentColumn} at ${id}`);
    visiting.add(id);
    const parentId = row[parentColumn];
    if (parentId !== null && parentId !== undefined) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error(`Missing parent ${parentId} for ${id}`);
      visit(parent);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(row);
  }

  for (const row of rows) visit(row);
  return ordered;
}

async function writeTableFiles(tableIndex, table, rows) {
  const files = [];
  const columnSql = table.columns.map(({ name }) => quoteIdentifier(name)).join(", ");
  const prefix = `INSERT INTO ${quoteIdentifier(table.name)} (${columnSql}) VALUES\n`;
  let batch = [];
  let batchBytes = Buffer.byteLength(prefix) + 2;

  async function flush() {
    if (batch.length === 0) return;
    const fileName = `${String(tableIndex + 1).padStart(2, "0")}-${table.name}-${String(files.length + 1).padStart(4, "0")}.sql`;
    const sql = `${prefix}${batch.join(",\n")};\n`;
    const sha256 = createHash("sha256").update(sql).digest("hex");
    await writeFile(path.join(sqlDir, fileName), sql, { mode: 0o600 });
    importStatements.push(sql);
    files.push({ file: `sql/${fileName}`, rows: batch.length, bytes: Buffer.byteLength(sql), sha256 });
    batch = [];
    batchBytes = Buffer.byteLength(prefix) + 2;
  }

  for (const row of rows) {
    const values = table.columns.map(({ name }) => sqlLiteral(row[name]));
    const rowSql = `  (${values.join(", ")})`;
    const rowBytes = Buffer.byteLength(rowSql) + (batch.length === 0 ? 0 : 2);
    if (batch.length > 0 && (batch.length >= maxRowsPerFile || batchBytes + rowBytes > targetFileBytes)) {
      await flush();
    }
    batch.push(rowSql);
    batchBytes += rowBytes;
  }
  await flush();
  return files;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Load backend/.env without printing it.");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(sqlDir, { recursive: true, mode: 0o700 });
  await mkdir(importDir, { recursive: true, mode: 0o700 });

  const manifest = {
    formatVersion: 1,
    generatedAt: null,
    source: {},
    passwordHashesExported: false,
    metrics: {},
    tables: [],
    importFiles: []
  };

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const metadata = await client.query(`
      SELECT
        transaction_timestamp() AS generated_at,
        current_database() AS database_name,
        current_setting('server_version') AS server_version
    `);
    manifest.generatedAt = metadata.rows[0].generated_at.toISOString();
    manifest.source = {
      database: metadata.rows[0].database_name,
      serverVersion: metadata.rows[0].server_version,
      isolation: "repeatable read, read only"
    };

    for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
      const table = tables[tableIndex];
      const selectedColumns = table.columns
        .filter(({ type }) => type !== "redacted")
        .map(({ name, type }) => type === "timestamp"
          ? `CASE WHEN ${quoteIdentifier(name)} IS NULL THEN NULL ELSE to_char(${quoteIdentifier(name)} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') END AS ${quoteIdentifier(name)}`
          : quoteIdentifier(name));
      const query = `SELECT ${selectedColumns.join(", ")} FROM ${quoteIdentifier(table.name)} ORDER BY ${table.orderBy}`;
      const result = await client.query(query);
      let sourceRows = result.rows;
      if (table.selfParentColumn) {
        sourceRows = topologicalOrder(sourceRows, "id", table.selfParentColumn);
      }

      const transformedRows = sourceRows.map((sourceRow) => Object.fromEntries(
        table.columns.map(({ name, type }) => [name, transformValue(sourceRow[name], type)])
      ));
      const tableHash = createHash("sha256");
      for (const row of transformedRows) tableHash.update(`${canonicalStringify(row)}\n`);
      const files = await writeTableFiles(tableIndex, table, transformedRows);

      manifest.tables.push({
        name: table.name,
        rowCount: transformedRows.length,
        sha256: tableHash.digest("hex"),
        columns: table.columns.map(({ name }) => name),
        files
      });
      process.stdout.write(`${table.name}: ${transformedRows.length}\n`);
    }

    const metrics = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM users WHERE email IS NOT NULL) AS users_with_email,
        (SELECT count(*)::integer FROM users WHERE password_hash IS NOT NULL) AS source_users_with_password_hash,
        (SELECT count(*)::integer FROM users WHERE role = 'admin') AS admin_users,
        (SELECT count(*)::integer FROM users WHERE disabled_at IS NOT NULL) AS disabled_users,
        (SELECT count(*)::integer FROM practice_sessions WHERE status = 'generated') AS generated_sessions,
        (SELECT count(*)::integer FROM practice_sessions WHERE status = 'submitted') AS submitted_sessions,
        (SELECT count(*)::integer FROM practice_sessions WHERE user_id IS NULL) AS sessions_without_user,
        (SELECT count(*)::integer FROM practice_sessions WHERE practice_mode = 'chapter') AS chapter_sessions,
        (SELECT count(*)::integer FROM question_bank WHERE active = true) AS active_questions,
        (SELECT count(*)::integer FROM question_bank WHERE active = false) AS inactive_questions,
        (SELECT count(*)::integer FROM question_bank WHERE paper_slug IS NULL) AS questions_missing_paper_slug,
        (SELECT count(*)::integer FROM question_bank WHERE question_no IS NULL) AS questions_missing_question_no,
        (SELECT count(*)::integer FROM question_section_mappings WHERE status = 'reviewed') AS reviewed_mappings,
        (SELECT count(*)::integer FROM question_section_mappings WHERE status = 'suggested') AS suggested_mappings,
        (SELECT count(*)::integer FROM question_section_mappings WHERE status = 'rejected') AS rejected_mappings,
        (SELECT count(*)::integer FROM question_section_mappings WHERE is_primary = true) AS primary_mappings,
        (SELECT count(*)::integer FROM discussion_threads) AS discussion_threads,
        (SELECT count(*)::integer FROM discussion_posts) AS discussion_posts
    `);
    manifest.metrics = metrics.rows[0];

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  let importBatch = [];
  let importBatchBytes = 0;
  async function flushImportBatch() {
    if (importBatch.length === 0) return;
    const fileName = `import-${String(manifest.importFiles.length + 1).padStart(4, "0")}.sql`;
    const sql = importBatch.join("\n");
    await writeFile(path.join(importDir, fileName), sql, { mode: 0o600 });
    manifest.importFiles.push({
      file: `import/${fileName}`,
      statements: importBatch.length,
      bytes: Buffer.byteLength(sql),
      sha256: createHash("sha256").update(sql).digest("hex")
    });
    importBatch = [];
    importBatchBytes = 0;
  }
  for (const statement of importStatements) {
    const statementBytes = Buffer.byteLength(statement) + (importBatch.length === 0 ? 0 : 1);
    if (importBatch.length > 0 && importBatchBytes + statementBytes > targetImportFileBytes) {
      await flushImportBatch();
    }
    importBatch.push(statement);
    importBatchBytes += statementBytes;
  }
  await flushImportBatch();
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
  process.stdout.write(`Export written to ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
