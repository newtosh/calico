import json
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from grok_desk_buddy.server import serve_in_thread
from grok_desk_buddy.store import DeskStore


class _Response:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self.body = body


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
        cleared = post(base + "/api/dismiss", {}, "secret")
        assert cleared.status == 204
        assert json.loads(urlopen(base + "/api/status").read())["needs_you"] is False
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
