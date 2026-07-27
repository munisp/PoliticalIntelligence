"""Seeded demo data for the Nigeria pilot (deterministic, versioned).

Provides sample jurisdictions, sectors, baseline metric time series and
assumption sets. All series are generated with a fixed internal seed so the
seed data itself is reproducible across deployments.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import numpy as np


def _stable_seed(*parts: str) -> int:
    """Process-independent seed derivation (PYTHONHASHSEED-safe)."""
    digest = hashlib.sha256("::".join(parts).encode()).hexdigest()
    return int(digest[:8], 16)

SEED_DATA_VERSION = "ng-pilot-2024.1"

# ---------------------------------------------------------------------------
# Jurisdictions
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Jurisdiction:
    jurisdiction_id: str
    name: str
    level: str  # federal | state
    population: int
    labour_force: int
    baseline_unemployment_rate: float
    gdp_ngn_bn: float


JURISDICTIONS: dict[str, Jurisdiction] = {
    "jur:ng": Jurisdiction("jur:ng", "Federal Republic of Nigeria", "federal",
                           223_800_000, 76_960_000, 0.331, 362_840.0),
    "jur:ng-kd": Jurisdiction("jur:ng-kd", "Kaduna State", "state",
                              8_900_000, 3_100_000, 0.286, 11_220.0),
    "jur:ng-la": Jurisdiction("jur:ng-la", "Lagos State", "state",
                              20_100_000, 9_400_000, 0.244, 41_170.0),
    "jur:ng-kn": Jurisdiction("jur:ng-kn", "Kano State", "state",
                              15_500_000, 4_600_000, 0.312, 12_050.0),
}

SECTORS: dict[str, dict] = {
    "education": {"name": "Education", "employment_share": 0.072},
    "sme": {"name": "Small & Medium Enterprises", "employment_share": 0.396},
    "procurement": {"name": "Public Procurement", "employment_share": 0.031},
    "agriculture": {"name": "Agriculture", "employment_share": 0.351},
    "health": {"name": "Health", "employment_share": 0.028},
    "electricity": {"name": "Electricity", "employment_share": 0.012},
}


# ---------------------------------------------------------------------------
# Assumptions sets
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class AssumptionsSet:
    assumptions_id: str
    description: str
    values: dict = field(default_factory=dict)


ASSUMPTION_SETS: dict[str, AssumptionsSet] = {
    "asm:edu:base": AssumptionsSet(
        "asm:edu:base",
        "Baseline education-sector assumptions: moderate teacher hiring "
        "elasticity, average wage NGN 120k/mo, 3% annual labour-force growth.",
        {"wage_monthly_ngn": 120_000, "hiring_elasticity": 0.6,
         "labour_force_growth": 0.03, "inflation": 0.21},
    ),
    "asm:sme:base": AssumptionsSet(
        "asm:sme:base",
        "Baseline SME assumptions: firm birth rate 4%/yr, average firm size 6, "
        "wage-subsidy take-up 55%.",
        {"firm_birth_rate": 0.04, "avg_firm_size": 6,
         "subsidy_takeup": 0.55, "inflation": 0.21},
    ),
    "asm:agri:base": AssumptionsSet(
        "asm:agri:base",
        "Baseline agriculture assumptions: seasonal employment factor 0.4, "
        "yield-response elasticity 0.3.",
        {"seasonality": 0.4, "yield_elasticity": 0.3, "inflation": 0.21},
    ),
    "asm:stress:high-inflation": AssumptionsSet(
        "asm:stress:high-inflation",
        "Stress case: inflation 32%, subsidy take-up falls to 40%.",
        {"wage_monthly_ngn": 150_000, "hiring_elasticity": 0.4,
         "labour_force_growth": 0.03, "inflation": 0.32, "subsidy_takeup": 0.40},
    ),
}


# ---------------------------------------------------------------------------
# Baseline metric time series (monthly, 36 months)
# ---------------------------------------------------------------------------
def _gen_series(base: float, trend: float, season_amp: float, noise: float,
                periods: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(periods)
    seasonal = season_amp * np.sin(2 * np.pi * t / 12.0)
    return base + trend * t + seasonal + rng.normal(0.0, noise, periods)


_PERIODS = 36


def baseline_series(jurisdiction_id: str, metric: str) -> tuple[list[str], np.ndarray]:
    """Return (period labels, values) for a baseline metric, deterministically."""
    jur = JURISDICTIONS.get(jurisdiction_id, JURISDICTIONS["jur:ng"])
    seed = _stable_seed(jurisdiction_id, metric)
    months = [f"2024-{m:02d}" for m in range(1, 13)] + \
             [f"2025-{m:02d}" for m in range(1, 13)] + \
             [f"2026-{m:02d}" for m in range(1, 13)]
    if metric == "employment":
        employed = jur.labour_force * (1.0 - jur.baseline_unemployment_rate)
        growth = employed * 0.0015  # ~0.15%/mo trend
        values = _gen_series(employed, growth, employed * 0.004, employed * 0.002,
                             _PERIODS, seed)
    elif metric == "unemployment_rate":
        values = _gen_series(jur.baseline_unemployment_rate, -0.0002, 0.003,
                             0.0015, _PERIODS, seed)
        values = np.clip(values, 0.01, 0.9)
    elif metric == "firm_count":
        firms = jur.labour_force * 0.06
        values = _gen_series(firms, firms * 0.003, firms * 0.001,
                             firms * 0.0015, _PERIODS, seed)
    elif metric == "real_gdp_ngn_bn":
        monthly = jur.gdp_ngn_bn / 12.0
        values = _gen_series(monthly, monthly * 0.002, monthly * 0.02,
                             monthly * 0.01, _PERIODS, seed)
    else:
        values = _gen_series(1000.0, 1.0, 5.0, 2.0, _PERIODS, seed)
    return months, np.round(values, 4)


# ---------------------------------------------------------------------------
# Synthetic population for microsimulation (households/firms)
# ---------------------------------------------------------------------------
def synthetic_population(jurisdiction_id: str, size: int, seed: int) -> dict[str, np.ndarray]:
    """Generate a deterministic synthetic household/firm population."""
    jur = JURISDICTIONS.get(jurisdiction_id, JURISDICTIONS["jur:ng"])
    rng = np.random.default_rng(seed)
    employed_prob = 1.0 - jur.baseline_unemployment_rate
    employed = rng.random(size) < employed_prob
    wage = np.where(
        employed,
        np.maximum(20_000, rng.lognormal(mean=11.5, sigma=0.6, size=size)),
        0.0,
    )
    household_size = rng.integers(1, 9, size)
    sector_idx = rng.choice(len(SECTORS), size=size,
                            p=[SECTORS[s]["employment_share"] /
                               sum(x["employment_share"] for x in SECTORS.values())
                               for s in SECTORS])
    return {
        "employed": employed,
        "wage_ngn": np.round(wage, 2),
        "household_size": household_size,
        "sector_idx": sector_idx,
    }
