#!/usr/bin/env python3
"""Add or remove one desk Wi-Fi network in the panel NVS partition over USB.

Uses the ESP-IDF ``nvs_partition_gen.py`` already installed with ``IDF_PATH``
(ESP-IDF 5.5.x) and esptool. It does not embed a second NVS writer, and it
does not flash application firmware.

The password is read from a hidden prompt. It is not accepted as an argument,
an environment variable, or a file in this repo.

``add`` reads the current NVS, inserts or updates one network, and writes
every saved network back. ``remove`` drops one SSID and writes the rest back.
Neither command replaces the partition with only the new network.
"""

from __future__ import annotations

import csv
import io
import os
import shlex
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import zlib
from getpass import getpass
from pathlib import Path

NAMESPACE = "desk"
# Keys read by firmware/main/net.c. Password key is "pass".
KEY_SSID = "ssid"
KEY_PASS = "pass"
KEY_URL = "url"
KEY_TOKEN = "token"

# Indexed keys n{i}ssid, n{i}pass, n{i}url, n{i}token. Must match WIFI_NET_MAX.
NET_MAX = 8

SSID_MAX = 32
PASS_MAX = 64
URL_MAX = 127
TOKEN_MAX = 127

DEFAULT_PORT = "/dev/ttyACM0"
NVS_PARTITION_NAME = "nvs"
CHIP = "esp32s3"

PAGE_SIZE = 4096
ENTRY_SIZE = 32
ENTRY_COUNT = 126
ENTRY_DATA_OFFSET = 64
PAGE_ACTIVE = 0xFFFFFFFE
PAGE_FULL = 0xFFFFFFFC
PAGE_FREEING = 0xFFFFFFF8
PAGE_UNINITIALIZED = 0xFFFFFFFF
ENTRY_WRITTEN = 0x2
TYPE_U8 = 0x01
TYPE_SZ = 0x21

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


class NvsError(ValueError):
    pass


class Network:
    def __init__(self, ssid: str, password: str, url: str = "", token: str = "") -> None:
        self.ssid = ssid
        self.password = password
        self.url = url
        self.token = token


class Store:
    def __init__(self) -> None:
        self.url = ""
        self.token = ""
        self.networks: list[Network] = []


def repo_root() -> Path:
    # scripts/ lives in firmware/, which lives in the repo root.
    return Path(__file__).resolve().parent.parent.parent


def partitions_csv() -> Path:
    return Path(__file__).resolve().parent.parent / "partitions.csv"


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


def slot_key(index: int, field: str) -> str:
    return f"n{index}{field}"


def managed_keys() -> set[str]:
    names = {KEY_SSID, KEY_PASS, KEY_URL, KEY_TOKEN}
    for index in range(NET_MAX):
        for field in (KEY_SSID, KEY_PASS, KEY_URL, KEY_TOKEN):
            names.add(slot_key(index, field))
    return names


def store_from_entries(entries: dict[str, str]) -> Store:
    """Load indexed networks. Legacy ssid/pass count only when no index exists."""
    store = Store()
    store.url = entries.get(KEY_URL, "")
    store.token = entries.get(KEY_TOKEN, "")
    for index in range(NET_MAX):
        ssid = entries.get(slot_key(index, KEY_SSID), "")
        if not ssid:
            continue
        store.networks.append(
            Network(
                ssid,
                entries.get(slot_key(index, KEY_PASS), ""),
                entries.get(slot_key(index, KEY_URL), ""),
                entries.get(slot_key(index, KEY_TOKEN), ""),
            )
        )
    if not store.networks and entries.get(KEY_SSID):
        store.networks.append(Network(entries[KEY_SSID], entries.get(KEY_PASS, ""), "", ""))
    return store


def entries_from_store(store: Store) -> list[tuple[str, str]]:
    """Packed n{i}* keys. Legacy ssid/pass are not written back."""
    entries: list[tuple[str, str]] = []
    if store.url:
        entries.append((KEY_URL, store.url))
    if store.token:
        entries.append((KEY_TOKEN, store.token))
    for index, net in enumerate(store.networks):
        entries.append((slot_key(index, KEY_SSID), net.ssid))
        entries.append((slot_key(index, KEY_PASS), net.password))
        if net.url:
            entries.append((slot_key(index, KEY_URL), net.url))
        if net.token:
            entries.append((slot_key(index, KEY_TOKEN), net.token))
    return entries


def entries_for_desk(previous: dict[str, str], store: Store) -> list[tuple[str, str]]:
    """Known desk keys come from the store. Any other desk key is kept."""
    fresh = entries_from_store(store)
    owned = managed_keys()
    extras = [(key, value) for key, value in previous.items() if key not in owned]
    return fresh + extras


def apply_add(store: Store, ssid: str, password: str, url: str, token: str) -> None:
    ssid = validate_ssid(ssid)
    password = validate_pass(password)
    url = validate_url(url)
    token = validate_token(token)
    for net in store.networks:
        if net.ssid == ssid:
            net.password = password
            net.url = url
            net.token = token
            return
    if len(store.networks) >= NET_MAX:
        raise FieldError(f"known network list is full ({NET_MAX})")
    store.networks.append(Network(ssid, password, url, token))


