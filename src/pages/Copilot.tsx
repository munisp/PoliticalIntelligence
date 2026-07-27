import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database,
  FlaskConical,
  Landmark,
  Scale,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import {
  payloadMeta,
  unwrapData,
  type RouterOutputs,
} from "@/components/legislation/types";
import { useOnlineStatus } from "@/hooks/use-pwa";
import ConversationRail from "@/components/copilot/ConversationRail";
import MessageThread from "@/components/copilot/MessageThread";
import Composer from "@/components/copilot/Composer";
import EvidencePanel, {
  type ContextEntity,
  type EvidenceTab,
} from "@/components/copilot/EvidencePanel";
import type {
  AnswerMeta,
  ChatMessage,
  Conversation,
  EvidenceItem,
  EvidenceSourceType,
} from "@/components/copilot/types";
import { uid } from "@/components/copilot/types";

const STORAGE_KEY = "meridian.copilot.conversations.v1";
const JURISDICTION_ID = "jur:ng-kd";
const JURISDICTION_LABEL = "Kaduna State";

const REFUSAL_PATTERN =
  /\b(approve|approval|publish|sign[ -]?off|auto[ -]?publish|enact)\b/i;

const PHASES = [
  "Searching sources…",
  "Reading retrieved documents…",
  "Assembling answer…",
];

const SUGGESTED = [
  {
    role: "Executive",
    Icon: Landmark,
    prompt: "Which sectors are furthest from their job targets?",
  },
  {
    role: "Policy analyst",
    Icon: FlaskConical,
    prompt: "Compare SME credit uptake scenarios from last month",
  },
  {
    role: "Legal analyst",
    Icon: Scale,
    prompt: "What does the Procurement Law say about SME set-asides?",
  },
  {
    role: "Data steward",
    Icon: Database,
    prompt: "Which sources feeding the education model are stale?",
  },
];

const SECTOR_KEYWORDS: [RegExp, string][] = [
  [/\beducation\b|school|teacher/i, "Education"],
  [/\bsme\b|business|formaliz/i, "SME Formation"],
  [/procurement|tender|contract/i, "Public Procurement"],
  [/agro|farm/i, "Agro-processing"],
  [/digital|ict/i, "Digital Services"],
];

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function deriveEntities(messages: ChatMessage[]): ContextEntity[] {
  const text = messages.map((m) => m.content).join(" ");
  const entities: ContextEntity[] = [
    { label: JURISDICTION_LABEL, kind: "jurisdiction" },
  ];
  for (const [re, label] of SECTOR_KEYWORDS) {
    if (re.test(text)) entities.push({ label, kind: "sector" });
  }
  if (/procurement (law|act)|ppa 2007/i.test(text))
    entities.push({ label: "Public Procurement Act 2007", kind: "instrument" });
  if (/cama|companies and allied/i.test(text))
    entities.push({ label: "CAMA 2020", kind: "instrument" });
  return entities;
}

