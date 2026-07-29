import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function insertComment(row: {
  commentId: string;
  lawId: string;
  userId: number | null;
  pseudonym: string | null;
  body: string;
  sentimentHint: schema.CommentSentiment;
  themeTags: string[];
}) {
  await getDb()
    .insert(schema.billComments)
    .values({
      commentId: row.commentId,
      lawId: row.lawId,
      userId: row.userId,
      pseudonym: row.pseudonym,
      body: row.body,
      sentimentHint: row.sentimentHint,
      themeTags: row.themeTags as never,
      status: "visible",
    });
  const created = await findComment(row.commentId);
  if (!created) throw new Error(`comment ${row.commentId} not persisted`);
  return created;
}

export async function findComment(commentId: string) {
  return getDb().query.billComments.findFirst({
    where: eq(schema.billComments.commentId, commentId),
  });
}

/** Comments for a law; `includeHidden` only for moderation surfaces. */
export async function commentsForLaw(
  lawId: string,
  opts: { includeHidden?: boolean; limit?: number } = {},
) {
  const rows = await getDb()
    .select()
    .from(schema.billComments)
    .where(eq(schema.billComments.lawId, lawId))
    .orderBy(desc(schema.billComments.createdAt))
    .limit(Math.min(opts.limit ?? 200, 500));
  if (opts.includeHidden) return rows;
  return rows.filter((r) => r.status !== "hidden");
}

export async function setCommentStatus(
  commentId: string,
  status: schema.CommentStatus,
) {
  await getDb()
    .update(schema.billComments)
    .set({ status })
    .where(eq(schema.billComments.commentId, commentId));
  return findComment(commentId);
}
