import json
import logging

import pytest

from grok_desk_buddy.cursor_poll import map_cursor_status, poll_once
from grok_desk_buddy.store import DeskStore


def test_map_and_poll_once() -> None:
    assert map_cursor_status("ACTIVE") == "running"
    assert map_cursor_status("IDLE") == "idle"
    assert map_cursor_status("ARCHIVED") == "idle"
    assert map_cursor_status("WAITING") is None
    store = DeskStore()
    body = json.dumps({"items": [{"id": "bc-1", "name": "Readme", "status": "ACTIVE"}]}).encode()
    seen: list[tuple[str, str]] = []

    def get(url: str, api_key: str) -> bytes:
        seen.append((url, api_key))
        return body

    poll_once(store, "ck_test", get, "2026-10-02T13:00:00Z")
    assert seen[0][0] == "https://api.cursor.com/v1/agents?limit=20"
    assert seen[0][1] == "ck_test"
    assert store.status()["phase"] == "running"
    assert store.status()["needs_you"] is False
    poll_once(store, "ck_test", get, "2026-10-02T13:00:02Z")
    events = store.status()["events"]
    assert isinstance(events, list)
    assert len(events) == 1

    def boom(url: str, api_key: str) -> bytes:
        raise OSError("down")

    poll_once(store, "ck_test", boom, "2026-10-02T13:00:03Z")
    assert len(store.status()["events"]) == 1
    poll_once(store, "", get, "2026-10-02T13:00:04Z")
    assert len(seen) == 2
    agents = store.status()["agents"]
    assert isinstance(agents, list)
    assert agents[0]["color"] == ""
    assert agents[0]["shape"] == ""
    assert agents[0]["icon"] == ""


def test_poll_forwards_identity_keys_when_present() -> None:
    store = DeskStore()
    body = json.dumps(
        {
            "items": [
                {
                    "id": "bc-1",
                    "name": "Readme",
                    "status": "ACTIVE",
                    "color": "#445566",
                    "shape": "square",
                    "icon": "mark",
                    "url": "https://cursor.com/agents/bc-1",
                }
            ]
        }
    ).encode()

    def get(url: str, api_key: str) -> bytes:
        return body

    poll_once(store, "ck_test", get, "2026-10-02T13:00:00Z")
    agents = store.status()["agents"]
    assert isinstance(agents, list)
    assert agents[0]["color"] == "#445566"
    assert agents[0]["shape"] == "square"
    assert agents[0]["icon"] == "mark"


def test_poll_logs_transport_error(caplog: pytest.LogCaptureFixture) -> None:
    store = DeskStore()

    def boom(url: str, api_key: str) -> bytes:
        raise OSError("401")

    with caplog.at_level(logging.WARNING):
        poll_once(store, "ck_test", boom, "2026-10-02T13:00:00Z")
    assert "cursor poll failed" in caplog.text
