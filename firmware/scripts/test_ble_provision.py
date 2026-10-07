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


def test_scan_text_round_trip():
    tool = load_tool()
    assert tool.encode_scan() == b"scan"
    assert "scan" in tool.UUIDS
    state, aps = tool.parse_scan("state=ready\n-45\tCafe WiFi\n-70\thome\n")
    assert state == "ready"
    assert aps == [(-45, "Cafe WiFi"), (-70, "home")]
    assert tool.parse_scan("state=busy\n") == ("busy", [])
    assert tool.parse_scan("state=fail\n") == ("fail", [])
    assert tool.parse_scan("state=idle\n") == ("idle", [])
    assert tool.parse_scan("state=ready\n") == ("ready", [])
    assert tool.parse_scan("state=ready\nnope\n-1\tonly\n") == ("ready", [(-1, "only")])
    assert tool.parse_scan("state=ready\n-40\thome=net\n") == ("ready", [(-40, "home=net")])
    assert tool.scan_poll_done("busy") is False
    assert tool.scan_poll_done("idle") is False
    assert tool.scan_poll_done("ready") is True
    assert tool.scan_poll_done("fail") is True


def test_menus_cover_provisioning():
    tool = load_tool()
    assert {key for key, _label in tool.MAIN_MENU} >= {"status", "url", "token", "wifi", "reboot"}
    assert {key for key, _label in tool.WIFI_MENU} >= {"wifi-scan", "type"}
    args = tool.build_parser().parse_args([])
    assert args.command == "tui"
    assert tool.build_parser().parse_args(["status"]).command == "status"
    assert tool.build_parser().parse_args(["wifi-scan"]).command == "wifi-scan"
    assert tool.build_parser().parse_args(["wifi"]).command == "wifi"


