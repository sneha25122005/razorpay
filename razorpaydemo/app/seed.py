import random
from datetime import datetime, timedelta

from app.database import Base, engine, SessionLocal
from app import models
from app.engine.synthetic_simulator import generate_cases, simulate_outcome
from app.engine.allocator import score_case, allocate_portfolio
from app.engine.policy import run_policy_gate, policy_allows, POLICY_VERSION
from app.engine.conflict import check_agent_conflict
from app.engine.attribution import attribute_outcome
from app.engine.models_ml import MODEL_VERSION


def seed(n_cases: int = 30, budget: float = 10000, contact_capacity: int = 500,
         voice_capacity: int = 100, human_capacity: int = 50, seed_val: int = 42):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    rng = random.Random(seed_val)

    raw_cases = generate_cases(n_cases, seed=seed_val)
    scores = [
        score_case(case_ref=c.case_ref, leak_type=c.leak_type, amount=c.amount,
                   age_hours=c.age_hours, prior_self_cure_rate=c.prior_self_cure_rate)
        for c in raw_cases
    ]
    allocation = {a.case_ref: a for a in allocate_portfolio(scores, budget, contact_capacity, voice_capacity, human_capacity)}

    customer = db.query(models.Customer).filter_by(external_ref="demo-customer-pool").first()
    if customer is None:
        customer = models.Customer(external_ref="demo-customer-pool")
        db.add(customer)
        db.flush()

    for raw, score in zip(raw_cases, scores):
        existing_leak = db.query(models.RevenueLeakEvent).filter_by(case_ref=raw.case_ref).first()
        if existing_leak is not None:
            continue

        alloc = allocation[raw.case_ref]

        # simulate agent conflict for ~14% of cases, promise-to-pay for ~6%
        conflict_roll = rng.random()
        active_agents = ["subscription_agent", "cart_agent"] if conflict_roll > 0.86 else []
        conflict = check_agent_conflict(active_agents)

        promise_active = rng.random() > 0.94

        policy_checks = run_policy_gate(
            action=alloc.action,
            consent_given=True,
            opted_out=False,
            contacts_last_24h=rng.randint(0, 2),
            contact_window_ok=True,
            payment_already_captured=False,
            budget_remaining=budget,
            action_cost=next(c.cost for c in score.candidates if c.action == alloc.action),
            agent_conflict=conflict.conflict,
            promise_active=promise_active,
            requires_human_approval=(alloc.action == "human"),
            human_approved=True,
        )
        allowed = policy_allows(policy_checks)

        final_decision = alloc.action
        if promise_active:
            final_decision = "lock"
        elif conflict.conflict or not allowed:
            final_decision = "suppress"

        leak = models.RevenueLeakEvent(
            case_ref=raw.case_ref,
            customer_id=customer.id,
            leak_type=raw.leak_type,
            amount_at_risk=raw.amount,
            status="open",
            natural_recovery_prob=score.natural_recovery_prob,
            model_version=MODEL_VERSION,
            created_at=datetime.utcnow() - timedelta(hours=raw.age_hours),
        )
        db.add(leak)
        db.flush()

        for cand in score.candidates:
            db.add(models.Intervention(
                leak_event_id=leak.id,
                action_type=cand.action,
                predicted_recovery_prob=cand.recovery_prob,
                predicted_incremental_prob=cand.incremental_prob,
                expected_incremental_value=cand.expected_incremental_value,
                cost=cand.cost,
                executed=(cand.action == final_decision and final_decision not in ("suppress", "lock")),
                executed_at=datetime.utcnow() if cand.action == final_decision else None,
            ))

        for check in policy_checks:
            db.add(models.PolicyAuditLog(
                leak_event_id=leak.id, check_name=check.check_name, passed=check.passed,
                reason=check.reason, policy_version=POLICY_VERSION,
            ))

        if active_agents:
            for a in active_agents:
                db.add(models.AgentRegistry(customer_id=customer.id, agent_name=a, status="active", simulated=True))
        db.add(models.AgentRegistry(customer_id=customer.id, agent_name="our_agent",
                                     status="blocked" if conflict.conflict else "active", simulated=False))

        if promise_active:
            db.add(models.PromiseToPay(
                leak_event_id=leak.id, customer_id=customer.id, amount=raw.amount,
                promise_text="Customer committed to pay by end of week.",
                promise_date=datetime.utcnow(), deadline=datetime.utcnow() + timedelta(days=3),
                status="active",
            ))

        # simulate the actual outcome and attribute it
        executed_action = final_decision if final_decision not in ("suppress", "lock") else "wait"
        outcome = simulate_outcome(raw, executed_action, rng)
        attribution = attribute_outcome(
            amount=raw.amount, natural_recovery_prob=score.natural_recovery_prob,
            action_taken=executed_action, recovered=outcome["recovered"],
        )
        db.add(models.Outcome(
            leak_event_id=leak.id, recovered_amount=attribution.recovered_amount,
            recovered_at=datetime.utcnow() if outcome["recovered"] else None,
            attribution_category=attribution.category, confidence=attribution.confidence,
        ))

        stages = [
            ("payment.failed", {"case_ref": raw.case_ref}, {"status": "leak_opened"}),
            ("natural_recovery_model", {"leak_type": raw.leak_type}, {"probability": score.natural_recovery_prob}),
            ("candidate_actions", {}, {"count": len(score.candidates)}),
            ("portfolio_allocator", {}, {"recommended": alloc.action, "funded": alloc.funded}),
            ("policy_gate", {}, {"allowed": allowed}),
            ("agent_conflict_check", {}, {"conflict": conflict.conflict}),
            ("final_decision", {}, {"decision": final_decision}),
        ]
        for stage, inp, out in stages:
            db.add(models.DecisionTrace(
                leak_event_id=leak.id, stage=stage, input_json=inp, output_json=out,
                model_version=MODEL_VERSION, policy_version=POLICY_VERSION,
                reason=policy_checks[0].reason if stage == "policy_gate" and not allowed else None,
            ))

    db.commit()
    db.close()
    print(f"Seeded {n_cases} cases.")


if __name__ == "__main__":
    seed()
