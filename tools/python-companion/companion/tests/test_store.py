import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from grok_desk_buddy.store import FRAME_MAX, DeskStore, EventIn, face_event_title


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


def test_status_orders_needs_you_then_recent(tmp_path: Path) -> None:
    path = tmp_path / "desk.sqlite"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE agents (id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT)"
        )
        conn.executemany(
            "INSERT INTO agents (id, title, status, updated_at) VALUES (?, ?, ?, ?)",
            [
                ("m", "M", "running", "2026-10-05T12:00:00Z"),
                ("z", "Z", "needs_you", "2026-10-05T09:00:00Z"),
                ("a", "A", "running", "2026-10-05T12:00:00Z"),
                ("b", "B", "idle", "2026-10-05T15:00:00Z"),
                ("n", "N", "needs_you", "2026-10-05T10:00:00Z"),
            ],
        )
    ids = [item["id"] for item in DeskStore(sqlite_path=str(path)).status()["agents"]]
    assert ids == ["n", "z", "b", "a", "m"]


def test_status_returns_every_stored_agent() -> None:
    store = DeskStore()
    for i in range(17):
        store.apply_event(EventIn(type="agent.launched", agent_id=f"a{i:02d}", title=f"Agent {i}"))
    agents = store.status()["agents"]
    assert isinstance(agents, list)
    assert len(agents) == 17
    assert agents[0]["id"] == "a00"
    assert agents[16]["id"] == "a16"
    assert agents[16]["title"] == "Agent 16"


def test_unread_counts_attention_and_clears_with_it() -> None:
    store = DeskStore()
    assert store.status()["unread"] == 0
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    assert store.status()["unread"] == 0
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    assert store.status()["unread"] == 0
    store.apply_event(EventIn(type="agent.finished", agent_id="a1"))
    assert store.status()["unread"] == 0
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    assert store.status()["unread"] == 0
    store.apply_event(EventIn(type="note", title="Remember", message="milk"))
    assert store.status()["unread"] == 1
    store.apply_event(EventIn(type="agent.needs_you", agent_id="a1", message="Pick one"))
    assert store.status()["unread"] == 1
    store.dismiss()
    after = store.status()
    assert after["needs_you"] is False
    assert after["unread"] == 0
    store.clear_unread()
    assert store.status()["unread"] == 0


def test_unread_persists_and_cursor_does_not_bump_it(tmp_path: Path) -> None:
    path = tmp_path / "desk.sqlite"
    store = DeskStore(sqlite_path=str(path))
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:00Z") is True
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:02Z") is False
    assert store.apply_cursor_item("bc-1", "Readme", "idle", "2026-10-02T13:01:00Z") is True
    assert store.status()["unread"] == 0
    store.apply_event(EventIn(type="agent.needs_you", agent_id="a1", message="Pick one"))
    assert store.status()["unread"] == 1
    assert DeskStore(sqlite_path=str(path)).status()["unread"] == 1
    store.clear_unread()
    assert store.status()["unread"] == 1
    store.dismiss()
    assert DeskStore(sqlite_path=str(path)).status()["unread"] == 0
    store.apply_event(EventIn(type="note", message="later"))
    assert DeskStore(sqlite_path=str(path)).status()["unread"] == 1


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
    held = store.status()["agents"]
    assert isinstance(held, list)
    waiting = next(item for item in held if item["id"] == "bc-1")
    assert waiting["status"] == "needs_you"
    assert waiting["attention"] is True
    assert store.apply_cursor_item("bc-1", "Readme", "running", _stamp(timedelta(0))) is False
    store.dismiss()
    assert store.apply_cursor_item("bc-1", "Readme", "running", _stamp(timedelta(0))) is True
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


def test_standing_launch_keeps_the_row_and_needs_you() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="agent.launched", agent_id="scaffold", title="Scaffold"))
    store.apply_event(EventIn(type="agent.launched", agent_id="jeeves", title="Jeeves"))
    store.apply_event(EventIn(type="agent.finished", agent_id="jeeves"))
    body = store.status()
    assert body["phase"] == "running"
    agents = {item["id"]: item for item in body["agents"]}
    assert agents["scaffold"]["status"] == "running"
    assert agents["jeeves"]["status"] == "idle"
    assert len(body["events"]) == 3

    store.apply_event(EventIn(type="agent.launched", agent_id="scaffold", title="Scaffold desk"))
    refreshed = store.status()
    assert len(refreshed["events"]) == 3
    scaffold = next(item for item in refreshed["agents"] if item["id"] == "scaffold")
    assert scaffold["status"] == "running"
    assert scaffold["title"] == "Scaffold desk"

    store.apply_event(EventIn(type="agent.needs_you", agent_id="scaffold", message="Pick one"))
    store.apply_event(EventIn(type="agent.launched", agent_id="scaffold", title="Scaffold"))
    blocked = store.status()
    assert blocked["needs_you"] is True
    assert len(blocked["events"]) == 4
    scaffold = next(item for item in blocked["agents"] if item["id"] == "scaffold")
    assert scaffold["status"] == "needs_you"

    store.apply_event(EventIn(type="agent.launched", agent_id="jeeves", title="Jeeves"))
    back = store.status()
    jeeves = next(item for item in back["agents"] if item["id"] == "jeeves")
    assert jeeves["status"] == "running"
    assert len(back["events"]) == 5


