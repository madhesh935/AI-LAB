"""REST API response times on this machine (real uvicorn process, real SQLite file, seeded DEMO data on a scratch database).

    python scripts/benchmark_api.py [--requests 100] [--out docs/eval/api_latency.json]

Each endpoint is called sequentially over one keep-alive connection after a warm-up; the table reports min/median/p95/max in milliseconds
and the HTTP status codes seen (a non-200 is reported, not hidden). No Ollama call is made here (copilot provider = none): Copilot
latency is measured separately by scripts/evaluate_copilot.py with the real model.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PY = BACKEND / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = Path(sys.executable)
PORT = 8011
STORE = "store-blr-104"
ENDPOINTS = [
    "/api/health", "/api/stores", f"/api/stores/{STORE}/overview", f"/api/stores/{STORE}/occupancy", f"/api/stores/{STORE}/shopper-analytics?range=today",
    f"/api/stores/{STORE}/inventory", f"/api/stores/{STORE}/queue-intelligence", f"/api/stores/{STORE}/staff/availability", f"/api/stores/{STORE}/tasks?limit=50",
    f"/api/stores/{STORE}/alerts?status=active", f"/api/stores/{STORE}/insights", "/api/copilot/health", "/api/system/health",
]


def pct(v, p):
    s = sorted(v)
    return s[min(len(s) - 1, int(len(s) * p))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--requests", type=int, default=100)
    ap.add_argument("--out", default=str(BACKEND / "docs" / "eval" / "api_latency.json"))
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="retailedge-apibench-"))
    env = {**os.environ, "RETAILEDGE_DATA_DIR": str(tmp), "RETAILEDGE_PORT": str(PORT), "RETAILEDGE_LOG_JSON": "false", "PYTHONPATH": str(BACKEND), "RETAILEDGE_COPILOT_PROVIDER": "none"}
    subprocess.run([str(PY), "-m", "database.manage", "setup"], cwd=BACKEND, env=env, capture_output=True, check=True)
    subprocess.run([str(PY), "-m", "database.manage", "seed-demo"], cwd=BACKEND, env=env, capture_output=True, check=True)
    proc = subprocess.Popen([str(PY), "run.py"], cwd=BACKEND, env=env, stdout=open(tmp / "api.log", "wb"), stderr=subprocess.STDOUT)
    rows = []
    try:
        conn = None
        for _ in range(80):
            try:
                conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
                conn.request("GET", "/api/health")
                conn.getresponse().read()
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise SystemExit("API did not start")
        for path in ENDPOINTS:
            codes, ms, size = set(), [], 0
            for i in range(args.requests + 5):
                t = time.perf_counter()
                conn.request("GET", path)
                r = conn.getresponse()
                body = r.read()
                dt = (time.perf_counter() - t) * 1000
                if i >= 5:  # warm-up
                    ms.append(dt)
                codes.add(r.status)
                size = len(body)
            rows.append({"path": path, "status": sorted(codes), "bytes": size, "min_ms": round(min(ms), 1), "median_ms": round(statistics.median(ms), 1), "p95_ms": round(pct(ms, 0.95), 1), "max_ms": round(max(ms), 1)})
            print(f"{path:<62} {sorted(codes)} median {rows[-1]['median_ms']:>7} ms  p95 {rows[-1]['p95_ms']:>7} ms  {size} B", flush=True)
    finally:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    out = {"requestsPerEndpoint": args.requests, "note": "sequential, one keep-alive connection, localhost, seeded DEMO database, no vision worker, no LLM", "endpoints": rows}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
