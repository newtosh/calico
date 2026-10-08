"""Host checks for the USB NVS provisioner. No board and no ESP-IDF required."""

from __future__ import annotations

import csv
import importlib.util
import os
import struct
import subprocess
import sys
import zlib
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "provision-wifi.py"


def load_provisioner():
    spec = importlib.util.spec_from_file_location("provision_wifi", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_partition_matches_firmware_table():
    tool = load_provisioner()
    offset, size = tool.nvs_geometry(tool.partitions_csv())
    assert offset == 0x9000
    assert size == 0x6000


def _csv_map(text: str) -> dict[str, str]:
    rows = list(csv.DictReader(text.splitlines()))
    return {row["key"]: row["value"] for row in rows if row["type"] == "data"}


def test_csv_uses_indexed_keys_and_omits_blank_optional():
    tool = load_provisioner()
    ssid = "unit-ssid"
    password = "p" * 8
    store = tool.Store()
    tool.apply_add(store, ssid, password, "", "")
    text = tool.render_csv([("desk", tool.entries_from_store(store))])
    rows = list(csv.DictReader(text.splitlines()))
    assert rows[0]["key"] == "desk"
    assert rows[0]["type"] == "namespace"
    assert [(row["key"], row["type"], row["encoding"]) for row in rows[1:]] == [
        ("n0ssid", "data", "string"),
        ("n0pass", "data", "string"),
    ]
    assert rows[1]["value"] == ssid
    assert rows[2]["value"] == password
    assert " ," not in text and ", " not in text


def test_csv_quotes_comma_and_includes_optional_keys():
    tool = load_provisioner()
    password = 'comma,quote"'
    url = "http://127.0.0.1:9"
    token = "t" * 8
    store = tool.Store()
    tool.apply_add(store, "unit-ssid", password, url, token)
    text = tool.render_csv([("desk", tool.entries_from_store(store))])
    by_key = _csv_map(text)
    assert by_key["n0pass"] == password
    assert by_key["n0url"] == url
    assert by_key["n0token"] == token
    assert "url" not in by_key
    assert "token" not in by_key


def test_legacy_nvs_migrates_and_add_keeps_the_first_network():
    tool = load_provisioner()
    first_pass = "home-pass"
    second_pass = "away-pass"
    previous = {
        "ssid": "home",
        "pass": first_pass,
        "url": "http://10.0.0.5:8787",
        "token": "global-token",
    }
    store = tool.store_from_entries(previous)
    assert [net.ssid for net in store.networks] == ["home"]
    assert store.networks[0].password == first_pass
    assert store.networks[0].url == ""
    assert store.url == "http://10.0.0.5:8787"
    assert store.token == "global-token"
    tool.apply_add(store, "away", second_pass, "http://10.1.0.8:8787", "")
    written = dict(tool.entries_for_desk(previous, store))
    assert written["n0ssid"] == "home"
    assert written["n0pass"] == first_pass
    assert written["n1ssid"] == "away"
    assert written["n1pass"] == second_pass
    assert written["n1url"] == "http://10.1.0.8:8787"
    assert "n1token" not in written
    assert written["url"] == "http://10.0.0.5:8787"
    assert written["token"] == "global-token"
    assert "ssid" not in written
    assert "pass" not in written
    summary = "\n".join(tool.summary_lines(store, "/dev/ttyACM0", 0x9000, 0x6000, "add"))
    assert first_pass not in summary
    assert second_pass not in summary
    assert "global-token" not in summary
    assert "home" in summary and "away" in summary


def test_add_updates_one_network_without_dropping_the_other():
    tool = load_provisioner()
    store = tool.store_from_entries(
        {
            "n0ssid": "home",
            "n0pass": "home-pass",
            "n1ssid": "away",
            "n1pass": "away-pass",
            "url": "http://10.0.0.5:8787",
        }
    )
    tool.apply_add(store, "home", "home-pass-2", "", "net-token")
    written = dict(tool.entries_from_store(store))
    assert written["n0ssid"] == "home"
    assert written["n0pass"] == "home-pass-2"
    assert written["n0token"] == "net-token"
    assert "n0url" not in written
    assert written["n1ssid"] == "away"
    assert written["n1pass"] == "away-pass"
    assert written["url"] == "http://10.0.0.5:8787"


def test_remove_one_network_packs_the_rest():
    tool = load_provisioner()
    store = tool.store_from_entries(
        {
            "n0ssid": "home",
            "n0pass": "home-pass",
            "n1ssid": "away",
            "n1pass": "away-pass",
            "n1url": "http://10.1.0.8:8787",
        }
    )
    assert tool.apply_remove(store, "home") is True
    written = dict(tool.entries_from_store(store))
    assert written["n0ssid"] == "away"
    assert written["n0pass"] == "away-pass"
    assert written["n0url"] == "http://10.1.0.8:8787"
    assert "n1ssid" not in written
    assert tool.apply_remove(store, "missing") is False
    assert store.networks[0].ssid == "away"


def test_indexed_ssid_wins_over_a_different_legacy_ssid():
    tool = load_provisioner()
    store = tool.store_from_entries(
        {"ssid": "stale", "pass": "stale-pass", "n0ssid": "home", "n0pass": "home-pass"}
    )
    assert [net.ssid for net in store.networks] == ["home"]
    assert store.networks[0].password == "home-pass"


def test_unknown_desk_key_and_other_namespace_survive_add():
    tool = load_provisioner()
    previous = {"n0ssid": "home", "n0pass": "home-pass", "note": "keep-me"}
    store = tool.store_from_entries(previous)
    tool.apply_add(store, "away", "away-pass", "", "")
    namespaces = [("desk", previous), ("other", {"keep": "yes"})]
    merged = tool.replace_namespace(namespaces, "desk", tool.entries_for_desk(previous, store))
    text = tool.render_csv(merged)
    rows = list(csv.DictReader(text.splitlines()))
    namespaces_seen = [row["key"] for row in rows if row["type"] == "namespace"]
    assert namespaces_seen == ["desk", "other"]
    by_key = {row["key"]: row["value"] for row in rows}
    assert by_key["n0ssid"] == "home"
    assert by_key["n0pass"] == "home-pass"
    assert by_key["n1ssid"] == "away"
    assert by_key["note"] == "keep-me"
    assert by_key["keep"] == "yes"


def test_rejects_short_password_and_overlong_ssid():
    tool = load_provisioner()
    try:
        tool.validate_pass("short")
    except tool.FieldError as exc:
        assert "short" not in str(exc)
    else:
        raise AssertionError("expected FieldError")
    tool.validate_pass("")
    tool.validate_pass("eightchr")
    try:
        tool.validate_ssid("n" * 33)
    except tool.FieldError:
        pass
    else:
        raise AssertionError("expected FieldError")


def test_flash_commands_do_not_carry_secrets():
    tool = load_provisioner()
    image = Path("/tmp/desk.bin")
    write = tool.write_flash_cmd(["esptool.py"], "/dev/ttyACM0", 0x9000, image)
    read = tool.read_flash_cmd(["esptool.py"], "/dev/ttyACM0", 0x9000, 0x6000, image)
    reset = tool.reset_cmd(["esptool.py"], "/dev/ttyACM0")
    assert write[:6] == [
        "esptool.py",
        "--chip",
        "esp32s3",
        "--port",
        "/dev/ttyACM0",
        "--before",
    ]
    assert "0x9000" in write
    assert "--after" in write and "no_reset" in write
    assert "write_flash" in write
    assert read[-4:] == ["read_flash", "0x9000", "0x6000", "/tmp/desk.bin"]
    assert reset[-1] == "run"
    secret = "p" * 8
    assert secret not in write and secret not in read and secret not in reset


def test_cli_rejects_arguments_without_echoing_them():
    leaked = "not-for-argv"
    env = os.environ.copy()
    env.pop("IDF_PATH", None)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "add", leaked],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert result.returncode == 2
    assert "command line" in result.stderr
    assert leaked not in result.stderr
    assert leaked not in result.stdout
    bare = subprocess.run(
        [sys.executable, str(SCRIPT), leaked],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert bare.returncode == 2
    assert leaked not in bare.stderr
    assert leaked not in bare.stdout


def test_cli_requires_idf_path_before_prompting():
    env = os.environ.copy()
    env.pop("IDF_PATH", None)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "add"],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert result.returncode != 0
    assert "IDF_PATH" in result.stderr or "IDF_PATH" in result.stdout
    assert (
        "nvs_partition_gen.py" in result.stderr
        or "nvs_partition_gen.py" in result.stdout
    )


