# Networks Vault (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calico keeps the panel's Wi-Fi networks in one keyring-protected list on this computer, and the panel gains `nets`, `forget` and a per-network URL and token on `wifi`, over Bluetooth and in the app's USB protocol.

**Architecture:** The vault lives in the Electron main process (`src/main/networks.ts`), stores `networks.json` (mode 0600) in the profile directory, encrypts passwords with `safeStorage`, and talks to the window over three `networks:*` IPC channels that only ever return `password_set` and `token_set`. The field limits move to `src/shared/panel-fields.ts` so main and the renderer check them with the same code. The firmware gets pure, host-tested formatters and parsers in `ble_desk.c` and two new authenticated GATT characteristics in `ble_link.c`, with every new buffer in PSRAM. Phase 2 never pushes the vault to the panel: that is Phase 3.

**Tech Stack:** ESP-IDF 5.5 C with NimBLE (firmware, host tests with system gcc); Electron 44 `safeStorage`, React 19, TypeScript, Vitest, Testing Library with happy-dom (app).

**Spec:** `docs/superpowers/specs/2026-10-13-wifi-networks-design.md`, section "Phase 2: the Networks vault". Read its "Superseded in part" box: pairing is OS-level numeric comparison, so there is no in-app PIN anywhere. Phase 3 (sync plan, address banner) gets its own plan.

## Global Constraints

