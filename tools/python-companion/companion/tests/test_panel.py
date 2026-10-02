import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from grok_desk_buddy.config import CompanionConfig, load_config
from grok_desk_buddy.server import serve_in_thread
from grok_desk_buddy.store import DeskStore


class _Response:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self.body = body


def put(url: str, payload: dict[str, object], token: str = "") -> _Response:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="PUT",
    )
    try:
        with urlopen(request) as response:
            return _Response(response.status, response.read())
    except HTTPError as exc:
        return _Response(exc.code, exc.read())


def test_panel_push_on_status_and_auth(tmp_path: Path) -> None:
    holder = CompanionConfig("0.0.0.0", 8787, "secret", "", "", 30)
    path = tmp_path / "config.json"
    server, base = serve_in_thread(
        DeskStore(),
        token="secret",
        web_dist=None,
        config=holder,
        config_path=path,
    )
    try:
        idle = json.loads(urlopen(base + "/api/status").read())
        assert "panel" not in idle
        denied = put(base + "/api/panel", {"url": "http://192.168.4.30:8787", "token": "desk"})
        assert denied.status == 401
        wifi = put(
            base + "/api/panel",
            {"url": "http://192.168.4.30:8787", "ssid": "home", "password": "nope"},
            "secret",
        )
        assert wifi.status == 400
        assert "panel" not in json.loads(urlopen(base + "/api/status").read())
        saved = put(
            base + "/api/panel",
            {"url": "http://192.168.4.30:8787/", "token": "desk-secret"},
            "secret",
        )
        assert saved.status == 200
        view = json.loads(saved.body)
        assert view == {"url": "http://192.168.4.30:8787", "token_set": True}
        assert "desk-secret" not in saved.body.decode()
        raw = urlopen(base + "/api/status").read()
        status = json.loads(raw)
        assert raw.startswith(b'{"panel":')
        assert status["panel"] == {
            "url": "http://192.168.4.30:8787",
            "token": "desk-secret",
        }
        masked = json.loads(urlopen(base + "/api/panel").read())
        assert masked["token_set"] is True
        assert "desk-secret" not in json.dumps(masked)
        loaded = load_config(path, {})
        assert loaded.panel_token == "desk-secret"
        put(base + "/api/config", {"bind_port": 8788}, "secret")
        assert holder.panel_token == "desk-secret"
        cleared = put(base + "/api/panel", {"clear": True}, "secret")
        assert cleared.status == 200
        assert json.loads(cleared.body)["url"] == ""
        assert "panel" not in json.loads(urlopen(base + "/api/status").read())
    finally:
        server.shutdown()