def _crc(data: bytes) -> int:
    return zlib.crc32(data, 0xFFFFFFFF) & 0xFFFFFFFF


def _mark(page: bytearray, index: int, state: int) -> None:
    bit = index * 2
    shift = bit % 8
    offset = 32 + bit // 8
    page[offset] = (page[offset] & ~(0x3 << shift)) | ((state & 0x3) << shift)


def _put_entry(page: bytearray, index: int, entry: bytes) -> None:
    start = 64 + index * 32
    page[start : start + 32] = entry
    _mark(page, index, 0x2)


def _u8_entry(ns_index: int, key: str, value: int) -> bytes:
    entry = bytearray(b"\xff" * 32)
    entry[0] = ns_index
    entry[1] = 0x01
    entry[2] = 1
    entry[3] = 0xFF
    entry[8:24] = b"\x00" * 16
    entry[8 : 8 + len(key)] = key.encode()
    entry[24] = value
    struct.pack_into("<I", entry, 4, _crc(bytes(entry[0:4] + entry[8:32])))
    return bytes(entry)


def _string_entry(ns_index: int, key: str, value: str, pad: bytes = b"\x00") -> tuple[bytes, int]:
    raw = value.encode() + b"\x00"
    data_entries = (len(raw) + 31) // 32
    span = data_entries + 1
    entry = bytearray(b"\xff" * 32)
    entry[0] = ns_index
    entry[1] = 0x21
    entry[2] = span
    entry[3] = 0xFF
    entry[8:24] = pad * 16
    encoded = key.encode()
    entry[8 : 8 + len(encoded)] = encoded
    entry[8 + len(encoded)] = 0
    struct.pack_into("<H", entry, 24, len(raw))
    struct.pack_into("<I", entry, 28, _crc(raw))
    struct.pack_into("<I", entry, 4, _crc(bytes(entry[0:4] + entry[8:32])))
    payload = raw + (b"\xff" * (data_entries * 32 - len(raw)))
    return bytes(entry) + payload, span


