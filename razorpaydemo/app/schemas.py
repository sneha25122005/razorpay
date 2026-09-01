from pydantic import BaseModel
from typing import Optional


class ActionOut(BaseModel):
    action: str
    cost: float
    recovery_prob: float
    incremental_prob: float
    expected_incremental_value: float
    net_value: float


class CaseOut(BaseModel):
    case_ref: str
    leak_type: str
    amount_at_risk: float
    age_hours: float
    natural_recovery_prob: float
    best_action: str
    final_decision: str
    agent_conflict: bool
    conflict_reason: Optional[str] = None
    policy_allowed: bool
    policy_reason: Optional[str] = None
    promise_active: bool
    actions: list[ActionOut]


class LedgerOut(BaseModel):
    gross_recovered: float
    natural_self_cure: float
    intervention_attributed: float
    intervention_cost: float
    net_incremental_value: float
    confidence_low: float
    confidence_high: float


class RecalcRequest(BaseModel):
    budget: float
    contact_capacity: int
    voice_capacity: int
    human_capacity: int
