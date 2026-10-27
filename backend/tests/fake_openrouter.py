"""A protocol-level stand-in for OpenRouter's HTTP API (GET /key, GET /models, POST /chat/completions with SSE streaming).

It lets the REAL OpenRouterProvider and orchestrator run end-to-end in tests with scripted model replies. It is a TEST DOUBLE: it proves the
plumbing (tool loop, validation, grounding, confirmation), not the quality of any real language model.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional

API_KEY = "sk-or-test-key"


class FakeOpenRouter:
    def __init__(self, model: str = "fake/qwen-flash", tools: bool = True, valid_key: bool = True, credit_left: Optional[float] = None, chunk_delay: float = 0.0):
        self.model, self.tools, self.valid_key, self.credit_left, self.chunk_delay = model, tools, valid_key, credit_left, chunk_delay
        self.script: List[Dict[str, Any]] = []
        self.requests: List[Dict[str, Any]] = []
        self.auth_headers: List[str] = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def _json(self, obj, code=200):
                body = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _sse(self, obj) -> None:
                self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n")
                self.wfile.flush()

            def do_GET(self):
                outer.auth_headers.append(self.headers.get("Authorization", ""))
                path = self.path.split("?")[0]
                if path == "/api/v1/key":
                    if not outer.valid_key:
                        return self._json({"error": {"message": "No auth credentials found", "code": 401}}, 401)
                    return self._json({"data": {"label": "test", "limit_remaining": outer.credit_left}})
                if path == "/api/v1/models":
                    return self._json({"data": ([{"id": outer.model, "context_length": 262144}] if outer.tools else [{"id": "other/model", "context_length": 8000}])})
                self._json({}, 404)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                payload = json.loads(self.rfile.read(n) or b"{}")
                if self.path != "/api/v1/chat/completions":
                    return self._json({}, 404)
                outer.requests.append(payload)
                step = outer.script.pop(0) if outer.script else {"content": "(no scripted reply)"}
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                try:
                    self.wfile.write(b": OPENROUTER PROCESSING\n\n")
                    words = (step.get("content") or "").split(" ")
                    for i, w in enumerate(words if step.get("content") else []):
                        self._sse({"choices": [{"index": 0, "delta": {"role": "assistant", "content": w + (" " if i < len(words) - 1 else "")}}]})
                        if outer.chunk_delay:
                            time.sleep(outer.chunk_delay)
                    for i, tc in enumerate(step.get("tool_calls") or []):
                        args = json.dumps(tc.get("arguments", {}))
                        half = len(args) // 2  # arguments arrive in fragments, like the real API
                        self._sse({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": i, "id": f"call_{i}", "type": "function", "function": {"name": tc["name"], "arguments": args[:half]}}]}}]})
                        self._sse({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": i, "function": {"arguments": args[half:]}}]}}]})
                    self._sse({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 11, "completion_tokens": 7}})
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread: Optional[threading.Thread] = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/api/v1"

    def __enter__(self) -> "FakeOpenRouter":
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *a) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    # convenience for scripting
    def say(self, content: str) -> "FakeOpenRouter":
        self.script.append({"content": content})
        return self

    def call(self, _tool: str, **args) -> "FakeOpenRouter":
        self.script.append({"tool_calls": [{"name": _tool, "arguments": args}]})
        return self