def _page(seq: int, blobs: list[tuple[int, bytes]]) -> bytes:
    page = bytearray(b"\xff" * 4096)
    struct.pack_into("<I", page, 0, 0xFFFFFFFE)
    struct.pack_into("<I", page, 4, seq)
    page[8] = 0xFE
    struct.pack_into("<I", page, 28, _crc(bytes(page[4:28])))
    for index, entry in blobs:
        if len(entry) == 32:
            _put_entry(page, index, entry)
        else:
            _put_entry(page, index, entry[:32])
            rest = entry[32:]
            start = 64 + (index + 1) * 32
            page[start : start + len(rest)] = rest
            for extra in range(1, len(entry) // 32):
                _mark(page, index + extra, 0x2)
    return bytes(page)


def test_parse_legacy_page_then_add_without_clobber():
    tool = load_provisioner()
    home_pass = "home-pass"
    away_pass = "away-pass"
    ssid_blob, _ssid_span = _string_entry(1, "ssid", "home")
    pass_blob, _pass_span = _string_entry(1, "pass", home_pass, pad=b"\xff")
    url_blob, _url_span = _string_entry(1, "url", "http://10.0.0.5:8787")
    cursor = 0
    pieces = [
        _u8_entry(0, "desk", 1),
        ssid_blob,
        pass_blob,
        url_blob,
    ]
    placed = []
    for piece in pieces:
        placed.append((cursor, piece))
        cursor += len(piece) // 32
    image = _page(0, placed) + (b"\xff" * 4096)
    namespaces = tool.parse_nvs(image)
    assert namespaces[0][0] == "desk"
    desk = namespaces[0][1]
    assert desk["ssid"] == "home"
    assert desk["pass"] == home_pass
    assert desk["url"] == "http://10.0.0.5:8787"
    store = tool.store_from_entries(desk)
    tool.apply_add(store, "away", away_pass, "", "")
    written = dict(tool.entries_for_desk(desk, store))
    assert written["n0ssid"] == "home"
    assert written["n0pass"] == home_pass
    assert written["n1ssid"] == "away"
    assert written["n1pass"] == away_pass
    assert written["url"] == "http://10.0.0.5:8787"
    assert "ssid" not in written


def test_parse_blank_partition_and_reject_garbage():
    tool = load_provisioner()
    assert tool.parse_nvs(b"\xff" * 0x6000) == []
    try:
        tool.parse_nvs(b"\x00" * 4096)
    except tool.NvsError:
        pass
    else:
        raise AssertionError("expected NvsError")


def test_erased_entry_does_not_hide_the_later_value():
    tool = load_provisioner()
    old_blob, old_span = _string_entry(1, "ssid", "old-name")
    new_blob, _new_span = _string_entry(1, "ssid", "new-name")
    page = bytearray(_page(0, [(0, _u8_entry(0, "desk", 1)), (1, old_blob), (1 + old_span, new_blob)]))
    # Mark the first string's span erased (state 0) so only the later write remains.
    for index in range(1, 1 + old_span):
        _mark(page, index, 0x0)
    found = tool.parse_nvs(bytes(page))
    assert found[0][1]["ssid"] == "new-name"
