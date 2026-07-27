"""Seeded Nigeria pilot corpus: legal passages, metrics, graph, profiles.

Deterministic seed data for the three retrieval fallback adapters.
"""
from __future__ import annotations

SEED_DATA_VERSION = "ng-pilot-corpus-2024.1"

# ---------------------------------------------------------------------------
# Legal / policy passages (vector adapter fallback)
# ---------------------------------------------------------------------------
PASSAGES: list[dict] = [
    {"id": "pas:ube-act-2004-s2", "type": "legal", "jurisdiction": "jur:ng",
     "title": "Universal Basic Education Act 2004, s.2",
     "citation": "UBE Act 2004 (Nigeria), s.2 — free compulsory basic education",
     "content": "Every Government in Nigeria shall provide free, compulsory and "
                "universal basic education for every child of primary and junior "
                "secondary school age, including the recruitment and licensing of "
                "qualified teachers."},
    {"id": "pas:ube-act-2004-s15", "type": "legal", "jurisdiction": "jur:ng",
     "title": "UBE Act 2004, s.15 — funding",
     "citation": "UBE Act 2004 (Nigeria), s.15 — UBE Intervention Fund",
     "content": "The Universal Basic Education Intervention Fund shall consist of "
                "not less than two per cent of the Consolidated Revenue Fund, applied "
                "to teacher training, instructional materials and school feeding."},
    {"id": "pas:trcn-act-cl3", "type": "legal", "jurisdiction": "jur:ng",
     "title": "Teachers Registration Council Act, licensing clause",
     "citation": "TRCN Act Cap T3 LFN 2004 — teacher licensing requirement",
     "content": "No person shall teach in any primary or secondary school unless "
                "registered and licensed by the Teachers Registration Council of "
                "Nigeria (TRCN); state ministries must verify licences annually."},
    {"id": "pas:nhgsf-policy", "type": "policy", "jurisdiction": "jur:ng",
     "title": "National Home-Grown School Feeding Programme",
     "citation": "NHGSFP Programme Design Document (2016, rev. 2022)",
     "content": "The school-meal programme procures meals from local smallholder "
                "farmers and employs community cooks, creating jobs in catering and "
                "agriculture supply chains while raising school enrolment."},
    {"id": "pas:ppa-2007-s16", "type": "legal", "jurisdiction": "jur:ng",
     "title": "Public Procurement Act 2007, s.16",
     "citation": "Public Procurement Act 2007 (Nigeria), s.16 — open competitive bidding",
     "content": "All public procurement shall be conducted by open competitive "
                "bidding; the Bureau of Public Procurement shall issue certificates "
                "of no objection for contract awards above threshold values."},
    {"id": "pas:ppa-2007-s5", "type": "legal", "jurisdiction": "jur:ng",
     "title": "Public Procurement Act 2007, s.5 — BPP establishment",
     "citation": "Public Procurement Act 2007 (Nigeria), s.5 — Bureau of Public Procurement",
     "content": "There is established the Bureau of Public Procurement, charged with "
                "the regulation, monitoring and oversight of public procurement and "
                "the maintenance of a national database of contractors."},
    {"id": "pas:smieis-act-s6", "type": "legal", "jurisdiction": "jur:ng",
     "title": "SMEDAN Act — SME registration",
     "citation": "SMEDAN Establishment Act 2003, s.6 — MSME registration mandate",
     "content": "The Small and Medium Enterprises Development Agency of Nigeria "
                "shall maintain a register of micro, small and medium enterprises "
                "and facilitate their access to credit, markets and skills training."},
    {"id": "pas:smieis-policy-note", "type": "policy", "jurisdiction": "jur:ng",
     "title": "MSME Survival Fund design note",
     "citation": "MSME Survival Fund Implementation Note (2020)",
     "content": "Payroll support to vulnerable MSMEs preserved an estimated 1.3 "
                "million jobs; eligibility required CAC registration and verifiable "
                "employee counts, reducing leakage by 22%."},
    {"id": "pas:kd-edu-law", "type": "legal", "jurisdiction": "jur:ng-kd",
     "title": "Kaduna State Education Law 2018",
     "citation": "Kaduna State Education Law 2018, Part IV — teacher standards",
     "content": "Kaduna State shall employ only TRCN-licensed teachers in public "
                "primary schools and may establish a State Teachers Service Board "
                "for recruitment, posting and discipline."},
    {"id": "pas:kd-procurement-law", "type": "legal", "jurisdiction": "jur:ng-kd",
     "title": "Kaduna State Public Procurement Law 2018",
     "citation": "Kaduna State Public Procurement Law 2018 — due process bureau",
     "content": "The Kaduna State Due Process and Project Monitoring Bureau shall "
                "enforce open contracting, publish award data, and certify projects "
                "prior to fund release."},
    {"id": "pas:agri-extension-policy", "type": "policy", "jurisdiction": "jur:ng",
     "title": "National Agricultural Extension Policy",
     "citation": "FMARD Agricultural Extension Revitalization Policy (2021)",
     "content": "Extension worker density of one per 800 farming households "
                "increases technology adoption by 18-25% and seasonal employment in "
                "agricultural value chains."},
    {"id": "pas:electricity-act-2023", "type": "legal", "jurisdiction": "jur:ng",
     "title": "Electricity Act 2023",
     "citation": "Electricity Act 2023 (Nigeria) — state electricity markets",
     "content": "States may establish intrastate electricity markets, issue "
                "mini-grid licences and regulate distribution within their "
                "territories, enabling decentralized power investment."},
]

