import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from grok_desk_buddy.config import CompanionConfig
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


def test_bad_port_is_400(tmp_path: Path) -> None:
    holder = CompanionConfig("0.0.0.0", 8787, "", "", "", 30)
    server, base = serve_in_thread(DeskStore(), token="", web_dist=None, config=holder)
    try:
        saved = put(base + "/api/config", {"bind_port": 70000})
        assert saved.status == 400
        assert holder.bind_port == 8787
    finally:
        server.shutdown()


def test_static_cors_and_config_merge(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("DESK", encoding="utf-8")
    holder = CompanionConfig("0.0.0.0", 8787, "secret", "", "", 30)
    server, base = serve_in_thread(DeskStore(), token="secret", web_dist=dist, config=holder)
    try:
        assert urlopen(base + "/").read() == b"DESK"
        try:
            urlopen(Request(base + "/../pyproject.toml"))
            raise AssertionError("expected 404")
        except HTTPError as exc:
            assert exc.code == 404
        opt = urlopen(Request(base + "/api/status", method="OPTIONS"))
        assert opt.status == 204
        assert opt.headers["Access-Control-Allow-Origin"] == "*"
        denied = put(base + "/api/config", {"cursor_api_key": "ck_test"})
        assert denied.status == 401
        saved = put(base + "/api/config", {"cursor_api_key": "ck_test"}, "secret")
        assert saved.status == 200
        view = json.loads(urlopen(base + "/api/config").read())
        assert view["cursor_api_key_set"] is True
        assert "ck_test" not in json.dumps(view)
        put(base + "/api/config", {"bind_port": 8787}, "secret")
        assert holder.cursor_api_key == "ck_test"
    finally:
        server.shutdown()
