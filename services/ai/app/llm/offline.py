"""Deterministic offline synthesizer (spec section 9.2 Recommendation contract).

When no LLM endpoint is configured (or all tiers fail), this module assembles
the structured Recommendation contract from the fused evidence bundle plus
deterministic templates — the platform remains fully functional without GPUs.
Every output carries model_routing metadata, evidence references and a
confidence score (explainability requirement).
"""
from __future__ import annotations

import re
import uuid

from app.data import corpus
from app.models import (BudgetRange, CopilotAnswer, EvidenceBundle,
                        EvidenceSource, KPI, Recommendation, RiskItem,
                        RoutingMetadata, SimulationScenarioRef, TimelinePhase)

_SECTOR_KEYWORDS: dict[str, list[str]] = {
    "education": ["education", "teacher", "school", "student", "classroom"],
    "sme": ["sme", "msme", "business", "enterprise", "credit", "firm"],
    "procurement": ["procurement", "contract", "tender", "bidding"],
    "agriculture": ["agriculture", "farm", "crop", "extension", "irrigation"],
    "health": ["health", "clinic", "hospital", "immunization"],
    "electricity": ["electricity", "power", "grid", "energy", "mini-grid"],
}

# Deterministic sector playbook templates.
_PLAYBOOKS: dict[str, dict] = {
    "education": {
        "title": "Teacher Recruitment & School-Meal Jobs Programme",
        "jobs_per_10k_pop": 9,
        "budget_low_per_job": 1.4,   # NGN m per job-year
        "budget_high_per_job": 2.2,
        "actors": ["State Ministry of Education", "SUBEB",
                   "Teachers Registration Council of Nigeria (TRCN)",
                   "State Teachers Service Board", "LGAs"],
        "legal": ["UBE Act 2004 s.2 & s.15 (funding via UBE Intervention Fund)",
                  "TRCN Act Cap T3 LFN 2004 — licensing requirement",
                  "State Education Law — teacher standards"],
        "risks": [
            ("Payroll ghost-worker leakage", "medium", "high",
             "Biometric verification tied to TRCN licence registry"),
            ("Unlicensed recruits blocked by TRCN rule", "high", "medium",
             "Pre-screen candidates against TRCN register; fund licensing bootcamps"),
            ("School-meal supply chain disruption", "medium", "medium",
             "Contract multiple local smallholder aggregators"),
        ],
        "kpis": [("Licensed teachers hired", "fill 60% of teacher gap in 24 months",
                  "SUBEB payroll vs TRCN registry"),
                 ("Pupil-teacher ratio", "≤ 40:1 in rural LGAs", "EMIS annual census"),
                 ("School-meal jobs created", "≥ 2 cooks per 500 pupils",
                  "NHGSFP monitoring")],
        "phases": [("Design & legal clearance", 3,
                    ["TRCN licensing pathway", "UBE fund disbursement MOU"]),
                   ("Pilot in 3 LGAs", 6, ["1,000 teachers hired", "meal vendors onboarded"]),
                   ("Statewide scale-up", 15, ["Full hiring wave", "KPI dashboard live"])],
    },
    "sme": {
        "title": "MSME Credit Guarantee & Formalization Drive",
        "jobs_per_10k_pop": 7,
        "budget_low_per_job": 1.1,
        "budget_high_per_job": 1.9,
        "actors": ["SMEDAN", "State Investment Promotion Agency",
                   "Commercial banks & MFBs", "CAC"],
        "legal": ["SMEDAN Act 2003 s.6 — MSME registration mandate",
                  "Public Procurement Act 2007 — vendor prequalification"],
        "risks": [
            ("Credit default in informal sector", "high", "high",
             "Partial guarantee (60%) with first-loss fund; registry-verified borrowers"),
            ("Low registration take-up", "medium", "medium",
             "Bundle registration with market-association onboarding drives"),
        ],
        "kpis": [("MSMEs newly registered", "+25% in 18 months", "SMEDAN/CAC register"),
                 ("Jobs preserved/created", "per credit-guarantee portfolio audit",
                  "Bank-reported employment schedules")],
        "phases": [("Guarantee fund setup", 4, ["Fund capitalized", "MOU with lenders"]),
                   ("Portfolio ramp", 12, ["First 5,000 MSME loans"]),
                   ("Evaluation & scale", 8, ["Independent impact audit"])],
    },
    "procurement": {
        "title": "Open Contracting & Local Supplier Development",
        "jobs_per_10k_pop": 3,
        "budget_low_per_job": 0.9,
        "budget_high_per_job": 1.6,
        "actors": ["Bureau of Public Procurement / Due Process Bureau",
                   "State Ministry of Finance", "Supplier associations"],
        "legal": ["Public Procurement Act 2007 s.5 & s.16 — open competitive bidding",
                  "State Public Procurement Law — due process certification"],
        "risks": [
            ("Elite capture of contract awards", "medium", "high",
             "Publish all award data in OCDS format; civil-society monitoring"),
        ],
        "kpis": [("Contracts published openly", "100% above threshold",
                  "Open contracting portal"),
                 ("Local SME share of awards", "≥ 30% by value",
                  "BPP award database")],
        "phases": [("Portal & legal rules", 4, ["OCDS portal live"]),
                   ("Supplier onboarding", 8, ["2,000 local vendors registered"])],
    },
    "agriculture": {
        "title": "Agricultural Extension & Value-Chain Employment",
        "jobs_per_10k_pop": 8,
        "budget_low_per_job": 0.8,
        "budget_high_per_job": 1.5,
        "actors": ["State Ministry of Agriculture", "ADP", "FMARD",
                   "Smallholder cooperatives"],
        "legal": ["FMARD Agricultural Extension Revitalization Policy (2021)"],
        "risks": [
            ("Seasonal attrition of extension workers", "medium", "medium",
             "Staggered contracts aligned to cropping calendar"),
        ],
        "kpis": [("Extension worker density", "1 per 800 households",
                  "ADP staffing register"),
                 ("Yield improvement", "+18% for covered farmers", "Seasonal crop surveys")],
        "phases": [("Recruitment & training", 5, ["500 extension workers certified"]),
                   ("Field deployment", 12, ["Coverage of priority value chains"])],
    },
    "health": {
        "title": "Primary Healthcare Workforce Expansion",
        "jobs_per_10k_pop": 4,
        "budget_low_per_job": 1.6,
        "budget_high_per_job": 2.6,
        "actors": ["State Ministry of Health", "PHC Development Agency", "NPHCDA"],
        "legal": ["National Health Act 2014 — Basic Health Care Provision Fund"],
        "risks": [("Health worker migration (japa)", "high", "high",
                   "Retention allowances + training bonds")],
        "kpis": [("PHC facilities fully staffed", "≥ 80%", "HRH registry")],
        "phases": [("Workforce mapping", 3, ["Gap analysis published"]),
                   ("Recruitment wave", 9, ["First 2,000 CHEWs deployed"])],
    },
    "electricity": {
        "title": "Mini-Grid Electrification for Productive Use",
        "jobs_per_10k_pop": 5,
        "budget_low_per_job": 2.0,
        "budget_high_per_job": 3.4,
        "actors": ["State Electricity Board", "Rural Electrification Agency",
                   "Private mini-grid developers"],
        "legal": ["Electricity Act 2023 — state electricity markets & mini-grid licences"],
        "risks": [("Developer financing gaps", "medium", "high",
                   "Results-based financing with milestone disbursement")],
        "kpis": [("Mini-grids commissioned", "≥ 20 sites", "REA project register"),
                 ("Jobs per MW", "≥ 31 (REA benchmark)", "Impact surveys")],
        "phases": [("Site selection & licensing", 4, ["State regulator operational"]),
                   ("Construction & commissioning", 14, ["First 10 MW connected"])],
    },
}