# ---------------------------------------------------------------------------
# Analytical metrics (SQL adapter fallback)
# ---------------------------------------------------------------------------
METRICS: list[dict] = [
    {"id": "met:ng-kd-unemp", "jurisdiction": "jur:ng-kd",
     "metric": "unemployment_rate", "value": 0.286, "period": "2024-Q2",
     "unit": "ratio", "source": "NBS Labour Force Survey"},
    {"id": "met:ng-kd-teachers-gap", "jurisdiction": "jur:ng-kd",
     "metric": "teacher_gap_primary", "value": 14500, "period": "2024",
     "unit": "count", "source": "Kaduna SUBEB"},
    {"id": "met:ng-kd-sme-count", "jurisdiction": "jur:ng-kd",
     "metric": "registered_smes", "value": 41200, "period": "2024",
     "unit": "count", "source": "SMEDAN/CAC register"},
    {"id": "met:ng-la-unemp", "jurisdiction": "jur:ng-la",
     "metric": "unemployment_rate", "value": 0.244, "period": "2024-Q2",
     "unit": "ratio", "source": "NBS Labour Force Survey"},
    {"id": "met:ng-la-sme-count", "jurisdiction": "jur:ng-la",
     "metric": "registered_smes", "value": 320500, "period": "2024",
     "unit": "count", "source": "SMEDAN/CAC register"},
    {"id": "met:ng-kn-unemp", "jurisdiction": "jur:ng-kn",
     "metric": "unemployment_rate", "value": 0.312, "period": "2024-Q2",
     "unit": "ratio", "source": "NBS Labour Force Survey"},
    {"id": "met:ng-kn-agri-share", "jurisdiction": "jur:ng-kn",
     "metric": "agriculture_employment_share", "value": 0.44, "period": "2024",
     "unit": "ratio", "source": "NBS"},
    {"id": "met:ng-school-meal-jobs", "jurisdiction": "jur:ng",
     "metric": "school_meal_program_jobs", "value": 127000, "period": "2023",
     "unit": "count", "source": "NHGSFP monitoring report"},
    {"id": "met:ng-msme-survival-jobs", "jurisdiction": "jur:ng",
     "metric": "msme_survival_fund_jobs_preserved", "value": 1300000,
     "period": "2021", "unit": "count", "source": "MSME Survival Fund evaluation"},
    {"id": "met:ng-minigrid-jobs", "jurisdiction": "jur:ng",
     "metric": "minigrid_jobs_per_mw", "value": 31, "period": "2022",
     "unit": "jobs_per_mw", "source": "REA Nigeria impact study"},
]

PROFILES: list[dict] = [
    {"id": "prof:ng-kd", "jurisdiction": "jur:ng-kd",
     "name": "Kaduna State",
     "content": "Kaduna State: population 8.9m; unemployment 28.6%; strengths in "
                "agriculture and public-sector reform; active due-process "
                "procurement bureau; teacher shortage concentrated in rural LGAs."},
    {"id": "prof:ng-la", "jurisdiction": "jur:ng-la",
     "name": "Lagos State",
     "content": "Lagos State: population 20.1m; unemployment 24.4%; dominant "
                "services and SME sector; highest registered-MSME count in the "
                "federation; severe skills mismatch in digital occupations."},
    {"id": "prof:ng-kn", "jurisdiction": "jur:ng-kn",
     "name": "Kano State",
     "content": "Kano State: population 15.5m; unemployment 31.2%; agriculture "
                "employs 44% of the labour force; large informal SME base; "
                "electricity reliability is the top firm-level constraint."},
]

