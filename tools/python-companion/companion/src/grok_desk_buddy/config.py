from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CompanionConfig:
    bind_host: str
    bind_port: int
    webhook_token: str
    cursor_api_key: str
    sqlite_path: str
    cursor_poll_seconds: int


def config_path(environ: Mapping[str, str], default: str = "companion/data/config.json") -> str:
    return environ.get("GROK_DESK_CONFIG") or default


def default_config() -> CompanionConfig:
    return CompanionConfig("0.0.0.0", 8787, "", "", "", 30)


def load_config(path: Path, environ: Mapping[str, str]) -> CompanionConfig:
    data: dict[str, object] = {}
    if path.is_file():
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data = loaded
    config = CompanionConfig(
        bind_host=str(data.get("bind_host", "0.0.0.0")),
        bind_port=int(str(data.get("bind_port", 8787))),
        webhook_token=str(data.get("webhook_token", "")),
        cursor_api_key=str(data.get("cursor_api_key", "")),
        sqlite_path=str(data.get("sqlite_path", "")),
        cursor_poll_seconds=int(str(data.get("cursor_poll_seconds", 30))),
    )
    overrides = {
        "GROK_DESK_HOST": "bind_host",
        "GROK_DESK_WEBHOOK_TOKEN": "webhook_token",
        "CURSOR_API_KEY": "cursor_api_key",
        "GROK_DESK_SQLITE": "sqlite_path",
    }
    for env_name, field in overrides.items():
        value = environ.get(env_name, "")
        if value:
            setattr(config, field, value)
    if environ.get("GROK_DESK_PORT"):
        config.bind_port = int(environ["GROK_DESK_PORT"])
    if environ.get("GROK_DESK_CURSOR_POLL_SECONDS"):
        config.cursor_poll_seconds = int(environ["GROK_DESK_CURSOR_POLL_SECONDS"])
    return config


def save_config(path: Path, config: CompanionConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "bind_host": config.bind_host,
        "bind_port": config.bind_port,
        "webhook_token": config.webhook_token,
        "cursor_api_key": config.cursor_api_key,
        "sqlite_path": config.sqlite_path,
        "cursor_poll_seconds": config.cursor_poll_seconds,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def public_view(config: CompanionConfig) -> dict[str, object]:
    return {
        "bind_host": config.bind_host,
        "bind_port": config.bind_port,
        "sqlite_path": config.sqlite_path,
        "cursor_poll_seconds": config.cursor_poll_seconds,
        "webhook_token_set": bool(config.webhook_token),
        "cursor_api_key_set": bool(config.cursor_api_key),
    }


def _bounded_int(value: object, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("bad number")
    if isinstance(value, str):
        if not value.isdigit():
            raise ValueError("bad number")
        value = int(value)
    if value < low or value > high:
        raise ValueError("bad number")
    return value


def merge_config(
    current: CompanionConfig, patch: Mapping[str, object]
) -> tuple[CompanionConfig, bool]:
    merged = CompanionConfig(
        current.bind_host,
        current.bind_port,
        current.webhook_token,
        current.cursor_api_key,
        current.sqlite_path,
        current.cursor_poll_seconds,
    )
    if "bind_host" in patch:
        merged.bind_host = str(patch["bind_host"])
    if "bind_port" in patch:
        merged.bind_port = _bounded_int(patch["bind_port"], 1, 65535)
    if "sqlite_path" in patch:
        merged.sqlite_path = str(patch["sqlite_path"])
    if "cursor_poll_seconds" in patch:
        merged.cursor_poll_seconds = _bounded_int(patch["cursor_poll_seconds"], 5, 86400)
    if "webhook_token" in patch:
        merged.webhook_token = str(patch["webhook_token"])
    if "cursor_api_key" in patch:
        merged.cursor_api_key = str(patch["cursor_api_key"])
    restart = (
        merged.bind_host != current.bind_host
        or merged.bind_port != current.bind_port
        or merged.sqlite_path != current.sqlite_path
    )
    return merged, restart
