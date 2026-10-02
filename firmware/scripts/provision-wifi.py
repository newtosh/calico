#!/usr/bin/env python3
"""Write desk Wi-Fi settings into the panel NVS partition over USB.

Uses the ESP-IDF ``nvs_partition_gen.py`` already installed with ``IDF_PATH``
(ESP-IDF 5.5.x) and esptool. It does not embed a second NVS format, and it
does not flash application firmware.

The password is read from a hidden prompt. It is not accepted as an argument,
an environment variable, or a file in this repo.
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from getpass import getpass
from pathlib import Path

NAMESPACE = "desk"
# Keys read by firmware/main/net.c (net_load / net_save).
KEY_SSID = "ssid"
KEY_PASS = "pass"
KEY_URL = "url"
KEY_TOKEN = "token"

SSID_MAX = 32
PASS_MAX = 64
URL_MAX = 127
TOKEN_MAX = 127

DEFAULT_PORT = "/dev/ttyACM0"
NVS_PARTITION_NAME = "nvs"
CHIP = "esp32s3"

# Ignored on purpose so a shell export cannot sneak a secret into the write.
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


class FieldError(ValueError):
    pass


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def partitions_csv() -> Path:
    return repo_root() / "firmware" / "partitions.csv"


def nvs_geometry(path: Path) -> tuple[int, int]:
    """Return (offset, size) of the nvs data partition."""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5:
            continue
        name, kind, offset, size = parts[0], parts[1], parts[3], parts[4]
        if name == NVS_PARTITION_NAME and kind == "data" and offset and size:
            return int(offset, 0), int(size, 0)
    raise FieldError(f"no nvs data partition in {path}")


def _reject_controls(value: str, label: str) -> None:
    if "\n" in value or "\r" in value or "\x00" in value:
        raise FieldError(f"{label} cannot contain a newline or NUL")


def validate_ssid(ssid: str) -> str:
    _reject_controls(ssid, "SSID")
    if ssid == "":
        raise FieldError("SSID is required")
    if len(ssid.encode()) > SSID_MAX:
        raise FieldError(f"SSID must be at most {SSID_MAX} bytes")
    return ssid


def validate_pass(password: str) -> str:
    _reject_controls(password, "password")
    size = len(password.encode())
    if size > PASS_MAX:
        raise FieldError(f"password must be at most {PASS_MAX} bytes")
    if size not in (0,) and size < 8:
        raise FieldError("password must be empty (open network) or 8 to 64 bytes (WPA)")
    return password


def validate_url(url: str) -> str:
    _reject_controls(url, "URL")
    if url == "":
        return url
    if not url.startswith(("http://", "https://")):
        raise FieldError("URL must start with http:// or https://")
    if len(url.encode()) > URL_MAX:
        raise FieldError(f"URL must be at most {URL_MAX} bytes")
    return url


def validate_token(token: str) -> str:
    _reject_controls(token, "token")
    if len(token.encode()) > TOKEN_MAX:
        raise FieldError(f"token must be at most {TOKEN_MAX} bytes")
    return token


def setting_entries(
    ssid: str, password: str, url: str = "", token: str = ""
) -> list[tuple[str, str]]:
    """Rows for namespace desk. Empty URL and token are omitted, not stored as blanks."""
    entries = [
        (KEY_SSID, validate_ssid(ssid)),
        (KEY_PASS, validate_pass(password)),
    ]
    checked_url = validate_url(url)
    if checked_url:
        entries.append((KEY_URL, checked_url))
    checked_token = validate_token(token)
    if checked_token:
        entries.append((KEY_TOKEN, checked_token))
    return entries


def render_csv(entries: list[tuple[str, str]]) -> str:
    """CSV for nvs_partition_gen.py. No spaces around commas."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["key", "type", "encoding", "value"])
    writer.writerow([NAMESPACE, "namespace", "", ""])
    for key, value in entries:
        writer.writerow([key, "data", "string", value])
    text = buffer.getvalue()
    if text.endswith("\n\n"):
        text = text[:-1]
    return text


def idf_python() -> str:
    explicit = os.environ.get("IDF_PYTHON", "")
    if explicit and os.path.isfile(explicit) and os.access(explicit, os.X_OK):
        return explicit
    venv = os.environ.get("IDF_PYTHON_ENV_PATH", "")
    if venv:
        candidate = os.path.join(venv, "bin", "python")
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    found = shutil.which("python")
    if found:
        return found
    return sys.executable


