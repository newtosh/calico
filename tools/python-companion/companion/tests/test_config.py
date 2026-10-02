from pathlib import Path

import pytest

from grok_desk_buddy.config import (
    CompanionConfig,
    config_path,
    load_config,
    merge_config,
    merge_panel,
    panel_public_view,
    panel_status_field,
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
    assert loaded.panel_url == ""
    assert panel_status_field(loaded) is None


def test_merge_panel_url_and_token(tmp_path: Path) -> None:
    current = CompanionConfig("0.0.0.0", 8787, "hook", "", "", 30)
    merged = merge_panel(
        current,
        {"url": "http://192.168.4.30:8787/", "token": "desk-secret"},
    )
    assert merged.panel_url == "http://192.168.4.30:8787"
    assert merged.panel_token == "desk-secret"
    assert merged.webhook_token == "hook"
    kept = merge_panel(merged, {"url": "http://192.168.4.40:8787"})
    assert kept.panel_token == "desk-secret"
    cleared = merge_panel(kept, {"clear": True, "url": "http://10.0.0.1:8787"})
    assert cleared.panel_url == ""
    assert cleared.panel_token == ""
    assert panel_public_view(merged) == {
        "url": "http://192.168.4.30:8787",
        "token_set": True,
    }
    assert panel_status_field(merged) == {
        "url": "http://192.168.4.30:8787",
        "token": "desk-secret",
    }
    path = tmp_path / "config.json"
    save_config(path, merged)
    loaded = load_config(path, {})
    assert loaded.panel_url == merged.panel_url
    assert loaded.panel_token == merged.panel_token
    companion, _restart = merge_config(loaded, {"bind_port": 9000})
    assert companion.panel_token == "desk-secret"
    assert "desk-secret" not in public_view(companion).values()


def test_merge_panel_requires_a_url_before_a_token() -> None:
    current = CompanionConfig("0.0.0.0", 8787, "", "", "", 30)
    with pytest.raises(ValueError):
        merge_panel(current, {"token": "only-token"})


@pytest.mark.parametrize(
    "patch",
    [
        {"url": "http://192.168.4.30:8787", "ssid": "home"},
        {"url": "http://192.168.4.30:8787", "password": "secret"},
        {"url": "http://192.168.4.30:8787", "pass": "secret"},
        {"clear": True, "wifi_password": "secret"},
        {"url": "ftp://192.168.4.30:8787"},
        {"url": "http://user:secret@192.168.4.30:8787"},
        {"url": "http://192.168.4.30:8787", "token": 'say "hi"'},
    ],
)
def test_merge_panel_rejects_wifi_and_bad_values(patch: dict[str, object]) -> None:
    current = CompanionConfig("0.0.0.0", 8787, "", "", "", 30, "http://10.0.0.2:8787", "keep")
    with pytest.raises(ValueError):
        merge_panel(current, patch)
    assert current.panel_url == "http://10.0.0.2:8787"
    assert current.panel_token == "keep"
