"""Host checks for the USB NVS provisioner. No board and no ESP-IDF required."""

from __future__ import annotations

import csv
import importlib.util
import os
import subprocess
import sys
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


def test_csv_uses_firmware_keys_and_omits_blank_optional():
    tool = load_provisioner()
    ssid = "unit-ssid"
    password = "p" * 8
    text = tool.render_csv(tool.setting_entries(ssid, password, "", ""))
    rows = list(csv.DictReader(text.splitlines()))
    assert rows[0]["key"] == "desk"
    assert rows[0]["type"] == "namespace"
    assert [(row["key"], row["type"], row["encoding"]) for row in rows[1:]] == [
        ("ssid", "data", "string"),
        ("pass", "data", "string"),
    ]
    assert rows[1]["value"] == ssid
    assert rows[2]["value"] == password
    assert " ," not in text and ", " not in text


def test_csv_quotes_comma_and_includes_optional_keys():
    tool = load_provisioner()
    password = 'comma,quote"'
    url = "http://127.0.0.1:9"
    token = "t" * 8
    text = tool.render_csv(tool.setting_entries("unit-ssid", password, url, token))
    rows = list(csv.DictReader(text.splitlines()))
    by_key = {row["key"]: row["value"] for row in rows}
    assert by_key["pass"] == password
    assert by_key["url"] == url
    assert by_key["token"] == token


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
    assert reset[-1] == "run"
    secret = "p" * 8
    assert secret not in write and secret not in reset


def test_cli_rejects_arguments_without_echoing_them():
    leaked = "not-for-argv"
    env = os.environ.copy()
    env.pop("IDF_PATH", None)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), leaked],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert result.returncode == 2
    assert "command line" in result.stderr
    assert leaked not in result.stderr
    assert leaked not in result.stdout


def test_cli_requires_idf_path_before_prompting():
    env = os.environ.copy()
    env.pop("IDF_PATH", None)
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
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