def apply_remove(store: Store, ssid: str) -> bool:
    ssid = validate_ssid(ssid)
    kept = [net for net in store.networks if net.ssid != ssid]
    if len(kept) == len(store.networks):
        return False
    store.networks = kept
    return True


def replace_namespace(
    namespaces: list[tuple[str, dict[str, str]]],
    name: str,
    entries: list[tuple[str, str]],
) -> list[tuple[str, list[tuple[str, str]]]]:
    found = False
    out: list[tuple[str, list[tuple[str, str]]]] = []
    for namespace, items in namespaces:
        if namespace == name:
            out.append((name, entries))
            found = True
        else:
            out.append((namespace, list(items.items())))
    if not found:
        out.append((name, entries))
    return out


def render_csv(namespaces: list[tuple[str, list[tuple[str, str]]]]) -> str:
    """CSV for nvs_partition_gen.py. No spaces around commas."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["key", "type", "encoding", "value"])
    for name, entries in namespaces:
        writer.writerow([name, "namespace", "", ""])
        for key, value in entries:
            writer.writerow([key, "data", "string", value])
    text = buffer.getvalue()
    if text.endswith("\n\n"):
        text = text[:-1]
    return text


def _crc(data: bytes) -> int:
    return zlib.crc32(data, 0xFFFFFFFF) & 0xFFFFFFFF


def _entry_state(bitmap: bytes, index: int) -> int:
    bit = index * 2
    return (bitmap[bit // 8] >> (bit % 8)) & 0x3


def _key_text(raw: bytes) -> str:
    if b"\x00" in raw:
        raw = raw.split(b"\x00", 1)[0]
    return raw.decode("utf-8")


def parse_nvs(blob: bytes) -> list[tuple[str, dict[str, str]]]:
    """Read namespace string values from a plaintext NVS partition image.

    A blank partition is an empty list. A page this tool cannot rewrite raises
    NvsError so the caller does not replace the image.
    """
    if len(blob) % PAGE_SIZE != 0 or len(blob) == 0:
        raise NvsError("NVS image size is not a multiple of 4096")
    pages: list[tuple[int, bytes]] = []
    for offset in range(0, len(blob), PAGE_SIZE):
        page = blob[offset : offset + PAGE_SIZE]
        state = struct.unpack_from("<I", page, 0)[0]
        if state == PAGE_UNINITIALIZED:
            if page != b"\xff" * PAGE_SIZE:
                raise NvsError("NVS page looks erased but is not empty")
            continue
        if state not in (PAGE_ACTIVE, PAGE_FULL, PAGE_FREEING):
            raise NvsError("NVS page is not readable")
        if _crc(page[4:28]) != struct.unpack_from("<I", page, 28)[0]:
            raise NvsError("NVS page checksum does not match")
        if page[8] < 0xFE:
            raise NvsError("NVS page version is not supported")
        seq = struct.unpack_from("<I", page, 4)[0]
        pages.append((seq, page))

    ns_by_index: dict[int, str] = {}
    order: list[str] = []
    values: dict[str, dict[str, str]] = {}
    for _seq, page in sorted(pages, key=lambda item: item[0]):
        bitmap = page[32:64]
        index = 0
        while index < ENTRY_COUNT:
            if _entry_state(bitmap, index) != ENTRY_WRITTEN:
                index += 1
                continue
            start = ENTRY_DATA_OFFSET + index * ENTRY_SIZE
            entry = page[start : start + ENTRY_SIZE]
            if len(entry) != ENTRY_SIZE:
                raise NvsError("NVS entry is truncated")
            if _crc(entry[0:4] + entry[8:32]) != struct.unpack_from("<I", entry, 4)[0]:
                raise NvsError("NVS entry checksum does not match")
            ns_index = entry[0]
            dtype = entry[1]
            span = entry[2]
            if span < 1 or index + span > ENTRY_COUNT:
                raise NvsError("NVS entry span is not on this page")
            key = _key_text(entry[8:24])
            if dtype == TYPE_U8 and ns_index == 0 and span == 1:
                ns_id = entry[24]
                ns_by_index[ns_id] = key
                if key not in values:
                    values[key] = {}
                    order.append(key)
            elif dtype == TYPE_SZ:
                data_size = struct.unpack_from("<H", entry, 24)[0]
                data_crc = struct.unpack_from("<I", entry, 28)[0]
                payload = page[start + ENTRY_SIZE : start + span * ENTRY_SIZE]
                if data_size > len(payload) or data_size < 1:
                    raise NvsError("NVS string length is outside its entry")
                chunk = payload[:data_size]
                if _crc(chunk) != data_crc:
                    raise NvsError("NVS string checksum does not match")
                if not chunk.endswith(b"\x00"):
                    raise NvsError("NVS string is missing its terminator")
                try:
                    text = chunk[:-1].decode("utf-8")
                except UnicodeError as exc:
                    raise NvsError("NVS string is not utf-8") from exc
                name = ns_by_index.get(ns_index)
                if name is None:
                    raise NvsError("NVS string is in an unknown namespace")
                if name not in values:
                    values[name] = {}
                    order.append(name)
                values[name][key] = text
            else:
                raise NvsError("NVS has an entry this tool cannot rewrite")
            index += span
    return [(name, values[name]) for name in order]


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


def read_flash_cmd(
    esptool: list[str], port: str, offset: int, size: int, image: Path
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
        "read_flash",
        f"0x{offset:x}",
        f"0x{size:x}",
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


def prompt_ssid() -> str:
    while True:
        try:
            return validate_ssid(_ask("Wi-Fi SSID: "))
        except FieldError as exc:
            print(exc, file=sys.stderr)


def prompt_network() -> tuple[str, str, str, str]:
    _disable_input_history()
    _require_tty()
    ssid = prompt_ssid()
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
        typed = _ask("Companion URL for this network (empty uses the default): ").strip()
        try:
            url = validate_url(typed)
            break
        except FieldError as exc:
            print(exc, file=sys.stderr)
    token = ""
    while True:
        typed = _ask_secret("Bearer token for this network (empty uses the default, not echoed): ")
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


def prompt_remove() -> str:
    _disable_input_history()
    _require_tty()
    while True:
        try:
            return validate_ssid(_ask("Wi-Fi SSID to remove: "))
        except FieldError as exc:
            print(exc, file=sys.stderr)


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
            "  scripts/provision-wifi.py add\n"
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


def summary_lines(store: Store, port: str, offset: int, size: int, command: str) -> list[str]:
    lines = [
        f"About to {command} one network in namespace {NAMESPACE} on {port}",
        f"  offset 0x{offset:x}  size 0x{size:x}",
        "Other saved networks are kept.",
        f"  networks after this write: {len(store.networks)}",
    ]
    for index, net in enumerate(store.networks):
        if net.password:
            secret = f"pass set ({len(net.password.encode())} bytes, hidden)"
        else:
            secret = "pass empty (open network)"
        url = net.url if net.url else "default url"
        lines.append(f"  n{index}: {net.ssid}  {secret}  {url}")
    if store.url:
        lines.append(f"  global {KEY_URL}: {store.url}")
    else:
        lines.append(f"  global {KEY_URL}: omitted (firmware default)")
    if store.token:
        lines.append(f"  global {KEY_TOKEN}: set (hidden)")
    else:
        lines.append(f"  global {KEY_TOKEN}: omitted")
    lines.append("Application firmware is not flashed.")
    return lines


def parse_command(argv: list[str] | None) -> str:
    if argv is None:
        argv = sys.argv[1:]
    if len(argv) == 1 and argv[0] in {"add", "remove"}:
        return argv[0]
    print(
        "usage: scripts/provision-wifi.py add|remove\n"
        "add updates one saved network and keeps the others.\n"
        "remove drops one saved network and keeps the others.\n"
        "The Wi-Fi password is read from a hidden prompt, not the command line.",
        file=sys.stderr,
    )
    return ""


def _desk_map(namespaces: list[tuple[str, dict[str, str]]]) -> dict[str, str]:
    for name, items in namespaces:
        if name == NAMESPACE:
            return dict(items)
    return {}


def provision(argv: list[str] | None = None) -> int:
    command = parse_command(argv)
    if not command:
        return 2

    warn_ignored_env()
    port = os.environ.get("PORT", DEFAULT_PORT)
    py, generator, esptool, offset, size = check_tools(port)

    old_umask = os.umask(0o077)
    work: Path | None = None
    try:
        work = Path(tempfile.mkdtemp(prefix="desk-nvs-"))
        os.chmod(work, 0o700)
        if repo_root() in work.resolve().parents:
            raise SystemExit("refusing to stage NVS files inside the repo")
        current = work / "current.bin"
        read = subprocess.run(
            read_flash_cmd(esptool, port, offset, size, current), check=False
        )
        if read.returncode != 0 or not current.is_file():
            print("esptool read_flash failed; NVS was not written", file=sys.stderr)
            return read.returncode or 1
        blob = current.read_bytes()
        try:
            namespaces = parse_nvs(blob)
        except NvsError as exc:
            print(f"{exc}; NVS was not written", file=sys.stderr)
            return 1
        previous = _desk_map(namespaces)
        store = store_from_entries(previous)
        if command == "add":
            ssid, password, url, token = prompt_network()
            try:
                apply_add(store, ssid, password, url, token)
            except FieldError as exc:
                print(exc, file=sys.stderr)
                return 1
        else:
            ssid = prompt_remove()
            if not apply_remove(store, ssid):
                print("that SSID is not a saved network; NVS was not written", file=sys.stderr)
                return 1
        merged = replace_namespace(namespaces, NAMESPACE, entries_for_desk(previous, store))
        for line in summary_lines(store, port, offset, size, command):
            print(line)
        if not _confirm("Proceed? [y/N] "):
            print("aborted")
            return 1
        image = generate_image(py, generator, render_csv(merged), size, work)
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

    print(f"Updated namespace {NAMESPACE} on {port} at 0x{offset:x} and soft-reset the board.")
    return 0


def main() -> None:
    sys.exit(provision())


if __name__ == "__main__":
    main()