export default function Copilot() {
  const online = useOnlineStatus();
  const utils = trpc.useUtils();
  const [searchParams, setSearchParams] = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(
    searchParams.get("c"),
  );
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [panelTab, setPanelTab] = useState<EvidenceTab>("bundle");
  const [bundleFor, setBundleFor] = useState<string | null>(null); // message id
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const cancelledRef = useRef(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  /* Persist conversations (strip in-flight streaming state). */
  useEffect(() => {
    const serialisable = conversations.map((c) => ({
      ...c,
      messages: c.messages.filter((m) => !m.streaming),
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable));
    } catch {
      /* storage full — conversations stay in memory */
    }
  }, [conversations]);

  const patchMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setConversations((cs) =>
        cs.map((c) =>
          c.id !== conversationId
            ? c
            : {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, ...patch } : m,
                ),
              },
      ),
      );
    },
    [],
  );

  const newConversation = useCallback((): string => {
    const id = uid("conv");
    setConversations((cs) => [
      {
        id,
        title: "New conversation",
        jurisdiction: JURISDICTION_LABEL,
        createdAt: new Date().toISOString(),
        messages: [],
      },
      ...cs,
    ]);
    setActiveId(id);
    setSearchParams({ c: id }, { replace: true });
    return id;
  }, [setSearchParams]);

  /* ---------------- Ask flow ---------------- */
  const send = useCallback(
    async (text: string, deepAnalysis: boolean) => {
      if (sending) return;
      const convId = activeId ?? newConversation();
      const scopedText = entityFilter
        ? `${text} (scope: ${entityFilter})`
        : text;

      const userMsg: ChatMessage = {
        id: uid("msg"),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      const assistantId = uid("msg");

      setConversations((cs) =>
        cs.map((c) =>
          c.id !== convId
            ? c
            : {
                ...c,
                title:
                  c.messages.length === 0
                    ? text.slice(0, 60) + (text.length > 60 ? "…" : "")
                    : c.title,
                messages: [...c.messages, userMsg],
              },
        ),
      );

      /* Guardrail: refusal-pattern card for action requests. */
      if (REFUSAL_PATTERN.test(text)) {
        const refusal: ChatMessage = {
          id: assistantId,
          role: "assistant",
          refusal: true,
          content:
            "I can't approve, publish, or sign off outputs — the copilot is read-only and advisory. Route this through the approval workflow, where a legal analyst or executive reviews and signs off.",
          createdAt: new Date().toISOString(),
        };
        setConversations((cs) =>
          cs.map((c) =>
            c.id === convId ? { ...c, messages: [...c.messages, refusal] } : c,
          ),
        );
        return;
      }

      /* Streaming placeholder + retrieval phases. */
      setSending(true);
      cancelledRef.current = false;
      setPhase(PHASES[0]);
      const phaseTimer = setInterval(() => {
        setPhase((p) => (p === PHASES[0] ? PHASES[1] : p));
      }, 1400);
      setConversations((cs) =>
        cs.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    id: assistantId,
                    role: "assistant",
                    content: "",
                    createdAt: new Date().toISOString(),
                    streaming: true,
                  } satisfies ChatMessage,
                ],
              }
            : c,
        ),
      );

      try {
        const raw = await utils.search.ask.fetch({
          q: scopedText,
          jurisdiction_id: JURISDICTION_ID,
          evidence_ids: [...pinnedIds].slice(0, 10),
        });
        const data = unwrapData<RouterOutputs["search"]["ask"]["data"]>(raw);
        const requestId = payloadMeta(raw)?.request_id ?? null;

        /* Hydrate the evidence bundle for cited sources. */
        const evidence: EvidenceItem[] = await Promise.all(
          data.citations.map(async (cit): Promise<EvidenceItem> => {
            try {
              const evRaw = await utils.search.evidence.fetch({
                evidence_source_id: cit.evidence_source_id,
              });
              const ev = unwrapData<RouterOutputs["search"]["evidence"]["data"]>(evRaw);
              return {
                id: ev.evidenceSourceId,
                citation: ev.citation,
                sourceType: ev.sourceType as EvidenceSourceType,
                confidence: ev.confidence,
                excerpt: ev.contentExcerpt,
                retrievalPath: ev.retrievalPath,
                createdAt: ev.createdAt
                  ? new Date(ev.createdAt).toISOString()
                  : null,
              };
            } catch {
              return {
                id: cit.evidence_source_id,
                citation: cit.citation,
                sourceType: "document",
                confidence: 0.5,
                excerpt: null,
                retrievalPath: null,
                createdAt: null,
              };
            }
          }),
        );

        if (cancelledRef.current) return;

        /* Token-by-token streaming reveal. */
        setPhase(PHASES[2]);
        clearInterval(phaseTimer);
        const tokens = data.answer.split(/(\s+)/);
        let revealed = "";
        for (let i = 0; i < tokens.length; i += 4) {
          if (cancelledRef.current) return;
          revealed = tokens.slice(0, i + 4).join("");
          patchMessage(convId, assistantId, { content: revealed });
          await new Promise((r) => setTimeout(r, 36));
        }

        const answer: AnswerMeta = {
          confidence: data.confidence,
          bridge: data.bridge,
          requestId,
          evidence,
          deepAnalysis,
          uncertainty: {
            lowConfidenceSources: evidence.filter((e) => e.confidence < 0.6)
              .length,
            totalSources: evidence.length,
            fallbackEngine: data.bridge === "fallback",
            modelAgreement: Math.min(
              0.98,
              Math.max(0.2, 0.35 + data.confidence * 0.6),
            ),
          },
        };
        patchMessage(convId, assistantId, {
          content: data.answer,
          streaming: false,
          answer,
        });
        setBundleFor(assistantId);
      } catch (err) {
        if (cancelledRef.current) return;
        patchMessage(convId, assistantId, {
          content:
            "The copilot could not assemble an answer — retrieval failed. " +
            `(${err instanceof Error ? err.message : "unknown error"}). ` +
            "Check connectivity and data-source health, then try again.",
          streaming: false,
          answer: {
            confidence: 0,
            bridge: "fallback",
            requestId: null,
            evidence: [],
            deepAnalysis,
            uncertainty: {
              lowConfidenceSources: 0,
              totalSources: 0,
              fallbackEngine: true,
              modelAgreement: 0,
            },
          },
        });
      } finally {
        clearInterval(phaseTimer);
        setPhase(null);
        setSending(false);
      }
    },
    [sending, activeId, newConversation, entityFilter, pinnedIds, patchMessage, utils],
  );

  /* Deep-linked prefill (?q=) — auto-send once. */
  const askedRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !askedRef.current && online) {
      askedRef.current = true;
      setSearchParams(activeId ? { c: activeId } : {}, { replace: true });
      void send(q, false);
    }
  }, [searchParams, online, send, activeId, setSearchParams]);

  useEffect(() => () => {
    cancelledRef.current = true;
  }, []);

  /* ---------------- Derived panel state ---------------- */
  const bundleMessage = useMemo(() => {
    if (!active) return null;
    if (bundleFor) {
      const m = active.messages.find((x) => x.id === bundleFor);
      if (m?.answer) return m;
    }
    const last = [...active.messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.answer && !m.streaming);
    return last ?? null;
  }, [active, bundleFor]);

  const bundle = bundleMessage?.answer?.evidence ?? [];
  const entities = useMemo(
    () => deriveEntities(active?.messages ?? []),
    [active],
  );

  /* ---------------- Actions ---------------- */
  const onPinSource = useCallback((item: EvidenceItem) => {
    setHighlightId(item.id);
    setPanelCollapsed(false);
    setPanelTab("bundle");
  }, []);

  const onTogglePin = useCallback((id: string) => {
    setPinnedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onOpenBundle = useCallback((messageId: string) => {
    setBundleFor(messageId);
    setPanelCollapsed(false);
    setPanelTab("bundle");
  }, []);

  const onFeedback = useCallback(
    (messageId: string, v: "up" | "down") => {
      if (!active) return;
      const msg = active.messages.find((m) => m.id === messageId);
      if (!msg?.answer) return;
      patchMessage(active.id, messageId, {
        answer: { ...msg.answer, feedback: v },
      });
    },
    [active, patchMessage],
  );

  const exportMemo = useCallback(() => {
    if (!active) return;
    const generated = new Date().toISOString();
    const sources = bundle
      .map(
        (e, i) =>
          `<li>[${i + 1}] ${e.citation} — relevance ${e.confidence.toFixed(2)} (${e.sourceType})</li>`,
      )
      .join("\n");
    const transcript = active.messages
      .map((m) =>
        m.role === "user"
          ? `<p><strong>Q:</strong> ${m.content}</p>`
          : `<p><strong>A:</strong> ${m.content}</p>`,
      )
      .join("\n");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Copilot memo section</title>
<style>body{font-family:Georgia,serif;color:#111827;max-width:720px;margin:40px auto;line-height:1.6}footer{font-family:monospace;font-size:11px;color:#4b5563;margin-top:32px;border-top:1px solid #d1d5db;padding-top:8px}</style>
</head><body>
<h1>Copilot memo section — ${active.title}</h1>
<p><em>Advisory only — copilot answers are never auto-published. Human review required.</em></p>
${transcript}
<h2>Numbered source list</h2>
<ol>${sources}</ol>
<footer>Generated ${generated}${bundleMessage?.answer?.requestId ? ` · Request ID ${bundleMessage.answer.requestId}` : ""} · Jurisdiction ${active.jurisdiction}</footer>
</body></html>`;
    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "copilot-memo-section.doc";
    a.click();
    URL.revokeObjectURL(url);
  }, [active, bundle, bundleMessage]);

  /* ---------------- Render ---------------- */
  return (
    <div className="flex flex-col lg:h-[calc(100dvh-88px)]">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="mb-4"
      >
        <p className="caption-label text-ink-muted">
          Kaduna State · Grounded decision support
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-ink-primary md:text-[32px] md:leading-10">
            Copilot
          </h1>
          <p className="rounded-full border border-ink-subtle bg-ink-surface px-3 py-1 text-xs text-ink-secondary">
            Read-only · never publishes · hybrid retrieval (SQL + vector + graph)
          </p>
        </div>
      </motion.header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:overflow-hidden">
        <div className="max-lg:max-h-[320px] max-lg:overflow-hidden max-lg:rounded-md max-lg:border max-lg:border-ink-subtle">
          <ConversationRail
            conversations={conversations}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              setSearchParams({ c: id }, { replace: true });
            }}
            onNew={newConversation}
            collapsed={railCollapsed}
            onToggleCollapsed={() => setRailCollapsed((v) => !v)}
          />
        </div>

        {/* Chat canvas */}
        <div className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-ink-subtle bg-ink-surface lg:min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[860px] px-4 py-6 md:px-6">
              {!active || active.messages.length === 0 ? (
                /* Empty state — suggested prompts */
                <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                  <img
                    src="/logo-mark.svg"
                    alt=""
                    width={56}
                    height={56}
                    className="opacity-90"
                  />
                  <h2 className="mt-4 text-xl font-semibold text-ink-primary">
                    Ask with evidence
                  </h2>
                  <p className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-secondary">
                    Answers cite their sources and show confidence. Copilot never
                    publishes or approves.
                  </p>
                  <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
                    {SUGGESTED.map((s, i) => (
                      <motion.button
                        key={s.prompt}
                        type="button"
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + i * 0.08, duration: 0.24 }}
                        whileHover={{ y: -3 }}
                        onClick={() => void send(s.prompt, false)}
                        disabled={!online || sending}
                        className="rounded-md border border-ink-subtle bg-ink-elevated p-3.5 text-left transition-colors hover:border-civic/50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="caption-label flex items-center gap-1.5 text-civic">
                          <s.Icon aria-hidden className="h-3.5 w-3.5" />
                          {s.role}
                        </span>
                        <span className="mt-1.5 block text-[13px] font-medium leading-5 text-ink-primary">
                          {s.prompt}
                        </span>
                      </motion.button>
                    ))}
                  </div>
                  {!online && (
                    <p
                      role="status"
                      className="mt-4 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-xs font-medium text-status-warning"
                    >
                      Offline — copilot requires connectivity; cached
                      conversations remain readable.
                    </p>
                  )}
                </div>
              ) : (
                <MessageThread
                  messages={active.messages}
                  phaseCaption={phase}
                  onPinSource={onPinSource}
                  onOpenBundle={onOpenBundle}
                  onFeedback={onFeedback}
                />
              )}
            </div>
          </div>

          <Composer
            online={online}
            sending={sending}
            pinnedCount={pinnedIds.size}
            onSend={(text, deep) => void send(text, deep)}
          />
        </div>

        <div className="max-lg:max-h-[480px] max-lg:overflow-hidden max-lg:rounded-md max-lg:border max-lg:border-ink-subtle">
          <EvidencePanel
            collapsed={panelCollapsed}
            onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
            tab={panelTab}
            onTabChange={setPanelTab}
            bundle={bundle}
            requestId={bundleMessage?.answer?.requestId ?? null}
            pinnedIds={pinnedIds}
            onTogglePin={onTogglePin}
            highlightId={highlightId}
            entities={entities}
            activeEntityFilter={entityFilter}
            onToggleEntityFilter={(label) =>
              setEntityFilter((cur) => (cur === label ? null : label))
            }
            onExportMemo={exportMemo}
            canExport={!!active && active.messages.length > 0}
          />
        </div>
      </div>

      {/* Offline indicator for the thread */}
      <AnimatePresence>
        {!online && active && active.messages.length > 0 && (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-md border border-status-warning/40 bg-ink-elevated px-4 py-2 text-[13px] text-status-warning shadow-overlay"
          >
            <Sparkles aria-hidden className="mr-1.5 inline h-3.5 w-3.5" />
            Offline — showing cached conversation. New questions need
            connectivity.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
