import { query } from "../client.js";

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    grade: row.grade,
    targetScore: row.target_score,
    language: row.language || "zh-CN",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserWithAuth(row) {
  return {
    ...mapUser(row),
    passwordHash: row.password_hash || null,
  };
}

export async function createUser(input) {
  const sql = `
    insert into users (email, display_name, role, grade, target_score, language)
    values ($1, $2, $3, $4, $5, $6)
    returning *
  `;
  const params = [
    input.email || null,
    input.displayName,
    input.role || "student",
    input.grade || null,
    input.targetScore ?? null,
    input.language || "zh-CN",
  ];
  const result = await query(sql, params);
  return mapUser(result.rows[0]);
}

export async function listUsers(limit = 20) {
  const sql = `
    select *
    from users
    order by created_at desc
    limit $1
  `;
  const result = await query(sql, [limit]);
  return result.rows.map(mapUser);
}

export async function getUserById(userId) {
  const sql = `
    select *
    from users
    where id = $1
    limit 1
  `;
  const result = await query(sql, [userId]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findUserByEmail(email) {
  const sql = `
    select *
    from users
    where lower(email) = lower($1)
    limit 1
  `;
  const result = await query(sql, [email]);
  return result.rows[0] ? mapUserWithAuth(result.rows[0]) : null;
}

export async function createUserWithPassword(input) {
  const sql = `
    insert into users (email, display_name, role, grade, target_score, password_hash, language)
    values ($1, $2, $3, $4, $5, $6, $7)
    returning *
  `;
  const params = [
    input.email || null,
    input.displayName,
    input.role || "student",
    input.grade || null,
    input.targetScore ?? null,
    input.passwordHash,
    input.language || "zh-CN",
  ];
  const result = await query(sql, params);
  return mapUser(result.rows[0]);
}

export async function updateUserProfile(userId, input) {
  const sql = `
    update users
    set
      display_name = $2,
      grade = $3,
      target_score = $4,
      language = $5,
      updated_at = now()
    where id = $1
    returning *
  `;
  const params = [
    userId,
    input.displayName,
    input.grade || null,
    input.targetScore ?? null,
    input.language || "zh-CN",
  ];
  const result = await query(sql, params);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function updateUserPasswordHash(userId, passwordHash) {
  const sql = `
    update users
    set
      password_hash = $2,
      updated_at = now()
    where id = $1
    returning id
  `;
  const result = await query(sql, [userId, passwordHash]);
  return Boolean(result.rows[0]);
}