def detect_sector(query: str, hint: str | None = None) -> str:
    if hint and hint in _PLAYBOOKS:
        return hint
    tokens = re.findall(r"[a-z-]+", query.lower())
    scores = {s: 0 for s in _PLAYBOOKS}
    for sector, kws in _SECTOR_KEYWORDS.items():
        for t in tokens:
            # exact or prefix match handles plurals ("teachers", "schools")
            if any(t == kw or t.startswith(kw) for kw in kws):
                scores[sector] += 1
    best = max(scores.items(), key=lambda kv: (kv[1], kv[0]))
    return best[0] if best[1] > 0 else "sme"


def _population_of(jurisdiction_id: str) -> float:
    pop = {"jur:ng": 223.8, "jur:ng-kd": 8.9, "jur:ng-la": 20.1,
           "jur:ng-kn": 15.5}
    return pop.get(jurisdiction_id, 10.0)  # millions


def _evidence_summary(evidence: list[EvidenceSource], limit: int = 4) -> str:
    top = evidence[:limit]
    if not top:
        return "no direct evidence retrieved; national benchmarks applied"
    return "; ".join(f"[{e.evidence_source_id}] {e.content[:160]}" for e in top)


def synthesize_recommendation(
    bundle: EvidenceBundle,
    sector_hint: str | None,
    routing: RoutingMetadata,
) -> Recommendation:
    sector = detect_sector(bundle.query, sector_hint)
    play = _PLAYBOOKS[sector]
    pop_m = _population_of(bundle.jurisdiction_id)
    estimated_jobs = int(round(play["jobs_per_10k_pop"] * pop_m * 100, -2))
    legal_deps = sorted({ld for ld in play["legal"]})
    # enrich legal dependencies from graph evidence
    for ev in bundle.evidence:
        if ev.retrieval_path.value == "graph" and "law" in ev.attributes.get("node_type", ""):
            name = ev.attributes.get("node_id", "")
            node = corpus.GRAPH_NODES.get(name)
            if node and node["name"] not in legal_deps:
                legal_deps.append(node["name"])
    evidence_conf = (sum(e.confidence for e in bundle.evidence[:5]) /
                     max(len(bundle.evidence[:5]), 1))
    confidence = round(min(0.95, 0.45 + 0.5 * evidence_conf), 3)
    return Recommendation(
        recommendation_id=f"rec:{uuid.uuid5(uuid.NAMESPACE_URL, bundle.bundle_id).hex[:12]}",
        title=f"{play['title']} — {bundle.jurisdiction_id}",
        rationale=(
            f"Query: '{bundle.query}'. Based on {len(bundle.evidence)} fused "
            f"evidence items (paths: "
            f"{', '.join(p.value for p in bundle.retrieval_paths_used)}), the "
            f"{sector} playbook is recommended. Key evidence: "
            f"{_evidence_summary(bundle.evidence)}."
        ),
        assumptions=[
            "Baseline labour-market metrics from seeded NBS-aligned data remain valid",
            "Executive sponsorship and budget appropriation are secured",
            "Federal legal framework applies without amendment during the horizon",
            f"Jobs-per-capita coefficient {play['jobs_per_10k_pop']}/10k from "
            "pilot benchmarks holds locally",
        ],
        evidence_base=bundle.evidence,
        estimated_jobs=estimated_jobs,
        budget_ranges=[BudgetRange(
            low_ngn_m=round(estimated_jobs * play["budget_low_per_job"], 1),
            high_ngn_m=round(estimated_jobs * play["budget_high_per_job"], 1),
            notes="Programme cost over 24 months incl. 10% contingency",
        )],
        timeline=[TimelinePhase(phase=p, duration_months=d, milestones=m)
                  for p, d, m in play["phases"]],
        implementation_actors=list(play["actors"]),
        legal_dependencies=legal_deps,
        risk_register=[RiskItem(risk=r, likelihood=l, impact=i, mitigation=m)
                       for r, l, i, m in play["risks"]],
        kpis=[KPI(name=n, target=t, measurement=m) for n, t, m in play["kpis"]],
        simulation_scenarios=[
            SimulationScenarioRef(
                engine="forecast",
                description="Probabilistic employment forecast with the intervention lift",
                suggested_parameters={"metric": "employment", "horizon_months": 24}),
            SimulationScenarioRef(
                engine="microsim",
                description="Distributional household impact of the subsidy/transfer rules",
                suggested_parameters={"population_size": 5000}),
            SimulationScenarioRef(
                engine="optimization",
                description="Portfolio selection across candidate interventions under budget",
                suggested_parameters={}),
        ],
        confidence=confidence,
        model_routing=routing,
    )


