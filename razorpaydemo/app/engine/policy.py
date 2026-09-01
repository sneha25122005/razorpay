"""
Deterministic policy gate. Runs AFTER the allocator recommends an action and
BEFORE any actuator executes it. Nothing upstream (ML model, LLM reasoning
panel, allocator) can bypass this — every check here is a plain boolean rule,
not a model call. Part 16: "Do not allow the LLM to override this layer."
"""
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Optional

POLICY_VERSION = "v1.1"


@dataclass
class PolicyCheckResult:
    check_name: str
    passed: bool
    reason: Optional[str] = None


def run_policy_gate(
    *,
    action: str,
    consent_given: bool,
    opted_out: bool,
    contacts_last_24h: int,
    contact_window_ok: bool,
    payment_already_captured: bool,
    budget_remaining: float,
    action_cost: float,
    agent_conflict: bool,
    promise_active: bool,
    requires_human_approval: bool,
    human_approved: bool,
) -> list[PolicyCheckResult]:
    checks = []

    checks.append(PolicyCheckResult("consent", consent_given, None if consent_given else "No consent on file for outreach."))
    checks.append(PolicyCheckResult("opt_out", not opted_out, None if not opted_out else "Customer has opted out of contact."))
    checks.append(PolicyCheckResult(
        "contact_frequency", contacts_last_24h < 3,
        None if contacts_last_24h < 3 else "Contact frequency cap (3/24h) exceeded."
    ))
    checks.append(PolicyCheckResult("contact_window", contact_window_ok, None if contact_window_ok else "Outside permitted contact hours."))
    checks.append(PolicyCheckResult(
        "payment_state", not payment_already_captured,
        None if not payment_already_captured else "Payment already captured — action moot."
    ))
    checks.append(PolicyCheckResult(
        "budget", action_cost <= budget_remaining,
        None if action_cost <= budget_remaining else "Insufficient recovery budget remaining."
    ))
    checks.append(PolicyCheckResult("agent_conflict", not agent_conflict, None if not agent_conflict else "Another agent is actively engaging this customer."))
    checks.append(PolicyCheckResult("promise_to_pay", not promise_active, None if not promise_active else "Active promise-to-pay locks other actions."))
    if requires_human_approval:
        checks.append(PolicyCheckResult("human_approval", human_approved, None if human_approved else "Awaiting human approval for this action."))

    # WAIT is always policy-exempt from contact-related checks — doing nothing needs no consent.
    if action == "wait":
        checks = [c for c in checks if c.check_name in ("budget",)]
        checks.append(PolicyCheckResult("no_op", True, None))

    return checks


def policy_allows(checks: list[PolicyCheckResult]) -> bool:
    return all(c.passed for c in checks)
