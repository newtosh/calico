#!/usr/bin/env python3
"""Provision the desk over BLE. No USB cable and no joined Wi-Fi required.

The board advertises as ``grokbot-buddy``. URL, token, and a verified
Wi-Fi network land in NVS namespace ``desk``. ``reboot`` soft-resets the
board. The link is GATT. The OS pairing dialog does not connect.

Wi-Fi is tried before it is saved. The desk associates with the candidate
and reports ok or fail over BLE. A failure does not write NVS. Success
writes the network and reboots.

With no command this opens a menu: pick a desk, read status, set the URL,
set or clear the token, add Wi-Fi from the desk's scan or by typing the
SSID, and reboot. The named commands stay for scripts.

Protocol, UUIDs, and the open-link posture: firmware/README.md.

Needs ``bleak`` and ``prompt_toolkit`` on the machine with the radio.
The password and the bearer are read from hidden prompts, not argv or
the environment.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from getpass import getpass

NAME = "grokbot-buddy"

# Canonical text is firmware/main/ble_desk.h. Keep these identical.
UUID_SVC = "8d7c4b10-6e2a-4f91-a3c5-67726f6b6465"
UUID_STATUS = "8d7c4b11-6e2a-4f91-a3c5-67726f6b6465"
UUID_URL = "8d7c4b12-6e2a-4f91-a3c5-67726f6b6465"
UUID_TOKEN = "8d7c4b13-6e2a-4f91-a3c5-67726f6b6465"
UUID_WIFI = "8d7c4b14-6e2a-4f91-a3c5-67726f6b6465"
UUID_REBOOT = "8d7c4b15-6e2a-4f91-a3c5-67726f6b6465"
UUID_SCAN = "8d7c4b16-6e2a-4f91-a3c5-67726f6b6465"
UUID_VERIFY = "8d7c4b17-6e2a-4f91-a3c5-67726f6b6465"

UUIDS = {
    "svc": UUID_SVC,
    "status": UUID_STATUS,
    "url": UUID_URL,
    "token": UUID_TOKEN,
    "wifi": UUID_WIFI,
    "reboot": UUID_REBOOT,
    "scan": UUID_SCAN,
    "verify": UUID_VERIFY,
}

SSID_MAX = 32
PASS_MAX = 64
URL_MAX = 127
TOKEN_MAX = 127
# Preferred ATT MTU is 256. A max URL or token needs payload room for 127 bytes.
MIN_WRITE_MTU = 130
# Active scan plus coexistence. The desk returns state=busy until it finishes.
SCAN_WAIT_S = 25.0
# Association plus a short grace for a disconnect that follows CONNECTED.
VERIFY_WAIT_S = 20.0

MAIN_MENU = (
    ("status", "Refresh status"),
    ("url", "Set companion URL"),
    ("token", "Set or clear bearer token"),
    ("wifi", "Add Wi-Fi"),
    ("reboot", "Reboot"),
    ("desk", "Pick a different desk"),
    ("quit", "Quit"),
)

WIFI_MENU = (
    ("wifi-scan", "Scan nearby networks"),
    ("type", "Type an SSID"),
    ("back", "Back"),
)

IGNORED_ENV = (
    "SSID",
    "WIFI_SSID",
    "PASS",
    "PASSWORD",
    "WIFI_PASS",
    "WIFI_PASSWORD",
    "TOKEN",
    "DESK_TOKEN",
    "URL",
    "COMPANION_URL",
)

COMMANDS = ("scan", "status", "url", "token", "wifi", "wifi-scan", "reboot", "tui")


class FieldError(ValueError):
    pass


def _reject_breaks(value: str, label: str) -> None:
    if "\n" in value or "\r" in value or "\x00" in value:
        raise FieldError(f"{label} cannot contain a newline or NUL")


def validate_url(url: str) -> str:
    _reject_breaks(url, "URL")
    if url.startswith("https://"):
        if len(url) < 9:
            raise FieldError("URL needs a host after https://")
    elif url.startswith("http://"):
        if len(url) < 8:
            raise FieldError("URL needs a host after http://")
    else:
        raise FieldError("URL must start with http:// or https://")
    if len(url.encode()) > URL_MAX:
        raise FieldError(f"URL must be at most {URL_MAX} bytes")
    return url


def validate_token(token: str) -> str:
    _reject_breaks(token, "token")
    if len(token.encode()) > TOKEN_MAX:
        raise FieldError(f"token must be at most {TOKEN_MAX} bytes")
    return token


def validate_ssid(ssid: str) -> str:
    _reject_breaks(ssid, "SSID")
    if ssid == "":
        raise FieldError("SSID is required")
    if len(ssid.encode()) > SSID_MAX:
        raise FieldError(f"SSID must be at most {SSID_MAX} bytes")
    return ssid


def validate_pass(password: str) -> str:
    _reject_breaks(password, "password")
    size = len(password.encode())
    if size > PASS_MAX:
        raise FieldError(f"password must be at most {PASS_MAX} bytes")
    if size not in (0,) and size < 8:
        raise FieldError("password must be empty (open network) or 8 to 64 bytes (WPA)")
    return password


def encode_url(url: str) -> bytes:
    return validate_url(url).encode()


def encode_token(token: str) -> bytes:
    token = validate_token(token)
    # A zero-length ATT write is easy to drop. One newline strips to empty on the desk.
    if token == "":
        return b"\n"
    return token.encode()


def encode_wifi(ssid: str, password: str) -> bytes:
    return f"{validate_ssid(ssid)}\n{validate_pass(password)}".encode()


def encode_reboot() -> bytes:
    return b"reboot"


def encode_scan() -> bytes:
    return b"scan"


def parse_scan(body: str) -> tuple[str, list[tuple[int, str]]]:
    state = parse_status(body).get("state", "")
    aps: list[tuple[int, str]] = []
    for line in body.splitlines():
        if line.startswith("state="):
            continue
        if "\t" not in line:
            continue
        rssi_s, ssid = line.split("\t", 1)
        try:
            rssi = int(rssi_s)
        except ValueError:
            continue
        if ssid == "":
            continue
        aps.append((rssi, ssid))
    return state, aps


def scan_poll_done(state: str) -> bool:
    return state in {"ready", "fail"}


def parse_status(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in body.splitlines():
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        fields[key] = value
    return fields


def warn_ignored_env() -> None:
    for name in IGNORED_ENV:
        if os.environ.get(name):
            print(
                f"ignoring {name} from the environment; type values at the prompt",
                file=sys.stderr,
            )


def _disable_input_history() -> None:
    try:
        import readline
    except ImportError:
        return
    readline.set_auto_history(False)


def _require_tty() -> None:
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise SystemExit(
            "Need an interactive terminal. Secrets are not read from argv, "
            "a pipe, or the environment."
        )


def _ask(label: str) -> str:
    return input(label)


def _ask_secret(label: str) -> str:
    return getpass(label)


def _confirm(label: str) -> bool:
    return _ask(label).strip().lower() in {"y", "yes"}


def prompt_url() -> str:
    while True:
        try:
            return validate_url(_ask("Companion URL: ").strip())
        except FieldError as exc:
            print(exc, file=sys.stderr)


def prompt_token() -> str:
    while True:
        typed = _ask_secret("Bearer token (empty clears it, not echoed): ")
        if typed == "":
            return ""
        again = _ask_secret("Bearer token again: ")
        if typed != again:
            print("tokens did not match", file=sys.stderr)
            continue
        try:
            return validate_token(typed)
        except FieldError as exc:
            print(exc, file=sys.stderr)


def prompt_ssid() -> str:
    while True:
        try:
            return validate_ssid(_ask("Wi-Fi SSID: "))
        except FieldError as exc:
            print(exc, file=sys.stderr)


def prompt_password() -> str:
    while True:
        password = _ask_secret("Wi-Fi password (empty for an open network, not echoed): ")
        again = _ask_secret("Wi-Fi password again: ")
        if password != again:
            print("passwords did not match", file=sys.stderr)
            continue
        try:
            return validate_pass(password)
        except FieldError as exc:
            print(exc, file=sys.stderr)


def prompt_wifi() -> tuple[str, str]:
    return prompt_ssid(), prompt_password()


def confirm_wifi(ssid: str, password: str) -> bool:
    kind = "open network" if password == "" else "WPA password"
    print(f"Try joining {ssid} ({kind}).")
    print("The desk associates first. A wrong password is not written to NVS.")
    print("If it joins, the password is saved and the desk reboots.")
    if not _confirm("Proceed? [y/N] "):
        print("aborted")
        return False
    return True


def actions_after_probe(state: str) -> tuple[str, ...]:
    """NVS and reboot run only after the AP accepts the password."""
    if state == "ok":
        return ("wifi", "reboot")
    return ()


def parse_probe(body: str) -> tuple[str, str, str]:
    fields = parse_status(body)
    return fields.get("state", ""), fields.get("ssid", ""), fields.get("reason", "")


def probe_poll_done(state: str) -> bool:
    return state in {"ok", "fail"}


def describe_probe_failure(state: str, ssid: str, reason: str) -> str:
    name = ssid or "that network"
    if reason == "auth":
        return f"Could not join {name}. The password was rejected. Nothing was saved."
    if reason == "missing":
        return f"Could not join {name}. The AP was not found. Nothing was saved."
    if reason == "timeout":
        return f"Could not join {name}. The AP did not answer in time. Nothing was saved."
    if reason == "radio":
        return f"Could not join {name}. The radio was busy. Nothing was saved."
    if state == "fail":
        return f"Could not join {name}. Nothing was saved."
    return f"Could not join {name}. Nothing was saved."


def reboot_exception_is_drop(exc: BaseException) -> bool:
    """A reset often drops the link. An ATT error means the write was rejected."""
    text = str(exc).lower()
    if "unlikely" in text or "protocol error" in text or "insufficient" in text:
        return False
    return True


def _bleak():
    try:
        import bleak
    except ImportError as exc:
        raise SystemExit(
            "bleak is not installed. On the machine with the radio: pip install bleak"
        ) from exc
    return bleak


def _desk_name(device, adv) -> str:
    local = getattr(adv, "local_name", None) if adv is not None else None
    return local or getattr(device, "name", None) or ""


def _desk_line(device, name: str) -> str:
    rssi = getattr(device, "rssi", None)
    extra = f"  {rssi} dBm" if rssi is not None else ""
    return f"{device.address}  {name}{extra}"


def print_text(text: str) -> None:
    print(text, end="" if text.endswith("\n") else "\n")


async def scan_desks(timeout: float = 5.0):
    """Return (device, advertised name) pairs for grokbot-buddy."""
    bleak = _bleak()
    try:
        found = await bleak.BleakScanner.discover(timeout=timeout, return_adv=True)
    except TypeError:
        found = await bleak.BleakScanner.discover(timeout=timeout)
    if isinstance(found, dict):
        pairs = list(found.values())
    else:
        pairs = [(device, None) for device in found]
    desks = []
    for device, adv in pairs:
        name = _desk_name(device, adv)
        if name == NAME:
            desks.append((device, name))
    return desks


async def resolve_address(address: str) -> str:
    if address:
        return address
    found = await scan_desks()
    if len(found) == 1:
        return found[0][0].address
    if not found:
        raise SystemExit(f"no {NAME} advertisement. Is the Bluetooth mark lit, with a dot on each side?")
    lines = "\n".join(f"  {device.address}  {name}" for device, name in found)
    raise SystemExit(f"more than one {NAME}. Pass --address.\n{lines}")


def reported_mtu(client) -> int:
    """Bytes the backend has actually learned.

    Bleak's ``mtu_size`` property warns and returns 23 until something calls
    the private ``_acquire_mtu``. That call needs a write-without-response
    or notify characteristic, and this desk has neither. Reading the property
    from ``_check_mtu`` was the warning on the scan write. BlueZ ReadValue
    and WriteValue still use the MTU the controller negotiated (the desk
    asks for 256). Unknown means do not invent 23.
    """
    backend = getattr(client, "_backend", None)
    known = getattr(backend, "_mtu_size", None)
    if isinstance(known, int) and known > 0:
        return known
    return 0


def _check_mtu(client, payload: bytes) -> None:
    mtu = reported_mtu(client)
    if mtu and mtu < MIN_WRITE_MTU and len(payload) + 3 > mtu:
        raise SystemExit(
            f"ATT MTU is {mtu}. This write needs at least {MIN_WRITE_MTU}. "
            "The desk asks for 256."
        )


async def read_text(client, uuid: str) -> str:
    raw = await client.read_gatt_char(uuid)
    return bytes(raw).decode("utf-8", errors="replace")


async def read_status(client) -> str:
    return await read_text(client, UUID_STATUS)


async def read_scan(client) -> str:
    return await read_text(client, UUID_SCAN)


async def request_wifi_scan(client, timeout: float = SCAN_WAIT_S) -> str:
    await write_char(client, UUID_SCAN, encode_scan())
    deadline = time.monotonic() + timeout
    last = ""
    while True:
        last = await read_scan(client)
        state, _aps = parse_scan(last)
        if scan_poll_done(state):
            return last
        if time.monotonic() >= deadline:
            raise TimeoutError(last or "wifi scan timed out")
        await asyncio.sleep(0.5)


async def write_char(client, uuid: str, payload: bytes) -> None:
    _check_mtu(client, payload)
    await client.write_gatt_char(uuid, payload, response=True)


async def _disconnect(client) -> None:
    try:
        await client.disconnect()
    except Exception:
        pass


async def request_verify(client, ssid: str, password: str, timeout: float = VERIFY_WAIT_S) -> str:
    await write_char(client, UUID_VERIFY, encode_wifi(ssid, password))
    deadline = time.monotonic() + timeout
    last = ""
    while True:
        last = await read_text(client, UUID_VERIFY)
        state, _ssid, _reason = parse_probe(last)
        if probe_poll_done(state):
            return last
        if time.monotonic() >= deadline:
            raise TimeoutError(last or "wifi verify timed out")
        await asyncio.sleep(0.5)


async def commit_joined(client, ssid: str, password: str) -> None:
    await write_char(client, UUID_WIFI, encode_wifi(ssid, password))
    try:
        await write_char(client, UUID_REBOOT, encode_reboot())
    except Exception as exc:
        if not reboot_exception_is_drop(exc):
            print(
                "Saved, but the reboot write was rejected. Choose Reboot from the menu.",
                file=sys.stderr,
            )
            raise
        print(f"reboot sent. The link dropped ({exc}).", file=sys.stderr)
        return
    print("reboot sent. The desk restarts in a moment.")


async def run_verify_commit(address: str, ssid: str, password: str) -> tuple[int, str]:
    bleak = _bleak()
    print(f"{NAME} {address}")
    client = bleak.BleakClient(address)
    joined = False
    body = ""
    try:
        await client.connect()
        print(f"Joining {ssid}…")
        body = await request_verify(client, ssid, password)
        state, got, reason = parse_probe(body)
        print_text(body)
        if actions_after_probe(state) != ("wifi", "reboot"):
            print(describe_probe_failure(state, got or ssid, reason), file=sys.stderr)
            return 1, body
        joined = True
        print(f"Joined {got or ssid}. Saving and rebooting.")
        await commit_joined(client, ssid, password)
        return 0, "reboot sent\n"
    except Exception as exc:
        if joined:
            print(f"Joined, but save or reboot failed: {exc}", file=sys.stderr)
            return 1, body
        print(f"wifi verify failed: {exc}", file=sys.stderr)
        return 1, ""
    finally:
        await _disconnect(client)


async def run_command(command: str, address: str, payload: bytes | None) -> tuple[int, str]:
    bleak = _bleak()
    target = await resolve_address(address)
    print(f"{NAME} {target}")
    client = bleak.BleakClient(target)
    try:
        await client.connect()
        if command == "status":
            text = await read_status(client)
            print_text(text)
            return 0, text
        if command == "reboot":
            await write_char(client, UUID_REBOOT, payload or encode_reboot())
            print("reboot sent. The desk restarts in a moment.")
            return 0, ""
        uuid = {
            "url": UUID_URL,
            "token": UUID_TOKEN,
            "wifi": UUID_WIFI,
        }[command]
        await write_char(client, uuid, payload or b"")
        text = await read_status(client)
        print_text(text)
        return 0, text
    except Exception as exc:
        if command == "reboot" and reboot_exception_is_drop(exc):
            print("reboot sent. The link dropped while the desk restarted.", file=sys.stderr)
            return 0, ""
        print(f"{command} failed: {exc}", file=sys.stderr)
        return 1, ""
    finally:
        await _disconnect(client)


async def fetch_status(address: str) -> str:
    bleak = _bleak()
    async with bleak.BleakClient(address) as client:
        return await read_status(client)


async def fetch_wifi_scan(address: str) -> str:
    bleak = _bleak()
    async with bleak.BleakClient(address) as client:
        return await request_wifi_scan(client)


async def run_wifi_scan(address: str) -> int:
    target = await resolve_address(address)
    print(f"{NAME} {target}")
    try:
        body = await fetch_wifi_scan(target)
    except Exception as exc:
        print(f"wifi-scan failed: {exc}", file=sys.stderr)
        return 1
    state, aps = parse_scan(body)
    if state != "ready":
        print_text(body)
        return 1
    if not aps:
        print("no networks")
        return 0
    for rssi, ssid in aps:
        print(f"{rssi}\t{ssid}")
    return 0


def _prepare_write(command: str) -> bytes | None:
    _disable_input_history()
    _require_tty()
    warn_ignored_env()
    if command == "url":
        url = prompt_url()
        print(f"Write companion URL {url}")
        print("Saved now. The poll keeps the previous URL until reboot.")
        if not _confirm("Proceed? [y/N] "):
            print("aborted")
            return None
        return encode_url(url)
    if command == "token":
        token = prompt_token()
        print("Clear bearer token." if token == "" else f"Write bearer token ({len(token.encode())} bytes).")
        print("The token is not readable back over BLE.")
        if not _confirm("Proceed? [y/N] "):
            print("aborted")
            return None
        return encode_token(token)
    if command == "reboot":
        print("Soft-reset the desk.")
        if not _confirm("Proceed? [y/N] "):
            print("aborted")
            return None
        return encode_reboot()
    return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="firmware/scripts/ble-provision.py")
    parser.add_argument(
        "command",
        nargs="?",
        default="tui",
        choices=COMMANDS,
        help="Default opens the menu. The other commands stay for scripts.",
    )
    parser.add_argument("--address", default="", help="BLE address. Default: the one grokbot-buddy found.")
    return parser


def _menu():
    try:
        from prompt_toolkit.shortcuts import choice
    except ImportError as exc:
        raise SystemExit(
            "prompt_toolkit is not installed. On the machine with the radio:\n"
            "  .venv-ble/bin/pip install bleak prompt_toolkit"
        ) from exc
    return choice


def choose(title: str, text: str, values):
    """Arrow keys move. Enter returns the highlighted value."""
    dialog = _menu()
    shown = text.strip() or " "
    return dialog(
        message=f"{title}\n\n{shown}",
        options=list(values),
        bottom_toolbar="arrows, enter",
    )


def pick_desk() -> str:
    found = asyncio.run(scan_desks())
    if not found:
        print(f"no {NAME} advertisement. Is the Bluetooth mark lit, with a dot on each side?")
        return ""
    if len(found) == 1:
        device, name = found[0]
        print(_desk_line(device, name))
        return device.address
    values = [(device.address, _desk_line(device, name)) for device, name in found]
    picked = choose("Pick a desk", f"{len(found)} advertising as {NAME}", values)
    return picked or ""


def pick_scanned_ssid(address: str) -> str | None:
    print("Scanning…")
    try:
        body = asyncio.run(fetch_wifi_scan(address))
    except Exception as exc:
        print(f"wifi scan failed: {exc}", file=sys.stderr)
        return None
    state, aps = parse_scan(body)
    if state != "ready":
        print("The desk could not scan.")
        print_text(body)
        return None
    values = [(("ssid", ssid), f"{rssi:4d} dBm  {ssid}") for rssi, ssid in aps]
    values.append((("type", ""), "Type an SSID"))
    values.append((("back", ""), "Back"))
    note = "None in range." if not aps else f"{len(aps)} networks, strongest first"
    picked = choose("Nearby networks", note, values)
    if not picked or picked[0] == "back":
        return None
    if picked[0] == "type":
        return prompt_ssid()
    return picked[1]


def tui_wifi(address: str) -> str | None:
    """Probe text, or the reboot note. None when the user backed out."""
    while True:
        choice = choose(
            "Add Wi-Fi",
            "The desk tries the password before saving it.",
            WIFI_MENU,
        )
        if choice in (None, "back"):
            return None
        if choice == "type":
            ssid, password = prompt_wifi()
        elif choice == "wifi-scan":
            ssid = pick_scanned_ssid(address)
            if ssid is None:
                continue
            password = prompt_password()
        else:
            continue
        if not confirm_wifi(ssid, password):
            continue
        code, text = asyncio.run(run_verify_commit(address, ssid, password))
        if text:
            return text
        return "reboot sent\n" if code == 0 else "verify failed\n"


def run_tui(address: str) -> int:
    _disable_input_history()
    _require_tty()
    warn_ignored_env()
    current = address
    status = ""
    if current:
        print(f"{NAME} {current}")
    while True:
        if not current:
            current = pick_desk()
            status = ""
            if not current:
                return 1
        if not status:
            try:
                status = asyncio.run(fetch_status(current))
            except Exception as exc:
                status = f"status failed: {exc}"
                print(status, file=sys.stderr)
        choice = choose(NAME, f"{current}\n\n{status}", MAIN_MENU)
        if choice in (None, "quit"):
            return 0
        if choice == "desk":
            current = ""
            status = ""
            continue
        if choice == "status":
            status = ""
            continue
        if choice == "wifi":
            written = tui_wifi(current)
            if written is not None:
                status = written
            continue
        payload = _prepare_write(choice)
        if payload is None:
            continue
        code, text = asyncio.run(run_command(choice, current, payload))
        status = text if choice != "reboot" and code == 0 and text else ""


def provision(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "tui":
        return run_tui(args.address)
    if args.command == "scan":
        found = asyncio.run(scan_desks())
        if not found:
            print(f"no {NAME} advertisement")
            return 1
        for device, name in found:
            print(_desk_line(device, name))
        return 0
    if args.command == "wifi-scan":
        return asyncio.run(run_wifi_scan(args.address))
    if args.command == "wifi":
        _disable_input_history()
        _require_tty()
        warn_ignored_env()
        ssid, password = prompt_wifi()
        if not confirm_wifi(ssid, password):
            return 1
        target = asyncio.run(resolve_address(args.address))
        code, _text = asyncio.run(run_verify_commit(target, ssid, password))
        return code
    payload = None
    if args.command != "status":
        payload = _prepare_write(args.command)
        if payload is None:
            return 1
    code, _text = asyncio.run(run_command(args.command, args.address, payload))
    return code


def main() -> None:
    try:
        raise SystemExit(provision())
    except KeyboardInterrupt:
        print("aborted", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
