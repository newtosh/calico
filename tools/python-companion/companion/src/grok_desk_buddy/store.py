from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

AGENT_TYPES = frozenset({"agent.launched", "agent.finished", "agent.needs_you"})
EVENT_CAP = 50
COLOR_LIMIT = 32
SHAPE_LIMIT = 16
ICON_LIMIT = 200

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
    color: str = ""
    shape: str = ""
    icon: str = ""


@dataclass(frozen=True)
class Event:
    id: str
    type: str
    agent_id: str
    title: str
    message: str
    source: str
    at: str
    color: str = ""
    shape: str = ""
    icon: str = ""


@dataclass
class _Agent:
    id: str
    title: str
    status: str
    updated_at: str
    color: str = ""
    shape: str = ""
    icon: str = ""


def clip_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def clip_shape(value: object) -> str:
    return clip_text(value, SHAPE_LIMIT).lower()


def face_event_title(title: str, message: str = "") -> str:
    """Panel headline. A dismiss acknowledgement is not one."""
    if title == "Dismissed" and not message:
        return ""
    return title


def _public_event(event: Event) -> dict[str, object]:
    data = asdict(event)
    data["title"] = face_event_title(event.title, event.message)
    return data


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
            color=clip_text(raw.color, COLOR_LIMIT),
            shape=clip_shape(raw.shape),
            icon=clip_text(raw.icon, ICON_LIMIT),
        )
        with self._lock:
            # A standing launch ping must not flood the log or clear NEEDS YOU.
            if raw.type == "agent.launched":
                current = self._agents.get(raw.agent_id)
                if current is not None and current.status in {"running", "needs_you"}:
                    self._upsert(
                        raw.agent_id,
                        raw.title,
                        current.status,
                        event.at,
                        event.color,
                        event.shape,
                        event.icon,
                    )
                    self._persist()
                    return event
            self._remember(event)
            if raw.type in _STATUS_FOR_TYPE:
                self._upsert(
                    raw.agent_id,
                    raw.title,
                    _STATUS_FOR_TYPE[raw.type],
                    event.at,
                    event.color,
                    event.shape,
                    event.icon,
                )
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
                    title="",
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
                    "color": agent.color,
                    "shape": agent.shape,
                    "icon": agent.icon,
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
            last = _public_event(self._events[0]) if self._events else None
            return {
                "phase": phase,
                "needs_you": phase == "needs_you",
                "agents": agents,
                "last_event": last,
                "events": [_public_event(event) for event in self._events],
            }

    def apply_cursor_item(
        self,
        agent_id: str,
        name: str,
        mapped: str,
        at: str,
        color: str = "",
        shape: str = "",
        icon: str = "",
    ) -> bool:
        if mapped not in {"running", "idle"}:
            raise ValueError("cursor status must be running or idle")
        event_type = "agent.launched" if mapped == "running" else "agent.finished"
        kept_color = clip_text(color, COLOR_LIMIT)
        kept_shape = clip_shape(shape)
        kept_icon = clip_text(icon, ICON_LIMIT)
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
                    color=kept_color,
                    shape=kept_shape,
                    icon=kept_icon,
                )
            )
            self._upsert(agent_id, name, mapped, at, kept_color, kept_shape, kept_icon)
            self._persist()
            return True

    def _remember(self, event: Event) -> None:
        self._events.insert(0, event)
        del self._events[EVENT_CAP:]

    def _upsert(
        self,
        agent_id: str,
        title: str,
        status: str,
        at: str,
        color: str,
        shape: str,
        icon: str,
    ) -> None:
        current = self._agents.get(agent_id)
        kept = title if title else (current.title if current else "")
        self._agents[agent_id] = _Agent(
            id=agent_id,
            title=kept,
            status=status,
            updated_at=at,
            color=color or (current.color if current else ""),
            shape=shape or (current.shape if current else ""),
            icon=icon or (current.icon if current else ""),
        )

    def _connect(self) -> sqlite3.Connection:
        assert self._sqlite_path is not None
        return sqlite3.connect(self._sqlite_path)

    def _load(self) -> None:
        with self._connect() as conn:
            _ensure_schema(conn)
            rows = conn.execute(
                "SELECT id, type, agent_id, title, message, source, at, color, shape, icon "
                "FROM events ORDER BY seq DESC"
            ).fetchall()
            for row in rows[:EVENT_CAP]:
                self._events.append(Event(*row))
            for agent_id, title, status, updated_at, color, shape, icon in conn.execute(
                "SELECT id, title, status, updated_at, color, shape, icon FROM agents"
            ):
                self._agents[agent_id] = _Agent(
                    agent_id, title, status, updated_at, color or "", shape or "", icon or ""
                )

    def _persist(self) -> None:
        if not self._sqlite_path:
            return
        with self._connect() as conn:
            _ensure_schema(conn)
            conn.execute("DELETE FROM events")
            conn.execute("DELETE FROM agents")
            for index, event in enumerate(reversed(self._events)):
                conn.execute(
                    "INSERT INTO events ("
                    "seq, id, type, agent_id, title, message, source, at, color, shape, icon"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        index,
                        event.id,
                        event.type,
                        event.agent_id,
                        event.title,
                        event.message,
                        event.source,
                        event.at,
                        event.color,
                        event.shape,
                        event.icon,
                    ),
                )
            for agent in self._agents.values():
                conn.execute(
                    "INSERT INTO agents ("
                    "id, title, status, updated_at, color, shape, icon"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        agent.id,
                        agent.title,
                        agent.status,
                        agent.updated_at,
                        agent.color,
                        agent.shape,
                        agent.icon,
                    ),
                )


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            seq INTEGER PRIMARY KEY,
            id TEXT, type TEXT, agent_id TEXT, title TEXT,
            message TEXT, source TEXT, at TEXT,
            color TEXT NOT NULL DEFAULT '',
            shape TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT ''
        )
        """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT,
            color TEXT NOT NULL DEFAULT '',
            shape TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT ''
        )
        """)
    _add_text_columns(conn, "events")
    _add_text_columns(conn, "agents")


def _add_text_columns(conn: sqlite3.Connection, table: str) -> None:
    have = {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}
    for name in ("color", "shape", "icon"):
        if name not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
