# Grok Desk Buddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a LAN companion, a React dashboard, and a Waveshare 2.16 firmware project that show Grok Bot / Cursor agent status and raise a NEEDS YOU alert.

**Architecture:** A stdlib Python process is the only writer of desk state. The browser and the panel read `GET /api/status`. Grok Bot (and the inject buttons) POST events. An optional poller reads Cursor’s agent list and never invents NEEDS YOU.

**Tech Stack:** Python 3.11+ (ruff, black, pytest), React 18 + Vite + Tailwind 4 + TypeScript strict, ESP-IDF 5.4 / LVGL 9 / BSP `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1`.

**Spec:** `docs/superpowers/specs/2026-10-02-grok-desk-buddy-design.md`

## Global Constraints

- Python: ruff, black, type annotations on every function, `pyproject.toml`, no runtime dependencies.
- TypeScript: ESLint, Prettier, `strict`, no `any`, one React component per file, Tailwind only for styling.
- Companion binds `0.0.0.0:8787` by default. Optional bearer protects writes only. GET `/api/status` is open.
- Event types are exactly `agent.launched`, `agent.finished`, `agent.needs_you`, `note`.
- Cursor list statuses map `ACTIVE` → running, `IDLE` and `ARCHIVED` → idle. Never `needs_you`.
- Do not add Docker. Do not implement microphone capture.
- Secrets live in `companion/data/config.json` or env. Never commit them.

## Review Focus

These are the inputs most likely to bite an operator, and the task that pins each one:

- Two overlapping webhook posts must both land in `events` and leave `phase` consistent with the agents. Task 2.
- `GET /api/static/../../etc/passwd` style paths must not escape `web/dist`. Task 5.
- The 51st event drops the oldest; `events` length stays 50. Task 1.
- Status JSON with `"last_event": null` and zero agents must not crash the panel parser; phase stays readable. Task 7.
- `PUT /api/config` that omits `cursor_api_key` must leave the stored key in place. Task 3.

---

### Task 1: Desk store

**Files:**
- Create: `companion/pyproject.toml`
- Create: `companion/src/grok_desk_buddy/__init__.py`
- Create: `companion/src/grok_desk_buddy/store.py`
- Test: `companion/tests/test_store.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `EventIn(type: str, agent_id: str = "", title: str = "", message: str = "", source: str = "grok-bot")`
  - `Event` frozen dataclass: `id: str, type: str, agent_id: str, title: str, message: str, source: str, at: str`
  - `DeskStore(sqlite_path: str | None = None)`
  - `DeskStore.apply_event(raw: EventIn) -> Event` raises `ValueError` on bad type or missing `agent_id` for agent types
  - `DeskStore.dismiss() -> None`
  - `DeskStore.status() -> dict[str, object]` with keys `phase`, `needs_you`, `agents`, `last_event`, `events`
  - `DeskStore.apply_cursor_item(agent_id: str, name: str, mapped: str, at: str) -> bool` — `mapped` is `running` or `idle`; returns whether an event was appended

- [ ] **Step 1: Write the failing test**

```python
def test_launch_then_needs_you_then_dismiss(tmp_path: Path) -> None:
    store = DeskStore(sqlite_path=str(tmp_path / "desk.sqlite"))
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    assert store.status()["phase"] == "running"
    store.apply_event(EventIn(type="agent.needs_you", agent_id="a1", message="Pick one"))
    body = store.status()
    assert body["phase"] == "needs_you"
    assert body["needs_you"] is True
    store.dismiss()
    after = store.status()
    assert after["phase"] == "running"
    assert after["needs_you"] is False


def test_note_does_not_create_agent_and_finish_goes_idle() -> None:
    store = DeskStore()
    store.apply_event(EventIn(type="note", message="hello"))
    assert store.status()["agents"] == []
    assert store.status()["phase"] == "idle"
    store.apply_event(EventIn(type="agent.launched", agent_id="a1", title="Scaffold"))
    store.apply_event(EventIn(type="agent.finished", agent_id="a1"))
    body = store.status()
    assert body["phase"] == "idle"
    agents = body["agents"]
    assert isinstance(agents, list)
    assert agents[0]["status"] == "idle"


def test_rejects_unknown_type_and_missing_agent() -> None:
    store = DeskStore()
    with pytest.raises(ValueError):
        store.apply_event(EventIn(type="agent.exploded", agent_id="a1"))
    with pytest.raises(ValueError):
        store.apply_event(EventIn(type="agent.finished", agent_id=""))


