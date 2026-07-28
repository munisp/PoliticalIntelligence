import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  Cpu,
  Scale,
  Server,
  LayoutDashboard,
  Compass,
  FlaskConical,
  FileText,
  HeartPulse,
  ShieldCheck,
  Landmark,
  GitBranch,
  Download,
  type LucideIcon,
} from "lucide-react";
import Footer from "@/components/Footer";
import ConfidenceChip from "@/components/shared/ConfidenceChip";
import ApprovalBadge from "@/components/shared/ApprovalBadge";
import MapPanel, { type LgaDatum } from "@/components/shared/MapPanel";
import { useInstallPrompt } from "@/hooks/use-pwa";
import { cn } from "@/lib/utils";
import { LOGIN_PATH } from "@/const";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

const DEMO_ROLES = [
  "Governor · Executive",
  "Policy Analyst",
  "Legal Analyst",
  "Simulation Specialist",
  "Data Steward",
  "Platform Administrator",
] as const;

const PILOT_LGAS: LgaDatum[] = [
  { id: "chikun", name: "Chikun", value: 0.86, hotspot: true },
  { id: "kaduna-north", name: "Kaduna North", value: 0.82, hotspot: true },
  { id: "kaduna-south", name: "Kaduna South", value: 0.78 },
  { id: "igabi", name: "Igabi", value: 0.71 },
  { id: "zaria", name: "Zaria", value: 0.74 },
  { id: "sabon-gari", name: "Sabon Gari", value: 0.66 },
  { id: "kajuru", name: "Kajuru", value: 0.58 },
  { id: "kachia", name: "Kachia", value: 0.61 },
  { id: "jema-a", name: "Jema'a", value: 0.63 },
  { id: "kaura", name: "Kaura", value: 0.55 },
  { id: "birnin-gwari", name: "Birnin Gwari", value: 0.41 },
  { id: "giwa", name: "Giwa", value: 0.52 },
  { id: "ikara", name: "Ikara", value: 0.48 },
  { id: "kubau", name: "Kubau", value: 0.44 },
  { id: "lere", name: "Lere", value: 0.5 },
  { id: "soba", name: "Soba", value: 0.46 },
];

const PILLARS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: LayoutDashboard,
    title: "Executive dashboard",
    body: "Job targets, sector highlights, and risks on one page — memo-ready.",
  },
  {
    Icon: Compass,
    title: "Opportunity explorer",
    body: "Ranked, scored, and mapped opportunities with confidence and evidence.",
  },
  {
    Icon: Scale,
    title: "Policy & legislation workbench",
    body: "Clause-level retrieval, dependency paths, citation trace, drafting support.",
  },
  {
    Icon: FlaskConical,
    title: "Simulation studio",
    body: "Six engines, seeded and auditable: forecast, causal, microsimulation, ABM, system dynamics, optimization.",
  },
  {
    Icon: FileText,
    title: "Executive briefs",
    body: "Structured briefs with approval handoff, presentation and print outputs.",
  },
  {
    Icon: HeartPulse,
    title: "Data health",
    body: "Pipeline freshness, source contracts, review queues — trust you can inspect.",
  },
];