def generator_path(idf_path: str) -> Path:
    return (
        Path(idf_path)
        / "components"
        / "nvs_flash"
        / "nvs_partition_generator"
        / "nvs_partition_gen.py"
    )


def esptool_argv(py: str) -> list[str]:
    venv = os.environ.get("IDF_PYTHON_ENV_PATH", "")
    if venv:
        for name in ("esptool.py", "esptool"):
            path = os.path.join(venv, "bin", name)
            if os.path.isfile(path) and os.access(path, os.X_OK):
                return [path]
    for name in ("esptool.py", "esptool"):
        found = shutil.which(name)
        if found:
            return [found]
    return [py, "-m", "esptool"]


def write_flash_cmd(
    esptool: list[str], port: str, offset: int, image: Path
) -> list[str]:
    return [
        *esptool,
        "--chip",
        CHIP,
        "--port",
        port,
        "--before",
        "default_reset",
        "--after",
        "no_reset",
        "write_flash",
        "--flash_mode",
        "keep",
        "--flash_freq",
        "keep",
        "--flash_size",
        "keep",
        f"0x{offset:x}",
        str(image),
    ]


def reset_cmd(esptool: list[str], port: str) -> list[str]:
    return [*esptool, "--chip", CHIP, "--port", port, "run"]


def format_cmd(argv: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in argv)


def _disable_input_history() -> None:
    try:
        import readline
    except ImportError:
        return
    readline.set_auto_history(False)


def _require_tty() -> None:
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise SystemExit(
            "Need an interactive terminal. The password is not read from argv, "
            "a pipe, or the environment."
        )


def _ask(label: str) -> str:
    return input(label)


def _ask_secret(label: str) -> str:
    return getpass(label)


def _confirm(label: str) -> bool:
    answer = _ask(label).strip().lower()
    return answer in {"y", "yes"}


def prompt_settings() -> tuple[str, str, str, str]:
    _disable_input_history()
    _require_tty()
    ssid = ""
    while True:
        try:
            ssid = validate_ssid(_ask("Wi-Fi SSID: "))
            break
        except FieldError as exc:
            print(exc, file=sys.stderr)
    password = ""
    while True:
        password = _ask_secret(
            "Wi-Fi password (empty for an open network, not echoed): "
        )
        again = _ask_secret("Wi-Fi password again: ")
        if password != again:
            print("passwords did not match", file=sys.stderr)
            continue
        try:
            password = validate_pass(password)
            break
        except FieldError as exc:
            print(exc, file=sys.stderr)
    url = ""
    while True:
        typed = _ask("Companion URL (empty to omit): ").strip()
        try:
            url = validate_url(typed)
            break
        except FieldError as exc:
            print(exc, file=sys.stderr)
    token = ""
    while True:
        typed = _ask_secret("Bearer token (empty to omit, not echoed): ")
        if typed == "":
            token = ""
            break
        again = _ask_secret("Bearer token again: ")
        if typed != again:
            print("tokens did not match", file=sys.stderr)
            continue
        try:
            token = validate_token(typed)
            break
        except FieldError as exc:
            print(exc, file=sys.stderr)
    return ssid, password, url, token


def warn_ignored_env() -> None:
    for name in IGNORED_ENV:
        if os.environ.get(name):
            print(
                f"ignoring {name} from the environment; type values at the prompt",
                file=sys.stderr,
            )


def check_tools(port: str) -> tuple[str, Path, list[str], int, int]:
    idf_path = os.environ.get("IDF_PATH", "")
    if not idf_path:
        raise SystemExit(
            "IDF_PATH is not set. On the machine with ESP-IDF 5.5.x, run:\n"
            '  . "$IDF_PATH/export.sh"\n'
            "  scripts/provision-wifi.py\n"
            "This script calls that install's nvs_partition_gen.py. "
            "It does not vendor another NVS format."
        )
    generator = generator_path(idf_path)
    if not generator.is_file():
        raise SystemExit(
            f"nvs_partition_gen.py not found at {generator}. "
            "Source the ESP-IDF 5.5.x export so IDF_PATH points at that tree."
        )
    py = idf_python()
    esptool = esptool_argv(py)
    probe = subprocess.run(
        [*esptool, "version"], capture_output=True, text=True, check=False
    )
    if probe.returncode != 0:
        raise SystemExit(
            "esptool is not runnable. Source the ESP-IDF 5.5.x export first:\n"
            '  . "$IDF_PATH/export.sh"'
        )
    if not Path(port).exists():
        raise SystemExit(f"serial port {port} does not exist (override with PORT=...)")
    offset, size = nvs_geometry(partitions_csv())
    if size % 4096 != 0 or size < 0x3000:
        raise SystemExit(f"nvs partition size 0x{size:x} is not a valid NVS size")
    return py, generator, esptool, offset, size