def _stamp(age: timedelta) -> str:
    return (datetime.now(UTC) - age).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_stale_running_ages_to_idle() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="agent.launched", agent_id="fresh", title="Fresh"))
    store.apply_event(EventIn(type="agent.launched", agent_id="old", title="Old"))
    store.apply_event(EventIn(type="agent.needs_you", agent_id="ask", message="Pick one"))
    store._agents["old"].updated_at = _stamp(timedelta(seconds=121))
    store._agents["ask"].updated_at = _stamp(timedelta(minutes=30))
    body = store.status()
    agents = {item["id"]: item for item in body["agents"]}
    assert agents["fresh"]["status"] == "running"
    assert agents["old"]["status"] == "idle"
    assert agents["ask"]["status"] == "needs_you"
    assert body["phase"] == "needs_you"
    assert body["needs_you"] is True
    assert [item["id"] for item in body["agents"] if item["status"] == "running"] == ["fresh"]

    quiet = DeskStore()
    quiet.apply_event(EventIn(type="agent.launched", agent_id="seed", title="Seed"))
    quiet._agents["seed"].updated_at = _stamp(timedelta(seconds=121))
    aged = quiet.status()
    assert aged["phase"] == "idle"
    assert aged["needs_you"] is False
    assert aged["agents"][0]["status"] == "idle"
    events = len(aged["events"])
    quiet.apply_event(EventIn(type="agent.launched", agent_id="seed", title="Seed"))
    again = quiet.status()
    assert again["phase"] == "running"
    assert again["agents"][0]["status"] == "running"
    assert len(again["events"]) == events

    inside = DeskStore()
    inside.apply_event(EventIn(type="agent.launched", agent_id="near", title="Near"))
    inside._agents["near"].updated_at = _stamp(timedelta(seconds=90))
    assert inside.status()["agents"][0]["status"] == "running"
    assert inside.status()["phase"] == "running"


def test_cursor_item_does_not_repeat(tmp_path: Path) -> None:
    path = str(tmp_path / "desk.sqlite")
    store = DeskStore(sqlite_path=path)
    fresh = _stamp(timedelta(0))
    assert store.apply_cursor_item("bc-1", "Readme", "running", fresh) is True
    assert store.apply_cursor_item("bc-1", "Readme", "running", fresh) is False
    reloaded = DeskStore(sqlite_path=path)
    assert reloaded.status()["phase"] == "running"


def test_finished_title_is_kept_and_empty_does_not_clear() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="agent.finished", agent_id="alfred", title="Alfred"))
    agents = store.status()["agents"]
    assert isinstance(agents, list)
    assert agents[0]["title"] == "Alfred"
    store.apply_event(EventIn(type="agent.finished", agent_id="alfred", title=""))
    agents = store.status()["agents"]
    assert isinstance(agents, list)
    assert agents[0]["title"] == "Alfred"


def test_attention_survives_finish_and_dismiss_clears_only_that_row() -> None:
    store = DeskStore()
    store.apply_event(
        EventIn(type="agent.launched", agent_id="spool", title="Spool", message="keep")
    )
    store.apply_event(EventIn(type="agent.launched", agent_id="desky", title="Desky"))
    store.apply_event(
        EventIn(type="agent.needs_you", agent_id="desky", title="Roster", message="roster update")
    )
    body = store.status()
    assert body["phase"] == "needs_you"
    assert body["unread"] == 1
    desky = next(item for item in body["agents"] if item["id"] == "desky")
    assert desky["status"] == "needs_you"
    assert desky["attention"] is True
    assert desky["message"] == "roster update"
    last = body["last_event"]
    assert isinstance(last, dict)
    assert last["title"] == "Desky"
    assert last["message"] == "roster update"
    assert last["agent_id"] == "desky"

    store.apply_event(EventIn(type="agent.finished", agent_id="desky"))
    held = store.status()
    assert held["needs_you"] is True
    assert held["unread"] == 1
    desky = next(item for item in held["agents"] if item["id"] == "desky")
    assert desky["attention"] is True
    assert desky["status"] == "needs_you"
    assert desky["message"] == "roster update"
    spool = next(item for item in held["agents"] if item["id"] == "spool")
    assert spool["status"] == "running"
    assert spool["message"] == "keep"
    assert spool["attention"] is False

    store.dismiss()
    quiet = store.status()
    assert quiet["needs_you"] is False
    assert quiet["unread"] == 0
    assert quiet["phase"] == "running"
    desky = next(item for item in quiet["agents"] if item["id"] == "desky")
    assert desky["attention"] is False
    assert desky["status"] == "idle"
    assert desky["message"] == ""
    spool = next(item for item in quiet["agents"] if item["id"] == "spool")
    assert spool["status"] == "running"
    assert spool["message"] == "keep"


