import hashlib
import hmac
import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine, SessionLocal
from app.main import app
from app.integrations.razorpay.webhook import verify_signature, WEBHOOK_SECRET
from app.engine.policy import run_policy_gate, policy_allows
from app.engine.conflict import check_agent_conflict, evaluate_promise
from app.engine.attribution import attribute_outcome
from app.engine.allocator import score_case, allocate_portfolio

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


# ---------- webhook signature + idempotency ----------

def _sign(body: bytes) -> str:
    return hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def test_webhook_valid_signature_accepted():
    payload = {"event": "payment.failed", "event_id": "evt_1", "payload": {}}
    body = json.dumps(payload).encode()
    resp = client.post("/api/webhooks/razorpay", data=body, headers={"X-Razorpay-Signature": _sign(body)})
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


def test_webhook_invalid_signature_rejected():
    payload = {"event": "payment.failed", "event_id": "evt_2", "payload": {}}
    body = json.dumps(payload).encode()
    resp = client.post("/api/webhooks/razorpay", data=body, headers={"X-Razorpay-Signature": "bad-signature"})
    assert resp.status_code == 401


def test_webhook_duplicate_event_ignored():
    payload = {"event": "payment.failed", "event_id": "evt_dup", "payload": {}}
    body = json.dumps(payload).encode()
    headers = {"X-Razorpay-Signature": _sign(body)}
    first = client.post("/api/webhooks/razorpay", data=body, headers=headers)
    second = client.post("/api/webhooks/razorpay", data=body, headers=headers)
    assert first.json()["status"] == "accepted"
    assert second.json()["status"] == "duplicate_ignored"


def test_signature_helper_rejects_missing_header():
    assert verify_signature(b"{}", "") is False


# ---------- policy gate ----------

def test_policy_blocks_on_agent_conflict():
    checks = run_policy_gate(
        action="payment_link", consent_given=True, opted_out=False, contacts_last_24h=0,
        contact_window_ok=True, payment_already_captured=False, budget_remaining=1000,
        action_cost=4, agent_conflict=True, promise_active=False,
        requires_human_approval=False, human_approved=False,
    )
    assert policy_allows(checks) is False


def test_policy_allows_clean_case():
    checks = run_policy_gate(
        action="payment_link", consent_given=True, opted_out=False, contacts_last_24h=0,
        contact_window_ok=True, payment_already_captured=False, budget_remaining=1000,
        action_cost=4, agent_conflict=False, promise_active=False,
        requires_human_approval=False, human_approved=False,
    )
    assert policy_allows(checks) is True


def test_policy_blocks_on_promise_to_pay():
    checks = run_policy_gate(
        action="voice", consent_given=True, opted_out=False, contacts_last_24h=0,
        contact_window_ok=True, payment_already_captured=False, budget_remaining=1000,
        action_cost=65, agent_conflict=False, promise_active=True,
        requires_human_approval=False, human_approved=False,
    )
    assert policy_allows(checks) is False


# ---------- agent conflict + promise suppression ----------

def test_agent_conflict_detected():
    result = check_agent_conflict(["subscription_agent", "cart_agent"])
    assert result.conflict is True
    assert "subscription_agent" in result.blocking_agents


def test_no_conflict_when_no_active_agents():
    result = check_agent_conflict([])
    assert result.conflict is False


def test_promise_suppresses_other_actions_until_deadline():
    now = datetime.utcnow()
    state = evaluate_promise(status="active", deadline=now + timedelta(days=1), now=now, payment_detected=False)
    assert state.status == "active"
    assert state.suppress_other_actions is True


def test_promise_broken_after_deadline():
    now = datetime.utcnow()
    state = evaluate_promise(status="active", deadline=now - timedelta(hours=1), now=now, payment_detected=False)
    assert state.status == "broken"
    assert state.suppress_other_actions is False


def test_promise_fulfilled_on_payment():
    now = datetime.utcnow()
    state = evaluate_promise(status="active", deadline=now + timedelta(days=1), now=now, payment_detected=True)
    assert state.status == "fulfilled"


# ---------- self-cure attribution ----------

def test_self_cure_attribution_not_credited_to_intervention():
    attr = attribute_outcome(amount=10000, natural_recovery_prob=0.9, action_taken="wait", recovered=True)
    assert attr.category == "self_cure"
    assert attr.intervention_attributed_amount == 0.0
    assert attr.recovered_amount == 10000


def test_not_recovered_attribution():
    attr = attribute_outcome(amount=5000, natural_recovery_prob=0.5, action_taken="wait", recovered=False)
    assert attr.category == "not_recovered"
    assert attr.recovered_amount == 0.0


def test_intervention_attributed_low_natural_baseline():
    attr = attribute_outcome(amount=5000, natural_recovery_prob=0.1, action_taken="payment_link", recovered=True)
    assert attr.category == "intervention_attributed"
    assert attr.intervention_attributed_amount > 0


# ---------- WAIT as a real candidate action + allocator ----------

def test_wait_is_a_scored_candidate():
    score = score_case(case_ref="C-TEST", leak_type="subscription", amount=5000, age_hours=10, prior_self_cure_rate=0.8)
    actions = [c.action for c in score.candidates]
    assert "wait" in actions


def test_allocator_falls_back_to_wait_when_budget_exhausted():
    score = score_case(case_ref="C-TEST2", leak_type="cart", amount=20000, age_hours=5, prior_self_cure_rate=0.1)
    results = allocate_portfolio([score], budget=0, contact_capacity=10, voice_capacity=10, human_capacity=10)
    assert results[0].action == "wait"


# ---------- end-to-end: payment.failed -> decision -> outcome -> attribution -> dashboard ----------

def test_seed_can_run_twice_without_unique_errors():
    from app.seed import seed

    seed(n_cases=5, budget=10000, contact_capacity=100, voice_capacity=20, human_capacity=10, seed_val=7)
    seed(n_cases=5, budget=10000, contact_capacity=100, voice_capacity=20, human_capacity=10, seed_val=7)

    portfolio_resp = client.get("/api/portfolio")
    assert portfolio_resp.status_code == 200
    assert len(portfolio_resp.json()) >= 5


def test_end_to_end_flow():
    from app.seed import seed
    seed(n_cases=5, budget=10000, contact_capacity=100, voice_capacity=20, human_capacity=10, seed_val=7)

    portfolio_resp = client.get("/api/portfolio")
    assert portfolio_resp.status_code == 200
    cases = portfolio_resp.json()
    assert len(cases) == 5
    for c in cases:
        assert "wait" in [a["action"] for a in c["actions"]]

    ledger_resp = client.get("/api/ledger")
    assert ledger_resp.status_code == 200
    ledger = ledger_resp.json()
    assert ledger["gross_recovered"] >= 0
    assert ledger["net_incremental_value"] == pytest.approx(
        ledger["gross_recovered"] - ledger["natural_self_cure"] - ledger["intervention_cost"], rel=1e-6
    )

    first_case_ref = cases[0]["case_ref"]
    trace_resp = client.get(f"/api/cases/{first_case_ref}")
    assert trace_resp.status_code == 200
    stages = [t["stage"] for t in trace_resp.json()["trace"]]
    assert "final_decision" in stages
