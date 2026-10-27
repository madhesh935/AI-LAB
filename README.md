# RetailEdge AI — Intelligent Retail Analytics & Operations Platform

Smart India Hackathon style, enterprise-grade edge computer vision and store operations platform.

## Architecture

1. **Frontend**: React + TypeScript + Vite + Tailwind CSS + Lucide Icons + Recharts
2. **Backend**: Python FastAPI with allowlisted retail tools, store-scoped data access, and two-phase action confirmation.
3. **AI Provider**: OpenRouter (default a free model, `nvidia/nemotron-3.5-lightning:free`, with free fallbacks; key in `backend/.env`) with allowlisted, database-grounded tools; without an API key the Copilot answers
   from the same tools by keyword routing and says so. Video and detections stay on this machine; only the Copilot's prompts (tool results) go to OpenRouter.
4. **Vision worker** (`python -m vision`): YOLO11n person detection + ByteTrack on a laptop webcam (`usb`), RTSP/HTTP stream or video file.

The complete, honest status of every module (what is real, what is DEMO, what is blocked) is in
[backend/docs/PHASE5_REPORT.md](backend/docs/PHASE5_REPORT.md).

---

## Getting Started

### One command (API + vision worker + frontend, then real per-component health)

```bash
cd backend
.venv/Scripts/python scripts/start_all.py            # --status to inspect, --stop to stop what it started
echo OPENROUTER_API_KEY=sk-or-... >> .env           # once, for the language model (optional)
```

### 1. Start the Frontend

```bash
npm install
npm run dev
```

The application runs at `http://localhost:5173/`.

### 2. Start the Backend (FastAPI + SQLite)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m database.manage setup      # create / migrate backend/data/retailedge.db
.venv/Scripts/python -m database.manage seed-demo  # optional demo data (explicit opt-in)
.venv/Scripts/python run.py                        # http://127.0.0.1:8000  (docs: /docs)
```

No authentication: the API binds to localhost only. See [backend/README.md](backend/README.md) and
[backend/docs/PHASE1_AUDIT.md](backend/docs/PHASE1_AUDIT.md).

> Frontend data modes: `VITE_DATA_MODE=real` (default) reads only the backend (`VITE_API_URL`, e.g. `http://127.0.0.1:8000`);
> `VITE_DATA_MODE=demo` browses labelled sample data with no backend.
> The seeded stores are DEMO fixtures (staff, shelves, tasks, alerts). Footfall, occupancy, queue length and zone dwell are meant to come from the camera: the demo seed's
> hourly footfall/dwell numbers are fixtures, so do not re-run `seed-demo` on a database you want to feed from the webcam.
> Point cameras at your laptop webcam with `PUT /api/cameras/{id}/source` `{"sourceType":"usb","sourceRef":"0","enabled":true}`. Several camera entries may share the one webcam
> (one reader serves them all); what each one measures depends on the entrance line / queue lanes / zones configured for it.

---

## Modules

1. **Main Overview Dashboard** (`/`)
2. **Shopper Analytics** (`/shopper-analytics`)
3. **Smart Inventory** (`/smart-inventory`)
4. **Queue Intelligence** (`/queue-intelligence`)
5. **Live Camera Monitoring** (`/live-cameras`)
6. **AI Insights & Recommendations** (`/ai-insights`)
7. **Reports & Analytics** (`/reports`)
8. **Store Copilot AI** (`/store-copilot`)
