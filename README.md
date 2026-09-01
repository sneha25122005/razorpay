# Razorpay Demo + Recover Frontend

This repository contains two related frontend/backend projects that were developed and run together in a single workspace:

- razorpaydemo: a Vite React app with a FastAPI backend for the Razorpay demo flow
- recover-frontend: a separate Vite React frontend for the recovery dashboard experience

## Project structure

- `razorpaydemo/` — React frontend + Python backend
- `recover-frontend/` — React + TypeScript + Vite app
- `.gitignore` — repo-level ignore rules

## Run locally

### 1) Backend (razorpaydemo)

```bash
cd razorpaydemo
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# or Git Bash / bash
source .venv/bin/activate
pip install -r requirements.txt
python -m app.seed
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then open:

- http://localhost:8000/docs
- http://localhost:8000/health

### 2) Razorpay demo frontend

```bash
cd razorpaydemo
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open:

- http://localhost:5173/

### 3) Recover frontend

```bash
cd recover-frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5174
```

Open:

- http://localhost:5174/

## Notes

- The backend in `razorpaydemo` is a FastAPI app.
- The frontend apps are Vite-based React apps.
- The repo is configured to keep generated files, node_modules, virtual environments, and database files out of source control.

## GitHub

Repository:

- https://github.com/sneha25122005/razorpay.git

## Production / deployment notes

- Use a separate environment for backend secrets and database configuration.
- Keep the frontend and backend URLs aligned when deploying to a real server.
- Use separate build/deploy pipelines if these are split into independent services later.
