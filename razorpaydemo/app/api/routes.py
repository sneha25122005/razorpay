import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models, schemas
from app.integrations.razorpay.webhook import verify_signature
from app.engine.allocator import score_case, allocate_portfolio

router = APIRouter()


@router.get("/portfolio")
def get_portfolio(db: Session = Depends(get_db)):
    cases = db.query(models.RevenueLeakEvent).all()
    out = []
    for leak in cases:
        interventions = db.query(models.Intervention).filter_by(leak_event_id=leak.id).all()
        conflict = db.query(models.AgentRegistry).filter_by(
            customer_id=leak.customer_id, status="active"
        ).filter(models.AgentRegistry.agent_name != "our_agent").first()
        policy_fail = db.query(models.PolicyAuditLog).filter_by(
            leak_event_id=leak.id, passed=False
        ).first()
        promise = db.query(models.PromiseToPay).filter_by(leak_event_id=leak.id, status="active").first()
        executed = next((i for i in interventions if i.executed), None)
        final = executed.action_type if executed else "suppress"
        if promise:
            final = "lock"
        elif conflict or policy_fail:
            final = "suppress"

        actions = [schemas.ActionOut(
            action=i.action_type, cost=i.cost, recovery_prob=i.predicted_recovery_prob,
            incremental_prob=i.predicted_incremental_prob,
            expected_incremental_value=i.expected_incremental_value,
            net_value=i.expected_incremental_value - i.cost,
        ) for i in interventions]
        best = max(actions, key=lambda a: a.net_value).action if actions else "wait"

        out.append(schemas.CaseOut(
            case_ref=leak.case_ref, leak_type=leak.leak_type, amount_at_risk=leak.amount_at_risk,
            age_hours=(datetime.utcnow() - leak.created_at).total_seconds() / 3600,
            natural_recovery_prob=leak.natural_recovery_prob, best_action=best, final_decision=final,
            agent_conflict=bool(conflict), conflict_reason=(f"{conflict.agent_name} active" if conflict else None),
            policy_allowed=not bool(policy_fail), policy_reason=(policy_fail.reason if policy_fail else None),
            promise_active=bool(promise), actions=actions,
        ))
    return out


@router.get("/cases/{case_ref}")
def get_case(case_ref: str, db: Session = Depends(get_db)):
    leak = db.query(models.RevenueLeakEvent).filter_by(case_ref=case_ref).first()
    if not leak:
        raise HTTPException(404, "Case not found")
    trace = db.query(models.DecisionTrace).filter_by(leak_event_id=leak.id).order_by(models.DecisionTrace.created_at).all()
    return {
        "case_ref": leak.case_ref,
        "trace": [{
            "stage": t.stage, "input": t.input_json, "output": t.output_json,
            "model_version": t.model_version, "policy_version": t.policy_version,
            "reason": t.reason, "timestamp": t.created_at.isoformat(),
        } for t in trace],
    }


@router.get("/ledger", response_model=schemas.LedgerOut)
def get_ledger(db: Session = Depends(get_db)):
    outcomes = db.query(models.Outcome).all()
    leaks_by_id = {l.id: l for l in db.query(models.RevenueLeakEvent).all()}

    gross = sum(o.recovered_amount for o in outcomes)
    natural = sum(
        (leaks_by_id[o.leak_event_id].amount_at_risk * leaks_by_id[o.leak_event_id].natural_recovery_prob)
        for o in outcomes if o.leak_event_id in leaks_by_id
    )
    intervention_attributed = sum(
        (o.recovered_amount - leaks_by_id[o.leak_event_id].amount_at_risk * leaks_by_id[o.leak_event_id].natural_recovery_prob)
        for o in outcomes if o.attribution_category == "intervention_attributed" and o.leak_event_id in leaks_by_id
    )
    cost = db.query(func.sum(models.Intervention.cost)).filter(models.Intervention.executed == True).scalar() or 0

    net = gross - natural - cost
    return schemas.LedgerOut(
        gross_recovered=gross, natural_self_cure=natural, intervention_attributed=max(0, intervention_attributed),
        intervention_cost=cost, net_incremental_value=net,
        confidence_low=net * 0.85, confidence_high=net * 1.15,
    )


@router.post("/decision-lab/recalculate")
def recalculate(req: schemas.RecalcRequest, db: Session = Depends(get_db)):
    """Genuine backend recalculation (Part 8) — re-runs the allocator against
    new constraints over the current case set and returns the new mix."""
    leaks = db.query(models.RevenueLeakEvent).all()
    scores = []
    for leak in leaks:
        interventions = db.query(models.Intervention).filter_by(leak_event_id=leak.id).all()
        from app.engine.allocator import CaseScore, CandidateAction
        candidates = [CandidateAction(
            action=i.action_type, cost=i.cost, recovery_prob=i.predicted_recovery_prob,
            incremental_prob=i.predicted_incremental_prob,
            expected_incremental_value=i.expected_incremental_value,
            net_value=i.expected_incremental_value - i.cost,
        ) for i in interventions]
        best = max(candidates, key=lambda c: c.net_value).action if candidates else "wait"
        scores.append(CaseScore(leak.case_ref, leak.leak_type, leak.amount_at_risk, leak.natural_recovery_prob, candidates, best))

    allocation = allocate_portfolio(scores, req.budget, req.contact_capacity, req.voice_capacity, req.human_capacity)
    mix = {}
    for a in allocation:
        mix[a.action] = mix.get(a.action, 0) + 1
    return {"allocation_mix": mix, "cases": [{"case_ref": a.case_ref, "action": a.action, "funded": a.funded} for a in allocation]}


@router.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    signature_valid = verify_signature(raw_body, signature)

    payload = json.loads(raw_body)
    event_id = payload.get("event_id") or payload.get("payload", {}).get("payment", {}).get("entity", {}).get("id")
    event_type = payload.get("event", "unknown")

    if not event_id:
        raise HTTPException(400, "Missing event identifier for idempotency")

    existing = db.query(models.WebhookEvent).filter_by(provider_event_id=event_id).first()
    if existing:
        return {"status": "duplicate_ignored", "event_id": event_id}

    wh = models.WebhookEvent(
        provider_event_id=event_id, event_type=event_type, raw_payload=payload,
        signature_valid=signature_valid, processed=False,
    )
    db.add(wh)
    db.commit()

    if not signature_valid:
        raise HTTPException(401, "Invalid webhook signature")

    # Processing is intentionally minimal here — a real deployment would
    # enqueue this onto a background worker (Part 19/23) rather than process
    # inline, to keep the webhook handler fast and idempotent under retries.
    wh.processed = True
    wh.processed_at = datetime.utcnow()
    db.commit()
    return {"status": "accepted", "event_id": event_id}
