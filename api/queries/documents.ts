import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import type { ReviewState } from "@contracts/entities";
import { getDb } from "./connection";

export async function updateDocumentState(
  documentId: string,
  reviewState: ReviewState,
) {
  await getDb()
    .update(schema.policyDocuments)
    .set({ reviewState })
    .where(eq(schema.policyDocuments.documentId, documentId));
}
