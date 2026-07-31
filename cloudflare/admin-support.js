import { AuthError } from "./auth-api.js";

export async function writeAudit(db, actorUserId, action, targetType, targetId = null, details = {}) {
  await db.prepare(`
    INSERT INTO admin_audit_events (id, actor_user_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    actorUserId,
    action,
    targetType,
    targetId,
    JSON.stringify(details || {})
  ).run();
}

export async function dispatchImportWorkflow(env, inputs = {}) {
  const token = String(env.GITHUB_ACTIONS_TOKEN || "");
  const repository = String(env.GITHUB_REPOSITORY || "A-Rosetta/ExPassway");
  const workflow = String(env.GITHUB_IMPORT_WORKFLOW || "cloudflare-pdf-import.yml");
  const ref = String(env.GITHUB_IMPORT_REF || "main");
  if (!token) {
    throw new AuthError(503, "GitHub Actions dispatch is not configured.", "GITHUB_ACTIONS_NOT_CONFIGURED");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new AuthError(503, "GitHub repository configuration is invalid.", "GITHUB_ACTIONS_NOT_CONFIGURED");
  }

  let response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "ExPassway-Cloudflare-Worker",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref,
          inputs: {
            action: inputs.action || "auto",
            job_id: inputs.jobId || "",
          },
        }),
      }
    );
  } catch (_error) {
    throw new AuthError(502, "GitHub Actions could not be reached.", "GITHUB_ACTIONS_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AuthError(502, "GitHub Actions rejected the workflow dispatch.", "GITHUB_ACTIONS_REJECTED", {
      upstreamStatus: response.status,
    });
  }
  return { repository, workflow, ref };
}