def _write_private(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        path.unlink()
        raise SystemExit(f"refusing to keep {path.name}: mode is {mode:o}")


def _shred(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        if path.exists() or path.is_symlink():
            path.unlink()
        return
    size = path.stat().st_size
    fd = os.open(path, os.O_WRONLY, 0o600)
    try:
        os.write(fd, b"\x00" * max(size, 1))
        os.fsync(fd)
    finally:
        os.close(fd)
    path.unlink()


def _wipe_tree(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        if path.is_dir() and not path.is_symlink():
            path.rmdir()
        else:
            _shred(path)
    root.rmdir()


def generate_image(
    py: str, generator: Path, csv_text: str, size: int, work: Path
) -> Path:
    csv_path = work / "desk.csv"
    image = work / "desk.bin"
    _write_private(csv_path, csv_text.encode())
    completed = subprocess.run(
        [
            py,
            str(generator),
            "generate",
            str(csv_path),
            str(image),
            f"0x{size:x}",
            "--version",
            "2",
            "--outdir",
            str(work),
        ],
        check=False,
    )
    if completed.returncode != 0 or not image.is_file():
        raise SystemExit("nvs_partition_gen.py failed; NVS was not written")
    return image


def describe(
    ssid: str, password: str, url: str, token: str, port: str, offset: int, size: int
) -> None:
    print(f"About to replace the entire nvs partition on {port}")
    print(f"  offset 0x{offset:x}  size 0x{size:x}")
    print(f"  namespace {NAMESPACE}")
    print(f"  {KEY_SSID}: {ssid}")
    if password:
        print(f"  {KEY_PASS}: set ({len(password.encode())} bytes, hidden)")
    else:
        print(f"  {KEY_PASS}: empty (open network)")
    if url:
        print(f"  {KEY_URL}: {url}")
    else:
        print(f"  {KEY_URL}: omitted (firmware default after reboot)")
    if token:
        print(f"  {KEY_TOKEN}: set (hidden)")
    else:
        print(f"  {KEY_TOKEN}: omitted")
    print("Application firmware is not flashed.")
    print("Omitted keys will not be on the board after this write.")


def provision(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Write namespace desk (ssid, pass, optional url and token) "
            "to the panel NVS partition over USB."
        )
    )
    parser.add_argument("extra", nargs="*", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.extra:
        print(
            "This script does not take arguments. "
            "The Wi-Fi password is read from a hidden prompt, not the command line.",
            file=sys.stderr,
        )
        return 2

    warn_ignored_env()
    port = os.environ.get("PORT", DEFAULT_PORT)
    py, generator, esptool, offset, size = check_tools(port)
    ssid, password, url, token = prompt_settings()
    entries = setting_entries(ssid, password, url, token)
    describe(ssid, password, url, token, port, offset, size)
    if not _confirm("Proceed? [y/N] "):
        print("aborted")
        return 1

    old_umask = os.umask(0o077)
    work: Path | None = None
    try:
        work = Path(tempfile.mkdtemp(prefix="desk-nvs-"))
        os.chmod(work, 0o700)
        if repo_root() in work.resolve().parents:
            raise SystemExit("refusing to stage NVS files inside the repo")
        image = generate_image(py, generator, render_csv(entries), size, work)
        write = write_flash_cmd(esptool, port, offset, image)
        written = subprocess.run(write, check=False)
        if written.returncode != 0:
            print("esptool write_flash failed; NVS was not confirmed", file=sys.stderr)
            return written.returncode
        reset = reset_cmd(esptool, port)
        ran = subprocess.run(reset, check=False)
        if ran.returncode != 0:
            print("NVS write succeeded, but soft-reset failed.", file=sys.stderr)
            print("Reset the board with:", file=sys.stderr)
            print(f"  {format_cmd(reset)}", file=sys.stderr)
            return ran.returncode
    finally:
        os.umask(old_umask)
        if work is not None and work.exists():
            _wipe_tree(work)

    print(
        f"Wrote namespace {NAMESPACE} on {port} at 0x{offset:x} and soft-reset the board."
    )
    print("The panel should join with the new NVS.")
    return 0


def main() -> None:
    sys.exit(provision())


if __name__ == "__main__":
    main()