const EVIDENCE_STAGES = [
  {
    key: "confidence",
    title: "Confidence — a score, not a shrug.",
    body: "Every recommendation carries a calibrated confidence score with evidence count, freshness, and model agreement — never a bare number.",
  },
  {
    key: "provenance",
    title: "Provenance — every figure links back.",
    body: "Each figure links to source documents, datasets, and full lineage: source → ingest → model → review → output.",
  },
  {
    key: "approval",
    title: "Approval — never auto-published.",
    body: "Policy and legal outputs pass through human review and sign-off before they can leave the platform.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */

function LandingNav() {
  const { canInstall, install } = useInstallPrompt();
  const links = [
    { label: "Platform", href: "#platform" },
    { label: "Evidence", href: "#evidence" },
    { label: "Simulation", href: "#platform" },
    { label: "Security", href: "#security" },
    { label: "Pilot", href: "#pilot" },
  ];
  return (
    <nav
      aria-label="Landing"
      className="fixed inset-x-0 top-0 z-40 flex h-[72px] items-center border-b border-ink-subtle bg-ink-base/80 px-6 backdrop-blur-md"
    >
      <Link to="/" className="flex items-center gap-2.5">
        <img src="/logo-mark.svg" alt="" className="h-9 w-9" />
        <span className="leading-tight">
          <span className="caption-label block text-[10px] text-ink-muted">
            MERIDIAN
          </span>
          <span className="block text-sm font-semibold text-ink-primary">
            Policy Twin
          </span>
        </span>
      </Link>
      <div className="mx-auto hidden items-center gap-6 lg:flex">
        {links.map((l) => (
          <a
            key={l.label}
            href={l.href}
            className="text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink-primary"
          >
            {l.label}
          </a>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2 lg:ml-0">
        {canInstall && (
          <button
            type="button"
            onClick={() => void install()}
            className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-civic hover:bg-ink-elevated sm:inline-flex"
          >
            <Download aria-hidden className="h-4 w-4" />
            Install Meridian
          </button>
        )}
        <Link
          to={LOGIN_PATH}
          className="rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-secondary hover:bg-ink-elevated hover:text-ink-primary"
        >
          Sign in
        </Link>
        <a
          href="#cta"
          className="rounded-md bg-civic px-3.5 py-1.5 text-[13px] font-medium text-ink-base transition-all hover:bg-civic-strong active:scale-[0.98]"
        >
          Request pilot briefing
        </a>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Hero preview cards                                                  */
/* ------------------------------------------------------------------ */

function MiniSparkline() {
  return (
    <svg viewBox="0 0 120 36" className="h-9 w-full" aria-hidden>
      <polyline
        points="0,30 15,27 30,28 45,22 60,20 75,14 90,12 105,7 120,4"
        fill="none"
        stroke="#3FAE9E"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniBand() {
  return (
    <svg viewBox="0 0 240 80" className="h-20 w-full" aria-hidden>
      <path
        d="M0,55 40,50 80,44 120,34 160,28 200,20 240,14 L240,34 200,40 160,48 120,56 80,62 40,68 0,72 Z"
        fill="#3FAE9E"
        fillOpacity="0.12"
      />
      <path
        d="M0,55 40,50 80,44 120,34 160,28 200,20 240,14"
        fill="none"
        stroke="#3FAE9E"
        strokeDasharray="4 3"
        strokeWidth="1"
      />
      <path
        d="M0,72 40,68 80,62 120,56 160,48 200,40 240,34"
        fill="none"
        stroke="#3FAE9E"
        strokeDasharray="4 3"
        strokeWidth="1"
      />
      <path
        d="M0,63 40,59 80,53 120,45 160,38 200,30 240,24"
        fill="none"
        stroke="#3FAE9E"
        strokeWidth="2"
      />
    </svg>
  );
}

function HeroCardStack() {
  return (
    <div className="relative h-[380px] w-full max-w-md">
      <div
        data-hero-card
        className="absolute left-0 top-2 w-[92%] rounded-[10px] border border-ink-subtle bg-ink-elevated/90 p-4 shadow-overlay backdrop-blur"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="caption-label text-ink-muted">Jobs supported YTD</p>
          <ConfidenceChip score={0.86} evidenceCount={14} />
        </div>
        <p className="mt-1 font-mono text-3xl leading-9 text-ink-primary">41,280</p>
        <MiniSparkline />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-status-success">↑ +8.2% vs prior quarter</span>
          <ApprovalBadge state="approved" />
        </div>
      </div>

      <div
        data-hero-card
        className="absolute left-[6%] top-[150px] w-[92%] rounded-[10px] border border-ink-subtle bg-ink-elevated/90 p-4 shadow-overlay backdrop-blur"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-primary">
            Agro-processing clusters
          </p>
          <span className="font-mono text-xs text-civic">Score 0.86</span>
        </div>
        <p className="mt-1 text-xs text-ink-secondary">
          Kaduna North · Zaria · 12,400 jobs potential
        </p>
        <div className="mt-2 flex items-center gap-2">
          <ConfidenceChip score={0.86} evidenceCount={9} />
          <ApprovalBadge state="in-review" />
        </div>
      </div>

      <div
        data-hero-card
        className="absolute left-[12%] top-[270px] w-[92%] rounded-[10px] border border-ink-subtle bg-ink-elevated/90 p-4 shadow-overlay backdrop-blur"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="caption-label text-ink-muted">Jobs forecast — 2027 target</p>
          <ConfidenceChip score={0.71} evidenceCount={22} />
        </div>
        <MiniBand />
        <p className="text-[11px] text-ink-muted">
          80% credible interval · microsimulation engine
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing page                                                        */
/* ------------------------------------------------------------------ */

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [evidenceStage, setEvidenceStage] = useState(0);
  const [demoRole, setDemoRole] = useState<string>("");
  const navigate = useNavigate();

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        /* Hero intro */
        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .from("[data-hero-word]", {
            y: 24,
            opacity: 0,
            stagger: 0.06,
            duration: 0.6,
          })
          .from(
            "[data-hero-fade]",
            { y: 16, opacity: 0, stagger: 0.08, duration: 0.5 },
            0.4,
          )
          .from(
            "[data-hero-card]",
            { y: 40, rotate: -2, opacity: 0, stagger: 0.12, duration: 0.6 },
            0.5,
          );

        /* Stat band count-up */
        gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el, i) => {
          const target = Number(el.dataset.count ?? "0");
          const obj = { v: 0 };
          gsap.from(el, {
            y: 24,
            opacity: 0,
            duration: 0.6,
            delay: i * 0.1,
            scrollTrigger: { trigger: el, start: "top 75%" },
          });
          gsap.to(obj, {
            v: target,
            duration: 1.2,
            ease: "power2.out",
            delay: i * 0.1,
            scrollTrigger: { trigger: el, start: "top 75%" },
            onUpdate: () => {
              el.textContent = Math.round(obj.v).toLocaleString("en-NG");
            },
          });
        });

        /* Pillars stagger */
        gsap.from("[data-pillar]", {
          y: 28,
          opacity: 0,
          stagger: 0.08,
          duration: 0.5,
          ease: "power3.out",
          scrollTrigger: { trigger: "#platform", start: "top 70%" },
        });

        /* Evidence pinned scroll story (200vh) */
        ScrollTrigger.create({
          trigger: "#evidence",
          start: "top top",
          end: "+=200%",
          pin: true,
          onUpdate: (self) => {
            const idx = Math.min(2, Math.floor(self.progress * 3));
            setEvidenceStage(idx);
          },
        });
        gsap.from("[data-evidence-panel]", {
          scale: 0.96,
          opacity: 0.4,
          duration: 0.5,
          scrollTrigger: { trigger: "#evidence", start: "top 60%" },
        });

        /* Pilot panel slide-in */
        gsap.from("[data-pilot-map]", {
          x: 40,
          opacity: 0,
          duration: 0.6,
          ease: "power3.out",
          scrollTrigger: { trigger: "#pilot", start: "top 70%" },
        });
        gsap.from("[data-pilot-text]", {
          y: 24,
          opacity: 0,
          duration: 0.5,
          scrollTrigger: { trigger: "#pilot", start: "top 70%" },
        });

        /* Security band */
        gsap.from("[data-security-item]", {
          y: 24,
          opacity: 0,
          stagger: 0.1,
          duration: 0.5,
          scrollTrigger: { trigger: "#security", start: "top 75%" },
        });

        /* Final CTA */
        gsap.from("[data-cta]", {
          y: 24,
          opacity: 0,
          duration: 0.6,
          scrollTrigger: { trigger: "#cta", start: "top 80%" },
        });
      });
    },
    { scope: rootRef },
  );

  const headline = "Evidence before policy. Simulation before spending.".split(" ");

  const stage = EVIDENCE_STAGES[evidenceStage];

  return (
    <div ref={rootRef} className="relative min-h-[100dvh] bg-ink-base">
      <LandingNav />

      {/* Topo background, 20% opacity, fading out after hero */}
      <div
        aria-hidden
        data-decorative
        className="pointer-events-none fixed inset-0 z-0 opacity-20"
        style={{
          backgroundImage: "url(/auth-topo.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="h-full w-full animate-topo-drift motion-reduce:animate-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-ink-base/40 to-ink-base" />
      </div>

      <div className="relative z-10">
        {/* ---------------- Section 1 — Hero ---------------- */}
        <section className="mx-auto grid min-h-[100dvh] max-w-7xl grid-cols-1 items-center gap-12 px-6 pb-16 pt-[120px] lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p
              data-hero-fade
              className="caption-label text-civic"
            >
              Jurisdiction Economic Intelligence · Nigeria Pilot
            </p>
            <h1
              className="mt-4 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-ink-primary sm:text-5xl lg:text-[56px]"
              aria-label="Evidence before policy. Simulation before spending."
            >
              {headline.map((word, i) => (
                <span
                  key={i}
                  aria-hidden
                  data-hero-word
                  className="inline-block overflow-hidden pb-1 align-top"
                >
                  <span className="inline-block">{word}&nbsp;</span>
                </span>
              ))}
            </h1>
            <p
              data-hero-fade
              className="mt-5 max-w-[52ch] text-lg leading-8 text-ink-secondary"
            >
              Meridian gives governors and ministries a policy twin of their
              jurisdiction — ranked job-creation opportunities, clause-aware
              legislation analysis, and simulated outcomes — with every number
              traced to its evidence.
            </p>

            <div data-hero-fade className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                to={LOGIN_PATH}
                className="rounded-md bg-civic px-5 py-2.5 text-sm font-semibold text-ink-base transition-all hover:bg-civic-strong active:scale-[0.98]"
              >
                Sign in to the platform
              </Link>
              <Link
                to="/dashboard"
                className="rounded-md border border-ink-strong px-5 py-2.5 text-sm font-medium text-ink-primary transition-all hover:border-civic/60 hover:bg-ink-elevated active:scale-[0.98]"
              >
                See the pilot dashboard
              </Link>
              {/* Demo role picker (dev/demo builds) */}
              <label className="flex items-center gap-2">
                <span className="caption-label text-ink-muted">Demo role</span>
                <select
                  value={demoRole}
                  onChange={(e) => {
                    setDemoRole(e.target.value);
                    if (e.target.value) navigate("/dashboard");
                  }}
                  className="rounded-md border border-ink-subtle bg-ink-surface px-2 py-1.5 text-xs text-ink-secondary"
                  aria-label="Explore with a demo role"
                >
                  <option value="">Explore with a demo role…</option>
                  {DEMO_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div
              data-hero-fade
              className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3"
            >
              {[
                { Icon: Cpu, label: "Qwen3 open-weight models" },
                { Icon: Scale, label: "Human review on all legal outputs" },
                { Icon: Server, label: "Deploys on-prem / sovereign cloud" },
              ].map(({ Icon, label }) => (
                <span
                  key={label}
                  className="flex items-center gap-2 font-mono text-xs text-ink-muted"
                >
                  <Icon aria-hidden className="h-4 w-4 text-civic" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5">
            <HeroCardStack />
          </div>
        </section>

        {/* ---------------- Section 2 — Stat band ---------------- */}
        <section className="border-y border-ink-subtle bg-ink-surface">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 py-12 lg:grid-cols-4">
            {[
              { count: 36, suffix: "", top: "states + FCT", label: "Modeled jurisdictions", display: null },
              { count: 774, suffix: "", top: "", label: "LGAs with ward-level spatial analysis", display: null },
              { count: 6, suffix: "", top: "", label: "Simulation engines — forecast → agent-based", display: null },
              { count: 100, suffix: "%", top: "", label: "High-impact outputs carry evidence + approval state", display: null },
            ].map((s, i) => (
              <div key={i}>
                <p className="font-mono text-3xl text-ink-primary lg:text-4xl">
                  <span data-count={s.count}>0</span>
                  {s.suffix}
                  {s.top && (
                    <span className="text-xl text-ink-secondary lg:text-2xl">
                      {" "}
                      {s.top}
                    </span>
                  )}
                </p>
                <p className="mt-2 text-[13px] leading-5 text-ink-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- Section 3 — Capability pillars ---------------- */}
        <section id="platform" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-24">
          <p className="caption-label text-civic">Platform</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.01em] text-ink-primary sm:text-3xl">
            One platform, five decision workflows
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map(({ Icon, title, body }) => (
              <article
                key={title}
                data-pillar
                className="group rounded-md border border-ink-subtle bg-ink-surface p-5 transition-all duration-150 hover:-translate-y-1 hover:border-ink-strong hover:shadow-overlay motion-reduce:hover:translate-y-0"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-ink-subtle bg-ink-elevated transition-transform duration-150 group-hover:-rotate-3 group-hover:border-civic/40">
                  <Icon aria-hidden className="h-5 w-5 text-civic" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink-primary">
                  {title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-ink-secondary">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- Section 4 — Evidence-first pinned story ---------------- */}
        <section id="evidence" className="scroll-mt-20 border-y border-ink-subtle bg-ink-surface">
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 py-20 lg:grid-cols-2">
            <div>
              <p className="caption-label text-civic">Evidence-first</p>
              <h2 className="mt-3 text-2xl font-semibold text-ink-primary sm:text-3xl">
                Every recommendation shows its work.
              </h2>
              <ol className="mt-8 space-y-4">
                {EVIDENCE_STAGES.map((s, i) => (
                  <li
                    key={s.key}
                    className={cn(
                      "border-l-2 pl-4 transition-all duration-200",
                      i === evidenceStage
                        ? "translate-x-0 border-civic opacity-100"
                        : "border-ink-subtle opacity-45",
                    )}
                  >
                    <p className="text-lg font-semibold text-ink-primary">
                      {s.title}
                    </p>
                    {i === evidenceStage && (
                      <p className="mt-1 max-w-[48ch] text-sm leading-6 text-ink-secondary">
                        {s.body}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {/* EvidenceDrawer mock swapping content per stage */}
            <div
              data-evidence-panel
              className="rounded-[10px] border border-ink-subtle bg-ink-elevated p-5 shadow-overlay"
              aria-live="polite"
            >
              <p className="caption-label text-ink-muted">
                Evidence drawer · {stage.key}
              </p>
              {stage.key === "confidence" && (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ink-secondary">
                      Agro-processing clusters recommendation
                    </span>
                    <ConfidenceChip
                      score={0.86}
                      evidenceCount={14}
                      freshness="12 Jan 2025"
                      modelAgreement={0.91}
                    />
                  </div>
                  <div className="space-y-2 rounded-md border border-ink-subtle bg-ink-inset p-3 font-mono text-xs text-ink-secondary">
                    <p>evidence_count … 14 sources</p>
                    <p>freshness …… 12 Jan 2025 (6 days)</p>
                    <p>model_agreement … 0.91 across 3 models</p>
                  </div>
                </div>
              )}
              {stage.key === "provenance" && (
                <ul className="mt-4 space-y-2">
                  {[
                    ["Kaduna State Statistical Yearbook 2024", "KDBS · Dec 2024", "0.94"],
                    ["NBS Labour Force Survey Q3 2024", "National Bureau of Statistics", "0.91"],
                    ["SMEDAN MSME Census", "SMEDAN · 2023", "0.87"],
                    ["State Procurement Records API", "Kaduna BPP · live feed", "0.82"],
                  ].map(([t, m, r]) => (
                    <li
                      key={t}
                      className="flex items-center justify-between gap-2 rounded-md border border-ink-subtle bg-ink-surface p-3"
                    >
                      <span>
                        <span className="block text-[13px] font-medium text-ink-primary">
                          {t}
                        </span>
                        <span className="block text-xs text-ink-muted">{m}</span>
                      </span>
                      <span className="font-mono text-xs text-civic">{r}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-1.5 pt-1 font-mono text-[11px] text-ink-muted">
                    <GitBranch aria-hidden className="h-3.5 w-3.5" />
                    source → ingest → model → review → output
                  </li>
                </ul>
              )}
              {stage.key === "approval" && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-md border border-ink-subtle bg-ink-surface p-3">
                    <span className="text-sm text-ink-primary">
                      Q1 Education brief — v3
                    </span>
                    <ApprovalBadge state="in-review" />
                  </div>
                  <div className="rounded-md border border-ink-subtle bg-ink-surface p-3">
                    <p className="text-xs text-ink-secondary">
                      Next approver:{" "}
                      <span className="font-medium text-ink-primary">
                        Attorney-General's Chambers
                      </span>{" "}
                      · Legal Analyst
                    </p>
                    <div className="mt-2 flex gap-2">
                      <span className="rounded bg-civic/15 px-2 py-1 text-xs text-civic">
                        Approve
                      </span>
                      <span className="rounded bg-status-warning/15 px-2 py-1 text-xs text-status-warning">
                        Return with comments
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-ink-muted">
                    Nothing is auto-published — a person signs off first.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ---------------- Section 5 — Nigeria pilot ---------------- */}
        <section id="pilot" className="mx-auto grid max-w-7xl scroll-mt-20 grid-cols-1 items-center gap-12 px-6 py-24 lg:grid-cols-2">
          <div data-pilot-text>
            <p className="caption-label text-civic">Reference deployment</p>
            <h2 className="mt-3 text-2xl font-semibold text-ink-primary sm:text-3xl">
              Nigeria pilot — Kaduna State
            </h2>
            <p className="mt-4 max-w-[52ch] text-[15px] leading-7 text-ink-secondary">
              Federal → state → LGA → ward modeling. Pilot sectors: education,
              SME formation, and procurement-led job creation. Target:{" "}
              <span className="font-mono text-ink-primary">250,000</span> new jobs
              by 2027.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {[
                "23 LGAs modeled",
                "Ward-level overlays",
                "Low-bandwidth & offline ready",
                "Multilingual-ready",
              ].map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-ink-subtle bg-ink-surface px-3 py-1 text-xs text-ink-secondary"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </div>
          <div data-pilot-map>
            <MapPanel
              title="Kaduna State — opportunity score by LGA"
              data={PILOT_LGAS}
              legendLabel="Opportunity score"
              presentation
            />
          </div>
        </section>

        {/* ---------------- Section 6 — Security & governance ---------------- */}
        <section id="security" className="scroll-mt-20 border-y border-ink-subtle bg-ink-surface">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-16 md:grid-cols-3">
            {[
              {
                Icon: ShieldCheck,
                title: "RBAC & audit",
                body: "Keycloak-backed roles; immutable audit events on every view, prompt, run, and publication.",
              },
              {
                Icon: Landmark,
                title: "Sovereign deployment",
                body: "Public cloud, private cloud, on-prem; offline-capable PWA.",
              },
              {
                Icon: Cpu,
                title: "Open-source stack",
                body: "No vendor lock-in; engines replaceable behind stable interfaces.",
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} data-security-item className="flex gap-3">
                <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-civic" />
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
                  <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- Section 7 — Final CTA ---------------- */}
        <section id="cta" className="mx-auto max-w-3xl scroll-mt-20 px-6 py-28 text-center">
          <div data-cta>
            <h2 className="text-3xl font-semibold tracking-[-0.01em] text-ink-primary">
              Ready to govern with evidence?
            </h2>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                to={LOGIN_PATH}
                className="animate-pulse-glow rounded-md bg-civic px-6 py-2.5 text-sm font-semibold text-ink-base transition-all hover:bg-civic-strong active:scale-[0.98] motion-reduce:animate-none"
              >
                Sign in
              </Link>
              <a
                href="mailto:pilot@meridian.example"
                className="rounded-md border border-ink-strong px-6 py-2.5 text-sm font-medium text-ink-primary transition-all hover:border-civic/60 hover:bg-ink-elevated active:scale-[0.98]"
              >
                Request pilot briefing
              </a>
            </div>
            <p className="caption-label mt-6 text-ink-muted">
              Authorized users only · All sessions audited
            </p>
          </div>
        </section>

        <Footer />
      </div>
    </div>
  );
}