def synthesize_copilot_answer(
    bundle: EvidenceBundle,
    routing: RoutingMetadata,
) -> CopilotAnswer:
    evidence = bundle.evidence[:5]
    citations = [e.citation for e in evidence]
    if not evidence:
        answer = (f"No evidence was retrieved for '{bundle.query}' in "
                  f"{bundle.jurisdiction_id}; please broaden the query or check "
                  "the jurisdiction id.")
        return CopilotAnswer(answer=answer, citations=[], evidence=[],
                             uncertainty="high", confidence=0.1,
                             model_routing=routing)
    lines = [f"Q: {bundle.query}", ""]
    for e in evidence:
        lines.append(f"- {e.content} [{e.citation}]")
    mean_conf = sum(e.confidence for e in evidence) / len(evidence)
    uncertainty = "low" if mean_conf >= 0.6 else "medium" if mean_conf >= 0.35 else "high"
    if uncertainty != "low":
        lines.append("")
        lines.append(f"Note: answer confidence is {uncertainty}; corroborating "
                     "sources are limited for this query.")
    return CopilotAnswer(
        answer="\n".join(lines),
        citations=citations,
        evidence=evidence,
        uncertainty=uncertainty,
        confidence=round(min(0.95, 0.3 + 0.7 * mean_conf), 3),
        model_routing=routing,
    )
