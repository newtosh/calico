from __future__ import annotations

import argparse
import logging
import os
import threading
from datetime import UTC, datetime
from pathlib import Path

from grok_desk_buddy.config import config_path, load_config
from grok_desk_buddy.cursor_poll import poll_once, urllib_get
from grok_desk_buddy.server import make_server
from grok_desk_buddy.store import DeskStore


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Grok desk buddy companion")
    parser.add_argument("--config", default=config_path(os.environ))
    parser.add_argument("--web-dist", default="web/dist")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    config_file = Path(args.config)
    config = load_config(config_file, os.environ)
    store = DeskStore(sqlite_path=config.sqlite_path or None)
    web_dist = Path(args.web_dist)
    stop = threading.Event()

    def loop() -> None:
        while not stop.is_set():
            try:
                poll_once(store, config.cursor_api_key, urllib_get, _now())
            except Exception:
                logging.exception("cursor poll failed")
            stop.wait(max(5, config.cursor_poll_seconds))

    threading.Thread(target=loop, name="cursor-poll", daemon=True).start()
    server = make_server(
        config.bind_host,
        config.bind_port,
        store,
        web_dist if web_dist.is_dir() else None,
        config,
        config_file,
    )
    logging.info("listening on http://%s:%s", config.bind_host, config.bind_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop.set()
        server.shutdown()


if __name__ == "__main__":
    main()
