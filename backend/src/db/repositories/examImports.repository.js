import { getPool, query } from "../client.js";

function mapJob(row) {
  return {
    id: row.id,
    subjectCode: row.subject_code,
    subjectName: row.subject_name || "",
    createdBy: row.created_by,
    createdByName: row.created_by_name || "",
    status: row.status,
    inputDir: row.input_dir,
    stagingDir: row.staging_dir,
    manifestPath: row.manifest_path || "",
    summary: row.summary || {},
    fileCount: Number(row.file_count || 0),
    issueCount: Number(row.issue_count || 0),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    publishedAt: row.published_at,
  };
}

function mapFile(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    fileName: row.file_name,
    documentType: row.document_type,
    paperSlug: row.paper_slug,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function mapIssue(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    paperSlug: row.paper_slug || "",
    severity: row.severity,
    code: row.code,
    message: row.message,
    details: row.details || {},
    createdAt: row.created_at,
  };
}

const JOB_SELECT = `
  select
    j.*,
    s.name as subject_name,
    u.display_name as created_by_name,
    (select count(*) from exam_import_files f where f.job_id = j.id)::int as file_count,
    (select count(*) from exam_import_issues i where i.job_id = j.id)::int as issue_count
  from exam_import_jobs j
  join exam_subjects s on s.code = j.subject_code
  left join users u on u.id = j.created_by
`;

export async function createImportJob(input) {
  const result = await query(`
    insert into exam_import_jobs (id, subject_code, created_by, input_dir, staging_dir)
    values ($1, $2, $3, $4, $5)
    returning *
  `, [input.id, input.subjectCode, input.createdBy, input.inputDir, input.stagingDir]);
  return mapJob(result.rows[0]);
}

export async function getImportJob(jobId) {
  const result = await query(`${JOB_SELECT} where j.id = $1 limit 1`, [jobId]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function listImportJobs(limit = 30) {
  const result = await query(`${JOB_SELECT} order by j.created_at desc limit $1`, [limit]);
  return result.rows.map(mapJob);
}

export async function addImportFile(input) {
  const result = await query(`
    insert into exam_import_files (
      job_id, file_name, document_type, paper_slug, byte_size, sha256, stored_path
    ) values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (job_id, file_name) do update set
      document_type = excluded.document_type,
      paper_slug = excluded.paper_slug,
      byte_size = excluded.byte_size,
      sha256 = excluded.sha256,
      stored_path = excluded.stored_path,
      created_at = now()
    returning *
  `, [
    input.jobId,
    input.fileName,
    input.documentType,
    input.paperSlug,
    input.byteSize,
    input.sha256,
    input.storedPath,
  ]);
  return mapFile(result.rows[0]);
}

export async function listImportFiles(jobId) {
  const result = await query(`
    select * from exam_import_files where job_id = $1 order by file_name
  `, [jobId]);
  return result.rows.map(mapFile);
}

export async function getPublishedImportFile(paperSlug, documentType) {
  const result = await query(`
    select f.stored_path
    from exam_import_files f
    join exam_import_jobs j on j.id = f.job_id
    where f.paper_slug = $1
      and f.document_type = $2
      and j.status = 'published'
    order by f.created_at desc
    limit 1
  `, [paperSlug, documentType]);
  return result.rows[0]?.stored_path || "";
}

export async function listImportIssues(jobId) {
  const result = await query(`
    select * from exam_import_issues where job_id = $1 order by created_at, paper_slug
  `, [jobId]);
  return result.rows.map(mapIssue);
}

export async function markJobProcessing(jobId) {
  await query(`
    update exam_import_jobs
    set status = 'processing', started_at = now(), completed_at = null,
        manifest_path = null, summary = '{}'::jsonb
    where id = $1
  `, [jobId]);
  await query("delete from exam_import_issues where job_id = $1", [jobId]);
}

export async function completeJobProcessing(jobId, input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(`
      update exam_import_jobs
      set status = $2, manifest_path = $3, summary = $4::jsonb, completed_at = now()
      where id = $1
    `, [jobId, input.status, input.manifestPath || null, JSON.stringify(input.summary || {})]);
    for (const issue of input.issues || []) {
      await client.query(`
        insert into exam_import_issues (
          job_id, paper_slug, severity, code, message, details
        ) values ($1,$2,$3,$4,$5,$6::jsonb)
      `, [
        jobId,
        issue.paperSlug || null,
        issue.severity || "error",
        issue.code,
        issue.message,
        JSON.stringify(issue.details || {}),
      ]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function markJobPublished(jobId, summary) {
  await query(`
    update exam_import_jobs
    set status = 'published', summary = $2::jsonb, published_at = now()
    where id = $1
  `, [jobId, JSON.stringify(summary || {})]);
}
