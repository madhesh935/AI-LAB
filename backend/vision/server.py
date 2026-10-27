"""Worker HTTP surface (127.0.0.1 only): MJPEG gateway, snapshots, status, control.

Video bytes flow worker -> browser directly; analytics metadata flows worker -> API -> WebSocket.
RTSP URLs / device refs / credentials exist only inside the worker and are never serialised.
"""

from __future__ import annotations

import asyncio
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from core.config import Settings
from vision.engine import VisionEngine

BOUNDARY = "retailedge"
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def create_worker_app(engine: VisionEngine, settings: Settings) -> FastAPI:
    app = FastAPI(title="RetailEdge vision worker", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
        allow_methods=["GET", "POST"], allow_headers=["*"],
    )
    viewer_lock = threading.Lock()

    def worker_or_404(camera_id: str):
        w = engine.get(camera_id)
        if w is None:
            raise HTTPException(404, "Unknown camera")
        return w

    def require_loopback(request: Request) -> None:
        if request.client is None or request.client.host not in LOOPBACK:
            raise HTTPException(403, "Control endpoints are loopback-only")

    @app.get("/health")
    def health():
        return {"ok": True, "workerId": engine.worker_id, "device": engine.device,
                "modelsReady": sum(1 for m in engine.registry.statuses() if m.status == "READY")}

    @app.get("/status")
    def status():
        return engine.status().model_dump(mode="json", by_alias=True)

    @app.get("/cameras")
    def cameras():
        return [w.runtime().model_dump(mode="json", by_alias=True) for w in list(engine.workers.values())]

    @app.get("/cameras/{camera_id}")
    def camera(camera_id: str):
        return worker_or_404(camera_id).runtime().model_dump(mode="json", by_alias=True)

    @app.get("/cameras/{camera_id}/detections")
    def detections(camera_id: str):
        w = worker_or_404(camera_id)
        if w.last_result is None:
            return {"cameraId": camera_id, "result": None, "reason": "no inference yet"}
        return {"cameraId": camera_id, "result": w.last_result.model_dump(mode="json", by_alias=True)}

    @app.get("/snapshot/{camera_id}.jpg")
    def snapshot(camera_id: str):
        w = worker_or_404(camera_id)
        jpg = w.latest_jpeg()
        if jpg is None:
            return JSONResponse({"error": {"code": "NO_FRAME", "message": "No frame available"}}, status_code=409)
        return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/stream/{camera_id}.mjpg")
    async def stream(camera_id: str, request: Request):
        w = worker_or_404(camera_id)
        if w.cfg.source_type == "unconfigured" or not w.cfg.enabled:
            return JSONResponse({"error": {"code": w.error_code or "NOT_CONFIGURED", "message": w.message or "Camera not available"}}, status_code=409)
        with viewer_lock:
            if w.viewers >= settings.vision_max_viewers_per_camera:
                return JSONResponse({"error": {"code": "TOO_MANY_VIEWERS", "message": "Viewer limit reached"}}, status_code=429)
            w.viewers += 1

        async def gen():
            # An ASYNC generator: when the browser closes the connection the task is cancelled and `finally` runs, so the viewer count is released.
            # (A synchronous generator in a thread pool was never closed on disconnect, which leaked viewers until new streams were refused.)
            seq, idle = 0, 0
            try:
                while True:
                    if await request.is_disconnected():
                        return
                    frame = await asyncio.to_thread(w.wait_stream, seq, 1.0)
                    if frame is None:
                        idle += 1
                        if idle >= 30 or w._stop.is_set():  # ~30 s without frames: let the client reconnect
                            return
                        continue
                    idle, seq = 0, frame.seq
                    head = (f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame.jpeg)}\r\n"
                            f"X-Frame-Meta: {frame.meta}\r\n\r\n").encode("ascii")
                    yield head + frame.jpeg + b"\r\n"
            finally:
                with viewer_lock:
                    w.viewers = max(w.viewers - 1, 0)

        return StreamingResponse(
            gen(), media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    @app.post("/control/reload")
    def reload(request: Request):
        require_loopback(request)
        return engine.reload()

    @app.post("/control/cameras/{camera_id}/reconnect")
    def reconnect(camera_id: str, request: Request):
        require_loopback(request)
        w = worker_or_404(camera_id)
        w.request_reconnect()
        return {"requested": True, "cameraId": camera_id, "state": w.state}

    @app.post("/control/models/{model_id}/reload")
    def reload_model(model_id: str, request: Request):
        require_loopback(request)
        entry = engine.registry.entries.get(model_id)
        if entry is None:
            raise HTTPException(404, "Unknown model")
        entry.instance, entry.status = None, "NOT_CONFIGURED"
        threading.Thread(target=engine.registry.load, args=(model_id,), daemon=True).start()
        return {"requested": True, "modelId": model_id}

    return app
