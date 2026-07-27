import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/**
 * PII redaction on free-text LLM-bound inputs (AI-11, docs/SECURITY.md).
 * Applied to sensitive free-text keys (query/question/prompt) before they
 * reach the AI bridge; document/field-data ingestion and audit payloads are
 * redacted in the event consumers (api/consumers.ts). Only redaction COUNTS
 * are ever logged — never the PII itself. Disable with PII_REDACTION=off.
 */
const PII_INPUT_KEYS = new Set(["query", "question", "prompt"]);

const redactPiiInputs = t.middleware(async (opts) => {
  const { next } = opts;
  if (process.env.PII_REDACTION === "off") return next();
  const rawInput = await opts.getRawInput();
  if (!rawInput || typeof rawInput !== "object") return next();
  const { redactText, logRedactionEvent } = await import("./utils/pii");
  const input = { ...(rawInput as Record<string, unknown>) };
  for (const key of Object.keys(input)) {
    if (PII_INPUT_KEYS.has(key) && typeof input[key] === "string") {
      const r = redactText(input[key] as string);
      if (r.total > 0) {
        input[key] = r.text;
        logRedactionEvent(`trpc.input.${key}`, r.counts);
      }
    }
  }
  return next({ getRawInput: async () => input });
});

export const publicQuery = t.procedure.use(redactPiiInputs);

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(redactPiiInputs).use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));
