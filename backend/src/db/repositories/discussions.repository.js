import { query } from "../client.js";

function mapThread(row) {
  return {
    id: row.id,
    questionKey: row.question_key,
    title: row.title,
    board: row.board,
    subject: row.subject,
    paper: row.paper,
    topic: row.topic,
    tags: row.tags || [],
    status: row.status,
    sticky: Boolean(row.sticky),
    approved: Boolean(row.approved),
    authorId: row.author_id,
    authorName: row.author_name || "Unknown",
    postCount: Number(row.post_count || 0),
    likeCount: Number(row.like_count || 0),
    followerCount: Number(row.follower_count || 0),
    followed: Boolean(row.followed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPostAt: row.last_post_at,
  };
}

function mapPost(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    authorName: row.author_name || "Unknown",
    body: row.body,
    approved: Boolean(row.approved),
    hidden: Boolean(row.hidden),
    likeCount: Number(row.like_count || 0),
    liked: Boolean(row.liked),
    flagCount: Number(row.flag_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function addFilter(filters, params, field, value) {
  if (!value) return;
  params.push(value);
  filters.push(`${field} = $${params.length}`);
}

function buildVisibilityFilters(includeHidden, includeUnapproved) {
  const filters = [];
  if (!includeHidden) {
    filters.push("t.status <> 'hidden'");
  }
  if (!includeUnapproved) {
    filters.push("t.approved = true");
  }
  return filters;
}

export async function listDiscussionThreads(input = {}) {
  const params = [input.viewerUserId || null];
  const filters = buildVisibilityFilters(input.includeHidden, input.includeUnapproved);

  addFilter(filters, params, "t.question_key", input.questionKey || null);
  addFilter(filters, params, "t.subject", input.subject || null);
  addFilter(filters, params, "t.paper", input.paper || null);
  addFilter(filters, params, "t.topic", input.topic || null);
  addFilter(filters, params, "t.status", input.status || null);

  if (input.tag) {
    params.push(input.tag);
    filters.push(`$${params.length} = any(t.tags)`);
  }

  if (input.followedOnly) {
    filters.push("exists (select 1 from discussion_thread_follows f where f.thread_id = t.id and f.user_id = $1::uuid)");
  }

  params.push(Number(input.limit || 30));
  const limitRef = `$${params.length}`;
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const result = await query(`
    select
      t.*,
      u.display_name as author_name,
      (select count(*)::int from discussion_posts p where p.thread_id = t.id and p.hidden = false and p.approved = true) as post_count,
      (select count(*)::int from discussion_posts p join discussion_post_likes l on l.post_id = p.id where p.thread_id = t.id) as like_count,
      (select count(*)::int from discussion_thread_follows f where f.thread_id = t.id) as follower_count,
      exists (select 1 from discussion_thread_follows f where f.thread_id = t.id and f.user_id = $1::uuid) as followed
    from discussion_threads t
    left join users u on u.id = t.author_id
    ${where}
    order by t.sticky desc, t.last_post_at desc
    limit ${limitRef}
  `, params);
  return result.rows.map(mapThread);
}

export async function getDiscussionThreadById(threadId, input = {}) {
  const result = await query(`
    select
      t.*,
      u.display_name as author_name,
      (select count(*)::int from discussion_posts p where p.thread_id = t.id and p.hidden = false and p.approved = true) as post_count,
      (select count(*)::int from discussion_posts p join discussion_post_likes l on l.post_id = p.id where p.thread_id = t.id) as like_count,
      (select count(*)::int from discussion_thread_follows f where f.thread_id = t.id) as follower_count,
      exists (select 1 from discussion_thread_follows f where f.thread_id = t.id and f.user_id = $2::uuid) as followed
    from discussion_threads t
    left join users u on u.id = t.author_id
    where t.id = $1
      and ($3::boolean or t.status <> 'hidden')
      and ($4::boolean or t.approved = true)
    limit 1
  `, [threadId, input.viewerUserId || null, Boolean(input.includeHidden), Boolean(input.includeUnapproved)]);
  return result.rows[0] ? mapThread(result.rows[0]) : null;
}

export async function listDiscussionPosts(threadId, input = {}) {
  const result = await query(`
    select
      p.*,
      u.display_name as author_name,
      (select count(*)::int from discussion_post_likes l where l.post_id = p.id) as like_count,
      exists (select 1 from discussion_post_likes l where l.post_id = p.id and l.user_id = $2::uuid) as liked,
      (select count(*)::int from discussion_flags f where f.post_id = p.id) as flag_count
    from discussion_posts p
    left join users u on u.id = p.author_id
    where p.thread_id = $1
      and ($3::boolean or p.hidden = false)
      and ($4::boolean or p.approved = true)
    order by p.created_at asc
  `, [threadId, input.viewerUserId || null, Boolean(input.includeHidden), Boolean(input.includeUnapproved)]);
  return result.rows.map(mapPost);
}

export async function createDiscussionThread(input) {
  const threadResult = await query(`
    insert into discussion_threads (
      question_key,
      title,
      board,
      subject,
      paper,
      topic,
      tags,
      author_id
    )
    values ($1, $2, $3, $4, $5, $6, $7::text[], $8)
    returning *
  `, [
    input.questionKey || null,
    input.title,
    input.board || null,
    input.subject || null,
    input.paper || null,
    input.topic || null,
    input.tags || [],
    input.authorId,
  ]);
  const thread = threadResult.rows[0];
  await createDiscussionPost({
    threadId: thread.id,
    authorId: input.authorId,
    body: input.body,
  });
  return getDiscussionThreadById(thread.id, {
    viewerUserId: input.authorId,
    includeHidden: true,
    includeUnapproved: true,
  });
}

export async function createDiscussionPost(input) {
  const result = await query(`
    insert into discussion_posts (thread_id, author_id, body)
    values ($1, $2, $3)
    returning *
  `, [input.threadId, input.authorId, input.body]);
  await query(`
    update discussion_threads
    set last_post_at = now(), updated_at = now()
    where id = $1
  `, [input.threadId]);
  return result.rows[0] ? mapPost(result.rows[0]) : null;
}

export async function likeDiscussionPost(postId, userId) {
  await query(`
    insert into discussion_post_likes (post_id, user_id)
    values ($1, $2)
    on conflict (post_id, user_id) do nothing
  `, [postId, userId]);
  return { liked: true };
}

export async function unlikeDiscussionPost(postId, userId) {
  await query(`
    delete from discussion_post_likes
    where post_id = $1 and user_id = $2
  `, [postId, userId]);
  return { liked: false };
}

export async function followDiscussionThread(threadId, userId) {
  await query(`
    insert into discussion_thread_follows (thread_id, user_id, last_read_at)
    values ($1, $2, now())
    on conflict (thread_id, user_id)
    do update set last_read_at = now()
  `, [threadId, userId]);
  return { followed: true };
}

export async function unfollowDiscussionThread(threadId, userId) {
  await query(`
    delete from discussion_thread_follows
    where thread_id = $1 and user_id = $2
  `, [threadId, userId]);
  return { followed: false };
}

export async function flagDiscussionPost(postId, userId, reason) {
  await query(`
    insert into discussion_flags (post_id, user_id, reason)
    values ($1, $2, $3)
    on conflict (post_id, user_id)
    do update set reason = excluded.reason, created_at = now()
  `, [postId, userId, reason || null]);
  return { flagged: true };
}

export async function updateDiscussionThreadModeration(threadId, input) {
  const result = await query(`
    update discussion_threads
    set
      status = coalesce($2, status),
      sticky = coalesce($3, sticky),
      approved = coalesce($4, approved),
      updated_at = now()
    where id = $1
    returning *
  `, [
    threadId,
    input.status ?? null,
    input.sticky ?? null,
    input.approved ?? null,
  ]);
  return result.rows[0] ? mapThread(result.rows[0]) : null;
}
