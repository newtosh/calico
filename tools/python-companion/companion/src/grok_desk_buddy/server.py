from __future__ import annotations

import json
import threading
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from grok_desk_buddy.config import (
    CompanionConfig,
    merge_config,
    merge_panel,
    panel_public_view,
    panel_status_field,
    public_view,
    save_config,
)
from grok_desk_buddy.store import DeskStore, EventIn

_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
}


def serve_in_thread(
    store: DeskStore,
    token: str = "",
    web_dist: Path | None = None,
    config: CompanionConfig | None = None,
    config_path: Path | None = None,
) -> tuple[ThreadingHTTPServer, str]:
    handler = _handler_class(store, token, web_dist, config, config_path)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f"http://{host}:{port}"


def make_server(
    host: str,
    port: int,
    store: DeskStore,
    web_dist: Path | None,
    config: CompanionConfig,
    config_path: Path | None,
) -> ThreadingHTTPServer:
    handler = _handler_class(store, "", web_dist, config, config_path)
    return ThreadingHTTPServer((host, port), handler)


def _handler_class(
    store: DeskStore,
    token: str,
    web_dist: Path | None,
    config: CompanionConfig | None,
    config_path: Path | None,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_OPTIONS(self) -> None:
            self._send(204, b"", "text/plain")

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/status":
                body = store.status()
                if config is not None:
                    panel = panel_status_field(config)
                    if panel is not None:
                        # First key: the panel buffer is 8 KB and drops the tail.
                        body = {"panel": panel, **body}
                self._json(200, body)
                return
            if path == "/api/panel":
                if config is None:
                    self._json(404, {"error": "not found"})
                    return
                self._json(200, panel_public_view(config))
                return
            if path == "/api/config":
                if config is None:
                    self._json(404, {"error": "not found"})
                    return
                self._json(200, public_view(config))
                return
            if path.startswith("/api/"):
                self._json(404, {"error": "not found"})
                return
            self._static(path)

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path not in {"/api/webhook/grok-bot", "/api/dismiss"}:
                self._json(404, {"error": "not found"})
                return
            if not self._allowed():
                self._json(401, {"error": "unauthorized"})
                return
            if path == "/api/dismiss":
                store.dismiss()
                self._send(204, b"", "text/plain")
                return
            payload = self._read_json()
            if payload is None:
                self._json(400, {"error": "bad json"})
                return
            try:
                event = store.apply_event(_event_in(payload))
            except ValueError:
                self._json(400, {"error": "bad event"})
                return
            self._json(201, asdict(event))

        def do_PUT(self) -> None:
            path = urlparse(self.path).path
            if path not in {"/api/config", "/api/panel"} or config is None:
                self._json(404, {"error": "not found"})
                return
            if not self._allowed():
                self._json(401, {"error": "unauthorized"})
                return
            payload = self._read_json()
            if payload is None:
                self._json(400, {"error": "bad json"})
                return
            if path == "/api/panel":
                try:
                    updated = merge_panel(config, payload)
                except ValueError:
                    self._json(400, {"error": "bad panel"})
                    return
                _copy_config(config, updated)
                if config_path is not None:
                    save_config(config_path, config)
                self._json(200, panel_public_view(config))
                return
            try:
                updated, restart = merge_config(config, payload)
            except ValueError:
                self._json(400, {"error": "bad config"})
                return
            _copy_config(config, updated)
            if config_path is not None:
                save_config(config_path, config)
            body = public_view(config)
            body["restart_required"] = restart
            self._json(200, body)

        def _token(self) -> str:
            if config is not None:
                return config.webhook_token
            return token

        def _allowed(self) -> bool:
            expected = self._token()
            if not expected:
                return True
            return self.headers.get("Authorization", "") == f"Bearer {expected}"

        def _read_json(self) -> dict[str, Any] | None:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b""
            try:
                parsed = json.loads(raw.decode() or "null")
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
            if not isinstance(parsed, dict):
                return None
            return parsed

        def _static(self, path: str) -> None:
            if web_dist is None:
                message = b"Build the web UI: cd web && npm install && npm run build\n"
                self._send(200, message, "text/plain; charset=utf-8")
                return
            file_path = _safe_file(web_dist, path)
            if file_path is None:
                self._send(404, b"not found\n", "text/plain; charset=utf-8")
                return
            content_type = _TYPES.get(file_path.suffix, "application/octet-stream")
            self._send(200, file_path.read_bytes(), content_type)

        def _json(self, status: int, payload: object) -> None:
            self._send(status, json.dumps(payload).encode(), "application/json")

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.end_headers()
            if body:
                self.wfile.write(body)

    return Handler


def _event_in(payload: dict[str, Any]) -> EventIn:
    return EventIn(
        type=str(payload.get("type", "")),
        agent_id=str(payload.get("agent_id", "")),
        title=str(payload.get("title", "")),
        message=str(payload.get("message", "")),
        source=str(payload.get("source", "grok-bot")),
    )


def _copy_config(target: CompanionConfig, source: CompanionConfig) -> None:
    target.bind_host = source.bind_host
    target.bind_port = source.bind_port
    target.webhook_token = source.webhook_token
    target.cursor_api_key = source.cursor_api_key
    target.sqlite_path = source.sqlite_path
    target.cursor_poll_seconds = source.cursor_poll_seconds
    target.panel_url = source.panel_url
    target.panel_token = source.panel_token


def _safe_file(web_dist: Path, url_path: str) -> Path | None:
    decoded = unquote(url_path)
    if ".." in decoded:
        return None
    relative = decoded.lstrip("/") or "index.html"
    root = web_dist.resolve()
    candidate = (root / relative).resolve()
    if candidate != root and root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate
