from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

AGENT_TYPES = frozenset({"agent.launched", "agent.finished", "agent.needs_you"})
EVENT_CAP = 50

_STATUS_FOR_TYPE = {
    "agent.launched": "running",
    "agent.finished": "idle",
    "agent.needs_you": "needs_you",
}


@dataclass(frozen=True)
class EventIn:
    type: str
    agent_id: str = ""
    title: str = ""
    message: str = ""
    source: str = "grok-bot"


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    agent_id: str
    title: str
    message: str
    source: str
    at: str


@dataclass
class _Agent:
    id: str
    title: str
    status: str
    updated_at: str


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class DeskStore:
    def __init__(self, sqlite_path: str | None = None) -> None:
        self._lock = threading.Lock()
        self._events: list[Event] = []
        self._agents: dict[str, _Agent] = {}
        self._sqlite_path = sqlite_path or None
        if self._sqlite_path:
            self._load()

    def apply_event(self, raw: EventIn) -> Event:
        if raw.type not in AGENT_TYPES and raw.type != "note":
            raise ValueError("unknown event type")
        if raw.type in AGENT_TYPES and not raw.agent_id:
            raise ValueError("agent_id required")
        event = Event(
            id=str(uuid.uuid4()),
            type=raw.type,
            agent_id=raw.agent_id,
            title=raw.title,
            message=raw.message,
            source=raw.source,
            at=_now(),
        )
        with self._lock:
            self._remember(event)
            if raw.type in _STATUS_FOR_TYPE:
                self._upsert(raw.agent_id, raw.title, _STATUS_FOR_TYPE[raw.type], event.at)
            self._persist()
        return event

    def dismiss(self) -> None:
        with self._lock:
            at = _now()
            for agent in self._agents.values():
                if agent.status == "needs_you":
                    agent.status = "running"
                    agent.updated_at = at
            self._remember(
                Event(
                    id=str(uuid.uuid4()),
                    type="note",
                    agent_id="",
                    title="Dismissed",
                    message="",
                    source="manual",
                    at=at,
                )
            )
            self._persist()

    def status(self) -> dict[str, object]:
        with self._lock:
            agents = [
                {
                    "id": agent.id,
                    "title": agent.title,
                    "status": agent.status,
                    "updated_at": agent.updated_at,
                }
                for agent in sorted(self._agents.values(), key=lambda item: item.id)
            ]
            statuses = {str(item["status"]) for item in agents}
            if "needs_you" in statuses:
                phase = "needs_you"
            elif "running" in statuses:
                phase = "running"
            else:
                phase = "idle"
            last = asdict(self._events[0]) if self._events else None
            return {
                "phase": phase,
                "needs_you": phase == "needs_you",
                "agents": agents,
                "last_event": last,
                "events": [asdict(event) for event in self._events],
            }

    def apply_cursor_item(self, agent_id: str, name: str, mapped: str, at: str) -> bool:
        if mapped not in {"running", "idle"}:
            raise ValueError("cursor status must be running or idle")
        event_type = "agent.launched" if mapped == "running" else "agent.finished"
        with self._lock:
            current = self._agents.get(agent_id)
            if current is not None and (current.status == mapped or current.status == "needs_you"):
                return False
            self._remember(
                Event(
                    id=str(uuid.uuid4()),
                    type=event_type,
                    agent_id=agent_id,
                    title=name,
                    message="",
                    source="cursor",
                    at=at,
                )
            )
            self._upsert(agent_id, name, mapped, at)
            self._persist()
            return True

    def _remember(self, event: Event) -> None:
        self._events.insert(0, event)
        del self._events[EVENT_CAP:]

    def _upsert(self, agent_id: str, title: str, status: str, at: str) -> None:
        current = self._agents.get(agent_id)
        kept = title if title else (current.title if current else "")
        self._agents[agent_id] = _Agent(id=agent_id, title=kept, status=status, updated_at=at)

    def _connect(self) -> sqlite3.Connection:
        assert self._sqlite_path is not None
        return sqlite3.connect(self._sqlite_path)

    def _load(self) -> None:
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY,
                    id TEXT, type TEXT, agent_id TEXT, title TEXT,
                    message TEXT, source TEXT, at TEXT
                )
                """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT
                )
                """)
            rows = conn.execute(
                "SELECT id, type, agent_id, title, message, source, at "
                "FROM events ORDER BY seq DESC"
            ).fetchall()
            for row in rows[:EVENT_CAP]:
                self._events.append(Event(*row))
            for agent_id, title, status, updated_at in conn.execute(
                "SELECT id, title, status, updated_at FROM agents"
            ):
                self._agents[agent_id] = _Agent(agent_id, title, status, updated_at)

    def _persist(self) -> None:
        if not self._sqlite_path:
            return
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY,
                    id TEXT, type TEXT, agent_id TEXT, title TEXT,
                    message TEXT, source TEXT, at TEXT
                )
                """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT
                )
                """)
            conn.execute("DELETE FROM events")
            conn.execute("DELETE FROM agents")
            for index, event in enumerate(reversed(self._events)):
                conn.execute(
                    "INSERT INTO events (seq, id, type, agent_id, title, message, source, at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        index,
                        event.id,
                        event.type,
                        event.agent_id,
                        event.title,
                        event.message,
                        event.source,
                        event.at,
                    ),
                )
            for agent in self._agents.values():
                conn.execute(
                    "INSERT INTO agents (id, title, status, updated_at) VALUES (?, ?, ?, ?)",
                    (agent.id, agent.title, agent.status, agent.updated_at),
                )
