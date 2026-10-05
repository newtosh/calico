import sqlite3
from pathlib import Path

import pytest

from grok_desk_buddy.store import DeskStore, EventIn, face_event_title


def test_launch_then_needs_you_then_dismiss(tmp_path: Path) -> None:
    store = DeskStore(sqlite_path=str(tmp_path / "desk.sqlite"))
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    assert store.status()["phase"] == "running"
    store.apply_event(EventIn(type="agent.needs_you", agent_id="a1", message="Pick one"))
    body = store.status()
    assert body["phase"] == "needs_you"
    assert body["needs_you"] is True
    store.dismiss()
    after = store.status()
    assert after["phase"] == "running"
    assert after["needs_you"] is False
    last = after["last_event"]
    assert isinstance(last, dict)
    assert last["type"] == "note"
    assert last["source"] == "manual"
    assert last["title"] == ""
    assert last["message"] == ""


def test_face_title_keeps_real_events_and_drops_dismiss() -> None:
    assert face_event_title("Dismissed", "") == ""
    assert face_event_title("Remember", "milk") == "Remember"
    assert face_event_title("Scaffold", "") == "Scaffold"
    assert face_event_title("Scaffold", "Pick one") == "Scaffold"


def test_old_dismiss_title_is_not_served(tmp_path: Path) -> None:
    path = tmp_path / "desk.sqlite"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE events ("
            "seq INTEGER PRIMARY KEY, id TEXT, type TEXT, agent_id TEXT, title TEXT, "
            "message TEXT, source TEXT, at TEXT)"
        )
        conn.execute(
            "INSERT INTO events (seq, id, type, agent_id, title, message, source, at) "
            "VALUES (0, 'e1', 'note', '', 'Dismissed', '', 'manual', 't')"
        )
    store = DeskStore(sqlite_path=str(path))
    last = store.status()["last_event"]
    assert isinstance(last, dict)
    assert last["title"] == ""
    assert last["type"] == "note"


def test_note_does_not_create_agent_and_finish_goes_idle() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="note", message="hello"))
    assert store.status()["agents"] == []
    assert store.status()["phase"] == "idle"
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    store.apply_event(EventIn(type="agent.finished", agent_id="a1"))
    body = store.status()
    assert body["phase"] == "idle"
    agents = body["agents"]
    assert isinstance(agents, list)
    assert agents[0]["status"] == "idle"


def test_rejects_unknown_type_and_missing_agent() -> None:
    store = DeskStore()
    with pytest.raises(ValueError):
        store.apply_event(EventIn(type="agent.exploded", agent_id="a1"))
    with pytest.raises(ValueError):
        store.apply_event(EventIn(type="agent.finished", agent_id=""))


def test_event_cap_is_50() -> None:
    store = DeskStore()
    for i in range(51):
        store.apply_event(EventIn(type="note", message=str(i)))
    events = store.status()["events"]
    assert isinstance(events, list)
    assert len(events) == 50
    assert events[0]["message"] == "50"


def test_cursor_item_does_not_clear_needs_you() -> None:
    store = DeskStore()
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:00Z") is True
    store.apply_event(EventIn(type="agent.needs_you", agent_id="bc-1", message="Pick one"))
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:02Z") is False
    body = store.status()
    assert body["needs_you"] is True
    events = body["events"]
    assert isinstance(events, list)
    assert len(events) == 2


def test_identity_passes_through_and_stays_when_omitted(tmp_path: Path) -> None:
    path = str(tmp_path / "desk.sqlite")
    store = DeskStore(sqlite_path=path)
    store.apply_event(
        EventIn(
            type="agent.launched",
            agent_id="a1",
            title="Scaffold",
            color="  #C45C26 ",
            shape="Diamond",
            icon="https://example.test/a.png",
        )
    )
    agent = store.status()["agents"]
    assert isinstance(agent, list)
    assert agent[0]["color"] == "#C45C26"
    assert agent[0]["shape"] == "diamond"
    assert agent[0]["icon"] == "https://example.test/a.png"
    event = store.status()["events"]
    assert isinstance(event, list)
    assert event[0]["shape"] == "diamond"
    store.apply_event(EventIn(type="agent.finished", agent_id="a1"))
    kept = store.status()["agents"]
    assert isinstance(kept, list)
    assert kept[0]["status"] == "idle"
    assert kept[0]["color"] == "#C45C26"
    assert kept[0]["shape"] == "diamond"
    assert kept[0]["icon"] == "https://example.test/a.png"
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", color="#224466"))
    changed = store.status()["agents"]
    assert isinstance(changed, list)
    assert changed[0]["color"] == "#224466"
    assert changed[0]["shape"] == "diamond"
    reloaded = DeskStore(sqlite_path=path)
    again = reloaded.status()["agents"]
    assert isinstance(again, list)
    assert again[0]["color"] == "#224466"
    assert again[0]["icon"] == "https://example.test/a.png"


def test_omitted_identity_stays_empty_and_cursor_does_not_invent_it() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    agent = store.status()["agents"]
    assert isinstance(agent, list)
    assert agent[0]["color"] == ""
    assert agent[0]["shape"] == ""
    assert agent[0]["icon"] == ""
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:00Z") is True
    cursor = store.status()["agents"]
    assert isinstance(cursor, list)
    found = next(item for item in cursor if item["id"] == "bc-1")
    assert found["color"] == ""
    assert found["shape"] == ""
    assert found["icon"] == ""
    store.apply_event(
        EventIn(type="agent.needs_you", agent_id="bc-1", color="#112233", shape="square")
    )
    assert store.apply_cursor_item("bc-1", "Readme", "idle", "2026-10-02T13:01:00Z") is False
    store.apply_event(EventIn(type="agent.finished", agent_id="bc-1"))
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:02:00Z") is True
    still = store.status()["agents"]
    assert isinstance(still, list)
    blocked = next(item for item in still if item["id"] == "bc-1")
    assert blocked["status"] == "running"
    assert blocked["color"] == "#112233"
    assert blocked["shape"] == "square"
    assert blocked["icon"] == ""


def test_old_sqlite_schema_gains_identity_columns(tmp_path: Path) -> None:
    path = tmp_path / "desk.sqlite"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE events ("
            "seq INTEGER PRIMARY KEY, id TEXT, type TEXT, agent_id TEXT, title TEXT, "
            "message TEXT, source TEXT, at TEXT)"
        )
        conn.execute(
            "CREATE TABLE agents (id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT)"
        )
        conn.execute(
            "INSERT INTO agents (id, title, status, updated_at) "
            "VALUES ('a1', 'Old', 'running', 't')"
        )
    store = DeskStore(sqlite_path=str(path))
    agent = store.status()["agents"]
    assert isinstance(agent, list)
    assert agent[0]["title"] == "Old"
    assert agent[0]["color"] == ""
    assert agent[0]["shape"] == ""
    assert agent[0]["icon"] == ""


def test_cursor_item_does_not_repeat(tmp_path: Path) -> None:
    path = str(tmp_path / "desk.sqlite")
    store = DeskStore(sqlite_path=path)
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:00Z") is True
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:01Z") is False
    reloaded = DeskStore(sqlite_path=path)
    assert reloaded.status()["phase"] == "running"
