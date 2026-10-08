import json
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from grok_desk_buddy.server import serve_in_thread
from grok_desk_buddy.store import FRAME_MAX, DeskStore


class _Response:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self.body = body


def post_bytes(
    url: str, body: bytes, token: str = "", content_type: str = "image/bmp"
) -> _Response:
    headers = {"Content-Type": content_type}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(request) as response:
            return _Response(response.status, response.read())
    except HTTPError as exc:
        return _Response(exc.code, exc.read())


def post(url: str, payload: dict[str, object], token: str = "") -> _Response:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        url,
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request) as response:
            return _Response(response.status, response.read())
    except HTTPError as exc:
        return _Response(exc.code, exc.read())


def test_webhook_updates_status_and_auth() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="secret", web_dist=None)
    try:
        idle = json.loads(urlopen(base + "/api/status").read())
        assert idle["phase"] == "idle"
        denied = post(base + "/api/webhook/grok-bot", {"type": "agent.launched", "agent_id": "a1"})
        assert denied.status == 401
        wrong = post(
            base + "/api/webhook/grok-bot",
            {"type": "agent.launched", "agent_id": "a1"},
            "nope",
        )
        assert wrong.status == 401
        ok = post(
            base + "/api/webhook/grok-bot",
            {"type": "agent.launched", "agent_id": "a1", "title": "Scaffold"},
            "secret",
        )
        assert ok.status == 201
        assert json.loads(ok.body)["source"] == "grok-bot"
        bad = post(
            base + "/api/webhook/grok-bot",
            {"type": "nope", "agent_id": "a1"},
            "secret",
        )
        assert bad.status == 400
        seen = json.loads(urlopen(base + "/api/status").read())
        assert seen["agents"][0]["id"] == "a1"
        post(
            base + "/api/webhook/grok-bot",
            {"type": "agent.needs_you", "agent_id": "a1"},
            "secret",
        )
        waiting = json.loads(urlopen(base + "/api/status").read())
        assert waiting["needs_you"] is True
        assert waiting["unread"] == 1
        cleared = post(base + "/api/dismiss", {}, "secret")
        assert cleared.status == 204
        body = json.loads(urlopen(base + "/api/status").read())
        assert body["needs_you"] is False
        assert body["unread"] == 0
        denied_badge = post(base + "/api/unread/dismiss", {})
        assert denied_badge.status == 401
        badge = post(base + "/api/unread/dismiss", {}, "secret")
        assert badge.status == 204
        assert json.loads(urlopen(base + "/api/status").read())["unread"] == 0
    finally:
        server.shutdown()


def test_webhook_passes_identity_and_ignores_non_strings() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="", web_dist=None)
    try:
        ok = post(
            base + "/api/webhook/grok-bot",
            {
                "type": "agent.launched",
                "agent_id": "a1",
                "title": "Scaffold",
                "color": "#C45C26",
                "shape": "triangle",
                "icon": "bolt",
            },
        )
        assert ok.status == 201
        stored = json.loads(ok.body)
        assert stored["color"] == "#C45C26"
        assert stored["shape"] == "triangle"
        assert stored["icon"] == "bolt"
        seen = json.loads(urlopen(base + "/api/status").read())
        assert seen["agents"][0]["color"] == "#C45C26"
        assert seen["agents"][0]["shape"] == "triangle"
        assert seen["agents"][0]["icon"] == "bolt"
        post(
            base + "/api/webhook/grok-bot",
            {"type": "agent.finished", "agent_id": "a1", "color": 12, "shape": None, "icon": {}},
        )
        kept = json.loads(urlopen(base + "/api/status").read())["agents"][0]
        assert kept["color"] == "#C45C26"
        assert kept["shape"] == "triangle"
        assert kept["icon"] == "bolt"
    finally:
        server.shutdown()


def test_parallel_launches_both_land() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="", web_dist=None)
    try:
        threads = [
            Thread(
                target=post,
                args=(base + "/api/webhook/grok-bot", {"type": "agent.launched", "agent_id": name}),
            )
            for name in ("a", "b")
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        ids = {agent["id"] for agent in json.loads(urlopen(base + "/api/status").read())["agents"]}
        assert ids == {"a", "b"}
    finally:
        server.shutdown()


def test_frame_request_post_and_get() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="secret", web_dist=None)
    try:
        try:
            urlopen(base + "/api/frame")
            raise AssertionError("missing frame should be 404")
        except HTTPError as exc:
            assert exc.code == 404
        denied = post_bytes(base + "/api/frame/request", b"")
        assert denied.status == 401
        assert json.loads(urlopen(base + "/api/status").read())["capture"] is False
        asked = post_bytes(base + "/api/frame/request", b"", "secret")
        assert asked.status == 204
        waiting = json.loads(urlopen(base + "/api/status").read())
        keys = list(waiting)
        assert keys.index("capture") == keys.index("unread") + 1
        assert waiting["capture"] is True
        stolen = post_bytes(base + "/api/frame", b"BMnope")
        assert stolen.status == 401
        assert store.frame() is None
        assert store.status()["capture"] is True
        typed = post_bytes(base + "/api/frame", b"BMnope", "secret", "text/plain")
        assert typed.status == 415
        assert store.frame() is None
        huge = post_bytes(base + "/api/frame", b"BM" + bytes(FRAME_MAX), "secret")
        assert huge.status == 413
        assert store.frame() is None
        assert store.status()["capture"] is True
        stored = post_bytes(base + "/api/frame", b"BMpixels", "secret")
        assert stored.status == 204
        assert store.status()["capture"] is False
        with urlopen(base + "/api/frame") as got:
            assert got.status == 200
            assert got.headers.get("Content-Type") == "image/bmp"
            assert got.read() == b"BMpixels"
        race = post_bytes(base + "/api/frame", b"BMrace", "secret")
        assert race.status == 204
        assert urlopen(base + "/api/frame").read() == b"BMrace"
    finally:
        server.shutdown()


def test_dismiss_one_agent_leaves_the_other() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="", web_dist=None)
    try:
        post(
            base + "/api/webhook/grok-bot",
            {"type": "agent.needs_you", "agent_id": "desky", "title": "Desky", "message": "one"},
        )
        post(
            base + "/api/webhook/grok-bot",
            {"type": "agent.needs_you", "agent_id": "spool", "title": "Spool", "message": "two"},
        )
        bad = post_bytes(base + "/api/dismiss", b"nope", content_type="application/json")
        assert bad.status == 400
        one = post(base + "/api/dismiss", {"agent_id": "desky"})
        assert one.status == 204
        body = json.loads(urlopen(base + "/api/status").read())
        agents = {item["id"]: item for item in body["agents"]}
        assert agents["desky"]["attention"] is False
        assert agents["spool"]["attention"] is True
        assert body["needs_you"] is True
        assert body["unread"] == 1
        cleared = post(base + "/api/dismiss", {})
        assert cleared.status == 204
        quiet = json.loads(urlopen(base + "/api/status").read())
        assert quiet["needs_you"] is False
        assert quiet["unread"] == 0
    finally:
        server.shutdown()