- Firmware internal RAM is the binding budget. After Wi-Fi joins about 16.8 KB of internal RAM is free, and `largest internal DMA N after NimBLE` reads 53248 to 55296. Neither may fall below 53248 (DMA) or 16000 (internal free at got-ip) after this work. Task 9 records both, before and after.
- New firmware buffers (the nets text, the parsed wifi request, the GATT write buffer) go in PSRAM, allocated once at host start. No new static internal buffers, no growth of the NimBLE host stack (6144). This plan adds no LVGL object; any LVGL object added later must be built inside `psram_objects_begin()`/`psram_objects_end()` (`firmware/main/ui.c:1802`).
- `idf.py size`: internal DRAM (`.data` + `.bss`) may grow by at most 64 bytes (Task 3 measures it).
- Never erase NVS or flash. Hardware steps are marked **owner at the panel** and use `idf.py -p /dev/ttyACM0 app-flash` only. Executors never flash.
- New BLE characteristics: `nets` is `READ | READ_AUTHEN`, `forget` is `WRITE | WRITE_AUTHEN`. `status` stays the only characteristic readable without pairing. Every new characteristic is listed in the table in `firmware/README.md`.
- `nets` is bounded: at most 8 networks of at most 32 SSID bytes, `BLE_DESK_NETS_TEXT` (297) bytes. It never carries a password, token or URL.
- Field limits, in bytes: SSID 1 to 32, password empty or 8 to 64, URL up to 127 starting `http://` or `https://`, token up to 127, no CR, LF or NUL anywhere. 8 networks.
- Secrets: no password or token in logs, test snapshots, IPC payloads to the renderer, or error messages. Test files use only fake placeholders such as `placeholder-pass` and `placeholder-token`.
- The vault refuses to save a password when `safeStorage.getSelectedStorageBackend()` is `basic_text` or `unknown`, or `isEncryptionAvailable()` is false, and says why.
- Phase 2 pushes nothing from the vault to the panel. Remove and Edit in Settings change the vault only.
- Commands: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` (fix with `pnpm exec prettier --write <files>`), `firmware/host/run.sh`, `python3 -m pytest firmware/scripts/test_ble_provision.py`, and `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build`.
- Commits: one per task, small imperative subject, made with `git commit --no-gpg-sign -m "<subject>"` (the repo sets `commit.gpgsign`; the controller signs the batch later). No trailers.
- Prose, comments and UI copy: no em-dashes, no emojis (test data uses `\u{1F4F6}` or `\xf0\x9f\x93\xb6` escapes, never a literal emoji). UI follows `DESIGN.md`: Tailwind tokens and the `.btn`, `.field`, `.label`, `.section-title` classes, dense rows with hairlines, no new modal, one component per file.
- happy-dom ignores `[hidden]`: tests that look inside Settings select `[role="tabpanel"]:not([hidden])`.

## Review Focus

- **The keyring is missing or is the plaintext fallback.** A person on a bare window manager types a password and expects either real protection or a clear refusal, never a silent plaintext file. Pinned by Task 6 tests `refuses a password on the basic_text backend`, `refuses a password when encryption is unavailable` (nothing written, `encrypt` never called).
- **SSIDs that collide or overflow.** The same SSID twice, `Home` beside `home` (different networks, both allowed), and a hidden SSID typed with non-ASCII or emoji that is 36 bytes while looking like 9 characters. Pinned by Task 6 `refuses a duplicate and keeps case-differing SSIDs` and `counts SSID bytes, not characters`, Task 4 `counts emoji SSIDs in bytes`, Task 2 forget-parse byte checks.
- **networks.json that is corrupt, hand-edited, unreadable, or written twice at once.** Expect the bad file set aside as `networks.json.bad` (not overwritten), an unreadable one left untouched with saving refused, and two quick saves both kept. Pinned by Task 6 `sets aside a corrupt file`, `sets aside a hand-edited duplicate`, `will not overwrite a file it cannot read`, `keeps both of two saves made together`, and the Task 6 `writeAtomic` stale-tmp mode test.
- **The ninth network.** The panel holds 8. The vault refuses a ninth with a message, the panel refuses a ninth `wifi` without dropping a saved slot, and `nets` with eight 32-byte SSIDs still fits its buffer. Pinned by Task 6 `refuses a ninth network`, Task 2 `apply refuses a ninth network and keeps the eight`, `eight 32-byte ssids fit the nets text`.
- **Passwords with quotes, backslashes, newlines or non-ASCII.** USB frames them as one JSON line, Bluetooth as raw UTF-8 lines where a newline would split fields. Expect quotes and `ö` to round trip exactly and a newline to be refused before anything is sent. Pinned by Task 5 `frames a password with quotes, a backslash and non-ASCII as one JSON line`, `refuses a password with a newline before anything is sent`, `writes a password with quotes and non-ASCII as raw UTF-8`, and Task 6 `encrypts a password with quotes and non-ASCII exactly`.

---

## File Structure

- Modify `firmware/main/net.c`: one heap log line at got-ip (Task 1).
- Modify `firmware/main/ble_desk.h`, `firmware/main/ble_desk.c`, `firmware/host/test_ble_desk.c`: nets formatter, forget parser, wifi-with-config parser and apply (Task 2).
- Modify `firmware/main/ble_link.c`, `firmware/README.md`: `nets` and `forget` characteristics, PSRAM scratch, longer `wifi` write (Task 3).
- Create `src/shared/panel-fields.ts`. Modify `src/renderer/src/device/commands.ts`, `commands.test.ts` (Task 4).
- Modify `src/renderer/src/device/ble.ts`, `ble.test.ts`, `usb.ts`, `usb.test.ts`, `docs/usb-console-protocol.md` (Task 5).
- Create `src/main/networks.ts`, `test/main/networks.test.ts`. Modify `src/server/state-file.ts`, `test/server/state-file.test.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts` (Task 6).
- Create `src/renderer/src/device/ScanSelect.tsx`, `src/renderer/src/settings/NetworksSection.tsx`, `NetworkForm.tsx`, `NetworksSection.test.tsx`. Modify `SettingsView.tsx`, `SettingsView.test.tsx`, `src/renderer/src/App.tsx` (Task 7).
- Create `src/renderer/src/device/PanelNetworks.tsx`, `PanelNetworks.test.tsx`, `ProvisionFlow.test.tsx`. Modify `ProvisionFlow.tsx`, `DeviceView.tsx` (Task 8).
- Modify `README.md`, `docs/review-rules.md`, `firmware/README.md` (Task 9).

Decisions made here, one line each:

- **The firmware has no USB console.** `docs/usb-console-protocol.md` says "The firmware side is not implemented yet" and nothing in `firmware/main` reads serial. Phase 2 extends that protocol document and the app's `UsbLink`, and the C parsers it adds are pure so a later console reuses them. Building the console is its own plan: it needs its own internal-RAM budget (driver ring buffers, a task).
- **"Forget on the panel" ships, in the Device view, not in Settings.** The panel holds 8 networks and the vault cannot push yet, so without it a full panel has no in-app way to make room, and `nets`/`forget` would have no way to be checked on the real board.
- **Set up Wi-Fi gains optional "own URL" and "own token" fields.** It is the only Phase 2 sender of the extended `wifi`, so the long Bluetooth write is exercised on hardware before Phase 3 depends on it. It sends what the person types, never the vault.
- **Edit keeps the SSID.** Renaming is Remove then Add; the SSID is the key on both sides.
- **`forget` of an SSID that is not saved succeeds.** A retry after a dropped response must not look like a failure.
- **`url` and `token` travel together on `wifi`.** Sending either writes both to the slot; a missing one is empty and falls back to the global value.

---

### Task 1: Log the internal heap when Wi-Fi gets an address

**Files:**

- Modify: `firmware/main/net.c:284-292` (`on_ip`)

**Interfaces:**

- Produces: the boot log line `I (...) desk-net: got ip, internal free N, largest internal M`, which Task 9 reads. This commit is the baseline image for Task 9, so it changes nothing else.

- [ ] **Step 1: Add the log line**

Replace `on_ip` in `firmware/main/net.c` with:

```c
static void on_ip(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)base;
    (void)id;
    (void)data;
    s_wifi_retries = 0;
    s_wifi_has_ip = 1;
    s_wifi_gave_up = 0;
    /* The internal RAM left once the station is up. Compared before and after firmware changes. */
    ESP_LOGI(TAG, "got ip, internal free %u, largest internal %u",
             (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
}
```

`esp_heap_caps.h` is already included at `net.c:9` and `TAG` is `"desk-net"` at `net.c:23`.

- [ ] **Step 2: Build**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|Project build complete"`
Expected: `Project build complete`.

- [ ] **Step 3: Host and script checks still pass**

Run: `firmware/host/run.sh && python3 -m pytest -q firmware/scripts/test_ble_provision.py`
Expected: every host test `ok`, pytest all passed.

- [ ] **Step 4: Commit**

```bash
git add firmware/main/net.c
git commit --no-gpg-sign -m "Log the internal heap when Wi-Fi gets an address"
```

---

### Task 2: Pure firmware helpers for nets, forget and wifi with its own URL and token

**Files:**

- Modify: `firmware/main/ble_desk.h` (UUID block comment at lines 13-22, UUIDs after line 44, sizes after line 53, ops enum at lines 55-64, declarations at the end)
- Modify: `firmware/main/ble_desk.c` (static assert after line 12, new functions at the end)
- Test: `firmware/host/test_ble_desk.c`

**Interfaces:**

- Consumes: `wifi_upsert`, `wifi_remove` (`wifi_store.h`), the static `clean_field`, `strip_tail`, `has_break`, `copy_out` and the public `ble_desk_parse_wifi`, `ble_desk_parse_url`, `ble_desk_parse_token`, `ble_desk_upsert_wifi` already in `ble_desk.c`.
- Produces (in `ble_desk.h`):
  - `#define BLE_DESK_UUID_NETS "8d7c4b19-6e2a-4f91-a3c5-67726f6b6465"`, `#define BLE_DESK_UUID_FORGET "8d7c4b1a-6e2a-4f91-a3c5-67726f6b6465"`
  - `BLE_DESK_OP_NETS = 9`, `BLE_DESK_OP_FORGET = 10`
  - `#define BLE_DESK_NETS_TEXT 297`, `#define BLE_DESK_WIFI_CFG_MAX 355`
  - `typedef struct { char ssid[33]; char pass[65]; char url[128]; char token[128]; int has_cfg; } ble_desk_wifi_t;`
  - `int ble_desk_format_nets(char *out, size_t cap, const wifi_store_t *store);` body `count=N\n` then `<u><t>\t<ssid>\n` per slot, `u`/`t` are `1` or `0`. Returns length or -1 (out emptied).
  - `int ble_desk_parse_forget(const uint8_t *in, size_t len, char *ssid, size_t cap);` 0 or -1.
  - `int ble_desk_parse_wifi_cfg(const uint8_t *in, size_t len, ble_desk_wifi_t *out);` accepts `ssid\npass` (has_cfg 0, same rules as `ble_desk_parse_wifi`) or `ssid\npass\nurl\ntoken` (has_cfg 1), each with an optional trailing newline. On failure `*out` is zeroed.
  - `int ble_desk_apply_wifi(wifi_store_t *store, const ble_desk_wifi_t *req);` has_cfg replaces the slot's url and token; otherwise keeps them. 0 or -1 (full store, bad input).

- [ ] **Step 1: Write the failing tests**

In `firmware/host/test_ble_desk.c`, add after the existing `parse_wifi` helper (line 25):

```c
static int parse_cfg(const char *text, ble_desk_wifi_t *req) {
    return ble_desk_parse_wifi_cfg((const uint8_t *)text, strlen(text), req);
}
```

and add before `if (g_failed) {` near the end of `main`:

```c
    {
        char nets[BLE_DESK_NETS_TEXT];
        int i;

        wifi_store_init(&store);
        n = ble_desk_format_nets(nets, sizeof(nets), &store);
        check(n > 0 && strcmp(nets, "count=0\n") == 0, "nets empty");
        check(wifi_upsert(&store, "home", "placeholder-pass", "http://10.0.0.8:8787",
                          "placeholder-token") == 0,
              "nets seed home");
        check(wifi_upsert(&store, "cafe", "", "", "") == 0, "nets seed cafe");
        n = ble_desk_format_nets(nets, sizeof(nets), &store);
        check(n > 0 && strcmp(nets, "count=2\n11\thome\n00\tcafe\n") == 0, "nets rows");
        check(strstr(nets, "placeholder-pass") == NULL && strstr(nets, "placeholder-token") == NULL &&
                  strstr(nets, "10.0.0.8") == NULL,
              "nets carries no password, token or url");

        wifi_store_init(&store);
        for (i = 0; i < WIFI_NET_MAX; i++) {
            char ssid[BLE_DESK_SSID_MAX + 1];
            memset(ssid, 'a' + i, BLE_DESK_SSID_MAX);
            ssid[BLE_DESK_SSID_MAX] = '\0';
            check(wifi_upsert(&store, ssid, "placeholder-pass", "http://10.0.0.8:8787",
                              "placeholder-token") == 0,
                  "nets fill");
        }
        n = ble_desk_format_nets(nets, sizeof(nets), &store);
        check(n > 0 && n < BLE_DESK_NETS_TEXT, "eight 32-byte ssids fit the nets text");
        check(strncmp(nets, "count=8\n", 8) == 0, "nets full count");
        check(ble_desk_format_nets(nets, 16, &store) < 0 && nets[0] == '\0',
              "nets refuses a small buffer");
        n = ble_desk_format_nets(nets, sizeof(nets), NULL);
        check(n > 0 && strcmp(nets, "count=0\n") == 0, "nets without a store");
        memcpy(store.nets[0].ssid, "a\nb", 4);
        check(ble_desk_format_nets(nets, sizeof(nets), &store) > 0 && strstr(nets, "\ta?b\n") != NULL,
              "a newline in a saved ssid cannot add a row");
    }
    {
        char name[BLE_DESK_SSID_MAX + 1];
        /* U+1F4F6 is four UTF-8 bytes: eight fill an SSID, nine do not fit. */
        const char *eight = "\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6"
                            "\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6";
        char nine[40];
        snprintf(nine, sizeof(nine), "%s\xf0\x9f\x93\xb6", eight);
        check(ble_desk_parse_forget((const uint8_t *)"home", 4, name, sizeof(name)) == 0 &&
                  strcmp(name, "home") == 0,
              "forget");
        check(ble_desk_parse_forget((const uint8_t *)"home\r\n", 6, name, sizeof(name)) == 0 &&
                  strcmp(name, "home") == 0,
              "forget crlf");
        check(ble_desk_parse_forget((const uint8_t *)"", 0, name, sizeof(name)) != 0, "forget empty");
        check(ble_desk_parse_forget((const uint8_t *)"\n", 1, name, sizeof(name)) != 0,
              "forget only a newline");
        check(ble_desk_parse_forget((const uint8_t *)"ho\nme", 5, name, sizeof(name)) != 0,
              "forget break");
        check(ble_desk_parse_forget((const uint8_t *)"ho\0me", 5, name, sizeof(name)) != 0,
              "forget nul");
        check(ble_desk_parse_forget((const uint8_t *)eight, strlen(eight), name, sizeof(name)) == 0,
              "forget a 32-byte emoji ssid");
        check(ble_desk_parse_forget((const uint8_t *)nine, strlen(nine), name, sizeof(name)) != 0,
              "forget refuses a 36-byte ssid");
    }
    {
        ble_desk_wifi_t req;
        char big[BLE_DESK_WIFI_CFG_MAX + 1];
        int i;

        check(parse_cfg("home\nplaceholder-pass", &req) == 0 && !req.has_cfg &&
                  strcmp(req.ssid, "home") == 0 && strcmp(req.pass, "placeholder-pass") == 0,
              "two-line wifi");
        check(parse_cfg("open\n", &req) == 0 && !req.has_cfg && req.pass[0] == '\0', "open network");
        check(parse_cfg("open\n\n", &req) == 0 && !req.has_cfg && req.pass[0] == '\0',
              "open network and a trailing newline");
        check(parse_cfg("home\nplaceholder-pass\n", &req) == 0 && !req.has_cfg,
              "two lines and a trailing newline");
        check(parse_cfg("home\nplaceholder-pass\nhttp://10.0.0.8:8787\nplaceholder-token", &req) == 0 &&
                  req.has_cfg && strcmp(req.url, "http://10.0.0.8:8787") == 0 &&
                  strcmp(req.token, "placeholder-token") == 0,
              "four lines");
        check(parse_cfg("home\nplaceholder-pass\nhttp://10.0.0.8:8787\nplaceholder-token\n", &req) == 0 &&
                  req.has_cfg && strcmp(req.token, "placeholder-token") == 0,
              "four lines and a trailing newline");
        check(parse_cfg("home\nplaceholder-pass\n\n", &req) == 0 && req.has_cfg && req.url[0] == '\0' &&
                  req.token[0] == '\0',
              "empty url and token clear the slot's own");
        check(parse_cfg("open\n\n\n", &req) == 0 && req.has_cfg && req.pass[0] == '\0',
              "open network with cleared url and token");
        check(parse_cfg("home\nplaceholder-pass\nhttp://x", &req) != 0, "three lines");
        check(parse_cfg("home\nplaceholder-pass\nftp://x\nt", &req) != 0, "bad url");
        check(req.pass[0] == '\0' && req.ssid[0] == '\0', "a refused write leaves no password behind");
        check(parse_cfg("home\nplaceholder-pass\nhttp://x\nt\nextra", &req) != 0, "five lines");
        check(parse_cfg("home\nplaceholder-pass\nhttp://x\nto\rken", &req) != 0, "cr in token");
        check(parse_cfg("home\nshort\nhttp://x\nt", &req) != 0, "short wpa in four lines");

        /* The longest legal write: 32 + 1 + 64 + 1 + 127 + 1 + 127 bytes and a trailing newline. */
        i = 0;
        memset(big + i, 's', 32);
        i += 32;
        big[i++] = '\n';
        memset(big + i, 'p', 64);
        i += 64;
        big[i++] = '\n';
        memcpy(big + i, "http://", 7);
        memset(big + i + 7, 'u', 120);
        i += 127;
        big[i++] = '\n';
        memset(big + i, 't', 127);
        i += 127;
        big[i++] = '\n';
        big[i] = '\0';
        check(i == BLE_DESK_WIFI_CFG_MAX, "the longest write is BLE_DESK_WIFI_CFG_MAX");
        check(parse_cfg(big, &req) == 0 && req.has_cfg, "the longest write parses");

        wifi_store_init(&store);
        check(wifi_upsert(&store, "home", "placeholder-pass", "http://per-net/", "per-token") == 0,
              "apply seed");
        check(parse_cfg("home\nplaceholder-pass-2", &req) == 0 && ble_desk_apply_wifi(&store, &req) == 0,
              "apply two-line");
        check(strcmp(store.nets[0].url, "http://per-net/") == 0 &&
                  strcmp(store.nets[0].token, "per-token") == 0,
              "two-line keeps the slot's url and token");
        check(parse_cfg("home\nplaceholder-pass-2\nhttp://10.0.0.9:8787\nnew-token", &req) == 0 &&
                  ble_desk_apply_wifi(&store, &req) == 0,
              "apply four-line");
        check(store.count == 1 && strcmp(store.nets[0].url, "http://10.0.0.9:8787") == 0 &&
                  strcmp(store.nets[0].token, "new-token") == 0,
              "four-line replaces them in place");
        for (i = 1; i < WIFI_NET_MAX; i++) {
            char ssid[8];
            snprintf(ssid, sizeof(ssid), "n%d", i);
            check(wifi_upsert(&store, ssid, "placeholder-pass", "", "") == 0, "apply fill");
        }
        check(parse_cfg("ninth\nplaceholder-pass\nhttp://x\nt", &req) == 0 &&
                  ble_desk_apply_wifi(&store, &req) != 0,
              "apply refuses a ninth network");
        check(store.count == WIFI_NET_MAX && strcmp(store.nets[0].ssid, "home") == 0,
              "apply refuses a ninth network and keeps the eight");
        check(ble_desk_apply_wifi(NULL, &req) != 0 && ble_desk_apply_wifi(&store, NULL) != 0,
              "apply refuses null");
        check(wifi_remove(&store, "home") == 0 && store.count == WIFI_NET_MAX - 1, "forget frees a slot");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `firmware/host/run.sh`
Expected: `FAIL test_ble_desk` at compile: `unknown type name 'ble_desk_wifi_t'`.

- [ ] **Step 3: Implement the header**

In `firmware/main/ble_desk.h`, extend the characteristic list in the top comment after the `peer` line:

```c
 *   nets    ...19  read: saved networks, flags and SSIDs only
 *   forget  ...1a  write: an SSID to remove from the saved networks
```

and add after that comment's scan/verify paragraph:

```c
 * Nets read is "count=N", then one line per saved slot: two flags, "1" or
 * "0" for the slot's own url and own token, a tab, and the SSID. A CR or LF
 * in a stored SSID is shown as '?'. Never a password, token or url.
 *
 * Wifi write is "ssid\npass", which keeps the slot's own url and token, or
 * "ssid\npass\nurl\ntoken", which replaces them (empty means the global one).
 * Either may end in one newline.
```

After `#define BLE_DESK_UUID_PEER ...` add:

```c
#define BLE_DESK_UUID_NETS "8d7c4b19-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_FORGET "8d7c4b1a-6e2a-4f91-a3c5-67726f6b6465"
```

After `#define BLE_DESK_SCAN_TEXT ...` add:

```c
/* "count=8\n" plus 8 rows of two flags, a tab, a 32-byte SSID and a newline, plus the NUL. */
#define BLE_DESK_NETS_TEXT (8 + WIFI_NET_MAX * (2 + 1 + BLE_DESK_SSID_MAX + 1) + 1)
/* ssid\npass\nurl\ntoken\n at full size: the longest write any characteristic takes. */
#define BLE_DESK_WIFI_CFG_MAX                                                                    \
    (BLE_DESK_SSID_MAX + 1 + BLE_DESK_PASS_MAX + 1 + BLE_DESK_URL_MAX + 1 + BLE_DESK_TOKEN_MAX + 1)
```

Change the ops enum's last line to:

```c
    BLE_DESK_OP_PEER = 8,
    BLE_DESK_OP_NETS = 9,
    BLE_DESK_OP_FORGET = 10
```

After the `ble_desk_ap_t` typedef add:

```c
/* One parsed wifi write. has_cfg is 1 when it carried the slot's own url and token. */
typedef struct {
    char ssid[BLE_DESK_SSID_MAX + 1];
    char pass[BLE_DESK_PASS_MAX + 1];
    char url[BLE_DESK_URL_MAX + 1];
    char token[BLE_DESK_TOKEN_MAX + 1];
    int has_cfg;
} ble_desk_wifi_t;
```

At the end of the header add:

```c
/* NUL-terminated nets body. Length without the NUL, or -1 (out emptied). A NULL store is count=0. */
int ble_desk_format_nets(char *out, size_t cap, const wifi_store_t *store);
/* An SSID of 1 to 32 bytes. One trailing CR/LF run is ignored. Embedded CR, LF or NUL is -1. */
int ble_desk_parse_forget(const uint8_t *in, size_t len, char *ssid, size_t cap);
/* Two or four lines, see above. On -1 *out is zeroed, so no password is left behind. */
int ble_desk_parse_wifi_cfg(const uint8_t *in, size_t len, ble_desk_wifi_t *out);
/* has_cfg writes the slot's url and token too; otherwise ble_desk_upsert_wifi. -1 when full. */
int ble_desk_apply_wifi(wifi_store_t *store, const ble_desk_wifi_t *req);
```

- [ ] **Step 4: Implement the functions**

In `firmware/main/ble_desk.c`, after the scan `_Static_assert` (line 12) add:

```c
_Static_assert(BLE_DESK_NETS_TEXT >= (sizeof("count=8\n") - 1) +
                       WIFI_NET_MAX * (2 + 1 + BLE_DESK_SSID_MAX + 1) + 1,
               "nets text");
```

At the end of `ble_desk.c` add:

```c
int ble_desk_format_nets(char *out, size_t cap, const wifi_store_t *store) {
    char ssid[BLE_DESK_SSID_MAX + 1];
    size_t used;
    int count = 0;
    int n;
    int i;
    if (!out || cap == 0) {
        return -1;
    }
    if (store && store->count > 0) {
        count = store->count > WIFI_NET_MAX ? WIFI_NET_MAX : store->count;
    }
    n = snprintf(out, cap, "count=%d\n", count);
    if (n < 0 || (size_t)n >= cap) {
        out[0] = '\0';
        return -1;
    }
    used = (size_t)n;
    for (i = 0; i < count; i++) {
        const wifi_net_t *net = &store->nets[i];
        clean_field(ssid, sizeof(ssid), net->ssid, "");
        n = snprintf(out + used, cap - used, "%c%c\t%s\n", net->url[0] ? '1' : '0',
                     net->token[0] ? '1' : '0', ssid);
        if (n < 0 || (size_t)n >= cap - used) {
            out[0] = '\0';
            return -1;
        }
        used += (size_t)n;
    }
    return (int)used;
}

int ble_desk_parse_forget(const uint8_t *in, size_t len, char *ssid, size_t cap) {
    size_t n;
    if (strip_tail(in, len, &n) != 0 || has_break(in, n) || n == 0 || n > BLE_DESK_SSID_MAX) {
        return -1;
    }
    return copy_out(ssid, cap, in, n);
}

static int wifi_cfg_fail(ble_desk_wifi_t *out) {
    memset(out, 0, sizeof(*out));
    return -1;
}

int ble_desk_parse_wifi_cfg(const uint8_t *in, size_t len, ble_desk_wifi_t *out) {
    size_t start[5];
    size_t end[5];
    size_t at = 0;
    size_t i;
    int parts = 0;
    if (!out) {
        return -1;
    }
    memset(out, 0, sizeof(*out));
    if (len > 0 && !in) {
        return -1;
    }
    for (i = 0; i <= len; i++) {
        if (i < len && in[i] != '\n') {
            continue;
        }
        if (parts == 5) {
            return -1;
        }
        start[parts] = at;
        end[parts] = i;
        parts++;
        at = i + 1;
    }
    /* One trailing newline ends the write and leaves an empty last part. */
    if ((parts == 3 || parts == 5) && start[parts - 1] == end[parts - 1]) {
        parts--;
    }
    if (parts == 2) {
        if (ble_desk_parse_wifi(in, len, out->ssid, sizeof(out->ssid), out->pass,
                                sizeof(out->pass)) != 0) {
            return wifi_cfg_fail(out);
        }
        return 0;
    }
    if (parts != 4) {
        return -1;
    }
    /* "ssid\npass" is the two-line body; the url and token parts follow it. */
    if (ble_desk_parse_wifi(in, end[1], out->ssid, sizeof(out->ssid), out->pass, sizeof(out->pass)) !=
        0) {
        return wifi_cfg_fail(out);
    }
    if (end[2] > start[2] &&
        ble_desk_parse_url(in + start[2], end[2] - start[2], out->url, sizeof(out->url)) != 0) {
        return wifi_cfg_fail(out);
    }
    if (ble_desk_parse_token(in + start[3], end[3] - start[3], out->token, sizeof(out->token)) != 0) {
        return wifi_cfg_fail(out);
    }
    out->has_cfg = 1;
    return 0;
}

int ble_desk_apply_wifi(wifi_store_t *store, const ble_desk_wifi_t *req) {
    if (!store || !req) {
        return -1;
    }
    if (req->has_cfg) {
        return wifi_upsert(store, req->ssid, req->pass, req->url, req->token);
    }
    return ble_desk_upsert_wifi(store, req->ssid, req->pass);
}
```

`ble_desk_parse_token` with a zero length writes `""` and returns 0, so an empty token part clears.

- [ ] **Step 5: Run to verify it passes**

Run: `firmware/host/run.sh`
Expected: `ok   test_ble_desk` and every other host test `ok`.

- [ ] **Step 6: Commit**

```bash
git add firmware/main/ble_desk.h firmware/main/ble_desk.c firmware/host/test_ble_desk.c
git commit --no-gpg-sign -m "Format saved networks and parse forget and per-network wifi"
```

---

### Task 3: nets and forget characteristics, and the longer wifi write

**Files:**

- Modify: `firmware/main/ble_link.c:40-41` (write max), `:145-147` (scratch after `s_probe_text`), `:166-196` (UUIDs), `:204-266` (GATT table), `:644-659` (`write_wifi`), `:675-729` (`access`), `:1041-1059` (`ble_link_host_start`)
- Modify: `firmware/README.md:103-118` (pairing paragraph, characteristic table)

**Interfaces:**

- Consumes: everything Task 2 produces; `net_save` (`net.h`), `wifi_remove`.
- Produces: GATT characteristics `nets` (`8d7c4b19-...`, read, authenticated) and `forget` (`8d7c4b1a-...`, write, authenticated); `wifi` accepts up to `BLE_DESK_WIFI_CFG_MAX` (355) bytes as a long write.

- [ ] **Step 1: Record the static RAM baseline**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build >/dev/null && idf.py size 2>&1 | tee /tmp/calico-size-before.txt | grep -iE "dram|diram|\.bss|\.data"`
Expected: the DRAM/DIRAM used bytes and the `.data` and `.bss` sizes. Keep the file.

- [ ] **Step 2: Raise the write limit**

Replace `ble_link.c:40-41` with:

```c
/* The longest write is wifi with this network's own url and token (355 bytes).
 * That is longer than one ATT packet, so the central sends it as a long write:
 * at MTU 256 two of the four prepare entries (CONFIG_BT_NIMBLE_ATT_MAX_PREP_ENTRIES). */
#define BLE_LINK_WRITE_MAX BLE_DESK_WIFI_CFG_MAX
_Static_assert(BLE_LINK_WRITE_MAX >= 160, "a write still fits a url, a token and a two-line wifi");
```

- [ ] **Step 3: Add the PSRAM scratch**

After `static char s_probe_text[BLE_LINK_PROBE_TEXT];` add:

```c
/* GATT access runs only on the NimBLE host task, so one scratch serves every write and the
 * nets read. It is PSRAM, allocated once at host start: on the host task's 6144-byte internal
 * stack the 355-byte write, the parsed network and the nets text would take about 1 KB of
 * headroom, and as static .bss they would take internal RAM the station needs. */
typedef struct {
    uint8_t write[BLE_LINK_WRITE_MAX];
    ble_desk_wifi_t wifi;
    char nets[BLE_DESK_NETS_TEXT];
} ble_link_scratch_t;
static ble_link_scratch_t *s_scratch;
```

- [ ] **Step 4: Add the UUIDs and GATT entries**

Change the UUID comment's list (line 167-168) to end `0x18 peer, 0x19 nets, 0x1a forget.` After `s_uuid_peer` add:

```c
static const ble_uuid128_t s_uuid_nets =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x19,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_forget =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x1a,
                     0x4b, 0x7c, 0x8d);