def test_event_cap_is_50() -> None:
    store = DeskStore()
    for i in range(51):
        store.apply_event(EventIn(type="note", message=str(i)))
    events = store.status()["events"]
    assert isinstance(events, list)
    assert len(events) == 50
    assert events[0]["message"] == "50"


def test_cursor_item_does_not_repeat(tmp_path: Path) -> None:
    path = str(tmp_path / "desk.sqlite")
    store = DeskStore(sqlite_path=path)
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:00Z") is True
    assert store.apply_cursor_item("bc-1", "Readme", "running", "2026-10-02T13:00:01Z") is False
    reloaded = DeskStore(sqlite_path=path)
    assert reloaded.status()["phase"] == "running"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && python -m pytest tests/test_store.py -v`
Expected: FAIL, `DeskStore` not importable

- [ ] **Step 3: Implement the store**

`apply_event` stamps `id` (`uuid4`) and `at` (UTC, seconds, `Z`). Agent types require non-empty `agent_id`. `note` may omit it. Newest event is index 0. Agents list is sorted by `id`. `dismiss` flips `needs_you` agents to `running` and appends a `note` with title `Dismissed`, source `manual`. SQLite tables `events` and `agents` mirror memory; constructor loads them when the file exists. `apply_cursor_item` no-ops when that agent already has `mapped` status.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && python -m pytest tests/test_store.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add companion/pyproject.toml companion/src companion/tests/test_store.py
git commit -m "feat: add desk event store"
```

### Task 2: HTTP status, webhook, dismiss

**Files:**
- Create: `companion/src/grok_desk_buddy/server.py`
- Test: `companion/tests/test_http.py`

**Interfaces:**
- Consumes: `DeskStore`, `EventIn`
- Produces: `serve_in_thread(store: DeskStore, token: str, web_dist: Path | None) -> tuple[ThreadingHTTPServer, str]` returning the server and a base URL like `http://127.0.0.1:12345`. Caller calls `server.shutdown()`.

- [ ] **Step 1: Write the failing test**

```python
def test_webhook_updates_status_and_auth() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="secret", web_dist=None)
    try:
        idle = json.loads(urlopen(base + "/api/status").read())
        assert idle["phase"] == "idle"
        denied = post(base + "/api/webhook/grok-bot", {"type": "agent.launched", "agent_id": "a1"})
        assert denied.status == 401
        wrong = post(base + "/api/webhook/grok-bot", {"type": "agent.launched", "agent_id": "a1"}, "nope")
        assert wrong.status == 401
        ok = post(base + "/api/webhook/grok-bot", {"type": "agent.launched", "agent_id": "a1", "title": "Scaffold"}, "secret")
        assert ok.status == 201
        assert json.loads(ok.body)["source"] == "grok-bot"
        bad = post(base + "/api/webhook/grok-bot", {"type": "nope", "agent_id": "a1"}, "secret")
        assert bad.status == 400
        seen = json.loads(urlopen(base + "/api/status").read())
        assert seen["agents"][0]["id"] == "a1"
        post(base + "/api/webhook/grok-bot", {"type": "agent.needs_you", "agent_id": "a1"}, "secret")
        cleared = post(base + "/api/dismiss", {}, "secret")
        assert cleared.status == 204
        assert json.loads(urlopen(base + "/api/status").read())["needs_you"] is False
    finally:
        server.shutdown()


def test_parallel_launches_both_land() -> None:
    store = DeskStore()
    server, base = serve_in_thread(store, token="", web_dist=None)
    try:
        threads = [
            Thread(target=post, args=(base + "/api/webhook/grok-bot", {"type": "agent.launched", "agent_id": name}))
            for name in ("a", "b")
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        ids = {agent["id"] for agent in json.loads(urlopen(base + "/api/status").read())["agents"]}
        assert ids == {"a", "b"}
    finally:
        server.shutdown()
```

`post` is a test helper that returns status and body and sends `Authorization: Bearer` only when the token argument is non-empty.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && python -m pytest tests/test_http.py -v`
Expected: FAIL, import error

- [ ] **Step 3: Implement `serve_in_thread`**

Routes from the spec. JSON errors: `{"error": "bad json"}`, `{"error": "unauthorized"}`, `{"error": "bad event"}`. Webhook 201 body is the stored event object. Dismiss returns 204 and an empty body. Bind `127.0.0.1` port 0 for tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && python -m pytest tests/test_http.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add companion/src/grok_desk_buddy/server.py companion/tests/test_http.py
git commit -m "feat: serve status, webhook, and dismiss"
```

### Task 3: Config file and merge

**Files:**
- Create: `companion/src/grok_desk_buddy/config.py`
- Test: `companion/tests/test_config.py`