def test_refresh_updates_message_without_unread(tmp_path: Path) -> None:
    path = tmp_path / "desk.sqlite"
    store = DeskStore(sqlite_path=str(path))
    store.apply_event(
        EventIn(type="agent.launched", agent_id="desky", title="Desky", message="started")
    )
    store.apply_event(EventIn(type="agent.needs_you", agent_id="desky", message="roster update"))
    assert store.status()["unread"] == 1
    logged = len(store.status()["events"])
    store._agents["desky"].updated_at = _stamp(timedelta(seconds=121))
    store.apply_event(
        EventIn(type="agent.launched", agent_id="desky", title="Desky", message="still going")
    )
    body = store.status()
    assert body["unread"] == 1
    assert body["needs_you"] is True
    assert len(body["events"]) == logged + 1
    desky = next(item for item in body["agents"] if item["id"] == "desky")
    assert desky["message"] == "still going"
    assert desky["status"] == "needs_you"
    assert desky["attention"] is True
    store.apply_event(EventIn(type="agent.launched", agent_id="desky", message="still going"))
    again = store.status()
    assert len(again["events"]) == logged + 1
    assert again["agents"][0]["status"] == "needs_you"
    assert DeskStore(sqlite_path=str(path)).status()["agents"][0]["message"] == "still going"


def test_two_waiters_keep_their_own_asides() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="agent.launched", agent_id="desky", title="Desky"))
    store.apply_event(EventIn(type="agent.launched", agent_id="spool", title="Spool"))
    store.apply_event(
        EventIn(type="agent.needs_you", agent_id="desky", title="Roster", message="roster update")
    )
    store.apply_event(
        EventIn(type="agent.needs_you", agent_id="spool", title="Other", message="your turn")
    )
    body = store.status()
    assert body["unread"] == 2
    agents = {item["id"]: item for item in body["agents"]}
    assert agents["desky"]["title"] == "Desky"
    assert agents["desky"]["message"] == "roster update"
    assert agents["spool"]["title"] == "Spool"
    assert agents["spool"]["message"] == "your turn"
    last = body["last_event"]
    assert isinstance(last, dict)
    assert last["agent_id"] == "spool"
    assert last["title"] == "Spool"
    assert last["message"] == "your turn"
    store.clear_unread()
    assert store.status()["unread"] == 2
    ids = [item["id"] for item in body["agents"] if item["attention"]]
    assert ids == ["spool", "desky"]
    store.dismiss("nope")
    assert store.status()["needs_you"] is True
    store.dismiss("desky")
    held = store.status()
    assert held["needs_you"] is True
    assert held["unread"] == 1
    agents = {item["id"]: item for item in held["agents"]}
    assert agents["desky"]["attention"] is False
    assert agents["desky"]["message"] == ""
    assert agents["spool"]["attention"] is True
    assert agents["spool"]["message"] == "your turn"
    store.dismiss("spool")
    quiet = store.status()
    assert quiet["unread"] == 0
    assert quiet["needs_you"] is False


def test_stale_unread_clears_when_nothing_is_waiting(tmp_path: Path) -> None:
    path = tmp_path / "desk.sqlite"
    store = DeskStore(sqlite_path=str(path))
    store.apply_event(EventIn(type="agent.launched", agent_id="desky", title="Desky"))
    store._unread = 2
    store._persist()
    assert store.status()["unread"] == 0
    assert store.status()["agents"][0]["status"] == "running"
    assert DeskStore(sqlite_path=str(path)).status()["unread"] == 0


def test_frame_is_one_memory_slot_and_sits_before_agents() -> None:
    store = DeskStore()
    body = store.status()
    keys = list(body)
    assert keys.index("capture") == keys.index("unread") + 1
    assert body["capture"] is False
    store.request_frame()
    assert store.status()["capture"] is True
    assert store.save_frame(b"nope") == "bad"
    assert store.status()["capture"] is True
    assert store.frame() is None
    assert store.save_frame(b"BM" + b"\x00" * (FRAME_MAX - 1)) == "too_big"
    assert store.frame() is None
    bmp = b"BMframe"
    assert store.save_frame(bmp) == "ok"
    assert store.frame() == bmp
    assert store.status()["capture"] is False
    # A post that wins the race still stores, and a bad body does not replace it.
    assert store.save_frame(b"BM2") == "ok"
    assert store.save_frame(b"xx") == "bad"
    assert store.frame() == b"BM2"
    store.request_frame()
    assert store.save_frame(b"BM" + bytes(FRAME_MAX)) == "too_big"
    assert store.status()["capture"] is True
    assert store.frame() == b"BM2"