```

In `s_svcs`, after the `peer` entry and before the `{ 0, }` terminator, add:

```c
                {
                    .uuid = &s_uuid_nets.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_NETS,
                    .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_AUTHEN,
                },
                {
                    .uuid = &s_uuid_forget.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_FORGET,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
```

- [ ] **Step 5: Replace write_wifi, add read_nets and write_forget**

Replace `write_wifi` (lines 644-659) with:

```c
static int write_wifi(const uint8_t *buf, uint16_t len) {
    ble_desk_wifi_t *req = &s_scratch->wifi;
    int rc;
    if (!s_store || ble_desk_parse_wifi_cfg(buf, len, req) != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    rc = ble_desk_apply_wifi(s_store, req);
    if (rc == 0) {
        net_save(s_store);
    }
    ble_link_leave();
    if (rc == 0) {
        ESP_LOGI(TAG, "wifi %s%s", req->ssid, req->has_cfg ? ", own url and token" : "");
    }
    memset(req, 0, sizeof(*req));
    return rc == 0 ? 0 : BLE_ATT_ERR_UNLIKELY;
}

static int read_nets(struct os_mbuf *om) {
    int n;
    if (!s_scratch) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    ble_link_enter();
    n = ble_desk_format_nets(s_scratch->nets, sizeof(s_scratch->nets), s_store);
    ble_link_leave();
    return append_text(om, s_scratch->nets, n);
}

/* An SSID that is not saved is still success: a retried forget must not look like a failure. */
static int write_forget(const uint8_t *buf, uint16_t len) {
    char ssid[BLE_DESK_SSID_MAX + 1];
    int removed;
    if (!s_store || ble_desk_parse_forget(buf, len, ssid, sizeof(ssid)) != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    removed = wifi_remove(s_store, ssid) == 0;
    if (removed) {
        net_save(s_store);
    }
    ble_link_leave();
    if (removed) {
        ESP_LOGI(TAG, "forget %s", ssid);
    }
    return 0;
}
```

- [ ] **Step 6: Route them in access()**

In `access`, replace `uint8_t buf[BLE_LINK_WRITE_MAX];` with `uint8_t *buf;`. In the read branch, before `return BLE_ATT_ERR_READ_NOT_PERMITTED;`, add:

```c
        if (op == BLE_DESK_OP_NETS) {
            return read_nets(ctxt->om);
        }
```

Replace `rc = read_flat(ctxt->om, buf, &len);` with:

```c
    if (!s_scratch) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    buf = s_scratch->write;
    rc = read_flat(ctxt->om, buf, &len);
```

and before the final `return BLE_ATT_ERR_UNLIKELY;` add:

```c
    if (op == BLE_DESK_OP_FORGET) {
        return write_forget(buf, len);
    }
```

- [ ] **Step 7: Allocate the scratch at host start**

In `ble_link_host_start`, right after `s_host_up = 1;`, add:

```c
    /* Before the host task can call access(). PSRAM: see ble_link_scratch_t. */
    s_scratch = heap_caps_calloc(1, sizeof(*s_scratch), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_scratch) {
        ESP_LOGE(TAG, "GATT scratch PSRAM missing: writes and nets are refused");
    }
```

- [ ] **Step 8: Build and compare static RAM**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|warning:.*ble_link|Project build complete" && idf.py size 2>&1 | tee /tmp/calico-size-after.txt | grep -iE "dram|diram|\.bss|\.data"`
Expected: `Project build complete`, no ble_link warning, and internal DRAM `.data` + `.bss` within 64 bytes of `/tmp/calico-size-before.txt` (the only new static is the 4-byte `s_scratch` pointer). Over 64 bytes: stop and report the two files.

- [ ] **Step 9: Host and script checks**

Run: `firmware/host/run.sh && python3 -m pytest -q firmware/scripts/test_ble_provision.py`
Expected: all `ok`; pytest passes (it checks `ble_link_host_start` keeps `start_scan_task` before `start_reboot_task` and that no write creates a task).

- [ ] **Step 10: Document the characteristics**

In `firmware/README.md`, in the pairing paragraph (line 103), change "Writes, scans and the full status need the paired link." to "Writes, scans, the network list and the full status need the paired link." Replace the `wifi` row and add two rows after `peer` in the table at lines 109-118:

```markdown
| wifi | `8d7c4b14-6e2a-4f91-a3c5-67726f6b6465` | write | `SSID\npassword`, which keeps this network's own URL and token, or `SSID\npassword\nurl\ntoken`, which sets them (empty uses the global one). Empty password is an open network. Optional trailing newline. The four-line form can be 355 bytes: a long write |
| nets | `8d7c4b19-6e2a-4f91-a3c5-67726f6b6465` | read | `count=N`, then per saved network two flags (`1` or `0`: own URL, own token), a tab, and the SSID. At most 8 rows, 297 bytes. Never a password, token, or URL |
| forget | `8d7c4b1a-6e2a-4f91-a3c5-67726f6b6465` | write | an SSID to remove from the saved networks. Optional trailing newline. An SSID that is not saved is not an error. The panel stays on its current network until it restarts |
```

Add after the table's following paragraph (after line 120):

```markdown
`nets`, `forget`, and the parsed `wifi` write share one PSRAM scratch allocated at host start, so they take no internal RAM and do not grow the 6144-byte host stack. A four-line `wifi` write is longer than one packet at MTU 256; BlueZ sends it as a prepared (long) write, which needs at most 3 of the 4 prepare entries even at the minimum MTU of 130. There is no USB console in this firmware yet: `docs/usb-console-protocol.md` describes the same commands for when there is.
```

Run: `pnpm exec prettier --write firmware/README.md`

- [ ] **Step 11: Commit**

```bash
git add firmware/main/ble_link.c firmware/README.md
git commit --no-gpg-sign -m "Add nets and forget characteristics and a per-network wifi write"
```

---

### Task 4: Shared panel field checks and the new commands

**Files:**

- Create: `src/shared/panel-fields.ts`
- Modify: `src/renderer/src/device/commands.ts:1-4,21-32,40-106` (limits, `Cmd`, `Reply`, validators, `secretsOf`), add `PanelNet` and `parseNets`
- Test: `src/renderer/src/device/commands.test.ts`

**Interfaces:**

- Produces in `src/shared/panel-fields.ts`: `SSID_MAX = 32`, `PASS_MAX = 64`, `URL_MAX = 127`, `TOKEN_MAX = 127`, `NETWORKS_MAX = 8`, `class FieldError extends Error`, `checkSsid(ssid: string): void`, `checkPass(pass: string): void`, `checkUrl(url: string): void`, `checkToken(token: string): void` (each throws `FieldError` with a message that never contains the value).
- Produces in `commands.ts`: re-exports of the above constants and `FieldError`; `Cmd` gains `{ op: "wifi"; ssid: string; pass: string; url?: string; token?: string }`, `{ op: "nets" }`, `{ op: "forget"; ssid: string }`; `interface PanelNet { ssid: string; has_url: boolean; has_token: boolean }`; `Reply` ok branch gains `nets?: PanelNet[]`; `parseNets(body: string): PanelNet[]`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/device/commands.test.ts`, change the import block to:

```ts
import { describe, expect, it } from "vitest";
import desk from "../../../../firmware/main/ble_desk.h?raw";
import store from "../../../../firmware/main/wifi_store.h?raw";
import {
  describeProbeFailure,
  FieldError,
  infoFromKv,
  NETWORKS_MAX,
  PASS_MAX,
  parseKv,
  parseNets,
  parseProbe,
  parseScan,
  secretsOf,
  SSID_MAX,
  timeoutFor,
  TOKEN_MAX,
  URL_MAX,
  validateCmd,
} from "./commands";
```

Add these entries to the `rejects %j` list:

```ts
    { op: "wifi", ssid: "home", pass: "", url: "ftp://x" },
    { op: "wifi", ssid: "home", pass: "", token: "t".repeat(128) },
    { op: "wifi", ssid: "home", pass: "placeholder-pass\n" },
    { op: "forget", ssid: "" },
    { op: "forget", ssid: "s".repeat(33) },
```

and these to the `accepts %j` list:

```ts
    { op: "wifi", ssid: "home", pass: "placeholder-pass", url: "", token: "" },
    { op: "wifi", ssid: "home", pass: "", url: "http://10.0.0.8:8787" },
    { op: "nets" },
    { op: "forget", ssid: "home" },
```

Add to the `validateCmd` describe:

```ts
it("counts emoji SSIDs in bytes", () => {
  const signal = "\u{1F4F6}";
  expect(() =>
    validateCmd({ op: "forget", ssid: signal.repeat(8) }),
  ).not.toThrow();
  expect(() => validateCmd({ op: "forget", ssid: signal.repeat(9) })).toThrow(
    FieldError,
  );
});

it("never puts the refused value in the message", () => {
  try {
    validateCmd({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass\n",
      token: "placeholder-token",
    });
  } catch (err) {
    expect((err as Error).message).not.toContain("placeholder");
    return;
  }
  throw new Error("expected a FieldError");
});

it("uses the firmware's limits", () => {
  expect(desk).toContain(`#define BLE_DESK_SSID_MAX ${SSID_MAX}`);
  expect(desk).toContain(`#define BLE_DESK_PASS_MAX ${PASS_MAX}`);
  expect(desk).toContain(`#define BLE_DESK_URL_MAX ${URL_MAX}`);
  expect(desk).toContain(`#define BLE_DESK_TOKEN_MAX ${TOKEN_MAX}`);
  expect(store).toContain(`#define WIFI_NET_MAX ${NETWORKS_MAX}`);
});
```

Add to the `parsers` describe:

```ts
it("reads the panel's networks", () => {
  expect(
    parseNets("count=3\n11\thome\n00\tcafe\tcorner\n10\tlab\r\nxx\tbad\n"),
  ).toEqual([
    { ssid: "home", has_url: true, has_token: true },
    { ssid: "cafe\tcorner", has_url: false, has_token: false },
    { ssid: "lab", has_url: true, has_token: false },
  ]);
  expect(parseNets("count=0\n")).toEqual([]);
});

it("keeps at most eight networks", () => {
  const rows = Array.from({ length: 10 }, (_, i) => `00\tn${i}`).join("\n");
  expect(parseNets(`count=10\n${rows}\n`)).toHaveLength(8);
});

it("treats the network token as a secret", () => {
  expect(
    secretsOf({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass",
      token: "placeholder-token",
    }),
  ).toEqual(["placeholder-pass", "placeholder-token"]);
  expect(secretsOf({ op: "wifi", ssid: "open", pass: "" })).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/renderer/src/device/commands.test.ts`
Expected: FAIL, `parseNets` and `NETWORKS_MAX` are not exported.

- [ ] **Step 3: Create the shared checks**

`src/shared/panel-fields.ts`:

```ts
// The panel's field limits (firmware/main/ble_desk.h, wifi_store.h), in bytes.
// Main checks the vault with these and the renderer checks every command with them.
export const SSID_MAX = 32;
export const PASS_MAX = 64;
export const URL_MAX = 127;
export const TOKEN_MAX = 127;
export const NETWORKS_MAX = 8;

/** A field the panel would refuse. The message names the field, never its value. */
export class FieldError extends Error {}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function noBreaks(value: string, label: string): void {
  if (/[\r\n\0]/.test(value))
    throw new FieldError(`${label} cannot contain a newline or NUL.`);
}

export function checkSsid(ssid: string): void {
  noBreaks(ssid, "SSID");
  if (!ssid) throw new FieldError("SSID is required.");
  if (bytes(ssid) > SSID_MAX)
    throw new FieldError(`SSID must be at most ${SSID_MAX} bytes.`);
}

export function checkPass(pass: string): void {
  noBreaks(pass, "Password");
  const n = bytes(pass);
  if (n > PASS_MAX)
    throw new FieldError(`Password must be at most ${PASS_MAX} bytes.`);
  if (n > 0 && n < 8)
    throw new FieldError(
      "Password must be empty (open network) or 8 to 64 bytes.",
    );
}

export function checkUrl(url: string): void {
  noBreaks(url, "URL");
  const ok =
    (url.startsWith("http://") && url.length > 7) ||
    (url.startsWith("https://") && url.length > 8);
  if (!ok)
    throw new FieldError(
      "URL must start with http:// or https:// and name a host.",
    );
  if (bytes(url) > URL_MAX)
    throw new FieldError(`URL must be at most ${URL_MAX} bytes.`);
}

export function checkToken(token: string): void {
  noBreaks(token, "Token");
  if (bytes(token) > TOKEN_MAX)
    throw new FieldError(`Token must be at most ${TOKEN_MAX} bytes.`);
}
```

- [ ] **Step 4: Rewire commands.ts**

Replace lines 1-4 of `commands.ts` with:

```ts
import {
  checkPass,
  checkSsid,
  checkToken,
  checkUrl,
  NETWORKS_MAX,
} from "../../../shared/panel-fields";

export {
  FieldError,
  NETWORKS_MAX,
  PASS_MAX,
  SSID_MAX,
  TOKEN_MAX,
  URL_MAX,
} from "../../../shared/panel-fields";
```

Replace the `Cmd` and `Reply` types with:

```ts
export interface PanelNet {
  ssid: string;
  has_url: boolean;
  has_token: boolean;
}

export type Cmd =
  | { op: "status" }
  | { op: "scan" }
  | { op: "verify"; ssid: string; pass: string }
  // url and token travel together: sending either writes both to this network's slot.
  | { op: "wifi"; ssid: string; pass: string; url?: string; token?: string }
  | { op: "url"; value: string }
  | { op: "token"; value: string }
  | { op: "reboot" }
  | { op: "nets" }
  | { op: "forget"; ssid: string };

export type Reply =
  | { ok: true; info?: DeskInfo; aps?: Ap[]; nets?: PanelNet[] }
  | { ok: false; error: string; reason?: ProbeReason };
```

Delete the old `export class FieldError`, `bytes`, `noBreaks`, `checkSsid`, `checkPass` (lines 40-65) and replace `validateCmd` and `secretsOf` with:

```ts
export function validateCmd(cmd: Cmd): void {
  switch (cmd.op) {
    case "url":
      checkUrl(cmd.value);
      return;
    case "token":
      checkToken(cmd.value);
      return;
    case "verify":
      checkSsid(cmd.ssid);
      checkPass(cmd.pass);
      return;
    case "wifi":
      checkSsid(cmd.ssid);
      checkPass(cmd.pass);
      // An empty URL means this network uses the panel's global one.
      if (cmd.url) checkUrl(cmd.url);
      if (cmd.token !== undefined) checkToken(cmd.token);
      return;
    case "forget":
      checkSsid(cmd.ssid);
      return;
    default:
      return;
  }
}
```

```ts
export function secretsOf(cmd: Cmd): string[] {
  if (cmd.op === "verify") return cmd.pass ? [cmd.pass] : [];
  if (cmd.op === "wifi") return [cmd.pass, cmd.token ?? ""].filter(Boolean);
  if (cmd.op === "token") return cmd.value ? [cmd.value] : [];
  return [];
}
```

After `parseScan` add:

```ts
/** The panel's nets read: "count=N", then "<url><token>\t<ssid>" with 1 or 0 flags. */
export function parseNets(body: string): PanelNet[] {
  const nets: PanelNet[] = [];
  for (const line of body.split("\n")) {
    const tab = line.indexOf("\t");
    const flags = line.slice(0, tab);
    const ssid = line.slice(tab + 1).replace(/\r$/, "");
    if (tab !== 2 || !/^[01]{2}$/.test(flags) || !ssid) continue;
    nets.push({
      ssid,
      has_url: flags[0] === "1",
      has_token: flags[1] === "1",
    });
  }
  return nets.slice(0, NETWORKS_MAX);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test src/renderer/src/device && pnpm typecheck`
Expected: PASS. The old `url` error messages are unchanged, so `ble.test.ts` and `usb.test.ts` still pass.

- [ ] **Step 6: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/shared/panel-fields.ts src/renderer/src/device/commands.ts src/renderer/src/device/commands.test.ts
git add src/shared/panel-fields.ts src/renderer/src/device/commands.ts src/renderer/src/device/commands.test.ts
git commit --no-gpg-sign -m "Share the panel's field checks and add nets and forget commands"
```

---

### Task 5: nets, forget and per-network wifi over Bluetooth and USB

**Files:**

- Modify: `src/renderer/src/device/ble.ts:1-30` (imports, `UUID`), `:64-72` (`send`), `:95-97` (`wifi` case), add `nets` and `forget` cases
- Modify: `src/renderer/src/device/usb.ts:1-11,50-60` (`toReply`)
- Modify: `docs/usb-console-protocol.md` (requests table)
- Test: `src/renderer/src/device/ble.test.ts`, `src/renderer/src/device/usb.test.ts`

**Interfaces:**

- Consumes: `Cmd`, `PanelNet`, `parseNets`, `NETWORKS_MAX` (Task 4); the UUID defines (Task 2).
- Produces in `ble.ts`: `UUID.nets`, `UUID.forget`, `wifiBody(cmd: Extract<Cmd, { op: "wifi" }>): string`, `OLD_FIRMWARE: string`. `UsbLink` replies carry `nets`.

- [ ] **Step 1: Write the failing BLE tests**

In `ble.test.ts`, add `OLD_FIRMWARE` and `wifiBody` to the import from `./ble`, and add inside `describe("BleLink", ...)`:

```ts
it("writes a password with quotes and non-ASCII as raw UTF-8", async () => {
  const { gatt, writes } = fakeGatt({});
  const pass = 'pla"ce\\hölder';
  await new BleLink(gatt, instant).send({ op: "wifi", ssid: "café", pass });
  expect(writes).toEqual([[UUID.wifi, `café\n${pass}`]]);
});

it("adds the network's own URL and token as two more lines", async () => {
  const { gatt, writes } = fakeGatt({});
  await new BleLink(gatt, instant).send({
    op: "wifi",
    ssid: "home",
    pass: "placeholder-pass",
    url: "http://10.0.0.8:8787",
    token: "placeholder-token",
  });
  expect(writes).toEqual([
    [
      UUID.wifi,
      "home\nplaceholder-pass\nhttp://10.0.0.8:8787\nplaceholder-token",
    ],
  ]);
});

it("sends both lines when only one is given, so the other clears", () => {
  expect(
    wifiBody({ op: "wifi", ssid: "home", pass: "", url: "http://h" }),
  ).toBe("home\n\nhttp://h\n");
  expect(wifiBody({ op: "wifi", ssid: "home", pass: "" })).toBe("home\n");
});

it("refuses a password with a newline before anything is sent", async () => {
  const { gatt, writes } = fakeGatt({});
  const reply = await new BleLink(gatt, instant).send({
    op: "wifi",
    ssid: "home",
    pass: "placeholder\npass",
  });
  expect(reply.ok).toBe(false);
  expect(writes).toEqual([]);
});

it("reads the panel's networks", async () => {
  const { gatt } = fakeGatt({
    [UUID.nets]: ["count=2\n11\thome\n00\tcafe\n"],
  });
  expect(await new BleLink(gatt, instant).send({ op: "nets" })).toEqual({
    ok: true,
    nets: [
      { ssid: "home", has_url: true, has_token: true },
      { ssid: "cafe", has_url: false, has_token: false },
    ],
  });
});

it("forgets one network by its SSID", async () => {
  const { gatt, writes } = fakeGatt({});
  expect(
    await new BleLink(gatt, instant).send({ op: "forget", ssid: "home" }),
  ).toEqual({ ok: true });
  expect(writes).toEqual([[UUID.forget, "home"]]);
});

it("says the firmware is too old when the panel lacks the characteristic", async () => {
  const gatt: Gatt = {
    async read() {
      throw Object.assign(new Error("No Characteristics matching UUID"), {
        name: "NotFoundError",
      });
    },
    async write() {},
    disconnect() {},
  };
  expect(await new BleLink(gatt, instant).send({ op: "nets" })).toEqual({
    ok: false,
    error: OLD_FIRMWARE,
  });
});
```

`matches the firmware's UUIDs` now also checks `BLE_DESK_UUID_NETS` and `BLE_DESK_UUID_FORGET`.

- [ ] **Step 2: Write the failing USB tests**

In `usb.test.ts`, add inside `describe("UsbLink", ...)`:

```ts
it("frames a password with quotes, a backslash and non-ASCII as one JSON line", async () => {
  const { usb, sent } = link();
  const pass = 'pla"ce\\hölder';
  const pending = usb.send({
    op: "wifi",
    ssid: "café",
    pass,
    url: "http://10.0.0.8:8787",
    token: "placeholder-token",
  });
  await Promise.resolve();
  expect(sent).toHaveLength(1);
  const line = sent[0] ?? "";
  expect(line.endsWith("\n")).toBe(true);
  expect(line.slice(0, -1)).not.toContain("\n");
  expect(JSON.parse(line)).toEqual({
    id: 1,
    op: "wifi",
    ssid: "café",
    pass,
    url: "http://10.0.0.8:8787",
    token: "placeholder-token",
  });
  usb.handleLine('{"id":1,"ok":true}');
  expect(await pending).toEqual({ ok: true });
});

it("refuses a password with a newline before anything is sent", async () => {
  const { usb, sent } = link();
  const reply = await usb.send({
    op: "wifi",
    ssid: "home",
    pass: "placeholder\npass",
  });
  expect(reply.ok).toBe(false);
  expect(sent).toEqual([]);
});

it("redacts a network token the device echoes", async () => {
  const { usb, logs } = link();
  const pending = usb.send({
    op: "wifi",
    ssid: "home",
    pass: "",
    token: "placeholder-token",
  });
  await Promise.resolve();
  usb.handleLine("I (5) desk: token placeholder-token");
  usb.handleLine('{"id":1,"ok":true}');
  await pending;
  expect(logs).toEqual(["I (5) desk: token ••••"]);
});
```

and a new describe at the end:

```ts
describe("toReply nets", () => {
  it("keeps only well-formed rows, at most eight, and never more than flags", () => {
    const rows = [
      { ssid: "home", has_url: true, has_token: false, token: "x" },
      { ssid: "", has_url: true, has_token: true },
      "junk",
      ...Array.from({ length: 9 }, (_, i) => ({ ssid: `n${i}` })),
    ];
    const reply = toReply({ ok: true, nets: rows });
    expect(reply.ok && reply.nets?.[0]).toEqual({
      ssid: "home",
      has_url: true,
      has_token: false,
    });
    expect(reply.ok && reply.nets).toHaveLength(8);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test src/renderer/src/device`
Expected: FAIL, `wifiBody` and `OLD_FIRMWARE` not exported, `UUID.nets` undefined, `toReply` drops `nets`.

- [ ] **Step 4: Implement BLE**

In `ble.ts`, add `parseNets` to the import from `./commands`. Add to `UUID` after `peer`:

```ts
  nets: "8d7c4b19-6e2a-4f91-a3c5-67726f6b6465",
  forget: "8d7c4b1a-6e2a-4f91-a3c5-67726f6b6465",
```

After `requirePairing` add:

```ts
export const OLD_FIRMWARE =
  "This panel's firmware cannot do that yet. Flash the latest firmware, then connect again.";

/** `ssid\npass`, or `ssid\npass\nurl\ntoken` to set this network's own URL and token (firmware ble_desk_parse_wifi_cfg). */
export function wifiBody(cmd: Extract<Cmd, { op: "wifi" }>): string {
  if (cmd.url === undefined && cmd.token === undefined)
    return `${cmd.ssid}\n${cmd.pass}`;
  return `${cmd.ssid}\n${cmd.pass}\n${cmd.url ?? ""}\n${cmd.token ?? ""}`;
}
```

In `send`, between the `FieldError` line and the `Bluetooth:` line, add:

```ts
// A characteristic the panel does not have: firmware from before that command.
if ((err as Error).name === "NotFoundError")
  return { ok: false, error: OLD_FIRMWARE };
```

Replace the `wifi` case and add two cases in `run`:

```ts
      case "wifi":
        await this.gatt.write(UUID.wifi, encode(wifiBody(cmd)));
        return { ok: true };
      case "nets":
        return { ok: true, nets: parseNets(await this.gatt.read(UUID.nets)) };
      case "forget":
        await this.gatt.write(UUID.forget, encode(cmd.ssid));
        return { ok: true };
```

- [ ] **Step 5: Implement USB**

In `usb.ts`, add `NETWORKS_MAX` and `type PanelNet` to the import from `./commands`, and in `toReply` after the `aps` block add:

```ts
if (Array.isArray(obj.nets)) {
  reply.nets = obj.nets
    .flatMap((n): PanelNet[] => {
      if (!n || typeof n !== "object") return [];
      const { ssid, has_url, has_token } = n as Record<string, unknown>;
      return typeof ssid === "string" && ssid
        ? [{ ssid, has_url: has_url === true, has_token: has_token === true }]
        : [];
    })
    .slice(0, NETWORKS_MAX);
}
```

- [ ] **Step 6: Update the USB protocol**

In `docs/usb-console-protocol.md`, replace the `wifi` row and add two rows after `reboot`:

```markdown
| `wifi` | `ssid`, `pass`, optional `url`, `token` | Same as the BLE `wifi` write. Without `url` and `token`: update the password of an existing SSID and keep its url and token, or append a new one. With either: write both to that network's slot, a missing one as `""` (the global value). A full panel (8 networks) is `ok: false`. |
| `nets` | none | Reply with `nets`: up to 8 `{"ssid": "home", "has_url": true, "has_token": false}`, in slot order. Never a password, token, or URL. |
| `forget` | `ssid` | Remove that saved network. An SSID that is not saved is still `ok: true`. The panel stays on its current network until it restarts. |
```

Run: `pnpm exec prettier --write docs/usb-console-protocol.md`

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm test src/renderer/src/device && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write src/renderer/src/device/ble.ts src/renderer/src/device/ble.test.ts src/renderer/src/device/usb.ts src/renderer/src/device/usb.test.ts
git add src/renderer/src/device/ble.ts src/renderer/src/device/ble.test.ts src/renderer/src/device/usb.ts src/renderer/src/device/usb.test.ts docs/usb-console-protocol.md
git commit --no-gpg-sign -m "Send nets, forget and per-network wifi over Bluetooth and USB"
```

---

### Task 6: The vault in the main process

**Files:**

- Create: `src/main/networks.ts`, `test/main/networks.test.ts`
- Modify: `src/server/state-file.ts:1-13` (`writeAtomic`), `test/server/state-file.test.ts`
- Modify: `src/shared/ipc.ts:90-114` (types and `CalicoApi`), `src/preload/index.ts:13-36`, `src/main/ipc.ts:27-58`, `src/main/index.ts:3,176-204`

**Interfaces:**

- Consumes: `checkSsid`, `checkPass`, `checkUrl`, `checkToken`, `FieldError`, `NETWORKS_MAX` (Task 4); `writeAtomic`.
- Produces in `src/shared/ipc.ts`:
  - `interface SavedNetwork { ssid: string; url: string; password_set: boolean; token_set: boolean }`
  - `interface NetworkInput { ssid: string; url: string; password?: string; token?: string; edit: boolean }` (absent password or token keeps the saved one; `""` clears)
  - `interface NetworksState { networks: SavedNetwork[]; error: string; notice: string }`
  - `CalicoApi.networksList(): Promise<NetworksState>`, `networksSave(input: NetworkInput): Promise<NetworksState>`, `networksRemove(ssid: string): Promise<NetworksState>`; IPC channels `networks:list`, `networks:save`, `networks:remove`.
- Produces in `src/main/networks.ts`: `interface SecretBox { backend(): string; available(): boolean; encrypt(text: string): Buffer }`, `class NetworkVault { constructor(path: string, box: SecretBox); list(): NetworksState; save(raw: unknown): NetworksState; remove(raw: unknown): NetworksState }`, `NO_KEYRING`, `PLAINTEXT_KEYRING`, `parseNetworks(value: unknown)`.

- [ ] **Step 1: Write the failing writeAtomic test**

In `test/server/state-file.test.ts`, add `chmodSync` to the `node:fs` import, add `writeAtomic` to the import from `../../src/server/state-file`, and add:

```ts
describe("writeAtomic", () => {
  it("writes 0600 even over a stale world-readable temp file", () => {
    const path = join(dir(), "networks.json");
    writeFileSync(`${path}.tmp`, "old");
    chmodSync(`${path}.tmp`, 0o644);
    writeAtomic(path, "{}");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing vault tests**

`test/main/networks.test.ts`:

```ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NetworkVault,
  NO_KEYRING,
  PLAINTEXT_KEYRING,
  type SecretBox,
} from "../../src/main/networks";

const PASS = "placeholder-pass";
const TOKEN = "placeholder-token";

function box(backend = "gnome_libsecret", available = true) {
  const seen: string[] = [];
  const fake: SecretBox = {
    backend: () => backend,
    available: () => available,
    encrypt: (text) => {
      seen.push(text);
      return Buffer.from(`sealed-${seen.length}`);
    },
  };
  return { fake, seen };
}

const file = () =>
  join(mkdtempSync(join(tmpdir(), "calico-nets-")), "networks.json");
const home = { ssid: "home", url: "", edit: false };

describe("NetworkVault", () => {
  it("starts empty when there is no file", () => {
    expect(new NetworkVault(file(), box().fake).list()).toEqual({
      networks: [],
      error: "",
      notice: "",
    });
  });

  it("saves a network 0600 with the password sealed and gives the window only flags", () => {
    const path = file();
    const state = new NetworkVault(path, box().fake).save({
      ssid: "home",
      url: "http://10.0.0.8:8787",
      password: PASS,
      token: TOKEN,
      edit: false,
    });
    expect(state).toEqual({
      networks: [
        {
          ssid: "home",
          url: "http://10.0.0.8:8787",
          password_set: true,
          token_set: true,
        },
      ],
      error: "",
      notice: "",
    });
    const text = readFileSync(path, "utf8");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(text).not.toContain(PASS);
    expect(JSON.parse(text).networks[0]).toEqual({
      ssid: "home",
      url: "http://10.0.0.8:8787",
      token: TOKEN,
      password: Buffer.from("sealed-1").toString("base64"),
    });
    const sent = JSON.stringify(state);
    expect(sent).not.toContain(PASS);
    expect(sent).not.toContain(TOKEN);
    expect(sent).not.toContain(Buffer.from("sealed-1").toString("base64"));
  });

  it("refuses a password on the basic_text backend", () => {
    const path = file();
    const { fake, seen } = box("basic_text");
    const state = new NetworkVault(path, fake).save({
      ...home,
      password: PASS,
    });
    expect(state.error).toBe(PLAINTEXT_KEYRING);
    expect(state.networks).toEqual([]);
    expect(seen).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a password when encryption is unavailable", () => {
    for (const { fake } of [box("gnome_libsecret", false), box("unknown")]) {
      const path = file();
      const state = new NetworkVault(path, fake).save({
        ...home,
        password: PASS,
      });
      expect(state.error).toBe(NO_KEYRING);
      expect(existsSync(path)).toBe(false);
    }
  });

  it("saves an open network without a keyring", () => {
    const state = new NetworkVault(file(), box("basic_text").fake).save({
      ...home,
      password: "",
    });
    expect(state.error).toBe("");
    expect(state.networks[0]?.password_set).toBe(false);
  });

  it("keeps the password and token when an edit leaves them out, and clears them on empty", () => {
    const { fake, seen } = box();
    const vault = new NetworkVault(file(), fake);
    vault.save({ ...home, password: PASS, token: TOKEN });
    let state = vault.save({ ssid: "home", url: "http://h", edit: true });
    expect(state.networks[0]).toEqual({
      ssid: "home",
      url: "http://h",
      password_set: true,
      token_set: true,
    });
    expect(seen).toEqual([PASS]);
    state = vault.save({ ...home, edit: true, password: "", token: "" });
    expect(state.networks[0]?.password_set).toBe(false);
    expect(state.networks[0]?.token_set).toBe(false);
  });

  it("refuses a duplicate and keeps case-differing SSIDs", () => {
    const vault = new NetworkVault(file(), box().fake);
    vault.save({ ...home, password: "" });
    expect(vault.save({ ...home, password: "" }).error).toMatch(
      /already saved/,
    );
    const state = vault.save({ ...home, ssid: "Home", password: "" });
    expect(state.error).toBe("");
    expect(state.networks.map((n) => n.ssid)).toEqual(["home", "Home"]);
    expect(vault.save({ ...home, ssid: "gone", edit: true }).error).toMatch(
      /not saved/,
    );
  });

  it("counts SSID bytes, not characters", () => {
    const vault = new NetworkVault(file(), box().fake);
    const signal = "\u{1F4F6}";
    expect(
      vault.save({ ...home, ssid: signal.repeat(9), password: PASS }).error,
    ).toMatch(/at most 32 bytes/);
    expect(
      vault.save({ ...home, ssid: signal.repeat(8), password: "" }).error,
    ).toBe("");
  });

  it("refuses a ninth network", () => {
    const path = file();
    const vault = new NetworkVault(path, box().fake);
    for (let i = 0; i < 8; i++)
      vault.save({ ...home, ssid: `n${i}`, password: "" });
    const state = vault.save({ ...home, ssid: "ninth", password: "" });
    expect(state.error).toMatch(/holds 8 networks/);
    expect(JSON.parse(readFileSync(path, "utf8")).networks).toHaveLength(8);
  });

  it("encrypts a password with quotes and non-ASCII exactly, and refuses a newline without echoing it", () => {
    const { fake, seen } = box();
    const vault = new NetworkVault(file(), fake);
    const quoted = 'pla"ce\\hölder';
    expect(vault.save({ ...home, password: quoted }).error).toBe("");
    expect(seen).toEqual([quoted]);
    const state = vault.save({
      ...home,
      ssid: "other",
      password: `${PASS}\nx`,
    });
    expect(state.error).toBe("Password cannot contain a newline or NUL.");
    expect(state.error).not.toContain(PASS);
  });

  it("refuses input that is not a network", () => {
    const vault = new NetworkVault(file(), box().fake);
    expect(vault.save(null).error).toBe("That network could not be saved.");
    expect(vault.save({ ...home, password: 7 }).error).toBe(
      "That network could not be saved.",
    );
    expect(vault.remove(3).error).toBe("That network could not be removed.");
  });

  it("removes a network, and removing it again is not an error", () => {
    const path = file();
    const vault = new NetworkVault(path, box().fake);
    vault.save({ ...home, password: PASS });
    expect(vault.remove("home")).toEqual({
      networks: [],
      error: "",
      notice: "",
    });
    expect(vault.remove("home").error).toBe("");
    expect(JSON.parse(readFileSync(path, "utf8")).networks).toEqual([]);
  });

  it("sets aside a corrupt file and starts empty", () => {
    const path = file();
    writeFileSync(path, "{not json");
    const state = new NetworkVault(path, box().fake).list();
    expect(state.networks).toEqual([]);
    expect(state.notice).toMatch(/networks\.json\.bad/);
    expect(readFileSync(`${path}.bad`, "utf8")).toBe("{not json");
  });

  it("sets aside a hand-edited duplicate or a wrong type", () => {
    for (const bad of [
      {
        networks: [
          { ssid: "a", url: "", token: "", password: "" },
          { ssid: "a", url: "", token: "", password: "" },
        ],
      },
      { networks: [{ ssid: "a", url: 5, token: "", password: "" }] },
      {
        networks: [{ ssid: "a", url: "", token: "", password: "not base64!" }],
      },
      [],
    ]) {
      const path = file();
      writeFileSync(path, JSON.stringify(bad));
      expect(new NetworkVault(path, box().fake).list().notice).toMatch(
        /set it aside/,
      );
      expect(existsSync(`${path}.bad`)).toBe(true);
    }
  });

  it("will not overwrite a file it cannot read", () => {
    const path = file();
    mkdirSync(path);
    const vault = new NetworkVault(path, box().fake);
    expect(vault.list().error).toMatch(/will not change it/);
    expect(vault.save({ ...home, password: "" }).error).toMatch(
      /will not change it/,
    );
    expect(statSync(path).isDirectory()).toBe(true);
  });

  it("keeps both of two saves made together", async () => {
    const path = file();
    const vault = new NetworkVault(path, box().fake);
    await Promise.all([
      Promise.resolve().then(() =>
        vault.save({ ...home, ssid: "a", password: "" }),
      ),
      Promise.resolve().then(() =>
        vault.save({ ...home, ssid: "b", password: "" }),
      ),
    ]);
    expect(
      new NetworkVault(path, box().fake).list().networks.map((n) => n.ssid),
    ).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test test/main/networks.test.ts test/server/state-file.test.ts`
Expected: FAIL, `Cannot find module '../../src/main/networks'`, and the writeAtomic mode is 644.

- [ ] **Step 4: Fix writeAtomic**

In `src/server/state-file.ts`, add `rmSync` to the `node:fs` import and change `writeAtomic` to:

```ts
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  // writeFileSync's mode only applies to a new file: a stale tmp would keep its own.
  rmSync(tmp, { force: true });
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}
```

- [ ] **Step 5: Add the shared types**

In `src/shared/ipc.ts`, before `export interface CalicoApi`, add:

```ts
/** A saved Wi-Fi network as the window sees it. Never the password or token. */
export interface SavedNetwork {
  ssid: string;
  url: string;
  password_set: boolean;
  token_set: boolean;
}

/** What the window sends. An absent password or token keeps the saved one; "" clears it. */
export interface NetworkInput {
  ssid: string;
  url: string;
  password?: string;
  token?: string;
  /** true changes a saved network, false adds one. */
  edit: boolean;
}

export interface NetworksState {
  networks: SavedNetwork[];
  /** Why the last action failed, or "". Never contains a secret. */
  error: string;
  /** Something the person should know about the file, such as a set-aside copy. */
  notice: string;
}
```

and at the end of `CalicoApi`:

```ts
  networksList(): Promise<NetworksState>;
  /** The password and token go to main only; the reply carries flags. */
  networksSave(input: NetworkInput): Promise<NetworksState>;
  networksRemove(ssid: string): Promise<NetworksState>;
```

- [ ] **Step 6: Implement the vault**

`src/main/networks.ts`:

```ts
import { readFileSync, renameSync } from "node:fs";
import { basename } from "node:path";
import { writeAtomic } from "../server/state-file";
import type { NetworkInput, NetworksState, SavedNetwork } from "../shared/ipc";
import {
  checkPass,
  checkSsid,
  checkToken,
  checkUrl,
  FieldError,
  NETWORKS_MAX,
} from "../shared/panel-fields";

/** What the vault needs from Electron's safeStorage, injected so tests never touch a keyring. */
export interface SecretBox {
  /** safeStorage.getSelectedStorageBackend() on Linux. */
  backend(): string;
  available(): boolean;
  encrypt(text: string): Buffer;
}

interface StoredNetwork {
  ssid: string;
  url: string;
  token: string;
  /** base64 of the safeStorage ciphertext. "" is an open network. */
  password: string;
}

export const NO_KEYRING =
  "Calico could not reach a system keyring, so it did not save the password. Unlock GNOME Keyring or KWallet, then try again.";
export const PLAINTEXT_KEYRING =
  "This desktop gives Calico no keyring, so the password would be stored as plain text. Calico did not save it. Install GNOME Keyring or KWallet, then try again.";
const BAD_INPUT = "That network could not be saved.";
const BAD_REMOVE = "That network could not be removed.";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkFields(ssid: string, url: string, token: string): void {
  checkSsid(ssid);
  if (url !== "") checkUrl(url);
  checkToken(token);
}

function view(n: StoredNetwork): SavedNetwork {
  return {
    ssid: n.ssid,
    url: n.url,
    password_set: n.password !== "",
    token_set: n.token !== "",
  };
}

/** The file as written by save. Anything else is a hand edit or damage, and throws. */
export function parseNetworks(value: unknown): StoredNetwork[] {
  if (!isRecord(value) || !Array.isArray(value.networks))
    throw new Error("bad networks");
  if (value.networks.length > NETWORKS_MAX) throw new Error("too many");
  const seen = new Set<string>();
  return value.networks.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error("bad network");
    const { ssid, url, token, password } = entry;
    if (
      typeof ssid !== "string" ||
      typeof url !== "string" ||
      typeof token !== "string" ||
      typeof password !== "string"
    )
      throw new Error("bad network");
    checkFields(ssid, url, token);
    if (password !== "" && !BASE64.test(password))
      throw new Error("bad network");
    if (seen.has(ssid)) throw new Error("duplicate network");
    seen.add(ssid);
    return { ssid, url, token, password };
  });
}

function optional(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FieldError(BAD_INPUT);
  return value;
}

function networkInput(raw: unknown): NetworkInput {
  if (
    !isRecord(raw) ||
    typeof raw.ssid !== "string" ||
    typeof raw.url !== "string" ||
    typeof raw.edit !== "boolean"
  )
    throw new FieldError(BAD_INPUT);
  const input: NetworkInput = {
    ssid: raw.ssid,
    url: raw.url,
    edit: raw.edit,
    password: optional(raw.password),
    token: optional(raw.token),
  };
  checkFields(input.ssid, input.url, input.token ?? "");
  if (input.password !== undefined) checkPass(input.password);
  return input;
}

function keyringRefusal(box: SecretBox): string | null {
  const backend = box.backend();
  if (backend === "basic_text") return PLAINTEXT_KEYRING;
  if (backend === "unknown" || !box.available()) return NO_KEYRING;
  return null;
}

// ponytail: synchronous file I/O serializes saves, and the single-instance lock makes main the
// only writer. An async rewrite would need a queue.
export class NetworkVault {
  private nets: StoredNetwork[] = [];
  private notice = "";
  /** Set when networks.json exists but cannot be read: saving would overwrite it. */
  private blocked = "";

  constructor(
    private readonly path: string,
    private readonly box: SecretBox,
  ) {
    this.load();
  }

  list(): NetworksState {
    return this.state("");
  }

  save(raw: unknown): NetworksState {
    if (this.blocked) return this.state("");
    let input: NetworkInput;
    try {
      input = networkInput(raw);
    } catch (err) {
      return this.state(err instanceof FieldError ? err.message : BAD_INPUT);
    }
    const at = this.nets.findIndex((n) => n.ssid === input.ssid);
    if (input.edit && at < 0) return this.state(`${input.ssid} is not saved.`);
    if (!input.edit && at >= 0)
      return this.state(`${input.ssid} is already saved. Edit it instead.`);
    if (!input.edit && this.nets.length >= NETWORKS_MAX)
      return this.state(
        `The panel holds ${NETWORKS_MAX} networks. Remove one first.`,
      );
    const old = this.nets[at];
    let password = old?.password ?? "";
    if (input.password !== undefined) {
      password = "";
      if (input.password !== "") {
        const refused = keyringRefusal(this.box);
        if (refused) return this.state(refused);
        try {
          password = this.box.encrypt(input.password).toString("base64");
        } catch {
          return this.state(NO_KEYRING);
        }
      }
    }
    const next: StoredNetwork = {
      ssid: input.ssid,
      url: input.url,
      token: input.token ?? old?.token ?? "",
      password,
    };
    return this.write(
      at >= 0
        ? this.nets.map((n, i) => (i === at ? next : n))
        : [...this.nets, next],
    );
  }

  remove(raw: unknown): NetworksState {
    if (this.blocked) return this.state("");
    if (typeof raw !== "string") return this.state(BAD_REMOVE);
    if (!this.nets.some((n) => n.ssid === raw)) return this.state("");
    return this.write(this.nets.filter((n) => n.ssid !== raw));
  }

  private write(nets: StoredNetwork[]): NetworksState {
    try {
      writeAtomic(
        this.path,
        `${JSON.stringify({ networks: nets }, null, 2)}\n`,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "a write error";
      return this.state(`Could not save ${basename(this.path)} (${code}).`);
    }
    this.nets = nets;
    return this.state("");
  }

  private load(): void {
    const name = basename(this.path);
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      this.blocked = `Calico cannot read ${name} (${code ?? "error"}), so it will not change it. Fix the file, then restart Calico.`;
      return;
    }
    try {
      this.nets = parseNetworks(JSON.parse(text));
    } catch {
      try {
        renameSync(this.path, `${this.path}.bad`);
      } catch {
        this.blocked = `Calico cannot read ${name}, so it will not change it. Fix the file, then restart Calico.`;
        return;
      }
      this.notice = `${name} was damaged, so Calico set it aside as ${name}.bad and started an empty list.`;
    }
  }

  private state(error: string): NetworksState {
    return {
      networks: this.nets.map(view),
      error: error || this.blocked,
      notice: this.notice,
    };
  }
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm test test/main/networks.test.ts test/server/state-file.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire IPC, preload and startup**

In `src/main/ipc.ts`, add `import type { NetworkVault } from "./networks";`, add to `IpcDeps`:

```ts
networks: Pick<NetworkVault, "list" | "save" | "remove">;
```

and inside `registerIpc`, after the `relay:copy-bot` handler:

```ts
// The window sends secrets here and gets back flags only (password_set, token_set).
ipcMain.handle("networks:list", () => deps.networks.list());
ipcMain.handle("networks:save", (_e, input: unknown) =>
  deps.networks.save(input),
);
ipcMain.handle("networks:remove", (_e, ssid: unknown) =>
  deps.networks.remove(ssid),
);
```

In `src/preload/index.ts`, add to `api` after `relayCopyForBot`:

```ts
  networksList: () => ipcRenderer.invoke("networks:list"),
  networksSave: (input) => ipcRenderer.invoke("networks:save", input),
  networksRemove: (ssid) => ipcRenderer.invoke("networks:remove", ssid),
```

In `src/main/index.ts`, change line 3 to `import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";`, add `import { NetworkVault } from "./networks";`, and before `registerIpc({` add:

```ts
// After app ready, so safeStorage knows its backend. Linux is the only target for now.
const networks = new NetworkVault(join(userData, "networks.json"), {
  backend: () =>
    process.platform === "linux"
      ? safeStorage.getSelectedStorageBackend()
      : "os",
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text),
});
```

and add `networks,` to the `registerIpc({ ... })` object.

- [ ] **Step 9: Check everything**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write src/main/networks.ts test/main/networks.test.ts src/server/state-file.ts test/server/state-file.test.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts
git add src/main/networks.ts test/main/networks.test.ts src/server/state-file.ts test/server/state-file.test.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts
git commit --no-gpg-sign -m "Keep Wi-Fi networks in a keyring-sealed vault"
```

---

### Task 7: Networks list in Settings > Connectivity

**Files:**

- Create: `src/renderer/src/device/ScanSelect.tsx`, `src/renderer/src/settings/NetworksSection.tsx`, `src/renderer/src/settings/NetworkForm.tsx`, `src/renderer/src/settings/NetworksSection.test.tsx`
- Modify: `src/renderer/src/settings/SettingsView.tsx:45-74`, `src/renderer/src/settings/SettingsView.test.tsx:6-9`, `src/renderer/src/App.tsx:48`

**Interfaces:**

- Consumes: `NetworksState`, `NetworkInput`, `SavedNetwork`, `window.calico.networks*` (Task 6); `NETWORKS_MAX` (Task 4); `DeviceLink`, `Ap`.
- Produces: `ScanSelect({ link, value, onPick, onError, onBusy?, disabled? })` (Task 8 reuses it); `NetworksSection({ link }: { link: DeviceLink | null })`; `SettingsView` takes optional `link?: DeviceLink | null`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/settings/NetworksSection.test.tsx`:

```tsx
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkInput, NetworksState } from "../../../shared/ipc";
import type { DeviceLink } from "../device/commands";
import { NetworksSection } from "./NetworksSection";

const saved: NetworksState = {
  networks: [
    { ssid: "home", url: "", password_set: true, token_set: false },
    {
      ssid: "lab",
      url: "http://10.0.0.8:8787",
      password_set: false,
      token_set: true,
    },
  ],
  error: "",
  notice: "",
};

let api: {
  networksList: ReturnType<typeof vi.fn>;
  networksSave: ReturnType<typeof vi.fn>;
  networksRemove: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  api = {
    networksList: vi.fn(async () => saved),
    networksSave: vi.fn(async (input: NetworkInput) => ({
      ...saved,
      networks: [
        ...saved.networks,
        {
          ssid: input.ssid,
          url: input.url,
          password_set: true,
          token_set: false,
        },
      ],
    })),
    networksRemove: vi.fn(async () => ({ ...saved, networks: [] })),
  };
  Object.assign(window, { calico: api });
});

afterEach(cleanup);

const scanLink: DeviceLink = {
  kind: "ble",
  send: async () => ({ ok: true, aps: [{ rssi: -40, ssid: "cafe" }] }),
  close() {},
};

describe("NetworksSection", () => {
  it("lists each network with its URL and whether a password is set", async () => {
    render(<NetworksSection link={null} />);
    const list = await screen.findByRole("list", { name: "Saved networks" });
    expect(list.textContent).toContain("home");
    expect(list.textContent).toContain("Default URL");
    expect(list.textContent).toContain("Password set");
    expect(list.textContent).toContain("http://10.0.0.8:8787");
    expect(list.textContent).toContain("No password");
  });

  it("adds a hidden network by typing its SSID, then forgets the typed password", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "hidden" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "placeholder-pass" },
    });
    fireEvent.click(screen.getByText("Save network"));
    await waitFor(() =>
      expect(api.networksSave).toHaveBeenCalledWith({
        ssid: "hidden",
        url: "",
        edit: false,
        password: "placeholder-pass",
      }),
    );
    expect(await screen.findByText("hidden")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("placeholder-pass");
  });

  it("asks for a password or Open network before adding", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "cafe" },
    });
    fireEvent.click(screen.getByText("Save network"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.networksSave).not.toHaveBeenCalled();
  });

  it("shows the vault's refusal, such as a missing keyring", async () => {
    api.networksSave.mockResolvedValueOnce({
      ...saved,
      error: "Calico did not save it.",
    });
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.change(screen.getByLabelText("SSID"), {
      target: { value: "cafe" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "placeholder-pass" },
    });
    fireEvent.click(screen.getByText("Save network"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Calico did not save it.",
    );
  });

  it("edits without resending an untouched password", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByLabelText("Edit home"));
    expect((screen.getByLabelText("SSID") as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText("Companion URL for this network"), {
      target: { value: "http://10.0.0.9:8787" },
    });
    fireEvent.click(screen.getByText("Save network"));
    await waitFor(() =>
      expect(api.networksSave).toHaveBeenCalledWith({
        ssid: "home",
        url: "http://10.0.0.9:8787",
        edit: true,
      }),
    );
  });

  it("removes from this computer only after a confirmation", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByLabelText("Remove home"));
    expect(api.networksRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/The panel keeps it/)).toBeTruthy();
    fireEvent.click(screen.getByText("Remove network"));
    await waitFor(() =>
      expect(api.networksRemove).toHaveBeenCalledWith("home"),
    );
  });

  it("picks an SSID from the panel's scan", async () => {
    render(<NetworksSection link={scanLink} />);
    fireEvent.click(await screen.findByText("Add network"));
    fireEvent.click(screen.getByText("Scan networks"));
    fireEvent.change(await screen.findByLabelText("Network"), {
      target: { value: "cafe" },
    });
    expect((screen.getByLabelText("SSID") as HTMLInputElement).value).toBe(
      "cafe",
    );
  });

  it("says how to scan when no panel is connected", async () => {
    render(<NetworksSection link={null} />);
    fireEvent.click(await screen.findByText("Add network"));
    expect(
      (screen.getByText("Scan networks") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Connect the panel on the Device page/),
    ).toBeTruthy();
  });

  it("stops adding at eight networks", async () => {
    api.networksList.mockResolvedValueOnce({
      ...saved,
      networks: Array.from({ length: 8 }, (_, i) => ({
        ssid: `n${i}`,
        url: "",
        password_set: false,
        token_set: false,
      })),
    });
    render(<NetworksSection link={null} />);
    await screen.findByText("n7");
    expect(
      (screen.getByText("Add network") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/holds 8 networks/)).toBeTruthy();
  });
});
```

In `SettingsView.test.tsx`, change line 3 to import `beforeEach, vi` as well, and add after the imports:

```ts
beforeEach(() => {
  // Connectivity lists the saved networks on mount, with or without the server.
  Object.assign(window, {
    calico: {
      networksList: vi.fn(async () => ({
        networks: [],
        error: "",
        notice: "",
      })),
    },
  });
});
```

and add a test inside `describe("SettingsView", ...)`:

```ts
  it("shows the Wi-Fi networks under Connectivity even without the server", async () => {
    render(<SettingsView info={info} />);
    fireEvent.click(screen.getByRole("tab", { name: "Connectivity" }));
    expect(panel().textContent).toContain("Wi-Fi networks");
    expect(await screen.findByText("No networks saved.")).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/renderer/src/settings`
Expected: FAIL, `Cannot find module './NetworksSection'`.

- [ ] **Step 3: Write ScanSelect**

`src/renderer/src/device/ScanSelect.tsx`:

```tsx
import { useState } from "react";
import type { Ap, DeviceLink } from "./commands";

/** Scan through the panel and pick an SSID. Hidden networks are typed by the caller. */
export function ScanSelect({
  link,
  value,
  onPick,
  onError,
  onBusy = () => undefined,
  disabled = false,
}: {
  link: DeviceLink | null;
  value: string;
  onPick: (ssid: string) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const [aps, setAps] = useState<Ap[]>([]);

  async function scan() {
    if (!link) return;
    onError("");
    setScanning(true);
    onBusy(true);
    const reply = await link.send({ op: "scan" });
    setScanning(false);
    onBusy(false);
    if (!reply.ok) return onError(reply.error);
    setAps(reply.aps ?? []);
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={disabled || scanning || !link}
        onClick={() => void scan()}
      >
        {scanning ? "Scanning (up to 30 s)" : "Scan networks"}
      </button>
      {aps.length > 0 ? (
        <label className="label">
          Network
          <select
            className="field mt-1 w-56"
            value={value}
            onChange={(e) => onPick(e.target.value)}
          >
            <option value="">Choose a network</option>
            {aps.map((ap) => (
              <option key={ap.ssid} value={ap.ssid}>
                {ap.ssid} ({ap.rssi} dBm)
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Write NetworkForm**

`src/renderer/src/settings/NetworkForm.tsx`:

```tsx
import { useState } from "react";
import type {
  NetworkInput,
  NetworksState,
  SavedNetwork,
} from "../../../shared/ipc";
import type { DeviceLink } from "../device/commands";
import { ScanSelect } from "../device/ScanSelect";
import { ErrorNote } from "../shell/ErrorNote";

export function NetworkForm({
  link,
  editing,
  onSaved,
  onCancel,
}: {
  link: DeviceLink | null;
  editing: SavedNetwork | null;
  onSaved: (state: NetworksState) => void;
  onCancel: () => void;
}) {
  const [ssid, setSsid] = useState(editing?.ssid ?? "");
  const [url, setUrl] = useState(editing?.url ?? "");
  // null is untouched, so an edit keeps what is saved.
  const [pass, setPass] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(editing ? !editing.password_set : false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    const needsPass = !open && !editing?.password_set;
    if (needsPass && !pass)
      return setError("Type the network's password, or choose Open network.");
    const input: NetworkInput = {
      ssid,
      url,
      edit: editing !== null,
      ...(open ? { password: "" } : pass ? { password: pass } : {}),
      ...(token !== null ? { token } : {}),
    };
    setSaving(true);
    const state = await window.calico.networksSave(input);
    setSaving(false);
    if (state.error) return setError(state.error);
    setPass(null);
    setToken(null);
    onSaved(state);
  }

  return (
    <div className="max-w-2xl px-4 pt-3">
      <div className="grid grid-cols-2 items-end gap-3">
        <label className="label">
          SSID
          <input
            className="field mt-1"
            value={ssid}
            disabled={editing !== null}
            onChange={(e) => setSsid(e.target.value)}
          />
        </label>
        {editing ? (
          <span />
        ) : (
          <div className="flex items-end gap-3">
            <ScanSelect
              link={link}
              value={ssid}
              onPick={setSsid}
              onError={setError}
            />
          </div>
        )}
        <label className="label">
          Password
          <input
            type="password"
            className="field mt-1"
            value={pass ?? ""}
            disabled={open}
            placeholder={editing?.password_set ? "Set. Type to replace" : ""}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
          />
          Open network (no password)
        </label>
        <label className="label">
          Companion URL for this network
          <input
            className="field mt-1 font-mono"
            value={url}
            placeholder="Default URL"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="label">
          Token for this network
          <input
            type="password"
            className="field mt-1"
            value={token ?? ""}
            placeholder={editing?.token_set ? "Set" : "Default token"}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      {!editing ? (
        <p className="pt-2 text-muted">
          {link
            ? "For a hidden network, type its name."
            : "Connect the panel on the Device page to scan for networks. For a hidden network, type its name."}
        </p>
      ) : null}
      <div className="flex gap-3 pt-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !ssid}
          onClick={() => void save()}
        >
          Save network
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Write NetworksSection**

`src/renderer/src/settings/NetworksSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { NetworksState, SavedNetwork } from "../../../shared/ipc";
import { NETWORKS_MAX } from "../../../shared/panel-fields";
import type { DeviceLink } from "../device/commands";
import { ErrorNote } from "../shell/ErrorNote";
import { NetworkForm } from "./NetworkForm";

const EMPTY: NetworksState = { networks: [], error: "", notice: "" };

export function NetworksSection({ link }: { link: DeviceLink | null }) {
  const [state, setState] = useState<NetworksState>(EMPTY);
  // null: no form. "new": adding. A network: editing it.
  const [form, setForm] = useState<SavedNetwork | "new" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    void window.calico.networksList().then(setState);
  }, []);

  async function remove(ssid: string) {
    setState(await window.calico.networksRemove(ssid));
    setRemoving(null);
  }

  const full = state.networks.length >= NETWORKS_MAX;
  return (
    <section>
      <h2 className="section-title">Wi-Fi networks</h2>
      <p className="max-w-2xl px-4 pb-2 text-muted">
        The networks the panel can join, kept on this computer. Passwords are
        locked with the system keyring and never shown again. Saving here does
        not change the panel: to set up the panel now, use Device.
      </p>
      {state.notice ? (
        <p role="status" className="max-w-2xl px-4 pb-2 text-amber">
          {state.notice}
        </p>
      ) : null}
      {state.networks.length === 0 ? (
        <p className="px-4 text-muted">No networks saved.</p>
      ) : (
        <ul aria-label="Saved networks" className="max-w-2xl px-4">
          {state.networks.map((n) => (
            <li
              key={n.ssid}
              className="flex items-center gap-3 border-b border-stroke/40 py-2"
            >
              <span className="min-w-0 flex-1 truncate">{n.ssid}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted">
                {n.url || "Default URL"}
              </span>
              <span className="text-muted">
                {n.password_set ? "Password set" : "No password"}
              </span>
              <button
                type="button"
                className="btn"
                aria-label={`Edit ${n.ssid}`}
                disabled={form !== null}
                onClick={() => {
                  setRemoving(null);
                  setForm(n);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Remove ${n.ssid}`}
                disabled={form !== null}
                onClick={() => setRemoving(n.ssid)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing ? (
        <div className="mx-4 mt-2 max-w-2xl border border-amber/60 bg-surface p-3">
          <p className="text-amber">
            Remove {removing} and its password from this computer? The panel
            keeps it until you forget it there, on the Device page.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void remove(removing)}
            >
              Remove network
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {form ? (
        <NetworkForm
          key={form === "new" ? "" : form.ssid}
          link={link}
          editing={form === "new" ? null : form}
          onSaved={(next) => {
            setState(next);
            setForm(null);
          }}
          onCancel={() => setForm(null)}
        />
      ) : (
        <div className="flex items-center gap-3 px-4 pt-3">
          <button
            type="button"
            className="btn"
            disabled={full}
            onClick={() => {
              setRemoving(null);
              setForm("new");
            }}
          >
            Add network
          </button>
          {full ? (
            <span className="text-muted">
              The panel holds {NETWORKS_MAX} networks. Remove one to add
              another.
            </span>
          ) : null}
        </div>
      )}
      {state.error && !form ? (
        <p role="alert" className="max-w-2xl px-4 pt-2">
          <ErrorNote>{state.error}</ErrorNote>
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Mount it and pass the link**

In `SettingsView.tsx`, add `import type { DeviceLink } from "../device/commands";` and `import { NetworksSection } from "./NetworksSection";`, change the signature to:

```tsx
export function SettingsView({
  info,
  link = null,
}: {
  info: CalicoInfo;
  link?: DeviceLink | null;
}) {
```

and in the `connectivity` panel add `<NetworksSection link={link} />` right after the closing `)}` of the `server ? ... : ...` block, so it renders with or without the server.

In `App.tsx` line 48 change to `{view === "settings" && info ? <SettingsView info={info} link={link} /> : null}`.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm test src/renderer/src && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm exec prettier --write src/renderer/src/device/ScanSelect.tsx src/renderer/src/settings src/renderer/src/App.tsx
git add src/renderer/src/device/ScanSelect.tsx src/renderer/src/settings/NetworksSection.tsx src/renderer/src/settings/NetworkForm.tsx src/renderer/src/settings/NetworksSection.test.tsx src/renderer/src/settings/SettingsView.tsx src/renderer/src/settings/SettingsView.test.tsx src/renderer/src/App.tsx
git commit --no-gpg-sign -m "List, add, edit and remove saved networks in Connectivity"
```

---

### Task 8: Networks on the panel, and a per-network URL and token in Set up Wi-Fi

**Files:**

- Create: `src/renderer/src/device/PanelNetworks.tsx`, `src/renderer/src/device/PanelNetworks.test.tsx`, `src/renderer/src/device/ProvisionFlow.test.tsx`
- Modify: `src/renderer/src/device/ProvisionFlow.tsx` (whole file), `src/renderer/src/device/DeviceView.tsx:106-110`

**Interfaces:**

- Consumes: `Cmd` with `nets`, `forget`, extended `wifi`; `PanelNet` (Task 4); `ScanSelect` (Task 7).
- Produces: `PanelNetworks({ link }: { link: DeviceLink })`. `ProvisionFlow` sends `{ op: "wifi", ssid, pass, url, token }` only when the person filled either own field.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/device/PanelNetworks.test.tsx`:

```tsx
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Cmd, DeviceLink, PanelNet, Reply } from "./commands";
import { PanelNetworks } from "./PanelNetworks";

afterEach(cleanup);

function panel(start: PanelNet[], fail?: string) {
  let nets = start;
  const sent: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd: Cmd): Promise<Reply> {
      sent.push(cmd);
      if (fail) return { ok: false, error: fail };
      if (cmd.op === "forget") nets = nets.filter((n) => n.ssid !== cmd.ssid);
      return cmd.op === "nets" ? { ok: true, nets } : { ok: true };
    },
    close() {},
  };
  return { link, sent };
}

describe("PanelNetworks", () => {
  it("lists the panel's networks with flags only", async () => {
    const { link } = panel([{ ssid: "home", has_url: true, has_token: false }]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    const list = await screen.findByRole("list", {
      name: "Networks on the panel",
    });
    expect(list.textContent).toContain("home");
    expect(list.textContent).toContain("Own URL");
    expect(list.textContent).toContain("Default token");
  });

  it("forgets one on the panel after a confirmation, then reads the list again", async () => {
    const { link, sent } = panel([
      { ssid: "home", has_url: false, has_token: false },
      { ssid: "cafe", has_url: false, has_token: false },
    ]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    fireEvent.click(await screen.findByLabelText("Forget cafe on the panel"));
    expect(sent.some((c) => c.op === "forget")).toBe(false);
    fireEvent.click(screen.getByText("Forget network"));
    await waitFor(() => expect(screen.queryByText("cafe")).toBeNull());
    expect(sent).toContainEqual({ op: "forget", ssid: "cafe" });
    expect(sent.filter((c) => c.op === "nets")).toHaveLength(2);
  });

  it("says when the panel has none", async () => {
    const { link } = panel([]);
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    expect(
      await screen.findByText("No networks saved on the panel."),
    ).toBeTruthy();
  });

  it("shows the link's error, such as old firmware", async () => {
    const { link } = panel([], "Flash the latest firmware.");
    render(<PanelNetworks link={link} />);
    fireEvent.click(screen.getByText("Show networks"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Flash the latest firmware.",
    );
  });
});
```

`src/renderer/src/device/ProvisionFlow.test.tsx`:

```tsx
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import type { Cmd, DeviceLink } from "./commands";
import { ProvisionFlow } from "./ProvisionFlow";

const info = {
  lanUrls: [],
  webhookToken: "",
} as unknown as CalicoInfo;

beforeEach(() => {
  Object.assign(window, {
    calico: { adoptPort: vi.fn(async () => undefined) },
  });
});
afterEach(cleanup);

function setup() {
  const sent: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push(cmd);
      return { ok: true };
    },
    close() {},
  };
  const onReboot = vi.fn(async () => undefined);
  render(<ProvisionFlow info={info} link={link} onReboot={onReboot} />);
  fireEvent.change(screen.getByLabelText("Or type an SSID"), {
    target: { value: "home" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "placeholder-pass" },
  });
  return { sent, onReboot };
}

describe("ProvisionFlow", () => {
  it("sends the plain two-field wifi when no own URL or token is given", async () => {
    const { sent, onReboot } = setup();
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
    expect(sent).toContainEqual({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass",
    });
  });

  it("sends this network's own URL and token with wifi", async () => {
    const { sent, onReboot } = setup();
    fireEvent.change(screen.getByLabelText("Companion URL for this network"), {
      target: { value: "http://10.0.0.8:8787" },
    });
    fireEvent.change(screen.getByLabelText("Token for this network"), {
      target: { value: "placeholder-token" },
    });
    fireEvent.click(screen.getByText("Test and save"));
    await waitFor(() => expect(onReboot).toHaveBeenCalled());
    expect(sent).toContainEqual({
      op: "wifi",
      ssid: "home",
      pass: "placeholder-pass",
      url: "http://10.0.0.8:8787",
      token: "placeholder-token",
    });
    expect(
      (screen.getByLabelText("Token for this network") as HTMLInputElement)
        .value,
    ).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/renderer/src/device`
Expected: FAIL, `Cannot find module './PanelNetworks'` and no "Companion URL for this network" label.

- [ ] **Step 3: Write PanelNetworks**

`src/renderer/src/device/PanelNetworks.tsx`:

```tsx
import { useState } from "react";
import type { DeviceLink, PanelNet } from "./commands";
import { ErrorNote } from "../shell/ErrorNote";

/** What the panel itself has saved. Forget acts on the panel only, never on Settings. */
export function PanelNetworks({ link }: { link: DeviceLink }) {
  const [nets, setNets] = useState<PanelNet[] | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function read() {
    setBusy(true);
    setError("");
    const reply = await link.send({ op: "nets" });
    setBusy(false);
    if (!reply.ok) return setError(reply.error);
    setNets(reply.nets ?? []);
  }

  async function forget(ssid: string) {
    setBusy(true);
    setError("");
    const reply = await link.send({ op: "forget", ssid });
    setForgetting(null);
    if (!reply.ok) {
      setBusy(false);
      return setError(reply.error);
    }
    await read();
  }

  return (
    <section>
      <h2 className="section-title">Networks on the panel</h2>
      <p className="max-w-2xl px-4 text-muted">
        The panel keeps up to 8 networks and never sends their passwords back.
        Forgetting one here removes it from the panel only. The panel stays on
        its current network until it restarts.
      </p>
      <div className="flex gap-3 px-4 pt-3">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void read()}
        >
          {busy ? "Asking the panel" : nets ? "Refresh" : "Show networks"}
        </button>
      </div>
      {nets && nets.length === 0 ? (
        <p className="px-4 pt-2 text-muted">No networks saved on the panel.</p>
      ) : null}
      {nets && nets.length > 0 ? (
        <ul aria-label="Networks on the panel" className="max-w-2xl px-4 pt-2">
          {nets.map((n) => (
            <li
              key={n.ssid}
              className="flex items-center gap-3 border-b border-stroke/40 py-2"
            >
              <span className="min-w-0 flex-1 truncate">{n.ssid}</span>
              <span className="text-muted">
                {n.has_url ? "Own URL" : "Default URL"}
              </span>
              <span className="text-muted">
                {n.has_token ? "Own token" : "Default token"}
              </span>
              <button
                type="button"
                className="btn"
                aria-label={`Forget ${n.ssid} on the panel`}
                disabled={busy}
                onClick={() => setForgetting(n.ssid)}
              >
                Forget on the panel
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {forgetting ? (
        <div className="mx-4 mt-2 max-w-2xl border border-amber/60 bg-surface p-3">
          <p className="text-amber">
            Forget {forgetting} on the panel? It will not join this network
            again until it is set up again. Settings keeps its copy.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void forget(forgetting)}
            >
              Forget network
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setForgetting(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Rewrite ProvisionFlow on ScanSelect with the own fields**

Replace `src/renderer/src/device/ProvisionFlow.tsx` with:

```tsx
import { useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import type { Cmd, DeviceLink } from "./commands";
import { ScanSelect } from "./ScanSelect";
import { ErrorNote } from "../shell/ErrorNote";

type Stage = "idle" | "verifying" | "saving";

export function ProvisionFlow({
  info,
  link,
  onReboot,
}: {
  info: CalicoInfo;
  link: DeviceLink;
  onReboot: () => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [scanning, setScanning] = useState(false);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [ownUrl, setOwnUrl] = useState("");
  const [ownToken, setOwnToken] = useState("");
  const [error, setError] = useState("");

  async function connect() {
    setError("");
    setStage("verifying");
    const verify = await link.send({ op: "verify", ssid, pass });
    if (!verify.ok) {
      setError(verify.error);
      return setStage("idle");
    }
    setStage("saving");
    const lan = info.lanUrls[0];
    // Only a network with its own URL or token sends the four-line wifi.
    const wifi: Cmd =
      ownUrl || ownToken
        ? { op: "wifi", ssid, pass, url: ownUrl, token: ownToken }
        : { op: "wifi", ssid, pass };
    const steps = [
      link.send.bind(link, wifi),
      ...(lan ? [link.send.bind(link, { op: "url", value: lan })] : []),
      link.send.bind(link, { op: "token", value: info.webhookToken }),
    ];
    for (const step of steps) {
      const reply = await step();
      if (!reply.ok) {
        setError(reply.error);
        return setStage("idle");
      }
    }
    setPass("");
    setOwnToken("");
    if (lan) await window.calico.adoptPort();
    setStage("idle");
    await onReboot();
  }

  const busy = scanning || stage !== "idle";
  return (
    <section>
      <h2 className="section-title">Set up Wi-Fi</h2>
      <p className="max-w-2xl px-4 text-muted">
        The desk tries the network first. A wrong password is not saved. When it
        joins, calico also sends this computer's URL and the webhook token, then
        reboots the desk.
      </p>
      <div className="flex max-w-2xl flex-wrap items-end gap-3 px-4 pt-3">
        <ScanSelect
          link={link}
          value={ssid}
          onPick={setSsid}
          onError={setError}
          onBusy={setScanning}
          disabled={busy}
        />
        <label className="label">
          Or type an SSID
          <input
            className="field mt-1 w-48"
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
          />
        </label>
        <label className="label">
          Password
          <input
            type="password"
            className="field mt-1 w-48"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ssid}
          onClick={() => void connect()}
        >
          {stage === "verifying"
            ? "Testing (up to 30 s)"
            : stage === "saving"
              ? "Saving"
              : "Test and save"}
        </button>
      </div>
      <details className="max-w-2xl px-4 pt-3">
        <summary className="cursor-pointer text-muted">
          This network's own companion URL and token (optional)
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <label className="label">
            Companion URL for this network
            <input
              className="field mt-1 font-mono"
              value={ownUrl}
              placeholder="Default URL"
              onChange={(e) => setOwnUrl(e.target.value)}
            />
          </label>
          <label className="label">
            Token for this network
            <input
              type="password"
              className="field mt-1"
              value={ownToken}
              placeholder="Default token"
              onChange={(e) => setOwnToken(e.target.value)}
            />
          </label>
        </div>
      </details>
      <p role="status" className="px-4 pt-2">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </p>
    </section>
  );
}
```

- [ ] **Step 5: Mount PanelNetworks**

In `DeviceView.tsx`, add `import { PanelNetworks } from "./PanelNetworks";` and after the `<ProvisionFlow ... />` element add `<PanelNetworks link={link} />`.

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test src/renderer/src/device && pnpm typecheck && pnpm lint`
Expected: PASS, including the existing `DeviceView.test.tsx` provisioning and pairing tests.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write src/renderer/src/device
git add src/renderer/src/device/PanelNetworks.tsx src/renderer/src/device/PanelNetworks.test.tsx src/renderer/src/device/ProvisionFlow.tsx src/renderer/src/device/ProvisionFlow.test.tsx src/renderer/src/device/DeviceView.tsx
git commit --no-gpg-sign -m "Show and forget the panel's networks, and set a network's own URL and token"
```

---

### Task 9: Hardware check and docs

**Files:**

- Modify: `README.md:11`, `docs/review-rules.md:7` (rule 3), `firmware/README.md` (one measurement line)

**Interfaces:**

- Consumes: the Task 1 commit (baseline image) and the branch head.

- [ ] **Step 1: Full local gate (executor)**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && firmware/host/run.sh && python3 -m pytest -q firmware/scripts/test_ble_provision.py && (cd firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|Project build complete")`
Expected: all pass, `Project build complete`.

- [ ] **Step 2: Docs**

In `README.md`, after line 11 add:

```markdown
- Keeps the panel's Wi-Fi networks in one list on this computer, with passwords locked in the system keyring (GNOME Keyring or KWallet). Without a keyring, Calico refuses to save a password.
```

In `docs/review-rules.md`, replace rule 3 with:

```markdown
3. **Secrets.** Wi-Fi passwords, bearer tokens, and the Cursor API key are never logged, never sent to the Console pane, and never written anywhere except `config.json` (tokens and keys only) and `networks.json` (mode 0600; Wi-Fi passwords only as `safeStorage` ciphertext, refused on the `basic_text` backend). The window never receives a saved Wi-Fi password or per-network token, only `password_set` and `token_set`. The panel's `nets` never carries a password, token, or URL.
```

Run: `pnpm exec prettier --write README.md docs/review-rules.md`

- [ ] **Step 3: Baseline numbers, owner at the panel**

Build the Task 1 commit in a separate worktree and app-flash it (no NVS or full-flash erase):

```bash
base=$(git log --format=%h -1 --grep "Log the internal heap when Wi-Fi gets an address")
git worktree add /tmp/calico-baseline "$base"
cp firmware/sdkconfig /tmp/calico-baseline/firmware/sdkconfig
cp -r firmware/managed_components /tmp/calico-baseline/firmware/
cd /tmp/calico-baseline/firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|Project build complete" && idf.py -p /dev/ttyACM0 app-flash 2>&1 | tail -1
```

Then read the boot log for 20 seconds:

```bash
python3 - <<'PY'
import serial,time
s=serial.Serial('/dev/ttyACM0',115200,timeout=1)
s.dtr=False; s.rts=True; time.sleep(.15); s.rts=False
t=time.time(); out=b''
while time.time()-t<20: out+=s.read(4096)
for l in out.decode(errors='replace').splitlines():
    if 'largest internal DMA' in l or 'got ip' in l or 'advert' in l or 'GATT scratch' in l: print(l)
PY
```

Expected: `largest internal DMA N after NimBLE` and `got ip, internal free F, largest internal L`. Write down N and F as BASELINE. Then `git worktree remove --force /tmp/calico-baseline`.

- [ ] **Step 4: Branch numbers, owner at the panel**

From the repo: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build && idf.py -p /dev/ttyACM0 app-flash`, then rerun the Step 3 reader.
Expected: no `GATT scratch PSRAM missing`; `largest internal DMA` at least 53248; `internal free` at least 16000; neither more than 512 bytes under BASELINE. If any fails: stop, report both sets of numbers, do not continue.

- [ ] **Step 5: Bluetooth round trip, owner at the panel**

Start the app (`pnpm dev`), open Device, Connect over Bluetooth (the computer is already paired; no code should appear). Keep the Step 3 reader running in another terminal with its window raised to 180 seconds and its filter removed, writing to `/tmp/calico-panel.log` (`print(l)` for every line, `> /tmp/calico-panel.log`).

1. Show networks: the panel's saved networks appear with Default URL / Default token for ones set up before.
2. Set up Wi-Fi with a second network the panel can reach (a phone hotspot): type its SSID and password, open "This network's own companion URL and token", enter this computer's LAN URL (the chip in the header) and the webhook token from Settings > Agents (any placeholder if none is set), then Test and save. The panel reboots; reconnect over Bluetooth.
3. Show networks: the hotspot row reads Own URL and Own token. No password, token or URL text is on screen.
4. Forget on the panel for the hotspot, confirm: the list refreshes without it.
5. Settings > Connectivity: add the hotspot with its password, edit its URL, remove it. The list shows Password set, then nothing.
6. `grep -c -e "<hotspot password>" -e "<token>" /tmp/calico-panel.log` prints 0; `grep "forget\|wifi " /tmp/calico-panel.log` shows SSIDs only.

Expected: every step as written.

- [ ] **Step 6: USB, owner at the panel**

Disconnect Bluetooth, Connect over USB, Show networks. Expected today: "The desk did not answer in 10 seconds." because the firmware has no USB console (`docs/usb-console-protocol.md`). Record "USB round trip: blocked on the firmware console" in the PR. The app must not hang or crash.

- [ ] **Step 7: Boot and advertising unchanged, owner at the panel**

Reboot the panel from Device. Expected: it rejoins the home network, the status lamp goes green, Bluetooth reconnects without a code, and Step 4's numbers repeat within 512 bytes.

- [ ] **Step 8: Record the numbers**

In `firmware/README.md`, after the paragraph added in Task 3 Step 10, add one line with the real values:

```markdown
Measured on the Phase 2 branch after Wi-Fi joined: largest internal DMA after NimBLE <N> (baseline <N0>), internal free at got-ip <F> (baseline <F0>).
```

Run: `pnpm exec prettier --write firmware/README.md`

- [ ] **Step 9: Commit**

```bash
git add README.md docs/review-rules.md firmware/README.md
git commit --no-gpg-sign -m "Document the networks vault and record the panel's RAM after it"
```

---

## Self-Review

- **Spec coverage.** Storage, mode 0600, `ssid`/`url`/`token` clear and `password` sealed: Task 6. Plaintext-backend refusal with a reason: Task 6. Renderer sees only `password_set`/`token_set`: Task 6 (types, tests), Task 7 (UI). `nets`, `forget`, `wifi` with `url` and `token` over Bluetooth: Tasks 2, 3, 5; over USB: Task 5 (app and protocol); the firmware USB console does not exist and is out of scope (stated above and in Task 9 Step 6). Networks list with SSID, URL or "Default URL", "Password set", Add, Scan through the panel, Edit, Remove, hidden SSIDs typed: Task 7. Panel limits through the shared validators: Tasks 4, 6. Host C tests for list and forget logic, Vitest for vault and validators, component tests for the list: Tasks 2, 4 to 8. Real-board list round trip: Task 9. Phase 3 sync and the address banner: not here, by design.
- **Placeholder scan.** No TBD or "handle edge cases"; every code step has code. Task 9 Step 8 has angle-bracket slots for measured numbers, which the owner fills from Steps 3 and 4.
- **Type consistency.** `ble_desk_wifi_t`, `BLE_DESK_NETS_TEXT`, `BLE_DESK_WIFI_CFG_MAX`, `BLE_DESK_OP_NETS`/`FORGET` match across Tasks 2 and 3. `PanelNet`, `parseNets`, `NETWORKS_MAX`, `FieldError` match across Tasks 4, 5, 7, 8. `SavedNetwork`, `NetworkInput`, `NetworksState`, `networksList/Save/Remove` match across Tasks 6 and 7. `ScanSelect` props match in Tasks 7 and 8.
- **Review Focus.** Each of the five lines names its test, and each test sits in the task that owns the code.
- **Open risk for Phase 3.** Web Bluetooth lives in the renderer, so a sync that pushes a vault password must pass it through the window, which this phase forbids. Phase 3 has to decide that (for example a one-shot IPC that hands the sealed value straight to the write and clears it).
