"""
Causal ledger logic. Every recovered rupee is attributed to exactly one
category. This never runs on gross recovery alone — it always nets out the
natural-recovery baseline that was estimated *before* any action executed,
so post-hoc rationalization can't inflate intervention credit.
"""
from dataclasses import dataclass

CATEGORIES = ["self_cure", "intervention_attributed", "uncertain", "not_recovered"]


@dataclass
class Attribution:
    category: str
    recovered_amount: float
    natural_baseline: float
    intervention_attributed_amount: float
    confidence: float


def attribute_outcome(*, amount: float, natural_recovery_prob: float, action_taken: str,
                       recovered: bool) -> Attribution:
    natural_baseline = amount * natural_recovery_prob

    if not recovered:
        return Attribution("not_recovered", 0.0, natural_baseline, 0.0, confidence=0.9)

    if action_taken == "wait":
        # Recovered with no intervention — by definition self-cure.
        return Attribution("self_cure", amount, natural_baseline, 0.0, confidence=0.95)

    # Recovered after an action executed. We can't observe the counterfactual
    # for this individual case, so attribution uses the estimated natural
    # baseline as an expected self-cure portion and credits the remainder to
    # the intervention — flagged UNCERTAIN when the baseline is high relative
    # to amount, since the split is less confident there.
    attributed = max(0.0, amount - natural_baseline)
    confidence = 0.85 if natural_recovery_prob < 0.5 else 0.55
    category = "intervention_attributed" if natural_recovery_prob < 0.6 else "uncertain"
    return Attribution(category, amount, natural_baseline, attributed, confidence=confidence)
