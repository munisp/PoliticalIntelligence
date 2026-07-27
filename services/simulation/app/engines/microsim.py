"""Microsimulation engine (spec section 22).

OpenFisca-style executable policy rules: parameterized tax / benefit /
wage-subsidy rule sets are applied to a seeded synthetic household/firm
population. Outputs distributional impacts (income deciles, sector groups)
with bootstrap uncertainty bands.
"""
from __future__ import annotations

import numpy as np

from app.models import (DistributionImpact, EngineName, EngineResult,
                        ScalarEstimate, UncertaintyBand)
from app.data import seed as seed_data
from app.engines import EngineContext, build_reproducibility

ENGINE_VERSION = "1.0.0"

# Executable policy rules -------------------------------------------------

def wage_subsidy_rule(pop: dict[str, np.ndarray], rate: float,
                      cap_ngn: float) -> np.ndarray:
    """Employers receive `rate` of payroll cost per worker, capped monthly."""
    subsidy = np.where(pop["employed"], pop["wage_ngn"] * rate, 0.0)
    return np.minimum(subsidy, cap_ngn)


def tax_credit_rule(pop: dict[str, np.ndarray], credit_rate: float,
                    threshold_ngn: float) -> np.ndarray:
    """Flat tax credit for low-income employed workers."""
    eligible = pop["employed"] & (pop["wage_ngn"] < threshold_ngn)
    return np.where(eligible, pop["wage_ngn"] * credit_rate, 0.0)


def cash_transfer_rule(pop: dict[str, np.ndarray], amount_ngn: float) -> np.ndarray:
    """Unconditional transfer to unemployed adults."""
    return np.where(~pop["employed"], amount_ngn, 0.0)


def run(ctx: EngineContext) -> EngineResult:
    params = ctx.plan.parameters
    n_pop = int(params.get("population_size", 5000))
    n_boot = int(params.get("n_bootstrap", 100))
    pop = seed_data.synthetic_population(
        ctx.jurisdiction.jurisdiction_id, n_pop, ctx.random_seed)

    rng = ctx.rng
    total_benefit = np.zeros(n_pop)
    rules_applied: list[str] = []
    for iv in ctx.config.interventions or []:
        p = iv.parameters
        if iv.kind == "wage_subsidy":
            rate = float(p.get("rate", 0.5 * iv.intensity))
            cap = float(p.get("cap_ngn", 75_000))
            total_benefit += wage_subsidy_rule(pop, rate, cap)
            rules_applied.append(f"wage_subsidy(rate={rate:.3f},cap={cap:.0f})")
        elif iv.kind == "tax_credit":
            credit_rate = float(p.get("credit_rate", 0.1 * iv.intensity))
            threshold = float(p.get("threshold_ngn", 100_000))
            total_benefit += tax_credit_rule(pop, credit_rate, threshold)
            rules_applied.append(f"tax_credit(rate={credit_rate:.3f},thr={threshold:.0f})")
        elif iv.kind == "cash_transfer":
            amount = float(p.get("amount_ngn", 25_000 * iv.intensity))
            total_benefit += cash_transfer_rule(pop, amount)
            rules_applied.append(f"cash_transfer(amount={amount:.0f})")
    if not rules_applied:  # default scenario keeps the service useful
        total_benefit += wage_subsidy_rule(pop, 0.25, 75_000)
        rules_applied.append("wage_subsidy(rate=0.25,cap=75000) [default]")

    baseline_income = pop["wage_ngn"].copy()
    scenario_income = baseline_income + total_benefit

    # Distributional impact by income decile of baseline wage (employed only).
    impacts: list[DistributionImpact] = []
    employed_mask = pop["employed"]
    base_emp = baseline_income[employed_mask]
    deciles = np.quantile(base_emp, np.linspace(0, 1, 11))
    benefit_emp = total_benefit[employed_mask]
    for d in range(10):
        lo, hi = deciles[d], deciles[d + 1]
        mask = (base_emp >= lo) & (base_emp <= hi if d == 9 else base_emp < hi)
        if not mask.any():
            continue
        grp_base = float(np.mean(base_emp[mask]))
        grp_vals = benefit_emp[mask]
        grp_delta = float(np.mean(grp_vals))
        bidx = rng.integers(0, grp_vals.size, size=(n_boot, grp_vals.size))
        boot = grp_vals[bidx].mean(axis=1)
        impacts.append(DistributionImpact(
            group=f"income_decile_{d + 1}",
            baseline_mean=round(grp_base, 2),
            scenario_mean=round(grp_base + grp_delta, 2),
            delta=round(grp_delta, 2),
            band=UncertaintyBand(
                lower=[round(float(np.quantile(boot, 0.05)), 2)],
                upper=[round(float(np.quantile(boot, 0.95)), 2)],
                level=0.9,
            ),
        ))

    mean_benefit = float(np.mean(total_benefit))
    se = float(np.std(total_benefit) / np.sqrt(n_pop))
    estimate = ScalarEstimate(
        metric="mean_monthly_household_benefit_ngn",
        estimate=round(mean_benefit, 2),
        ci_lower=round(mean_benefit - 1.96 * se, 2),
        ci_upper=round(mean_benefit + 1.96 * se, 2),
        notes=f"Rules applied: {'; '.join(rules_applied)}",
    )
    return EngineResult(
        engine=EngineName.microsim,
        engine_version=ENGINE_VERSION,
        model_version=f"openfisca-style-rules/{ENGINE_VERSION}",
        summary=(f"Microsimulation over {n_pop} synthetic households in "
                 f"{ctx.jurisdiction.name}; mean monthly benefit "
                 f"NGN {mean_benefit:,.0f}."),
        estimates=[estimate],
        distribution_impacts=impacts,
        metadata={"population_size": n_pop, "rules": rules_applied},
        reproducibility=build_reproducibility(ENGINE_VERSION, ctx.random_seed),
    )
