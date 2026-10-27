"""One command to start (and stop) the complete local RetailEdge system.

    python scripts/start_all.py            # API + vision worker + frontend, then print real per-component health
    python scripts/start_all.py --status   # print health of whatever is running, start nothing
    python scripts/start_all.py --stop     # stop only the processes THIS script started (pids in data/run/pids.json)

Rules it follows:
* Every step reports OK / WARN / FAIL with the real reason. A service that did not come up is reported, never papered over.
* No duplicate workers: if the vision port already answers, that worker is reused. The worker itself also refuses a second instance.
* It never trains models, never pulls an LLM and never seeds data on its own (use --seed-demo explicitly).
* Ctrl+C (or --stop) shuts down only what was started here.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from core.config import get_settings  # noqa: E402

PY = BACKEND / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = BACKEND / ".venv" / "bin" / "python"
if not PY.exists():
    PY = Path(sys.executable)


def say(level: str, msg: str) -> None:
    print(f"  [{level:<4}] {msg}", flush=True)


def listening(host: str, port: int) -> bool:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET  # an IPv6 literal such as ::1 cannot be resolved on an AF_INET socket
    try:
        with socket.socket(family, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            return s.connect_ex((host, port)) == 0
    except OSError:
        return False


def http_json(url: str, timeout: float = 2.0) -> Optional[Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception:  # noqa: BLE001
        return None


def wait_for(fn, seconds: float, every: float = 0.5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    return None


def kill_tree(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except OSError:
            pass


class Runner:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.s = get_settings()
        self.run_dir = self.s.data_dir / "run"
        self.log_dir = self.s.data_dir / "logs"
        self.pids: Dict[str, int] = {}
        self.api = f"http://127.0.0.1:{self.s.port}"

    # ------------------------------------------------------------------ pid bookkeeping
    def load_pids(self) -> Dict[str, int]:
        f = self.run_dir / "pids.json"
        return json.loads(f.read_text()) if f.exists() else {}

    def save_pids(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "pids.json").write_text(json.dumps(self.pids))

    # ------------------------------------------------------------------ steps
    def validate(self) -> bool:
        ok = True
        print("1. Environment")
        if sys.version_info < (3, 10):
            say("FAIL", f"Python {sys.version.split()[0]} is too old (need 3.10+)")
            return False
        say("OK", f"Python {sys.version.split()[0]} ({PY})")
        for mod in ("fastapi", "uvicorn", "sqlalchemy", "alembic", "httpx"):
            try:
                __import__(mod)
            except ImportError:
                say("FAIL", f"missing Python package '{mod}': run  backend/.venv/Scripts/pip install -r backend/requirements.txt")
                ok = False
        try:
            self.s.data_dir.mkdir(parents=True, exist_ok=True)
            (self.s.data_dir / ".write_test").write_text("x")
            (self.s.data_dir / ".write_test").unlink()
            say("OK", f"data directory writable: {self.s.data_dir}")
        except OSError as exc:
            say("FAIL", f"data directory not writable: {exc}")
            ok = False
        try:
            self.s.assert_safe_bind()
            say("OK", f"API binds {self.s.host}:{self.s.port}" + ("  (LAN mode ON - see docs/LAN_DEPLOYMENT.md)" if self.s.allow_lan else "  (loopback only)"))
        except RuntimeError as exc:
            say("FAIL", str(exc))
            ok = False
        return ok

    def database(self) -> bool:
        print("2. SQLite")
        from database import manage

        try:
            res = manage.upgrade(self.s)
            say("OK", f"{self.s.db_path} at revision {res.get('after') or manage.current_revision(self.s)}" + (f" (backup {Path(res['backup']).name})" if res.get("backup") else ""))
            return True
        except Exception as exc:  # noqa: BLE001
            say("FAIL", f"migration failed: {type(exc).__name__}: {exc}")
            return False

    def models(self) -> None:
        print("3. Model files")
        person = BACKEND / "ai_models" / "person" / "yolo11n.pt"
        say("OK" if person.exists() else "WARN", f"person detector weights: {person}" + ("" if person.exists() else "  (missing: the worker will report ERROR for this model)"))
        shelf = list((BACKEND / "ai_models" / "shelf").rglob("best.pt"))  # weights live in shelf/<run-name>/weights/
        say("OK" if shelf else "WARN", "shelf model: " + (", ".join(p.name for p in shelf) if shelf else "none (no validated shelf model exists; shelf counts only come from posted observations)"))

    def start_proc(self, name: str, cmd: List[str], cwd: Path, env_extra: Optional[Dict[str, str]] = None) -> subprocess.Popen:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        log = open(self.log_dir / f"{name}.log", "ab")
        kw: Dict[str, Any] = {"cwd": str(cwd), "stdout": log, "stderr": subprocess.STDOUT, "env": {**os.environ, **(env_extra or {})}}
        if os.name == "nt":
            kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        else:
            kw["start_new_session"] = True
        p = subprocess.Popen(cmd, **kw)
        self.pids[name] = p.pid
        self.save_pids()
        return p

    def start_api(self) -> bool:
        print("4. FastAPI")
        if http_json(f"{self.api}/api/health"):
            say("OK", f"already running at {self.api} (reused, not restarted)")
            return True
        if listening("127.0.0.1", self.s.port):
            # a dev server with --reload can be mid-restart: give it a few seconds before judging
            if wait_for(lambda: http_json(f"{self.api}/api/health"), 12):
                say("OK", f"already running at {self.api} (reused, not restarted)")
                return True
            say("FAIL", f"port {self.s.port} is in use by something that does not answer /api/health as RetailEdge")
            return False
        p = self.start_proc("api", [str(PY), "run.py"], BACKEND)
        up = wait_for(lambda: http_json(f"{self.api}/api/health") or (p.poll() is not None and {}), 40)
        if up:
            say("OK", f"started (pid {p.pid}), log: data/logs/api.log")
            return True
        say("FAIL", f"did not answer on {self.api} - see {self.log_dir / 'api.log'}")
        return False

    def start_worker(self) -> None:
        print("5. Vision worker (person detection + tracking + MJPEG gateway)")
        if self.args.no_worker:
            say("SKIP", "--no-worker")
            return
        url = f"http://127.0.0.1:{self.s.vision_worker_port}/health"
        h = http_json(url)
        if h:
            say("OK", f"already running (worker {h.get('workerId')}, device {h.get('device')}); reused - no duplicate started")
            return
        if listening("127.0.0.1", self.s.vision_worker_port):
            say("FAIL", f"port {self.s.vision_worker_port} is in use by something that is not the vision worker")
            return
        p = self.start_proc("worker", [str(PY), "-m", "vision"], BACKEND)
        h = wait_for(lambda: http_json(url), 120)  # model weights load before the HTTP server answers
        if h:
            say("OK" if h.get("modelsReady") else "WARN", f"started (pid {p.pid}); device {h.get('device')}; models ready: {h.get('modelsReady')}")
        else:
            say("FAIL", f"worker did not come up - see {self.log_dir / 'worker.log'}")

    def check_copilot_model(self) -> None:
        print("6. Store Copilot language model (OpenRouter)")
        h = http_json(f"{self.api}/api/copilot/health?refresh=true", 8)
        if not h:
            say("WARN", "Copilot health unavailable (API down?)")
            return
        level = "OK" if h["state"] == "READY" else "WARN"
        say(level, f"{h['state']}: {h['detail']}  [model {h['model']}, mode {h['mode']}]")
        if h["state"] == "NOT_CONFIGURED":
            say("HINT", "put OPENROUTER_API_KEY=... in backend/.env and restart the API (answers still work from database tools without it)")

    def start_frontend(self) -> None:
        print("7. Frontend (Vite)")
        if self.args.no_frontend:
            say("SKIP", "--no-frontend")
            return
        port = self.args.frontend_port
        if listening("127.0.0.1", port) or listening("::1", port):
            say("OK", f"something already serves port {port} (reused): http://localhost:{port}")
            return
        if not (ROOT / "node_modules").exists():
            say("FAIL", "node_modules missing: run  npm install  in the project root")
            return
        npm = "npm.cmd" if os.name == "nt" else "npm"
        env = {"VITE_API_URL": self.api}
        p = self.start_proc("frontend", [npm, "run", "dev", "--", "--port", str(port), "--strictPort"], ROOT, env)
        ok = wait_for(lambda: listening("127.0.0.1", port) or listening("::1", port), 40)
        say("OK" if ok else "FAIL", f"http://localhost:{port} (pid {p.pid}), log: data/logs/frontend.log" if ok else f"Vite did not start - see {self.log_dir / 'frontend.log'}")

    def seed(self) -> None:
        if self.args.seed_demo:
            from database.seed import seed_demo

            print("   seeding the labelled DEMO store (explicit --seed-demo)")
            say("OK", str(seed_demo(self.s)))

    def report(self) -> int:
        print("\nSystem health (probed, not assumed)")
        h = http_json(f"{self.api}/api/system/health", 20)
        if not h:
            say("FAIL", "the API does not answer /api/system/health")
            return 2
        for c in h["components"]:
            mark = {"READY": "OK", "NOT_CONFIGURED": "N/C", "LOADING": "...", "DEGRADED": "WARN", "OFFLINE": "DOWN", "ERROR": "FAIL"}[c["state"]]
            print(f"  {mark:<5} {c['name']:<36} {c['state']:<15} {c['detail'][:100]}")
        print(f"\n  overall: {h['overall']}   (fully operational: {h['fullyOperational']}; not ready & required: {h['notReadyRequired'] or 'none'})")
        print(f"  admin console : http://localhost:{self.args.frontend_port}\n  staff app     : http://localhost:{self.args.frontend_port}/staff\n  customer app  : http://localhost:{self.args.frontend_port}/customer\n  API docs      : {self.api}/docs")
        return 0 if h["coreOk"] else 1

    # ------------------------------------------------------------------ modes
    def stop(self) -> int:
        pids = self.load_pids()
        if not pids:
            print("Nothing recorded as started by this script.")
            return 0
        for name, pid in pids.items():
            kill_tree(pid)
            say("OK", f"stopped {name} (pid {pid})")
        (self.run_dir / "pids.json").unlink(missing_ok=True)
        return 0

    def main(self) -> int:
        if self.args.stop:
            return self.stop()
        if self.args.status:
            return self.report()
        if not (self.validate() and self.database()):
            return 1
        self.models()
        if not self.start_api():
            return 1
        self.seed()
        self.start_worker()
        self.check_copilot_model()
        self.start_frontend()
        code = self.report()
        if self.pids and not self.args.detach:
            print("\nRunning. Press Ctrl+C to stop everything started by this script.")
            try:
                while True:
                    time.sleep(2)
                    for name, pid in list(self.pids.items()):
                        if name in ("api",) and not http_json(f"{self.api}/api/health", 2) and not listening("127.0.0.1", self.s.port):
                            print(f"  [FAIL] the API stopped unexpectedly - see data/logs/api.log")
                            raise KeyboardInterrupt
            except KeyboardInterrupt:
                print("\nShutting down...")
                self.stop()
        return code


def main() -> int:
    ap = argparse.ArgumentParser(description="Start the complete RetailEdge system locally")
    ap.add_argument("--no-frontend", action="store_true")
    ap.add_argument("--no-worker", action="store_true")
    ap.add_argument("--frontend-port", type=int, default=5173)
    ap.add_argument("--seed-demo", action="store_true", help="load the clearly-labelled DEMO store (never automatic)")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--stop", action="store_true")
    ap.add_argument("--detach", action="store_true", help="return after startup instead of supervising (use --stop later)")
    return Runner(ap.parse_args()).main()


if __name__ == "__main__":
    raise SystemExit(main())
