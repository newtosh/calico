"""Record the Python companion's responses for calico's contract tests.

Run from the calico repo root. It drives the reference implementation in
tools/python-companion:

    python3 test/contract/capture.py

Writes test/contract/fixtures/companion.json. Re-run only when the frozen
contract changes on purpose, and say so in the pull request.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

CORS = ("Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers")


def run(base: str, step: dict[str, object]) -> dict[str, object]:
    headers = dict(step.get("headers", {}))  # type: ignore[arg-type]
    if step.get("auth"):
        headers["Authorization"] = "Bearer secret"
    data: bytes | None = None
    if "json" in step:
        data = json.dumps(step["json"]).encode()
        headers.setdefault("Content-Type", "application/json")
    elif "body_b64" in step:
        data = base64.b64decode(str(step["body_b64"]))
    request = Request(base + str(step["path"]), data=data, headers=headers, method=str(step["method"]))
    try:
        with urlopen(request) as response:
            status, got, body = response.status, response.headers, response.read()
    except HTTPError as exc:
        status, got, body = exc.code, exc.headers, exc.read()
    record: dict[str, object] = {
        "step": step,
        "status": status,
        "content_type": got.get("Content-Type", ""),
        "cors": [got.get(name, "") for name in CORS],
    }
    if str(record["content_type"]).startswith("application/json"):
        record["json"] = json.loads(body)
    elif body:
        record["body_b64"] = base64.b64encode(body).decode()
    return record


def main() -> None:
    repo = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo / "tools" / "python-companion" / "companion" / "src"))
    from grok_desk_buddy.config import default_config
    from grok_desk_buddy.server import serve_in_thread
    from grok_desk_buddy.store import DeskStore

    here = Path(__file__).parent
    steps = json.loads((here / "scenario.json").read_text(encoding="utf-8"))
    config = default_config()
    config.webhook_token = "secret"
    server, base = serve_in_thread(DeskStore(), web_dist=None, config=config, config_path=None)
    try:
        results = [run(base, step) for step in steps]
    finally:
        server.shutdown()
    out = here / "fixtures" / "companion.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(
        json.dumps({"source": "tools/python-companion", "steps": results}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(results)} steps to {out}")


if __name__ == "__main__":
    main()
