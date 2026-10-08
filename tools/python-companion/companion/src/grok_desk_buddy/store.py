from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta

AGENT_TYPES = frozenset({"agent.launched", "agent.finished", "agent.needs_you"})
EVENT_CAP = 50
COLOR_LIMIT = 32
SHAPE_LIMIT = 16
ICON_LIMIT = 200
# A launch POST that nobody refreshes must not pin the desk on the 2s poll.
RUNNING_TTL = timedelta(seconds=120)
# One 480x480 RGB565 BMP plus the 66-byte header and a little slack.
FRAME_MAX = 480 * 480 * 2 + 256


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
    # Awaiting Jon. Independent of running/idle so a finish does not drop the lamp.
    attention: bool = False
    message: str = ""


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


def _visible_status(agent: _Agent, now: datetime) -> str:
    if agent.attention:
        return "needs_you"
    if agent.status != "running":
        return "idle"
    try:
        updated = datetime.strptime(agent.updated_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError:
        return agent.status
    if now - updated > RUNNING_TTL:
        return "idle"
    return "running"


def _note_visible(event: Event | None) -> bool:
    return bool(event and event.type == "note" and event.message)


class DeskStore:
    def __init__(self, sqlite_path: str | None = None) -> None:
        self._lock = threading.Lock()
        self._events: list[Event] = []
        self._agents: dict[str, _Agent] = {}
        self._unread = 0
        self._capture = False
        self._frame: bytes | None = None
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
            # A standing launch ping refreshes updated_at and must not flood
            # the log, bump unread, or clear attention.
            if raw.type == "agent.launched":
                current = self._agents.get(raw.agent_id)
                if current is not None and (current.status == "running" or current.attention):
                    changed = bool(raw.message) and raw.message != current.message
                    self._touch(
                        raw.agent_id,
                        raw.title,
                        event.at,
                        event.color,
                        event.shape,
                        event.icon,
                        status="running",
                        attention=current.attention,
                        message=raw.message or None,
                    )
                    if changed:
                        self._remember(event)
                    self._persist()
                    return event
            if raw.type == "agent.finished":
                current = self._agents.get(raw.agent_id)
                waiting = current is not None and current.attention
                self._remember(event)
                # Keep the question up when they are still waiting. An empty
                # finish title is not a rename; a provided one is the name.
                self._touch(
                    raw.agent_id,
                    raw.title,
                    event.at,
                    event.color,
                    event.shape,
                    event.icon,
                    status="idle",
                    attention=waiting,
                    message=None if waiting else "",
                )
                self._persist()
                return event
            if raw.type == "note" and raw.message:
                self._unread = 1
            self._remember(event)
            if raw.type == "agent.needs_you":
                # The question is `message`. A title here must not rename Desky to the question.
                named = "" if raw.agent_id in self._agents else raw.title
                self._touch(
                    raw.agent_id,
                    named,
                    event.at,
                    event.color,
                    event.shape,
                    event.icon,
                    status="running",
                    attention=True,
                    message=raw.message or None,
                )
            elif raw.type == "agent.launched":
                self._touch(
                    raw.agent_id,
                    raw.title,
                    event.at,
                    event.color,
                    event.shape,
                    event.icon,
                    status="running",
                    attention=False,
                    message=raw.message or None,
                )
            self._persist()
        return event

    def dismiss(self, agent_id: str = "") -> None:
        with self._lock:
            at = _now()
            cleared = False
            for agent in self._agents.values():
                if not agent.attention:
                    continue
                if agent_id and agent.id != agent_id:
                    continue
                agent.attention = False
                agent.message = ""
                if agent.status == "running":
                    agent.updated_at = at
                cleared = True
            still = any(agent.attention for agent in self._agents.values())
            # A named dismiss that matched nobody must not clear the others.
            if agent_id and not cleared:
                return
            if still:
                self._persist()
                return
            # The alert is gone and this note has no text. A badge with
            # nothing to highlight is the bug Jon hit.
            self._unread = 0
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

    def request_frame(self) -> None:
        with self._lock:
            self._capture = True

    def save_frame(self, body: bytes) -> str:
        """Store one BMP. 'too_big' and 'bad' leave the previous frame and the flag."""
        if len(body) > FRAME_MAX:
            return "too_big"
        if len(body) < 2 or not body.startswith(b"BM"):
            return "bad"
        with self._lock:
            self._frame = bytes(body)
            self._capture = False
        return "ok"

    def frame(self) -> bytes | None:
        with self._lock:
            return self._frame

    def clear_unread(self) -> None:
        with self._lock:
            if self._unread == 0:
                return
            self._unread = 0
            self._persist()

    def _reported_unread(self) -> int:
        """Badge equals waiting agents. A note counts only when nothing is waiting."""
        waiters = sum(1 for agent in self._agents.values() if agent.attention)
        if waiters:
            return waiters
        last = self._events[0] if self._events else None
        if _note_visible(last) and self._unread:
            return 1
        return 0

    def _face_last(self) -> dict[str, object] | None:
        """Last event the face matches onto a row.

        One waiting agent keeps their question on that row even when a later
        event has no text. Firmware that only reads last_event.title still
        highlights the right agent.
        """
        if not self._events:
            return None
        data = _public_event(self._events[0])
        waiters = [agent for agent in self._agents.values() if agent.attention and agent.message]
        if len(waiters) == 1:
            agent = waiters[0]
            data["agent_id"] = agent.id
            data["title"] = agent.title or agent.id
            data["message"] = agent.message
            return data
        agent_id = str(data.get("agent_id", ""))
        if data.get("message") and agent_id:
            agent = self._agents.get(agent_id)
            bound = agent.title or agent.id if agent else ""
            if bound and data.get("title") not in {agent.title, agent.id}:
                data["title"] = bound
        return data

    def status(self) -> dict[str, object]:
        with self._lock:
            # attention, then newest updated_at. The clock is whole seconds, so
            # two needs_you in that second follow event order (later event first).
            # id is the last tie. Stable sorts keep the earlier key.
            recent: dict[str, int] = {}
            for index, event in enumerate(self._events):
                if event.agent_id and event.agent_id not in recent:
                    recent[event.agent_id] = index
            tail = len(self._events)
            ordered = sorted(self._agents.values(), key=lambda agent: agent.id)
            ordered.sort(
                key=lambda agent: recent.get(agent.id, tail) if agent.attention else 0
            )
            ordered.sort(key=lambda agent: agent.updated_at, reverse=True)
            ordered.sort(key=lambda agent: not agent.attention)
            now = datetime.now(UTC)
            agents = [
                {
                    "id": agent.id,
                    "title": agent.title,
                    "status": _visible_status(agent, now),
                    "attention": agent.attention,
                    "message": agent.message,
                    "updated_at": agent.updated_at,
                    "color": agent.color,
                    "shape": agent.shape,
                    "icon": agent.icon,
                }
                for agent in ordered
            ]
            statuses = {str(item["status"]) for item in agents}
            if "needs_you" in statuses:
                phase = "needs_you"
            elif "running" in statuses:
                phase = "running"
            else:
                phase = "idle"
            unread = self._reported_unread()
            if unread == 0 and self._unread != 0:
                self._unread = 0
                self._persist()
            return {
                "phase": phase,
                "needs_you": phase == "needs_you",
                "unread": unread,
                # Before agents: a 16KB panel buffer drops the tail.
                "capture": self._capture,
                "agents": agents,
                "last_event": self._face_last(),
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
            if current is not None and current.attention:
                return False
            if current is not None and current.status == mapped:
                # Same cursor status is the heartbeat. A newer stamp keeps
                # the row from aging out; it is not a new unread.
                if mapped == "running" and at > current.updated_at:
                    current.updated_at = at
                    self._persist()
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
            self._touch(
                agent_id,
                name,
                at,
                kept_color,
                kept_shape,
                kept_icon,
                status=mapped,
                attention=False,
            )
            self._persist()
            return True

    def _remember(self, event: Event) -> None:
        self._events.insert(0, event)
        del self._events[EVENT_CAP:]

    def _touch(
        self,
        agent_id: str,
        title: str,
        at: str,
        color: str,
        shape: str,
        icon: str,
        *,
        status: str,
        attention: bool,
        message: str | None = None,
    ) -> None:
        current = self._agents.get(agent_id)
        if message is None:
            message = current.message if current else ""
        self._agents[agent_id] = _Agent(
            id=agent_id,
            title=title or (current.title if current else ""),
            status=status,
            updated_at=at,
            color=color or (current.color if current else ""),
            shape=shape or (current.shape if current else ""),
            icon=icon or (current.icon if current else ""),
            attention=attention,
            message=message,
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
            for (
                agent_id,
                title,
                status,
                updated_at,
                color,
                shape,
                icon,
                attention,
                message,
            ) in conn.execute(
                "SELECT id, title, status, updated_at, color, shape, icon, attention, message "
                "FROM agents"
            ):
                waiting = bool(attention) or status == "needs_you"
                life = "running" if status == "needs_you" else status
                self._agents[agent_id] = _Agent(
                    agent_id,
                    title,
                    life,
                    updated_at,
                    color or "",
                    shape or "",
                    icon or "",
                    waiting,
                    message or "",
                )
            row = conn.execute("SELECT n FROM unread").fetchone()
            if row is not None:
                self._unread = max(0, int(row[0]))

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
                    "id, title, status, updated_at, color, shape, icon, attention, message"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        agent.id,
                        agent.title,
                        agent.status,
                        agent.updated_at,
                        agent.color,
                        agent.shape,
                        agent.icon,
                        1 if agent.attention else 0,
                        agent.message,
                    ),
                )
            conn.execute("DELETE FROM unread")
            conn.execute("INSERT INTO unread (n) VALUES (?)", (self._unread,))


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
    conn.execute("CREATE TABLE IF NOT EXISTS unread (n INTEGER NOT NULL)")


def _add_text_columns(conn: sqlite3.Connection, table: str) -> None:
    have = {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}
    for name in ("color", "shape", "icon"):
        if name not in have:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
    if table == "agents":
        if "attention" not in have:
            conn.execute("ALTER TABLE agents ADD COLUMN attention INTEGER NOT NULL DEFAULT 0")
        if "message" not in have:
            conn.execute("ALTER TABLE agents ADD COLUMN message TEXT NOT NULL DEFAULT ''")
