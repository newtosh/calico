from pathlib import Path

import pytest

from grok_desk_buddy.config import (
    CompanionConfig,
    config_path,
    load_config,
    merge_config,
    public_view,
    save_config,
)


def test_load_env_override_and_mask(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    save_config(path, CompanionConfig("127.0.0.1", 8787, "", "ck_live", "", 30))
    loaded = load_config(path, {"GROK_DESK_PORT": "9000"})
    assert loaded.bind_host == "127.0.0.1"
    assert loaded.bind_port == 9000
    assert loaded.cursor_api_key == "ck_live"
    view = public_view(loaded)
    assert view["cursor_api_key_set"] is True
    assert "ck_live" not in view.values()


def test_merge_keeps_omitted_secret() -> None:
    current = CompanionConfig("0.0.0.0", 8787, "tok", "ck_live", "", 30)
    merged, restart = merge_config(current, {"bind_port": 9001, "extra": 1})
    assert restart is True
    assert merged.cursor_api_key == "ck_live"
    assert merged.bind_port == 9001
    cleared, _restart = merge_config(merged, {"cursor_api_key": ""})
    assert cleared.cursor_api_key == ""


def test_config_path_env() -> None:
    assert config_path({}) == "companion/data/config.json"
    assert config_path({"GROK_DESK_CONFIG": "data/desk.json"}) == "data/desk.json"


def test_merge_rejects_bad_port() -> None:
    current = CompanionConfig("0.0.0.0", 8787, "", "", "", 30)
    with pytest.raises(ValueError):
        merge_config(current, {"bind_port": "abc"})
    with pytest.raises(ValueError):
        merge_config(current, {"bind_port": 70000})
    with pytest.raises(ValueError):
        merge_config(current, {"cursor_poll_seconds": -1})


def test_missing_file_defaults(tmp_path: Path) -> None:
    loaded = load_config(tmp_path / "missing.json", {})
    assert loaded.bind_host == "0.0.0.0"
    assert loaded.bind_port == 8787
    assert loaded.cursor_poll_seconds == 30