# ---------------------------------------------------------------------------
# Legal/policy dependency graph (graph adapter fallback)
# nodes: laws, clauses, agencies, sectors
# edges: (src, rel, dst) with rel in CITES|ENABLES|RESTRICTS|APPLIES_TO
# ---------------------------------------------------------------------------
GRAPH_NODES: dict[str, dict] = {
    "law:ube-act-2004": {"type": "law", "name": "Universal Basic Education Act 2004"},
    "clause:ube-s2": {"type": "clause", "name": "UBE Act s.2 free basic education"},
    "clause:ube-s15": {"type": "clause", "name": "UBE Act s.15 intervention fund"},
    "law:trcn-act": {"type": "law", "name": "TRCN Act Cap T3 LFN 2004"},
    "clause:trcn-licensing": {"type": "clause", "name": "TRCN licensing requirement"},
    "law:ppa-2007": {"type": "law", "name": "Public Procurement Act 2007"},
    "clause:ppa-s16": {"type": "clause", "name": "PPA s.16 open competitive bidding"},
    "law:smedan-act-2003": {"type": "law", "name": "SMEDAN Act 2003"},
    "clause:smedan-s6": {"type": "clause", "name": "SMEDAN s.6 MSME registration"},
    "law:electricity-2023": {"type": "law", "name": "Electricity Act 2023"},
    "clause:ea-state-markets": {"type": "clause", "name": "EA state electricity markets"},
    "policy:nhgsfp": {"type": "policy", "name": "School-meal programme (NHGSFP)"},
    "agency:subeb": {"type": "agency", "name": "State Universal Basic Education Board"},
    "agency:trcn": {"type": "agency", "name": "Teachers Registration Council of Nigeria"},
    "agency:bpp": {"type": "agency", "name": "Bureau of Public Procurement"},
    "agency:smedan": {"type": "agency", "name": "SMEDAN"},
    "agency:rea": {"type": "agency", "name": "Rural Electrification Agency"},
    "sector:education": {"type": "sector", "name": "Education"},
    "sector:sme": {"type": "sector", "name": "SME"},
    "sector:procurement": {"type": "sector", "name": "Procurement"},
    "sector:agriculture": {"type": "sector", "name": "Agriculture"},
    "sector:health": {"type": "sector", "name": "Health"},
    "sector:electricity": {"type": "sector", "name": "Electricity"},
}

GRAPH_EDGES: list[tuple[str, str, str]] = [
    ("law:ube-act-2004", "CITES", "clause:ube-s2"),
    ("law:ube-act-2004", "CITES", "clause:ube-s15"),
    ("clause:ube-s15", "ENABLES", "policy:nhgsfp"),
    ("clause:ube-s2", "APPLIES_TO", "sector:education"),
    ("law:trcn-act", "CITES", "clause:trcn-licensing"),
    ("clause:trcn-licensing", "RESTRICTS", "sector:education"),
    ("agency:trcn", "APPLIES_TO", "sector:education"),
    ("agency:subeb", "APPLIES_TO", "sector:education"),
    ("policy:nhgsfp", "APPLIES_TO", "sector:education"),
    ("policy:nhgsfp", "APPLIES_TO", "sector:agriculture"),
    ("law:ppa-2007", "CITES", "clause:ppa-s16"),
    ("clause:ppa-s16", "RESTRICTS", "sector:procurement"),
    ("agency:bpp", "APPLIES_TO", "sector:procurement"),
    ("law:smedan-act-2003", "CITES", "clause:smedan-s6"),
    ("clause:smedan-s6", "ENABLES", "sector:sme"),
    ("agency:smedan", "APPLIES_TO", "sector:sme"),
    ("law:electricity-2023", "CITES", "clause:ea-state-markets"),
    ("clause:ea-state-markets", "ENABLES", "sector:electricity"),
    ("agency:rea", "APPLIES_TO", "sector:electricity"),
]
