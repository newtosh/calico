"""Host checks for the BLE provisioner. No radio and no bleak required."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "ble-provision.py"
HEADER = Path(__file__).resolve().parent.parent / "firmware" / "main" / "ble_desk.h"
LINK = Path(__file__).resolve().parent.parent / "firmware" / "main" / "ble_link.c"


def load_tool():
    spec = importlib.util.spec_from_file_location("ble_provision", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def uuid_le(uuid: str) -> str:
    raw = bytes.fromhex(uuid.replace("-", ""))
    return ",".join(f"0x{byte:02x}" for byte in raw[::-1])


def test_uuids_match_firmware():
    tool = load_tool()
    header = HEADER.read_text(encoding="utf-8")
    link = "".join(LINK.read_text(encoding="utf-8").split())
    assert tool.NAME == "grokbot-buddy"
    assert f'#define BLE_DESK_NAME "{tool.NAME}"' in header
    for key, uuid in tool.UUIDS.items():
        assert f'"{uuid}"' in header, key
        assert uuid_le(uuid) in link, key
    assert "#define BLE_DESK_URL_MAX 127" in header
    assert tool.URL_MAX == 127
    assert tool.TOKEN_MAX == 127
    assert tool.SSID_MAX == 32
    assert tool.PASS_MAX == 64


def test_encode_matches_desk_parser():
    tool = load_tool()
    assert tool.encode_url("http://192.168.4.30:8787") == b"http://192.168.4.30:8787"
    assert tool.encode_url("https://desk.example/hook") == b"https://desk.example/hook"
    assert tool.encode_token("") == b"\n"
    assert tool.encode_token("desk-secret") == b"desk-secret"
    assert tool.encode_wifi("home", "password1") == b"home\npassword1"
    assert tool.encode_wifi("open", "") == b"open\n"
    assert tool.encode_reboot() == b"reboot"
    for bad in ("ftp://x", "http://", "https://", "http://bad\nhost"):
        try:
            tool.encode_url(bad)
        except tool.FieldError:
            continue
        raise AssertionError(bad)
    try:
        tool.encode_wifi("home", "short")
    except tool.FieldError:
        pass
    else:
        raise AssertionError("short wpa")
    try:
        tool.encode_token("has\nbreak")
    except tool.FieldError:
        pass
    else:
        raise AssertionError("token break")


def test_status_parse_hides_nothing_it_was_not_given():
    tool = load_tool()
    body = (
        "name=grokbot-buddy\n"
        "fw=886dd11\n"
        "ssid=none\n"
        "url=http://192.168.4.30:8787\n"
        "token=none\n"
    )
    fields = tool.parse_status(body)
    assert fields["name"] == "grokbot-buddy"
    assert fields["fw"] == "886dd11"
    assert fields["ssid"] == "none"
    assert fields["url"] == "http://192.168.4.30:8787"
    assert fields["token"] == "none"
    assert "desk-bearer-secret" not in body


def test_token_encode_ignores_environment(monkeypatch):
    tool = load_tool()
    monkeypatch.setenv("TOKEN", "from-env")
    monkeypatch.setenv("PASSWORD", "from-env")
    assert tool.encode_token("typed") == b"typed"
    assert tool.encode_wifi("home", "password1") == b"home\npassword1"
    assert os.environ["TOKEN"] == "from-env"