def _c_fn(src: str, signature: str) -> str:
    start = src.find(signature)
    assert start >= 0, signature
    brace = src.find("{", start)
    depth = 0
    for i in range(brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[brace : i + 1]
    raise AssertionError(signature)


def test_scan_write_does_not_allocate_a_task():
    """5151902 created the 12KB task inside the GATT write (ATT 0x0E).
    3b2db6d moved that create to host start, then logged
    "ble-scan not started, largest internal 7680". The stack is PSRAM."""
    link = LINK.read_text(encoding="utf-8")
    defaults = (LINK.parent.parent / "sdkconfig.defaults").read_text(encoding="utf-8")
    write = _c_fn(link, "static int write_scan(")
    start = _c_fn(link, "static void start_scan_task(")
    assert "xTaskCreate" not in write
    assert "xSemaphoreGive" in write
    assert "xTaskCreate(" not in start
    assert "xTaskCreateStatic" in start
    assert "MALLOC_CAP_SPIRAM" in start
    assert "7680" in link
    assert "CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM=y" in defaults
    assert "nimble_port_freertos_init" in _c_fn(link, "void ble_link_host_start(")


def test_wifi_join_and_glass_scan_use_psram_stacks():
    """aeeb737: xTaskCreate(wifi-join, 12288) failed after the NimBLE host
    (largest internal ~7680) and the glass showed SCAN FAILED with no
    desk-net line. The Settings wifi-scan task was the same internal 12288.
    Wi-Fi init stays before the host task. The 20-line stripe stays."""
    main = (LINK.parent / "main.c").read_text(encoding="utf-8")
    dma = (LINK.parent / "dma_stripe.h").read_text(encoding="utf-8")
    defaults = (LINK.parent.parent / "sdkconfig.defaults").read_text(encoding="utf-8")
    app = _c_fn(main, "void app_main(")
    assert "xTaskCreate(scan_task" not in main
    assert "xTaskCreate(join_task" not in main
    assert "xTaskCreate(poll_task" not in main
    assert "xTaskCreateStatic" in main
    assert "MALLOC_CAP_SPIRAM" in main
    assert "CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM" in main
    prepare = app.find("net_wifi_prepare()")
    host = app.find("ble_link_host_start()")
    join = app.find('"wifi-join"')
    assert 0 <= prepare < host < join
    assert "DESK_DMA_LINES = 20" in dma
    assert "CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM=y" in defaults


def test_probe_gates_the_nvs_write():
    tool = load_tool()
    assert "verify" in tool.UUIDS
    assert tool.actions_after_probe("ok") == ("wifi", "reboot")
    assert tool.actions_after_probe("fail") == ()
    assert tool.actions_after_probe("busy") == ()
    assert tool.actions_after_probe("idle") == ()
    assert tool.actions_after_probe("") == ()
    assert tool.parse_probe("state=fail\nssid=home\nreason=auth\n") == ("fail", "home", "auth")
    assert tool.parse_probe("state=ok\nssid=Cafe WiFi\n") == ("ok", "Cafe WiFi", "")
    assert tool.probe_poll_done("busy") is False
    assert tool.probe_poll_done("ok") is True
    assert tool.probe_poll_done("fail") is True
    assert "Nothing was saved" in tool.describe_probe_failure("fail", "home", "auth")
    assert "password was rejected" in tool.describe_probe_failure("fail", "home", "auth")
    assert tool.reboot_exception_is_drop(Exception("device disconnected")) is True
    assert tool.reboot_exception_is_drop(Exception("GATT Protocol Error: Unlikely Error")) is False
    assert tool.reboot_exception_is_drop(Exception("Insufficient Resources")) is False
    text = SCRIPT.read_text(encoding="utf-8")
    assert text.index("body = await request_verify") < text.index("await commit_joined")
    commit = text[text.index("async def commit_joined") : text.index("async def run_verify_commit")]
    assert commit.index("UUID_WIFI") < commit.index("UUID_REBOOT")


def test_reboot_write_is_not_on_the_nimble_host():
    """f445c2d called esp_restart inside the GATT write. The host task then
    waited on the controller, and the controller waited on the host task."""
    link = LINK.read_text(encoding="utf-8")
    main = (LINK.parent / "main.c").read_text(encoding="utf-8")
    write = _c_fn(link, "static int write_reboot(")
    access = _c_fn(link, "static int access(")
    worker = _c_fn(link, "static void reboot_worker(")
    start = _c_fn(link, "static void start_reboot_task(")
    host = _c_fn(link, "void ble_link_host_start(")
    restart = _c_fn(main, "static void on_ble_restart(")
    assert "esp_restart" not in write
    assert "s_on_restart()" not in write
    assert "xSemaphoreGive(s_reboot_go)" in write
    assert "xTaskCreate" not in write
    assert "esp_restart" not in access
    assert "s_on_restart()" not in access
    assert "s_on_restart()" in worker
    assert "vTaskDelay" in worker
    assert "xTaskCreate(" not in start
    assert "xTaskCreateStatic" in start
    assert "MALLOC_CAP_SPIRAM" in start
    assert host.index("start_scan_task") < host.index("start_reboot_task")
    assert "nimble_port_freertos_init" in host
    assert "esp_restart" in restart


def test_verify_does_not_save_and_shares_the_psram_worker():
    link = LINK.read_text(encoding="utf-8")
    net = (LINK.parent / "net.c").read_text(encoding="utf-8")
    main = (LINK.parent / "main.c").read_text(encoding="utf-8")
    stripe = (LINK.parent / "dma_stripe.h").read_text(encoding="utf-8")
    write = _c_fn(link, "static int write_verify(")
    worker = _c_fn(link, "static void scan_worker(")
    probe = _c_fn(net, "int net_wifi_probe(")
    start = _c_fn(net, "void net_wifi_start(")
    fill = _c_fn(net, "static void fill_sta(")
    app = _c_fn(main, "void app_main(")
    assert "net_save" not in write
    assert "wifi_upsert" not in write
    assert "xTaskCreate" not in write
    assert "xSemaphoreGive(s_scan_go)" in write
    assert "BLE_LINK_JOB_VERIFY" in write
    verify = _c_fn(link, "static void run_verify(")
    assert "run_verify" in worker
    assert "net_wifi_probe" in verify
    assert "net_save" not in verify
    assert "net_save" not in worker
    assert "xTaskCreate" not in worker
    assert "net_save" not in probe
    assert "fill_sta" in probe
    assert "s_reconnect_hold" in probe
    assert "fill_sta" in start
    assert "s_wifi_retries = 0" in start
    assert "ble_desk_sta_authmode" in fill
    assert "pmf_cfg.capable = true" in fill
    assert "pmf_cfg.required = false" in fill
    assert app.index("net_wifi_prepare") < app.index("ble_link_host_start")
    assert "DESK_DMA_LINES = 20" in stripe


def test_mtu_check_does_not_read_the_warning_property():
    tool = load_tool()

    class Backend:
        _mtu_size = None

    class Client:
        _backend = Backend()

        @property
        def mtu_size(self):
            raise AssertionError("mtu_size warns and reports 23")

    assert tool.reported_mtu(Client()) == 0
    tool._check_mtu(Client(), b"scan")
    client = Client()
    client._backend = Backend()
    client._backend._mtu_size = 23
    tool._check_mtu(client, b"scan")
    try:
        tool._check_mtu(client, b"x" * 200)
    except SystemExit:
        return
    raise AssertionError("long write on a known small MTU")
