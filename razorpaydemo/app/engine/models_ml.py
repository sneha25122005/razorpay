"""
Natural-recovery and per-action uplift models. Trained on synthetic
historical outcomes (observed features -> observed recovered/not), using
scikit-learn LogisticRegression as specified (Part 19: "ML: scikit-learn
initially"). Ground truth from the simulator is never fed in as a feature —
only what a real system could observe.
"""
import random
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder

from app.engine.synthetic_simulator import generate_cases, simulate_outcome, LEAK_TYPES, ACTIONS

MODEL_VERSION = "v0.4.2"

_encoder = OneHotEncoder(sparse_output=False, categories=[LEAK_TYPES], handle_unknown="ignore")
_encoder.fit(np.array(LEAK_TYPES).reshape(-1, 1))


def _features(leak_type: str, amount: float, age_hours: float, prior_self_cure_rate: float) -> np.ndarray:
    leak_oh = _encoder.transform([[leak_type]])[0]
    return np.concatenate([[amount / 60000, age_hours / 96, prior_self_cure_rate], leak_oh])


class NaturalRecoveryModel:
    """P(customer self-cures with NO intervention)."""
    version = MODEL_VERSION

    def __init__(self, seed: int = 1):
        self.rng = random.Random(seed)
        self._train()

    def _train(self, n_train: int = 4000):
        cases = generate_cases(n_train, seed=1)
        X, y = [], []
        for c in cases:
            outcome = simulate_outcome(c, "wait", self.rng)
            X.append(_features(c.leak_type, c.amount, c.age_hours, c.prior_self_cure_rate))
            y.append(1 if outcome["recovered"] else 0)
        self.clf = LogisticRegression(max_iter=500)
        self.clf.fit(np.array(X), np.array(y))

    def predict_proba(self, leak_type, amount, age_hours, prior_self_cure_rate) -> float:
        x = _features(leak_type, amount, age_hours, prior_self_cure_rate).reshape(1, -1)
        return float(self.clf.predict_proba(x)[0][1])


class UpliftModel:
    """P(recover | action) for a given action, so incremental = P(action) - P(wait)."""
    version = MODEL_VERSION

    def __init__(self, action: str, seed: int = 2):
        assert action in ACTIONS
        self.action = action
        self.rng = random.Random(seed + hash(action) % 100)
        self._train()

    def _train(self, n_train: int = 4000):
        cases = generate_cases(n_train, seed=hash(self.action) % 10000)
        X, y = [], []
        for c in cases:
            outcome = simulate_outcome(c, self.action, self.rng)
            X.append(_features(c.leak_type, c.amount, c.age_hours, c.prior_self_cure_rate))
            y.append(1 if outcome["recovered"] else 0)
        self.clf = LogisticRegression(max_iter=500)
        self.clf.fit(np.array(X), np.array(y))

    def predict_proba(self, leak_type, amount, age_hours, prior_self_cure_rate) -> float:
        x = _features(leak_type, amount, age_hours, prior_self_cure_rate).reshape(1, -1)
        return float(self.clf.predict_proba(x)[0][1])


# Module-level singletons — trained once at process start, reused for scoring.
natural_recovery_model = NaturalRecoveryModel()
uplift_models = {a: UpliftModel(a) for a in ACTIONS}
ACTION_COSTS = {"wait": 0, "payment_link": 4, "voice": 65, "human": 100}
