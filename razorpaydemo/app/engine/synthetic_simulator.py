"""
Generates synthetic historical revenue-leak cases for training and demo
seeding. Each generated record carries a HIDDEN ground-truth natural-cure
probability and per-action treatment effect. The ML models below only ever
see the *observed features* (leak_type, amount, age, prior self-cure rate for
that customer, etc.) — never the ground truth — mirroring how the real
system must learn from noisy outcomes rather than an oracle.
"""
import random
from dataclasses import dataclass, field
from typing import List

LEAK_TYPES = ["subscription", "cart", "invoice", "mandate", "payment_link"]
ACTIONS = ["payment_link", "voice", "human"]


@dataclass
class SyntheticCase:
    case_ref: str
    leak_type: str
    amount: float
    age_hours: float
    prior_self_cure_rate: float  # observed feature: this customer's history
    true_natural_prob: float     # hidden ground truth
    true_uplift: dict            # hidden ground truth per action
    observed_outcome: dict = field(default_factory=dict)  # filled by simulate_outcome


def generate_cases(n: int, seed: int = 42) -> List[SyntheticCase]:
    rng = random.Random(seed)
    cases = []
    for i in range(n):
        leak_type = rng.choice(LEAK_TYPES)
        amount = round(rng.uniform(300, 60000), 2)
        age_hours = round(rng.uniform(0, 96), 1)
        prior_self_cure_rate = rng.betavariate(2, 2)
        true_natural_prob = min(0.97, max(0.02, prior_self_cure_rate * rng.uniform(0.7, 1.3)))
        true_uplift = {
            "payment_link": rng.uniform(0, 0.35),
            "voice": rng.uniform(0, 0.28),
            "human": rng.uniform(0, 0.22),
        }
        cases.append(SyntheticCase(
            case_ref=f"C-{1000+i}",
            leak_type=leak_type,
            amount=amount,
            age_hours=age_hours,
            prior_self_cure_rate=prior_self_cure_rate,
            true_natural_prob=true_natural_prob,
            true_uplift=true_uplift,
        ))
    return cases


def simulate_outcome(case: SyntheticCase, action: str, rng: random.Random) -> dict:
    """Roll the dice using hidden ground truth to produce an observed outcome.
    This is the only place ground truth is used — downstream code only sees
    the boolean/observed result, exactly as the real payment webhooks would
    deliver it."""
    prob = case.true_natural_prob
    cost = {"wait": 0, "payment_link": 4, "voice": 65, "human": 100}[action]
    if action != "wait":
        prob = min(0.99, prob + case.true_uplift[action])
    recovered = rng.random() < prob
    return {
        "action": action,
        "cost": cost,
        "recovered": recovered,
        "recovered_amount": case.amount if recovered else 0.0,
    }
