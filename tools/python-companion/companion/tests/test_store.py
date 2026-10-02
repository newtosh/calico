from pathlib import Path

import pytest

from grok_desk_buddy.store import DeskStore, EventIn


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


def test_cursor_item_does_not_repeat(tmp_path: Path) -> None:
    path = str(tmp_path / "desk.sqlite")
    store = DeskStore(sqlite_path=path)
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:00Z") is True
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:01Z") is False
    reloaded = DeskStore(sqlite_path=path)
    assert reloaded.status()["phase"] == "running"
