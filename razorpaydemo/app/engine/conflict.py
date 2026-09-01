"""
Agent conflict resolution + promise-to-pay suppression.

External-agent state (Subscription Agent, Cart Agent, etc.) is NOT sourced
from any private Razorpay Agent Studio API — no such public API is verified
to exist. All external-agent events here come from a mock adapter and are
labeled 'External agent event — simulated' wherever surfaced to the UI.
Our own agent's state is real, tracked in AgentRegistry.
"""
from dataclasses import dataclass
from datetime import datetime


@dataclass
class ConflictCheckResult:
    conflict: bool
    reason: str | None
    blocking_agents: list[str]


def check_agent_conflict(active_agents: list[str]) -> ConflictCheckResult:
    """active_agents: names of agents currently ACTIVE on this customer,
    excluding 'our_agent'. More than zero => conflict, our agent yields."""
    if active_agents:
        return ConflictCheckResult(
            True,
            f"{', '.join(active_agents)} already engaging this customer.",
            active_agents,
        )
    return ConflictCheckResult(False, None, [])


@dataclass
class PromiseState:
    status: str  # active|fulfilled|broken
    suppress_other_actions: bool


def evaluate_promise(*, status: str, deadline: datetime, now: datetime, payment_detected: bool) -> PromiseState:
    if status != "active":
        return PromiseState(status, suppress_other_actions=False)
    if payment_detected:
        return PromiseState("fulfilled", suppress_other_actions=False)
    if now > deadline:
        return PromiseState("broken", suppress_other_actions=False)
    return PromiseState("active", suppress_other_actions=True)
