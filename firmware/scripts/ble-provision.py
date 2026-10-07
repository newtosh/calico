#!/usr/bin/env python3
"""Provision the desk over BLE. No USB cable and no joined Wi-Fi required.

The board advertises as ``grokbot-buddy``. Writes land in NVS namespace
``desk`` and take effect on the next boot. ``reboot`` soft-resets the board.

Protocol, UUIDs, and the open-link posture: firmware/README.md.

Needs ``bleak`` on the machine with the radio (``pip install bleak``).
The password and the bearer are read from hidden prompts, not argv or
the environment.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from getpass import getpass

NAME = "grokbot-buddy"

# Canonical text is firmware/main/ble_desk.h. Keep these identical.
UUID_SVC = "8d7c4b10-6e2a-4f91-a3c5-67726f6b6465"
UUID_STATUS = "8d7c4b11-6e2a-4f91-a3c5-67726f6b6465"
UUID_URL = "8d7c4b12-6e2a-4f91-a3c5-67726f6b6465"
UUID_TOKEN = "8d7c4b13-6e2a-4f91-a3c5-67726f6b6465"
UUID_WIFI = "8d7c4b14-6e2a-4f91-a3c5-67726f6b6465"
UUID_REBOOT = "8d7c4b15-6e2a-4f91-a3c5-67726f6b6465"

UUIDS = {
    "svc": UUID_SVC,
    "status": UUID_STATUS,
    "url": UUID_URL,
    "token": UUID_TOKEN,
    "wifi": UUID_WIFI,
    "reboot": UUID_REBOOT,
}

SSID_MAX = 32
PASS_MAX = 64
URL_MAX = 127
TOKEN_MAX = 127
# Preferred ATT MTU is 256. A max URL or token needs payload room for 127 bytes.
MIN_WRITE_MTU = 130

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

COMMANDS = ("scan", "status", "url", "token", "wifi", "reboot")


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


def prompt_wifi() -> tuple[str, str]:
    while True:
        try:
            ssid = validate_ssid(_ask("Wi-Fi SSID: "))
            break
        except FieldError as exc:
            print(exc, file=sys.stderr)
    while True:
        password = _ask_secret("Wi-Fi password (empty for an open network, not echoed): ")
        again = _ask_secret("Wi-Fi password again: ")
        if password != again:
            print("passwords did not match", file=sys.stderr)
            continue
        try:
            return ssid, validate_pass(password)
        except FieldError as exc:
            print(exc, file=sys.stderr)


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
        raise SystemExit(f"no {NAME} advertisement. Is the BT mark plain, not struck through?")
    lines = "\n".join(f"  {device.address}  {name}" for device, name in found)
    raise SystemExit(f"more than one {NAME}. Pass --address.\n{lines}")


def _check_mtu(client, payload: bytes) -> None:
    mtu = getattr(client, "mtu_size", 0) or 0
    if mtu and mtu < MIN_WRITE_MTU and len(payload) + 3 > mtu:
        raise SystemExit(
            f"ATT MTU is {mtu}. This write needs at least {MIN_WRITE_MTU}. "
            "The desk asks for 256."
        )


async def read_status(client) -> str:
    raw = await client.read_gatt_char(UUID_STATUS)
    return bytes(raw).decode("utf-8", errors="replace")


async def write_char(client, uuid: str, payload: bytes) -> None:
    _check_mtu(client, payload)
    await client.write_gatt_char(uuid, payload, response=True)


async def run_command(command: str, address: str, payload: bytes | None) -> int:
    bleak = _bleak()
    target = await resolve_address(address)
    print(f"{NAME} {target}")
    try:
        async with bleak.BleakClient(target) as client:
            if command == "status":
                text = await read_status(client)
                print(text, end="" if text.endswith("\n") else "\n")
                return 0
            if command == "reboot":
                await write_char(client, UUID_REBOOT, payload or encode_reboot())
                print("reboot sent. The link may drop before the response.")
                return 0
            uuid = {
                "url": UUID_URL,
                "token": UUID_TOKEN,
                "wifi": UUID_WIFI,
            }[command]
            await write_char(client, uuid, payload or b"")
            text = await read_status(client)
            print(text, end="" if text.endswith("\n") else "\n")
            return 0
    except Exception as exc:
        # A reboot often disconnects before the ATT response. The other
        # commands should still be connected, so this stays a failure.
        print(f"{command} failed: {exc}", file=sys.stderr)
        if command == "reboot":
            print("If the board reset, scan again for the advertisement.", file=sys.stderr)
        return 1


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
    if command == "wifi":
        ssid, password = prompt_wifi()
        kind = "open network" if password == "" else "WPA password"
        print(f"Save Wi-Fi {ssid} ({kind}). Other saved networks stay.")
        print("The station joins it on reboot, not on this write.")
        if not _confirm("Proceed? [y/N] "):
            print("aborted")
            return None
        return encode_wifi(ssid, password)
    if command == "reboot":
        print("Soft-reset the desk.")
        if not _confirm("Proceed? [y/N] "):
            print("aborted")
            return None
        return encode_reboot()
    return None


def provision(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scripts/ble-provision.py")
    parser.add_argument("command", choices=COMMANDS)
    parser.add_argument("--address", default="", help="BLE address. Default: the one grokbot-buddy found.")
    args = parser.parse_args(argv)
    if args.command == "scan":
        found = asyncio.run(scan_desks())
        if not found:
            print(f"no {NAME} advertisement")
            return 1
        for device, name in found:
            rssi = getattr(device, "rssi", None)
            extra = f"  {rssi} dBm" if rssi is not None else ""
            print(f"{device.address}  {name}{extra}")
        return 0
    payload = None
    if args.command != "status":
        payload = _prepare_write(args.command)
        if payload is None:
            return 1
    return asyncio.run(run_command(args.command, args.address, payload))


def main() -> None:
    try:
        raise SystemExit(provision())
    except KeyboardInterrupt:
        print("aborted", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