**Interfaces:**
- Consumes: nothing from the store
- Produces:
  - `CompanionConfig` dataclass with the six spec fields
  - `load_config(path: Path, environ: Mapping[str, str]) -> CompanionConfig`
  - `save_config(path: Path, config: CompanionConfig) -> None`
  - `public_view(config: CompanionConfig) -> dict[str, object]`
  - `merge_config(current: CompanionConfig, patch: Mapping[str, object]) -> tuple[CompanionConfig, bool]`

- [ ] **Step 1: Write the failing test**

```python
def test_load_env_override_and_mask(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    save_config(path, CompanionConfig("127.0.0.1", 8787, "", "ck_live", "", 30))
    loaded = load_config(path, {"GROK_DESK_PORT": "9000"})
    assert loaded.bind_host == "127.0.0.1"
    assert loaded.bind_port == 9000
    assert loaded.cursor_api_key == "ck_live"
    view = public_view(loaded)
    assert view["cursor_api_key_set"] is True
    assert "ck_live" not in view.values()


def test_merge_keeps_omitted_secret() -> None:
    current = CompanionConfig("0.0.0.0", 8787, "tok", "ck_live", "", 30)
    merged, restart = merge_config(current, {"bind_port": 9001, "extra": 1})
    assert restart is True
    assert merged.cursor_api_key == "ck_live"
    assert merged.bind_port == 9001
    cleared, _ = merge_config(merged, {"cursor_api_key": ""})
    assert cleared.cursor_api_key == ""


def test_missing_file_defaults(tmp_path: Path) -> None:
    loaded = load_config(tmp_path / "missing.json", {})
    assert loaded.bind_host == "0.0.0.0"
    assert loaded.bind_port == 8787
    assert loaded.cursor_poll_seconds == 30
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && python -m pytest tests/test_config.py -v`
Expected: FAIL

- [ ] **Step 3: Implement config.py**

