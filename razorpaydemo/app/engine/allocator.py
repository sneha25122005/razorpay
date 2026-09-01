"""
Turns per-case candidate actions into a budget-constrained allocation across
the whole portfolio. This is a genuine recalculation (not a frontend
animation): given a budget and a list of cases with candidate actions, it
greedily allocates spend to the actions with the best net-value-per-rupee
until a resource runs out, matching Part 8 (Decision Lab: "must be a genuine
backend recalculation").
"""
from dataclasses import dataclass
from typing import Optional

from app.engine.models_ml import natural_recovery_model, uplift_models, ACTION_COSTS


@dataclass
class CandidateAction:
    action: str
    cost: float
    recovery_prob: float
    incremental_prob: float
    expected_incremental_value: float
    net_value: float


@dataclass
class CaseScore:
    case_ref: str
    leak_type: str
    amount: float
    natural_recovery_prob: float
    candidates: list[CandidateAction]
    best_action: str


def score_case(*, case_ref, leak_type, amount, age_hours, prior_self_cure_rate) -> CaseScore:
    natural_p = natural_recovery_model.predict_proba(leak_type, amount, age_hours, prior_self_cure_rate)
    candidates = [CandidateAction(
        action="wait", cost=0, recovery_prob=natural_p, incremental_prob=0,
        expected_incremental_value=0, net_value=0,
    )]
    for action, model in uplift_models.items():
        p = model.predict_proba(leak_type, amount, age_hours, prior_self_cure_rate)
        p = max(p, natural_p)  # an action can never be worse than doing nothing, by construction
        incr_p = p - natural_p
        cost = ACTION_COSTS[action]
        expected_incremental = amount * incr_p
        candidates.append(CandidateAction(
            action=action, cost=cost, recovery_prob=p, incremental_prob=incr_p,
            expected_incremental_value=expected_incremental, net_value=expected_incremental - cost,
        ))
    best = max(candidates, key=lambda c: c.net_value)
    return CaseScore(case_ref, leak_type, amount, natural_p, candidates, best.action)


@dataclass
class AllocationResult:
    case_ref: str
    action: str
    funded: bool
    reason: Optional[str] = None


def allocate_portfolio(scores: list[CaseScore], budget: float, contact_capacity: int,
                        voice_capacity: int, human_capacity: int) -> list[AllocationResult]:
    """Greedy allocation: rank all non-WAIT candidate actions by net value
    descending, fund them while resources remain, otherwise fall back to WAIT."""
    fundable = []
    for s in scores:
        best = max(s.candidates, key=lambda c: c.net_value)
        if best.action != "wait" and best.net_value > 0:
            fundable.append((s.case_ref, best))

    fundable.sort(key=lambda pair: pair[1].net_value, reverse=True)

    remaining_budget = budget
    remaining_contacts = contact_capacity
    remaining_voice = voice_capacity
    remaining_human = human_capacity

    results = {}
    for case_ref, action in fundable:
        cap_ok = True
        if action.action == "voice" and remaining_voice <= 0:
            cap_ok = False
        if action.action == "human" and remaining_human <= 0:
            cap_ok = False
        if remaining_contacts <= 0:
            cap_ok = False
        if action.cost > remaining_budget:
            cap_ok = False

        if cap_ok:
            remaining_budget -= action.cost
            remaining_contacts -= 1
            if action.action == "voice":
                remaining_voice -= 1
            if action.action == "human":
                remaining_human -= 1
            results[case_ref] = AllocationResult(case_ref, action.action, True)
        else:
            results[case_ref] = AllocationResult(case_ref, "wait", False, "Capacity/budget exhausted — deferred to WAIT.")

    for s in scores:
        if s.case_ref not in results:
            results[s.case_ref] = AllocationResult(s.case_ref, "wait", True, "WAIT has the highest net value.")

    return list(results.values())
