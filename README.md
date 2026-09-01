# Recover — Payment Recovery Intelligence Platform

This repository is the foundation for a revenue-recovery and financial-control platform built around Razorpay payment failures, churn risk, and intelligent recovery decisions.

It combines:

- a FastAPI backend decision engine for scoring, pricing, and policy enforcement
- a Razorpay demo frontend showing how the recovery flow works
- a separate React dashboard for monitoring and intervention strategy

The goal is to reduce failed-payment revenue loss, surface the best recovery action for each customer, and make the whole flow measurable, auditable, and explainable.

## What this website/app is for

The product is designed to help a business answer questions like:

- Which customers are likely to recover naturally?
- Which ones need an intervention?
- Should the business retry payment, send a reminder, offer a payment link, or do nothing?
- Which action gives the best return for the least cost?
- How do we track outcomes and explain the decisions?

In short, this is a financial recovery control plane for payment events. It is built to:

- read payment failures and event streams
- evaluate customer risk and recovery potential
- generate candidate recovery actions
- apply budget, capacity, and policy constraints
- rank interventions by expected value and impact
- show a dashboard of portfolio health, outcomes, and ledger attribution

## What the system does

### 1. Payment event intake
The backend can ingest Razorpay webhook events, verify signatures, and guard against duplicate processing.

### 2. Recovery scoring
It calculates natural recovery likelihood and uplift from actions such as payment retry, outreach, or human follow-up.

### 3. Decision engine
The app uses a deterministic engine to:

- score candidates
- apply business rules
- suppress impossible or conflicting actions
- allocate budget across the best opportunities

### 4. Portfolio monitoring
The frontend dashboards show the current financial view:

- at-risk cases
- recovery opportunity
- portfolio allocation
- decision causes and interventions

### 5. Causal accountability
The system tracks what happened after an action was taken so teams can see whether the intervention caused the improvement versus simple natural recovery.

## Project structure

```text
.
├── README.md
├── .gitignore
├── razorpaydemo/
│   ├── app/
│   ├── src/
│   ├── requirements.txt
│   ├── package.json
│   └── ...
├── recover-frontend/
│   ├── src/
│   ├── package.json
│   └── ...
└── index.html
```

## App components

### razorpaydemo
This project includes the backend and the main demo frontend. It is the technical core with:

- FastAPI backend
- SQLAlchemy + SQLite-ready data layer
- seed data generation
- Razorpay webhook verification logic
- decision and allocation engine
- API endpoints for portfolio and ledger views

### recover-frontend
This is the user-facing dashboard/front-end experience for the recovery control plane. It is designed to show monitoring, decisions, and action states clearly.

## Local development

### 1) Start the backend

```bash
cd razorpaydemo
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
python -m app.seed
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open:

- http://localhost:8000/docs
- http://localhost:8000/health

### 2) Start the Razorpay demo frontend

```bash
cd razorpaydemo
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open:

- http://localhost:5173/

### 3) Start the recover dashboard frontend

```bash
cd recover-frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

Open:

- http://localhost:5174/

## Deployment guide

This project can be deployed in a few common ways depending on how you want to host it.

### Option 1: Deploy backend on Render or Railway

This is the best option for the FastAPI app if you want a simple production setup.

1. Push your backend repo or keep it in the same repo and deploy the `razorpaydemo` folder as a service.
2. Set environment variables:

```bash
DATABASE_URL=postgresql://user:password@host:5432/recover_db
RAZORPAY_WEBHOOK_SECRET=your_secret_here
API_BASE_URL=https://your-backend-domain.com
```

3. Build command:

```bash
pip install -r requirements.txt
python -m app.seed
```

4. Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

5. Use a managed Postgres database instead of SQLite for production.

Note: SQLite is fine for local/dev demo work, but production systems should use a proper database like PostgreSQL.

### Option 2: Deploy frontend apps to Vercel or Netlify

The React Vite apps can be deployed as static sites.

#### For `razorpaydemo`

```bash
cd razorpaydemo
npm install
npm run build
```

Then deploy the generated `dist` folder to Vercel or Netlify.

#### For `recover-frontend`

```bash
cd recover-frontend
npm install
npm run build
```

Then deploy the generated `dist` folder to Vercel or Netlify.

### Option 3: One combined deployment

If you want the simplest demonstration setup:

- deploy the FastAPI app to Render/Railway
- deploy the frontend to Vercel
- configure the frontend to call the backend API via environment variables such as:

```bash
VITE_API_BASE_URL=https://your-backend-domain.com
```

## Production recommendations

- Use PostgreSQL instead of SQLite in production.
- Keep Razorpay webhook secrets in environment variables.
- Use HTTPS everywhere.
- Use a reverse proxy or cloud platform with SSL.
- Add monitoring for failed webhook events and API errors.
- Add automated backups for the database.

## GitHub

Repository:

- https://github.com/sneha25122005/razorpay.git

## Future vision

This project is designed to grow into a full recovery intelligence platform that can:

- predict which interventions are worth paying for
- automate outreach workflows
- trigger payment recovery actions
- optimize budget allocation per portfolio segment
- show real financial ROI from recovery efforts

## Summary

This project is not just a demo. It is a working concept for a payment recovery and monetization system that turns failed transactions into recoverable revenue through data-driven decision-making, action ranking, and portfolio optimization.