Env names from the spec override file values when the variable is non-empty. `merge_config` sets the restart flag when `bind_host`, `bind_port`, or `sqlite_path` change.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && python -m pytest tests/test_config.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add companion/src/grok_desk_buddy/config.py companion/tests/test_config.py
git commit -m "feat: load and merge companion config"
```

### Task 4: Cursor list poll

**Files:**
- Create: `companion/src/grok_desk_buddy/cursor_poll.py`
- Test: `companion/tests/test_cursor_poll.py`

**Interfaces:**
- Consumes: `DeskStore.apply_cursor_item`
- Produces:
  - `map_cursor_status(status: str) -> str | None`
  - `poll_once(store: DeskStore, api_key: str, get: Callable[[str, str], bytes], now: str) -> None`
  - `get` is called as `get(url, api_key)` and returns the response body

- [ ] **Step 1: Write the failing test**

```python
def test_map_and_poll_once() -> None:
    assert map_cursor_status("ACTIVE") == "running"
    assert map_cursor_status("IDLE") == "idle"
    assert map_cursor_status("ARCHIVED") == "idle"
    assert map_cursor_status("WAITING") is None
    store = DeskStore()
    body = json.dumps({"items": [{"id": "bc-1", "name": "Readme", "status": "ACTIVE"}]}).encode()
    seen: list[tuple[str, str]] = []

    def get(url: str, api_key: str) -> bytes:
        seen.append((url, api_key))
        return body

    poll_once(store, "ck_test", get, "2026-10-02T13:00:00Z")
    assert seen[0][0] == "https://api.cursor.com/v1/agents?limit=20"
    assert seen[0][1] == "ck_test"
    assert store.status()["phase"] == "running"
    assert store.status()["needs_you"] is False
    poll_once(store, "ck_test", get, "2026-10-02T13:00:02Z")
    events = store.status()["events"]
    assert isinstance(events, list)
    assert len(events) == 1

    def boom(url: str, api_key: str) -> bytes:
        raise OSError("down")

    poll_once(store, "ck_test", boom, "2026-10-02T13:00:03Z")
    assert len(store.status()["events"]) == 1
    poll_once(store, "", get, "2026-10-02T13:00:04Z")
    assert len(seen) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && python -m pytest tests/test_cursor_poll.py -v`
Expected: FAIL

- [ ] **Step 3: Implement cursor_poll.py**

URL is `https://api.cursor.com/v1/agents?limit=20`. Read `items[].id`, `name`, `status`. Skip items `map_cursor_status` returns `None` for. Empty `api_key` returns without calling `get`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && python -m pytest tests/test_cursor_poll.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add companion/src/grok_desk_buddy/cursor_poll.py companion/tests/test_cursor_poll.py
git commit -m "feat: poll Cursor agent list into desk state"
```

### Task 5: Process entry, CORS, static files, config routes

**Files:**
- Create: `companion/src/grok_desk_buddy/__main__.py`
- Modify: `companion/src/grok_desk_buddy/server.py`
- Test: `companion/tests/test_static.py`

**Interfaces:**
- Consumes: `serve_in_thread`, `CompanionConfig`, `load_config`, `merge_config`, `public_view`, `poll_once`
- Produces: `main(argv: list[str] | None = None) -> None` loads config, starts the poll thread, serves until interrupted. `serve_in_thread` grows a `config: CompanionConfig` argument and uses it for token checks and config routes. Keep the Task 2 signature working by making `config` optional: when omitted, token is the `token` argument and config routes return 404.

- [ ] **Step 1: Write the failing test**

```python
def test_static_cors_and_config_merge(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("DESK", encoding="utf-8")
    holder = CompanionConfig("0.0.0.0", 8787, "secret", "", "", 30)
    server, base = serve_in_thread(DeskStore(), token="secret", web_dist=dist, config=holder)
    try:
        assert urlopen(base + "/").read() == b"DESK"
        escaped = urlopen(Request(base + "/../pyproject.toml"))
        assert escaped.status == 404
        opt = urlopen(Request(base + "/api/status", method="OPTIONS"))
        assert opt.status == 204
        assert opt.headers["Access-Control-Allow-Origin"] == "*"
        denied = put(base + "/api/config", {"cursor_api_key": "ck_test"})
        assert denied.status == 401
        saved = put(base + "/api/config", {"cursor_api_key": "ck_test"}, "secret")
        assert saved.status == 200
        view = json.loads(urlopen(base + "/api/config").read())
        assert view["cursor_api_key_set"] is True
        assert "ck_test" not in json.dumps(view)
        put(base + "/api/config", {"bind_port": 8787}, "secret")
        assert holder.cursor_api_key == "ck_test"
    finally:
        server.shutdown()
```

`serve_in_thread` accepts `config`. When `config` is passed, the token argument is ignored and `config.webhook_token` is the bearer. PUT updates that same object in place. `put` matches the Task 2 `post` helper. A missing static file, including a `..` path, is 404 (catch `HTTPError`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd companion && python -m pytest tests/test_static.py -v`
Expected: FAIL

- [ ] **Step 3: Implement static, CORS, config routes, and `__main__.py`**

Poll thread sleeps `cursor_poll_seconds` (floor 5) and calls `poll_once` with a real `urllib` get. Log and continue on failure. `__main__` default config path is `companion/data/config.json` relative to the cwd.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd companion && python -m pytest -v && python -m ruff check src tests && python -m black --check src tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add companion/src/grok_desk_buddy/server.py companion/src/grok_desk_buddy/__main__.py companion/tests/test_static.py
git commit -m "feat: serve the web UI and config API"
```

### Task 6: React dashboard

**Files:**
- Create: `web/` Vite + React + TS project (`package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.prettierrc`, `index.html`, `src/main.tsx`, `src/index.css`, `src/App.tsx`, `src/api.ts`, `src/vite-env.d.ts`)
- Create: `web/src/components/StatusDashboard.tsx`
- Create: `web/src/components/NeedsYouBanner.tsx`
- Create: `web/src/components/AgentList.tsx`
- Create: `web/src/components/EventList.tsx`
- Create: `web/src/components/ConfigForm.tsx`
- Create: `web/src/components/InjectPanel.tsx`
- Test: `web/src/api.test.ts`

**Interfaces:**
- Consumes: the HTTP API from Task 5
- Produces: `npm run build` writes `web/dist`. `api.ts` exports `injectBody(type: string, agentId: string, message: string): WebhookBody` and types `DeskStatus`, `DeskEvent`, `DeskAgent`, `PublicConfig` with no `any`.

- [ ] **Step 1: Write the failing test**

`injectBody("agent.needs_you", "a1", "Pick one")` equals `{type: "agent.needs_you", agent_id: "a1", title: "a1", message: "Pick one", source: "manual"}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- --run src/api.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the UI**

Tailwind via `@tailwindcss/vite`. Dark full-viewport layout. Dashboard polls every 2s. Banner visible only when `needs_you` is true and its button POSTs dismiss. Inject panel has four buttons posting the four event types with agent id input default `demo`. Config form loads public config, password inputs for token and Cursor key, save PUTs only fields the user edited plus the visible non-secrets. `strict` TypeScript. ESLint flat config with `typescript-eslint` banning `any`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- --run && npm run build && npx tsc --noEmit && npx eslint src`
Expected: PASS, `web/dist/index.html` exists

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat: add status and config dashboard"
```

### Task 7: Firmware project and host preview

**Files:**
- Create: `firmware/CMakeLists.txt`
- Create: `firmware/partitions.csv`
- Create: `firmware/sdkconfig.defaults`
- Create: `firmware/main/CMakeLists.txt`
- Create: `firmware/main/idf_component.yml`
- Create: `firmware/main/desk_view.h`
- Create: `firmware/main/desk_view.c`
- Create: `firmware/main/main.c`
- Create: `firmware/main/ui.c`
- Create: `firmware/main/ui.h`
- Create: `firmware/main/net.c`
- Create: `firmware/main/net.h`
- Create: `firmware/simulator/index.html`
- Create: `firmware/host/test_desk_view.c`
- Create: `firmware/README.md`
- Test: `firmware/host/test_desk_view.c` compiled with `gcc`

**Interfaces:**
- Consumes: status JSON from Task 2
- Produces:
  - `int desk_view_from_json(const char *json, desk_view_t *out)` returns 0, or -1 when `json` or `out` is NULL
  - `const char *desk_phase_label(const desk_view_t *view, int consecutive_failures)` returns `link down` when `consecutive_failures >= 3`, otherwise `IDLE`, `RUNNING`, or `NEEDS YOU`
  - `desk_view_t` fields: `phase[16]`, `needs_you`, `title[96]`, `message[160]`, `running_count`

- [ ] **Step 1: Write the failing test**

Compile-failing assertions: sample status JSON with one running agent and a last event fills title, message, `running_count == 1`, label `RUNNING`. `{"phase":"idle","needs_you":false,"agents":[],"last_event":null,"events":[]}` yields empty title and label `IDLE`. `consecutive_failures == 3` yields `link down`. NULL json returns -1.

- [ ] **Step 2: Run test to verify it fails**

Run: `gcc -Wall -Werror -I firmware/main firmware/host/test_desk_view.c firmware/main/desk_view.c -o /tmp/test_desk_view && /tmp/test_desk_view`
Expected: FAIL to compile or assertions fail

- [ ] **Step 3: Implement parser, ESP-IDF app, simulator, flash docs**

Parser scans the JSON text for the keys it needs (no cJSON in the host file). `main.c` calls `bsp_display_start`, loads NVS namespace `desk`, and starts Wi-Fi plus a poll task when `ssid` is set. UI: tiles, NEEDS YOU full-screen tap to dismiss, settings screen for ssid/pass/url/token, mic stub string `Voice not in this PoC`. `sdkconfig.defaults` and `partitions.csv` match the Waveshare LVGL example values from the spec. `firmware/README.md` documents `idf.py set-target esp32s3`, build, flash, and the simulator path when `idf.py` is missing. Simulator is a 480×480 page polling `{base}/api/status`.

- [ ] **Step 4: Run test to verify it passes**

Run: `gcc -Wall -Werror -I firmware/main firmware/host/test_desk_view.c firmware/main/desk_view.c -o /tmp/test_desk_view && /tmp/test_desk_view`
Expected: PASS printed by the test. If `idf.py` exists, also `idf.py build` from `firmware/`. If it does not, say so in `firmware/README.md` (already required) and do not invent a build log.

- [ ] **Step 5: Commit**

```bash
git add firmware
git commit -m "feat: add Waveshare panel firmware and host preview"
```

### Task 8: Root docs and license

**Files:**
- Create: `README.md` (replace the placeholder)
- Create: `docs/grok-bot-integration.md`
- Create: `LICENSE`
- Create: `.gitignore`
- Create: `.env.example`
- Modify: none of the product code

**Interfaces:**
- Consumes: the routes and env names from earlier tasks
- Produces: the documents the spec lists

- [ ] **Step 1: Write the docs**

README contains a mermaid diagram, quickstart for companion and web, flash pointer, a security note (LAN, no auth on GET, optional bearer), and a Grok Bot section shorter than a page that links to `docs/grok-bot-integration.md`. That guide has the four event types, an example POST, and a paragraph on VibePulse / XiaoZhi. MIT license. `.env.example` lists the env vars with empty secrets. `.gitignore` ignores `companion/data/`, `.env`, `web/node_modules`, `web/dist`, `firmware/build`, `firmware/managed_components`, `firmware/sdkconfig`.

- [ ] **Step 2: Verify**

Run: `cd companion && python -m pytest -q`
Expected: PASS. Confirm README Grok Bot section is present by reading it.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/grok-bot-integration.md LICENSE .gitignore .env.example
git commit -m "docs: add quickstart, Grok Bot wiring, and license"
```
