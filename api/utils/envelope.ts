import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import {
  API_VERSION,
  type Envelope,
  type EnvelopeMeta,
  type ErrorEnvelope,
  EventTopics,
} from "@contracts/entities";
import type { TrpcContext } from "../context";
import { insertAuditEvent } from "../queries/audit";

const requestIds = new WeakMap<TrpcContext["req"], EnvelopeMeta>();

/** Stable per-request meta (request_id / correlation_id), lazily generated. */
export function requestMeta(ctx: TrpcContext): EnvelopeMeta {
  let meta = requestIds.get(ctx.req);
  if (!meta) {
    const incoming = ctx.req.headers.get("x-correlation-id");
    meta = {
      request_id: `req_${nanoid(16)}`,
      correlation_id: incoming ?? `cor_${nanoid(16)}`,
      api_version: API_VERSION,
    };
    requestIds.set(ctx.req, meta);
  }
  return meta;
}

/** Standard response envelope (design.md §9). */
export function envelope<T>(data: T, ctx: TrpcContext): Envelope<T> {
  return {
    data,
    meta: requestMeta(ctx),
    audit: {
      actor_id: ctx.user?.id ?? null,
      generated_at: new Date(),
    },
  };
}

/**
 * Build a TRPCError whose `cause` carries the standard error envelope
 * {code, message, request_id, retryable, details}.
 */
export function apiError(
  ctx: TrpcContext,
  opts: {
    http:
      | "BAD_REQUEST"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INTERNAL_SERVER_ERROR";
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  },
): TRPCError {
  const cause: ErrorEnvelope = {
    code: opts.code,
    message: opts.message,
    request_id: requestMeta(ctx).request_id,
    retryable: opts.retryable ?? false,
    ...(opts.details !== undefined ? { details: opts.details } : {}),
  };
  return new TRPCError({
    code: opts.http,
    message: opts.message,
    cause,
  });
}

export type AuditEntity = {
  type: string;
  id: string;
  /** Authorization scopes touched, e.g. ["briefs:write"]. */
  scopes?: string[];
  /** Extra payload stored with the event. */
  payload?: unknown;
};

/**
 * Fire-and-forget audit event writer (append-only audit_events table).
 * Never throws into the request path; failures are logged to stderr.
 */
export function audit(
  ctx: TrpcContext,
  action: string,
  entity: AuditEntity,
): void {
  const meta = requestMeta(ctx);
  insertAuditEvent({
    actorId: ctx.user?.id ?? null,
    action,
    entityType: entity.type,
    entityId: entity.id,
    scopes: entity.scopes ?? null,
    requestId: meta.request_id,
    correlationId: meta.correlation_id,
    payload: {
      topic: EventTopics.auditEvents,
      ...(entity.payload !== undefined ? { data: entity.payload } : {}),
    },
  }).catch((err) => {
    console.error(`[audit] failed to record ${action}:`, err);
  });
}
