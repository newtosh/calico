from __future__ import annotations

import json
import logging
from base64 import b64encode
from collections.abc import Callable
from urllib.request import Request, urlopen

from grok_desk_buddy.store import COLOR_LIMIT, ICON_LIMIT, DeskStore, clip_shape, clip_text

AGENTS_URL = "https://api.cursor.com/v1/agents?limit=20"
logger = logging.getLogger(__name__)


def map_cursor_status(status: str) -> str | None:
    key = status.upper()
    if key == "ACTIVE":
        return "running"
    if key in {"IDLE", "ARCHIVED"}:
        return "idle"
    return None


def poll_once(
    store: DeskStore,
    api_key: str,
    get: Callable[[str, str], bytes],
    now: str,
) -> None:
    if not api_key:
        return
    try:
        raw = get(AGENTS_URL, api_key)
        parsed = json.loads(raw.decode())
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("cursor poll failed: %s", exc)
        return
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return
    for item in items:
        if not isinstance(item, dict):
            continue
        mapped = map_cursor_status(str(item.get("status", "")))
        agent_id = str(item.get("id", ""))
        if mapped is None or not agent_id:
            continue
        store.apply_cursor_item(
            agent_id,
            str(item.get("name", "")),
            mapped,
            now,
            clip_text(item.get("color"), COLOR_LIMIT),
            clip_shape(item.get("shape")),
            clip_text(item.get("icon"), ICON_LIMIT),
        )


def urllib_get(url: str, api_key: str) -> bytes:
    basic = b64encode(f"{api_key}:".encode()).decode()
    request = Request(url, headers={"Authorization": f"Basic {basic}"})
    with urlopen(request, timeout=10) as response:
        body = response.read()
        if not isinstance(body, bytes):
            raise OSError("empty cursor response")
        return body
