export type EvidenceSourceType = "sql" | "vector" | "graph" | "document";

export interface EvidenceItem {
  id: string;
  citation: string;
  sourceType: EvidenceSourceType;
  /** Retrieval relevance / confidence, 0–1. */
  confidence: number;
  excerpt: string | null;
  retrievalPath: string | null;
  createdAt: string | null;
}

export interface UncertaintyFactors {
  lowConfidenceSources: number;
  totalSources: number;
  fallbackEngine: boolean;
  modelAgreement: number;
}

export interface AnswerMeta {
  confidence: number;
  bridge: "remote" | "fallback";
  requestId: string | null;
  evidence: EvidenceItem[];
  deepAnalysis: boolean;
  feedback?: "up" | "down";
  uncertainty: UncertaintyFactors;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Refusal-pattern card (guardrail) rather than a grounded answer. */
  refusal?: boolean;
  content: string;
  createdAt: string;
  /** Present only once the answer has finished streaming. */
  answer?: AnswerMeta;
  streaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  jurisdiction: string;
  createdAt: string;
  messages: ChatMessage[];
}

export const SOURCE_TYPE_LABELS: Record<EvidenceSourceType, string> = {
  sql: "SQL",
  vector: "Vector",
  graph: "Graph",
  document: "Docs",
};

export const SOURCE_TYPE_CHIP: Record<EvidenceSourceType, string> = {
  sql: "Dataset",
  vector: "Document",
  graph: "Legal clause",
  document: "Document",
};

/** Model tier chip label from routing metadata. */
export function modelTierLabel(bridge: "remote" | "fallback", deep: boolean): string {
  if (bridge === "fallback") return "offline fallback engine";
  return deep ? "deepseek-r1 · specialist tier" : "qwen3-32b";
}

export function uid(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
