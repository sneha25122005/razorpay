# RECOVER // Financial Control Plane — Backend

A real, runnable FastAPI backend implementing the core decision engine:
natural-recovery scoring, candidate-action generation, incremental-value
calculation, a budget-constrained portfolio allocator, a deterministic
policy gate, agent-conflict resolution, promise-to-pay suppression, causal
attribution, and Razorpay webhook ingestion (signature verification +
idempotency).

This is Phases 1–12 and part of 19–21 of the original 21-phase build plan —
the backend foundation the frontend (Command Center / Portfolio / Decision
Drawer, delivered separately as an in-chat React demo) is designed to sit on
top of. It is **not** a mock: every number below comes from a trained
scikit-learn model, a real allocator run, and rows in a database.

## What's real vs simplified here

| Spec item | Status |
|---|---|
| Natural recovery model | Real `LogisticRegression`, trained on synthetic historical outcomes at process start |
| Uplift models (payment link / voice / human) | Real, one `LogisticRegression` per action |
| Portfolio allocator | Real greedy budget/capacity-constrained allocation, re-runnable via `/api/decision-lab/recalculate` |
| Policy gate | Real deterministic rule engine (`app/engine/policy.py`) — no model can override it |
| Agent conflict / registry | Real registry table for **our** agent; external-agent state (Subscription/Cart agents) is a labeled simulator, since no public Razorpay Agent Studio API is verified to exist (Part 22) |
| Promise-to-pay suppression | Real state machine (`app/engine/conflict.py`) |
| Causal attribution | Real, nets out the natural-recovery baseline before crediting intervention |
| Webhook signature + idempotency | Real HMAC-SHA256 verification per Razorpay's documented scheme, real dedupe on `event_id` |
| Database | SQLite by default (zero config); models use only Postgres-portable types — set `DATABASE_URL` to a Postgres DSN and run `alembic` migrations (not yet scaffolded) to move to Postgres |
| Background jobs (Celery/Arq) | **Not yet implemented** — webhook processing currently runs inline in the request. Arq is the recommended choice (async-native, lighter than Celery, no separate broker config needed beyond Redis) once processing needs to move off the request path |
| Payment Links as a real actuator | **Not yet implemented** — `app/integrations/razorpay/` currently only has webhook verification. Creating real test-mode Payment Links via Razorpay's official SDK is the next integration to add |
| Experiments (control/baseline/our-policy) | **Not yet implemented** |
| Command Center / Portfolio / Decision Drawer UI | Delivered separately as `recover-demo.jsx`, a client-side visual prototype — not yet wired to this API (see "Next" below) |

## Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# seed synthetic demo data (creates ./recover.db)
python -m app.seed

# run the API
uvicorn app.main:app --reload
```

Then visit `http://localhost:8000/docs` for interactive API docs, or:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/portfolio
curl http://localhost:8000/api/ledger
curl -X POST http://localhost:8000/api/decision-lab/recalculate \
  -H "Content-Type: application/json" \
  -d '{"budget": 50000, "contact_capacity": 500, "voice_capacity": 100, "human_capacity": 50}'
```

Run tests:

```bash
pytest app/tests/ -v
```

18 tests cover: webhook signature validation, webhook deduplication, policy
gate (agent conflict, promise-to-pay, clean-pass), conflict detection,
promise-to-pay suppression/fulfillment/breaking, self-cure attribution
(never credited to intervention), the allocator's WAIT fallback under
budget exhaustion, and one full end-to-end flow (`payment.failed` → decision
→ outcome → attribution → dashboard).

## Project layout

```
app/
  main.py                  FastAPI entrypoint
  database.py               SQLAlchemy engine/session (SQLite default, Postgres-ready)
  models.py                  All 14 tables from the spec
  schemas.py                 Pydantic response models
  seed.py                     Synthetic demo data generator, seeds via the real engine
  api/routes.py               /api/portfolio, /api/cases/{ref}, /api/ledger,
                               /api/decision-lab/recalculate, /api/webhooks/razorpay
  engine/
    synthetic_simulator.py    Generates cases with HIDDEN ground truth (used only
                               to simulate outcomes, never fed to the models)
    models_ml.py               Natural-recovery + uplift LogisticRegression models
    allocator.py                Candidate-action scoring + budget-constrained allocation
    policy.py                    Deterministic policy checks
    conflict.py                   Agent conflict + promise-to-pay state machine
    attribution.py                 Causal ledger attribution logic
  integrations/razorpay/
    webhook.py                 HMAC-SHA256 signature verification (Razorpay's
                                 documented scheme — no invented endpoints/fields)
  tests/test_engine.py        18 tests, see above
```

## Next (to reach the full 21-phase spec)

1. Wire `recover-demo.jsx` to these endpoints instead of its local synthetic
   generator (swap `useSyntheticPortfolio` for `useQuery` against `/api/portfolio`).
2. Add Arq + Redis for async webhook processing off the request path.
3. Add real Razorpay Payment Link creation via the official SDK as the
   `payment_link` actuator.
4. Add the Experiments module (control/baseline/our-policy arms + CI comparison).
5. Add Alembic migrations and a `docker-compose.yml` for Postgres + Redis.
6. Build out Agent Control, Causal Ledger, Experiments, and Policy Engine
   frontend pages against the corresponding (mostly-existing) backend logic.
