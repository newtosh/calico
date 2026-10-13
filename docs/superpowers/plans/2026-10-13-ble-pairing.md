# Bluetooth Pairing (Phase 1) Implementation Plan

> **Superseded in part (2026-10-13).** The typed-passkey design in this plan did not survive hardware testing: Electron's pairing handler is never called on Linux with BlueZ. Phase 1 shipped as OS-level numeric comparison, with a Yes and No confirm card on the panel, a "Paired with <computer>" card, and no in-app PIN prompt. Tasks that mention the passkey display, `setBluetoothPairingHandler` or the in-app PIN prompt describe the abandoned design. The final design is in the Phase 1 pull request.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel pairs with a computer over Bluetooth using a 6-digit PIN shown on its glass, and every write and the full status need the paired, encrypted link.

**Architecture:** NimBLE security is switched on with LE Secure Connections, MITM protection and bonding. The panel displays a random passkey on a glass overlay while a computer pairs, and the GATT characteristics require an authenticated link. The app answers the OS pairing request through Electron's `setBluetoothPairingHandler`, with an in-app PIN prompt, and refuses panels that do not pair.

**Tech Stack:** ESP-IDF 5.5 C with NimBLE and LVGL 9 (firmware, host tests with system gcc); Electron 44, React 19, TypeScript, Vitest (app).

**Spec:** `docs/superpowers/specs/2026-10-13-wifi-networks-design.md` (Phase 1). Phases 2 and 3 get their own plans.

## Global Constraints

- Firmware palette only (`INK 0xefe7d6`, `INK_DIM`, `DOCK 0x0c0e09`, `FIELD_EDGE 0x6d6756`, `ROW_MARK 0x9bb57a`). No new colors.
- App: Tailwind classes only, no inline styles, Lucide icons, no new colors (`DESIGN.md`). Modals are allowed only for the listed cases, so Task 6 adds the pairing PIN to that list.
- Passkey: exactly 6 digits, shown as `123 456` on the panel, typed as `123456` in the app.
- Up to three bonded computers (`CONFIG_BT_NIMBLE_MAX_BONDS=3`). Bonds persist in NVS.
- The panel's DMA budget must hold: the boot log line `largest internal DMA N after NimBLE` must stay at or above `DESK_DMA_KEPT_FOR_STA` (48000) and the Wi-Fi station must still join.
- `status` is the only characteristic readable without pairing, and unpaired it returns only `name`, `fw`, `pair=1`, `paired=0`.
- A panel that does not report `pair=1` gets no secret from the app.
- A stale `firmware/sdkconfig` hides new defaults: delete `firmware/sdkconfig` and reconfigure after editing `sdkconfig.defaults`. Do not erase NVS.
- Test first. Run `pre-commit run` before any commit. One `timeshare run` per commit, run from `~/bin/src/calico`. No Claude session link in PR bodies.
- Prose and comments: avoid em-dashes.

## Review Focus

- A wrong PIN must leave nothing written and nothing leaked: the panel's glass overlay must disappear and the app must say pairing failed. (Tasks 3, 4, 7)
- An unpaired connection reading `status` must not see the SSID, URL, or token flag. (Task 3)
- A panel flashed before this change must be refused secrets, not trusted. (Task 7)
- Pairing started twice, or a second computer connecting mid-pair, must not leave the overlay stuck. (Tasks 3, 4)
- The app's pairing prompt must give up after a minute and never leave a dangling Electron callback. (Task 5)

---

## File Structure

- Create `firmware/main/ble_pair.h`, `firmware/main/ble_pair.c`: pure passkey helpers.
- Create `firmware/host/test_ble_pair.c`: host tests.
- Modify `firmware/host/run.sh`, `firmware/main/CMakeLists.txt`: register them.
- Modify `firmware/sdkconfig.defaults`: security, NVS persistence, bonds.
- Modify `firmware/main/ble_link.c`, `ble_link.h`: security setup, passkey action, authenticated flags, gated status, forget.
- Modify `firmware/main/ble_desk.c`, `ble_desk.h`, `firmware/host/test_ble_desk.c`: `pair` line and the locked status.
- Modify `firmware/main/ui.c`, `ui.h`, `main.c`: pairing overlay and the Forget pairings button.
- Create `src/main/pairing.ts`, `test/main/pairing.test.ts`: PIN validation.
- Modify `src/main/devices.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`: pairing handler and bridge.
- Create `src/renderer/src/device/PairingPrompt.tsx` and its test. Modify `src/renderer/src/App.tsx`.
- Modify `src/renderer/src/device/ble.ts`, `ble.test.ts`: refuse non-pairing panels, trigger pairing.
- Modify `DESIGN.md`, `firmware/README.md`.

Commit grouping: Task 1 is a spike and commits nothing unless it passes. Tasks 2 to 4 are one commit, Tasks 5 to 7 one, Task 8 one.

---

### Task 1: Spike, does NimBLE security fit beside Wi-Fi?

**Files:**

- Modify: `firmware/sdkconfig.defaults:63,69,70,86`

This task decides whether the rest of the plan can proceed. It changes only configuration.

- [ ] **Step 1: Record the baseline**

Run on the current firmware (flash `main`'s build first if the panel runs something else):

```bash
cd firmware && . ~/esp/esp-idf/export.sh && python - <<'PY'
import serial,time
s=serial.Serial('/dev/ttyACM0',115200,timeout=1)
s.dtr=False; s.rts=True; time.sleep(.15); s.rts=False
t=time.time(); out=b''
while time.time()-t<12: out+=s.read(4096)
for l in out.decode(errors='replace').splitlines():
    if 'largest internal DMA' in l or 'sta ip' in l: print(l)
PY
```

Expected: a line like `I (...) ble-link: largest internal DMA 5xxxx after NimBLE` and a `sta ip:` line. Write the DMA number down as BASELINE.

- [ ] **Step 2: Turn security on**

```bash
sed -i 's/^CONFIG_BT_NIMBLE_MAX_BONDS=1/CONFIG_BT_NIMBLE_MAX_BONDS=3/; s/^# CONFIG_BT_NIMBLE_SECURITY_ENABLE is not set/CONFIG_BT_NIMBLE_SECURITY_ENABLE=y/; s/^# CONFIG_BT_NIMBLE_NVS_PERSIST is not set/CONFIG_BT_NIMBLE_NVS_PERSIST=y/; s/^# CONFIG_BT_CTRL_BLE_SECURITY_ENABLE is not set/CONFIG_BT_CTRL_BLE_SECURITY_ENABLE=y/' firmware/sdkconfig.defaults
grep -n "NIMBLE_SECURITY\|NVS_PERSIST\|MAX_BONDS\|CTRL_BLE_SECURITY" firmware/sdkconfig.defaults
rm -f firmware/sdkconfig
```

Expected: the four lines now read `=y` or `=3`.

- [ ] **Step 3: Build, flash, read the numbers**

```bash
cd firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|Project build complete" && idf.py -p /dev/ttyACM0 app-flash 2>&1 | tail -1
```

Then repeat the Step 1 serial read. Expected: `largest internal DMA` is at least 48000, and a `sta ip:` line appears within 12 seconds.

- [ ] **Step 4: Decide**

If DMA is at least 48000 and the station joins: keep the config, ledger `Spike B: pass, DMA <baseline> -> <after>`, and continue. If not: `git checkout firmware/sdkconfig.defaults`, ledger the numbers, and **stop**: report to the person that the spec's largest risk landed and the design needs a decision (shrink another buffer, or drop bonding persistence). Do not continue to Task 2.

---

### Task 2: Passkey helpers (pure C)

**Files:**

- Create: `firmware/main/ble_pair.h`, `firmware/main/ble_pair.c`, `firmware/host/test_ble_pair.c`
- Modify: `firmware/host/run.sh`, `firmware/main/CMakeLists.txt`

**Interfaces:**

- Produces: `uint32_t ble_pair_passkey(uint32_t random)` returns 0 to 999999; `int ble_pair_format(uint32_t passkey, char *out, size_t cap)` writes `"123 456"` and returns its length (7), or 0 if `cap` is under `BLE_PAIR_TEXT_MAX`; `#define BLE_PAIR_TEXT_MAX 8`.

- [ ] **Step 1: Write the failing test** `firmware/host/test_ble_pair.c`

```c
#include "ble_pair.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

int main(void) {
    char text[BLE_PAIR_TEXT_MAX];
    check(ble_pair_passkey(0) == 0, "zero stays zero");
    check(ble_pair_passkey(999999) == 999999, "999999 stays");
    check(ble_pair_passkey(1000000) == 0, "a million wraps to zero");
    check(ble_pair_passkey(4294967295u) == 4294967295u % 1000000u, "the largest random value stays in range");
    for (uint32_t r = 0; r < 5000000; r += 997) {
        check(ble_pair_passkey(r) < 1000000, "always under a million");
    }

    check(ble_pair_format(123456, text, sizeof text) == 7 && strcmp(text, "123 456") == 0,
          "formats with a space");
    check(ble_pair_format(7, text, sizeof text) == 7 && strcmp(text, "000 007") == 0,
          "pads with zeros");
    check(ble_pair_format(0, text, sizeof text) == 7 && strcmp(text, "000 000") == 0, "zero");
    check(ble_pair_format(999999, text, sizeof text) == 7 && strcmp(text, "999 999") == 0, "max");
    check(ble_pair_format(123456, text, 7) == 0 && text[0] == '\0', "a buffer that is too small gives empty");

    if (g_failed) {
        return 1;
    }
    puts("test_ble_pair ok");
    return 0;
}
```

Add to `firmware/host/run.sh` after the `test_ble_desk` line: `run test_ble_pair firmware/main/ble_pair.c`.

- [ ] **Step 2: Run to verify it fails**

Run: `firmware/host/run.sh`
Expected: FAIL to compile, `ble_pair.h: No such file or directory`.

- [ ] **Step 3: Implement**

`firmware/main/ble_pair.h`:

```c
#pragma once

#include <stddef.h>
#include <stdint.h>

/* The pairing passkey is 6 digits, shown on the glass as "123 456". */
#define BLE_PAIR_TEXT_MAX 8

uint32_t ble_pair_passkey(uint32_t random);
int ble_pair_format(uint32_t passkey, char *out, size_t cap);
```

`firmware/main/ble_pair.c`:

```c
#include "ble_pair.h"

#include <stdio.h>

uint32_t ble_pair_passkey(uint32_t random) {
    return random % 1000000u;
}

int ble_pair_format(uint32_t passkey, char *out, size_t cap) {
    int n;
    if (!out || cap == 0) {
        return 0;
    }
    out[0] = '\0';
    if (cap < BLE_PAIR_TEXT_MAX) {
        return 0;
    }
    n = snprintf(out, cap, "%03u %03u", (unsigned)(passkey / 1000u), (unsigned)(passkey % 1000u));
    if (n != 7) {
        out[0] = '\0';
        return 0;
    }
    return n;
}
```

Add `"ble_pair.c"` to `SRCS` in `firmware/main/CMakeLists.txt` after `"ble_link.c"`.

- [ ] **Step 4: Run to verify it passes**

Run: `firmware/host/run.sh`
Expected: `ok   test_ble_pair` and every other host test `ok`.

---

### Task 3: Firmware security, gated status, authenticated writes, forget

**Files:**

- Modify: `firmware/main/ble_desk.c`, `ble_desk.h`, `firmware/host/test_ble_desk.c`, `firmware/main/ble_link.c`, `ble_link.h`

**Interfaces:**

- Consumes: `ble_pair_passkey`, `ble_pair_format`, `BLE_PAIR_TEXT_MAX` (Task 2).
- Produces:
  - `int ble_desk_format_status_locked(char *out, size_t cap, const char *fw)` gives `name=ginger\nfw=<fw>\npair=1\npaired=0\n`. The full `ble_desk_format_status` gains a final `pair=1\npaired=1\n`.
  - In `ble_link.h`: `typedef void (*ble_link_pair_show_fn)(const char *pin_text); typedef void (*ble_link_pair_hide_fn)(void); void ble_link_set_pair_callbacks(ble_link_pair_show_fn show, ble_link_pair_hide_fn hide); void ble_link_forget_pairings(void);`

- [ ] **Step 1: Write the failing tests** in `firmware/host/test_ble_desk.c`

Find the existing status test in that file and add, next to it:

```c
    {
        char locked[128];
        int n = ble_desk_format_status_locked(locked, sizeof locked, "abc1234");
        check(n > 0 && strcmp(locked, "name=ginger\nfw=abc1234\npair=1\npaired=0\n") == 0,
              "locked status shows only name, fw and the pairing flags");
        check(strstr(locked, "ssid=") == NULL && strstr(locked, "url=") == NULL &&
                  strstr(locked, "token=") == NULL,
              "locked status leaks no network detail");
        check(ble_desk_format_status_locked(locked, 8, "abc1234") < 0, "locked status refuses a small buffer");
    }
```

and change the existing full-status expectation so the string ends with `pair=1\npaired=1\n`.

Run: `firmware/host/run.sh`
Expected: FAIL to compile (`ble_desk_format_status_locked` undeclared).

- [ ] **Step 2: Implement the status builders**

In `ble_desk.h` declare `int ble_desk_format_status_locked(char *out, size_t cap, const char *fw);`. In `ble_desk.c` change the full builder's format to `"name=%s\nfw=%s\nssid=%s\nurl=%s\ntoken=%s\npair=1\npaired=1\n"` and add:

```c
int ble_desk_format_status_locked(char *out, size_t cap, const char *fw) {
    char fw_buf[48];
    int n;
    if (!out || cap == 0) {
        return -1;
    }
    clean_field(fw_buf, sizeof(fw_buf), fw, "unknown");
    n = snprintf(out, cap, "name=%s\nfw=%s\npair=1\npaired=0\n", BLE_DESK_NAME, fw_buf);
    if (n < 0 || (size_t)n >= cap) {
        out[0] = '\0';
        return -1;
    }
    return n;
}
```

Run `firmware/host/run.sh`. Expected: all host tests `ok`.

- [ ] **Step 3: Security setup and passkey action in `ble_link.c`**

Add includes `#include "ble_pair.h"` and `#include "esp_random.h"`. Near the other statics add:

```c
static ble_link_pair_show_fn s_pair_show;
static ble_link_pair_hide_fn s_pair_hide;

void ble_link_set_pair_callbacks(ble_link_pair_show_fn show, ble_link_pair_hide_fn hide) {
    s_pair_show = show;
    s_pair_hide = hide;
}

static void pair_hide(void) {
    if (s_pair_hide) {
        s_pair_hide();
    }
}
```

In `start_radio`, replace the `ponytail: open GATT` comment and the `#if CONFIG_BT_NIMBLE_SECURITY_ENABLE` block with:

```c
    /* The glass shows the passkey, the computer types it: MITM-protected LE Secure Connections,
     * with the keys kept in NVS so a paired computer reconnects without a PIN. */
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
    ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_ONLY;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_mitm = 1;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
```

(and delete the now-duplicate three assignments of `reset_cb`, `sync_cb`, `store_status_cb` above it.)

In `gap_event`, add before `default:`:

```c
    case BLE_GAP_EVENT_PASSKEY_ACTION: {
        struct ble_sm_io io;
        char text[BLE_PAIR_TEXT_MAX];
        uint32_t key;
        if (event->passkey.params.action != BLE_SM_IOACT_DISP) {
            return 0;
        }
        key = ble_pair_passkey(esp_random());
        memset(&io, 0, sizeof io);
        io.action = BLE_SM_IOACT_DISP;
        io.passkey = key;
        if (ble_pair_format(key, text, sizeof text) > 0 && s_pair_show) {
            s_pair_show(text);
        }
        return ble_sm_inject_io(event->passkey.conn_handle, &io);
    }
    case BLE_GAP_EVENT_ENC_CHANGE:
        pair_hide();
        return 0;
```

and in the `BLE_GAP_EVENT_DISCONNECT` case add `pair_hide();` as its first statement.

- [ ] **Step 4: Authenticated flags and the gated status**

In `s_svcs`, change the flags: `url` becomes `BLE_GATT_CHR_F_READ_AUTHEN | BLE_GATT_CHR_F_WRITE_AUTHEN`; `token`, `wifi` and `reboot` become `BLE_GATT_CHR_F_WRITE_AUTHEN`; `scan` and `verify` become `BLE_GATT_CHR_F_READ_AUTHEN | BLE_GATT_CHR_F_WRITE_AUTHEN`. Leave `status` as `BLE_GATT_CHR_F_READ`. Update the UUID comment above the table to say the status is open and the rest need a paired link.

Change the read dispatch in `access` to pass the connection:

```c
        if (op == BLE_DESK_OP_STATUS) {
            return read_status(conn_handle, ctxt->om);
        }
```

and delete the `(void)conn_handle;` line from `access`. Replace the start of `read_status` (currently `static int read_status(struct os_mbuf *om) {`, which declares `ssid`, `url`, `body`, `token_set`, `n`) so an unpaired link gets the locked status and nothing else:

```c
static int read_status(uint16_t conn_handle, struct os_mbuf *om) {
    char ssid[33];
    char url[128];
    char body[256];
    struct ble_gap_conn_desc desc;
    int token_set = 0;
    int n;
    /* Until the link is paired and encrypted, the status says only that this panel pairs. */
    if (ble_gap_conn_find(conn_handle, &desc) != 0 || !desc.sec_state.encrypted) {
        n = ble_desk_format_status_locked(body, sizeof(body), DESK_FW_SHA);
        return append_text(om, body, n);
    }
    ssid[0] = '\0';
    url[0] = '\0';
    /* ...the rest of the function is unchanged: it reads the store and calls
     * ble_desk_format_status(...) as before. */
```

Keep everything from `ble_link_enter();` onward exactly as it is.

- [ ] **Step 5: Forget pairings**

Add to `ble_link.h` the typedefs and prototypes from the Interfaces block, and to `ble_link.c`:

```c
void ble_link_forget_pairings(void) {
#if CONFIG_BT_NIMBLE_ENABLED
    ble_store_clear();
    if (s_conn != BLE_LINK_NO_CONN) {
        ble_gap_terminate(s_conn, BLE_LINK_TERM_USER);
    }
#endif
}
```

(include `"host/ble_store.h"` if the build asks.)

- [ ] **Step 6: Build**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|Project build complete"`
Expected: `Project build complete`. Then `firmware/host/run.sh`: all `ok`.

---

### Task 4: The panel's pairing overlay and Forget button

**Files:**

- Modify: `firmware/main/ui.h`, `firmware/main/ui.c`, `firmware/main/main.c`

**Interfaces:**

- Consumes: `ble_link_set_pair_callbacks`, `ble_link_forget_pairings` (Task 3).
- Produces: `void ui_show_pairing(const char *pin_text); void ui_hide_pairing(void); typedef void (*ui_action_fn)(void); void ui_bind_forget_pairings(ui_action_fn fn);`. Callers hold the LVGL lock.

- [ ] **Step 1: Declare**

In `ui.h` add:

```c
/* The Bluetooth pairing passkey, as "123 456". Hidden again once the link is encrypted. */
void ui_show_pairing(const char *pin_text);
void ui_hide_pairing(void);
typedef void (*ui_action_fn)(void);
void ui_bind_forget_pairings(ui_action_fn fn);
```

- [ ] **Step 2: The overlay and the button in `ui.c`**

Add next to the other statics (`s_bat_box`):

```c
static lv_obj_t *s_pair_card;
static lv_obj_t *s_pair_pin;
static ui_action_fn s_on_forget;
```

and, above `build_battery`:

```c
/* Pairing card on the top layer, so it sits over every screen. The digits use the 20 px font
 * with wide spacing: that is the largest face the firmware ships. */
void ui_show_pairing(const char *pin_text) {
    lv_obj_t *title;
    if (!s_pair_card) {
        s_pair_card = lv_obj_create(lv_layer_top());
        lv_obj_set_size(s_pair_card, 360, 180);
        lv_obj_center(s_pair_card);
        lv_obj_set_style_bg_color(s_pair_card, lv_color_hex(DOCK), 0);
        lv_obj_set_style_bg_opa(s_pair_card, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(s_pair_card, 18, 0);
        lv_obj_set_style_border_width(s_pair_card, 3, 0);
        lv_obj_set_style_border_color(s_pair_card, lv_color_hex(FIELD_EDGE), 0);
        lv_obj_clear_flag(s_pair_card, LV_OBJ_FLAG_SCROLLABLE);
        title = lv_label_create(s_pair_card);
        lv_label_set_text_static(title, "Pair with a computer");
        lv_obj_set_style_text_font(title, &lv_font_montserrat_20, 0);
        lv_obj_set_style_text_color(title, lv_color_hex(INK_DIM), 0);
        lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 8);
        s_pair_pin = lv_label_create(s_pair_card);
        lv_obj_set_style_text_font(s_pair_pin, &lv_font_montserrat_20, 0);
        lv_obj_set_style_text_color(s_pair_pin, lv_color_hex(INK), 0);
        lv_obj_set_style_text_letter_space(s_pair_pin, 8, 0);
        lv_obj_align(s_pair_pin, LV_ALIGN_CENTER, 0, 8);
    }
    lv_label_set_text(s_pair_pin, pin_text ? pin_text : "");
    lv_obj_clear_flag(s_pair_card, LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_foreground(s_pair_card);
}

void ui_hide_pairing(void) {
    if (s_pair_card) {
        lv_obj_add_flag(s_pair_card, LV_OBJ_FLAG_HIDDEN);
    }
}

void ui_bind_forget_pairings(ui_action_fn fn) {
    s_on_forget = fn;
}

static void on_forget_clicked(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED) {
        return;
    }
    if (s_on_forget) {
        s_on_forget();
    }
    ui_set_settings_status("Bluetooth pairings cleared.");
}
```

Where the settings sheet builds its buttons (`scan = action_button(actions, "Scan", on_scan_clicked);`), add on the next line `(void)action_button(actions, "Forget pairings", on_forget_clicked);`. `on_forget_clicked` must be defined above that function, and `ui_set_settings_status` is already declared in `ui.h`.

- [ ] **Step 3: Wire in `main.c`**

Add, next to `on_power`:

```c
static void on_pair_show(const char *pin_text) {
    if (lock_lvgl()) {
        ui_show_pairing(pin_text);
        unlock_lvgl();
    }
}

static void on_pair_hide(void) {
    if (lock_lvgl()) {
        ui_hide_pairing();
        unlock_lvgl();
    }
}
```

Where `ui_bind_rotlock(...)` is called (inside the `lock_lvgl()` block after `ui_init`), add `ui_bind_forget_pairings(ble_link_forget_pairings);`. Before `ble_link_start(...)` is called, add `ble_link_set_pair_callbacks(on_pair_show, on_pair_hide);`.

- [ ] **Step 4: Build, host tests, flash**

```bash
firmware/host/run.sh
cd firmware && . ~/esp/esp-idf/export.sh && idf.py build 2>&1 | grep -E "error:|Project build complete" && idf.py -p /dev/ttyACM0 app-flash 2>&1 | tail -1
```

Expected: all host tests `ok`, `Project build complete`, flash `Done`. The panel boots and the Wi-Fi lamp turns green.

- [ ] **Step 5: Stage for the commit**

`git add firmware` then `pre-commit run`, then one `timeshare run` commits `Pair Bluetooth with a PIN on the panel's glass` and pushes.

---

### Task 5: The app answers the pairing request

**Files:**

- Create: `src/main/pairing.ts`, `test/main/pairing.test.ts`
- Modify: `src/main/devices.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`

**Interfaces:**

- Produces: `pairResponse(pin: unknown): { confirmed: boolean; pin?: string }`. In `CalicoApi`: `onBlePair(cb: () => void): () => void` and `answerBlePair(pin: string | null): void`.

- [ ] **Step 1: Write the failing test** `test/main/pairing.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { pairResponse } from "../../src/main/pairing";

describe("pairResponse", () => {
  it("confirms a six-digit PIN", () => {
    expect(pairResponse("123456")).toEqual({ confirmed: true, pin: "123456" });
    expect(pairResponse("000007")).toEqual({ confirmed: true, pin: "000007" });
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "12345",
      "1234567",
      "12 456",
      "abcdef",
      "12345a",
      123456,
      { pin: "123456" },
    ])
      expect(pairResponse(bad), String(bad)).toEqual({ confirmed: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/main/pairing.test.ts`
Expected: FAIL, cannot find module `../../src/main/pairing`.

- [ ] **Step 3: Implement**

`src/main/pairing.ts`:

```ts
export interface PairResponse {
  confirmed: boolean;
  pin?: string;
}

/** The renderer's answer to a Bluetooth pairing request: a six-digit PIN, or a refusal. */
export function pairResponse(pin: unknown): PairResponse {
  if (typeof pin === "string" && /^\d{6}$/.test(pin))
    return { confirmed: true, pin };
  return { confirmed: false };
}
```

In `src/main/devices.ts` add `import { type PairResponse, pairResponse } from "./pairing";` and, after the `ipcMain.on("device:ble-choose", ...)` block:

```ts
// The OS asks for the panel's PIN while it pairs. Ask the renderer, and give up after a minute
// so Electron's callback is never left hanging.
let pairCallback: ((response: PairResponse) => void) | null = null;
let pairTimer: NodeJS.Timeout | null = null;
const finishPair = (response: PairResponse) => {
  if (pairTimer) clearTimeout(pairTimer);
  pairTimer = null;
  const callback = pairCallback;
  pairCallback = null;
  callback?.(response);
};
session.setBluetoothPairingHandler((details, callback) => {
  if (details.pairingKind !== "providePin") {
    callback({ confirmed: false });
    return;
  }
  finishPair({ confirmed: false });
  pairCallback = callback;
  pairTimer = setTimeout(() => finishPair({ confirmed: false }), 60_000);
  contents.send("device:ble-pair");
});
ipcMain.on("device:ble-pin", (_event, pin: unknown) =>
  finishPair(pairResponse(pin)),
);
```

In `src/preload/index.ts` after `chooseBle`:

```ts
  onBlePair: (cb) => subscribe("device:ble-pair", cb),
  answerBlePair: (pin) => ipcRenderer.send("device:ble-pin", pin),
```

In `CalicoApi` (`src/shared/ipc.ts`) after `chooseBle(id: string): void;`:

```ts
  /** The panel is showing a pairing PIN and the OS wants it. */
  onBlePair(cb: () => void): () => void;
  /** The six-digit PIN, or null to give up. */
  answerBlePair(pin: string | null): void;
```

- [ ] **Step 4: Run, typecheck**

Run: `pnpm vitest run test/main/pairing.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean. (If any `window.calico` stub in a test now fails typechecking for the new members, add `onBlePair: () => () => undefined, answerBlePair: () => undefined` to it.)

---

### Task 6: The PIN prompt

**Files:**

- Create: `src/renderer/src/device/PairingPrompt.tsx`, `src/renderer/src/device/PairingPrompt.test.tsx`
- Modify: `src/renderer/src/App.tsx`, `DESIGN.md`

**Interfaces:**

- Consumes: `window.calico.onBlePair`, `window.calico.answerBlePair` (Task 5).

- [ ] **Step 1: Write the failing test** `PairingPrompt.test.tsx`

```tsx
// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalicoApi } from "../../../shared/ipc";
import { PairingPrompt } from "./PairingPrompt";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  let ask: () => void = () => undefined;
  const answer = vi.fn();
  window.calico = {
    onBlePair: (cb: () => void) => {
      ask = cb;
      return () => undefined;
    },
    answerBlePair: answer,
  } as unknown as CalicoApi;
  render(<PairingPrompt />);
  return { ask: () => act(() => ask()), answer };
}

describe("PairingPrompt", () => {
  it("stays out of the way until the panel asks", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the code on the panel, and sends it once it is six digits", () => {
    const { ask, answer } = setup();
    ask();
    const field = screen.getByLabelText(
      "Code shown on the panel",
    ) as HTMLInputElement;
    const pair = screen.getByRole("button", {
      name: "Pair",
    }) as HTMLButtonElement;
    expect(pair.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "12 34a5" } });
    expect(field.value).toBe("12345");
    expect(pair.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "123456" } });
    expect(pair.disabled).toBe(false);
    fireEvent.click(pair);
    expect(answer).toHaveBeenCalledWith("123456");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives up cleanly on Cancel", () => {
    const { ask, answer } = setup();
    ask();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts empty each time it is asked", () => {
    const { ask } = setup();
    ask();
    fireEvent.change(screen.getByLabelText("Code shown on the panel"), {
      target: { value: "111111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    ask();
    expect(
      (screen.getByLabelText("Code shown on the panel") as HTMLInputElement)
        .value,
    ).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/renderer/src/device/PairingPrompt.test.tsx`
Expected: FAIL, cannot find module `./PairingPrompt`.

- [ ] **Step 3: Implement** `PairingPrompt.tsx`

```tsx
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";

/** Asks for the 6-digit code the panel shows while a computer pairs with it over Bluetooth. */
export function PairingPrompt() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");

  useEffect(
    () =>
      window.calico.onBlePair(() => {
        setPin("");
        setOpen(true);
      }),
    [],
  );

  function answer(value: string | null) {
    window.calico.answerBlePair(value);
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && answer(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-glass/80" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 w-96 -translate-x-1/2 -translate-y-1/2 border border-stroke bg-surface">
          <Dialog.Title className="section-title">
            Pair with the panel
          </Dialog.Title>
          <p className="px-4 pb-3 text-muted">
            The panel is showing a 6-digit code on its screen. Type it here.
          </p>
          <label className="label px-4">
            Code shown on the panel
            <input
              className="field mt-1 font-mono tracking-widest"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <div className="flex gap-3 px-4 py-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pin.length !== 6}
              onClick={() => answer(pin)}
            >
              Pair
            </button>
            <button type="button" className="btn" onClick={() => answer(null)}>
              Cancel
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

In `App.tsx` add `import { PairingPrompt } from "./device/PairingPrompt";` and render `<PairingPrompt />` on the line after `<Picker />`. In `DESIGN.md`, in the "Modals for anything except" line, add `, the Bluetooth pairing PIN` to the list of allowed cases.

- [ ] **Step 4: Run**

Run: `pnpm vitest run src/renderer/src/device/PairingPrompt.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, lint and typecheck clean.

---

### Task 7: Refuse non-pairing panels, trigger pairing

**Files:**

- Modify: `src/renderer/src/device/ble.ts`, `src/renderer/src/device/ble.test.ts`

**Interfaces:**

- Produces: `requirePairing(statusBody: string): "paired" | "needs-pairing"`, throwing `Error` with the text `This panel's firmware does not pair yet. Flash the latest firmware, then connect again.` when the status lacks `pair=1`.

- [ ] **Step 1: Write the failing tests** (append to `ble.test.ts`; add `requirePairing` to its import from `./ble`)

```ts
describe("requirePairing", () => {
  it("accepts a panel that pairs and is already paired", () => {
    expect(
      requirePairing(
        "name=ginger\nfw=abc\nssid=Home\nurl=http://h\ntoken=set\npair=1\npaired=1\n",
      ),
    ).toBe("paired");
  });

  it("asks for pairing when the panel says the link is not paired", () => {
    expect(requirePairing("name=ginger\nfw=abc\npair=1\npaired=0\n")).toBe(
      "needs-pairing",
    );
  });

  it("refuses firmware that does not pair, so no secret is sent to it", () => {
    expect(() =>
      requirePairing("name=ginger\nfw=abc\nssid=Home\nurl=none\ntoken=none\n"),
    ).toThrow(/does not pair yet/);
    expect(() => requirePairing("")).toThrow(/does not pair yet/);
  });
});
```

Run: `pnpm vitest run src/renderer/src/device/ble.test.ts`
Expected: FAIL, `requirePairing` is not exported.

- [ ] **Step 2: Implement**

In `ble.ts` add after the `UUID` constant:

```ts
/**
 * The panel's status says whether it pairs and whether this link is paired. A panel that does not
 * report `pair=1` is firmware from before pairing: it gets no secret from us.
 */
export function requirePairing(statusBody: string): "paired" | "needs-pairing" {
  const kv = parseKv(statusBody);
  if (kv.pair !== "1")
    throw new Error(
      "This panel's firmware does not pair yet. Flash the latest firmware, then connect again.",
    );
  return kv.paired === "1" ? "paired" : "needs-pairing";
}
```

In `connectBle`, build the `Gatt` object first, then pair before returning the link:

```ts
const decoder = new TextDecoder();
const gatt: Gatt = {
  async read(uuid) {
    const view = await (await char(uuid)).readValue();
    return decoder.decode(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  },
  async write(uuid, data) {
    await (await char(uuid)).writeValueWithResponse(data);
  },
  disconnect: () => server.disconnect(),
};
if (requirePairing(await gatt.read(UUID.status)) === "needs-pairing") {
  try {
    // Reading a protected characteristic makes the OS pair, which asks us for the PIN.
    await gatt.read(UUID.url);
  } catch {
    server.disconnect();
    throw new Error(
      "Pairing did not finish. Check the code on the panel and try again.",
    );
  }
}
return new BleLink(gatt);
```

(Remove the old inline object passed to `new BleLink(...)`.)

- [ ] **Step 3: Run everything**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 4: Stage for the commit**

`git add src DESIGN.md test` then `pre-commit run`, then one `timeshare run` commits `Pair with the panel from the app` and pushes.

---

### Task 8: Hardware check, docs, PR

**Files:**

- Modify: `firmware/README.md`

- [ ] **Step 1: Document**

In `firmware/README.md`, in the Bluetooth part, add: `Bluetooth requires pairing. A computer that connects sees only the name and firmware version until it pairs: the panel shows a 6-digit code on its glass, and the computer types it once. The panel remembers up to three computers. Settings has a Forget pairings button. Writes, scans and the full status need the paired link. After changing sdkconfig.defaults, delete firmware/sdkconfig and reconfigure. Do not erase NVS.`

- [ ] **Step 2: Check on the board** (the person is at the panel)

Flash the build (`idf.py -p /dev/ttyACM0 app-flash`), then in the dev app (`CALICO_USER_DATA=$HOME/.config/calico-dev pnpm dev`):

1. Device, Connect over Bluetooth, pick `ginger`. **Expected:** a card with a 6-digit code appears on the panel's glass and the app's "Pair with the panel" prompt appears.
2. Type a **wrong** code, press Pair. **Expected:** the glass card disappears, the app says "Pairing did not finish. Check the code on the panel and try again.", and nothing on the panel changed.
3. Connect again, type the **right** code. **Expected:** the card disappears and the Device screen shows the panel's SSID, URL and token state.
4. Disconnect and connect again. **Expected:** no code is asked for (the pairing is remembered).
5. On the panel: Settings, Forget pairings. Connect again. **Expected:** the code is asked for again.
6. If step 1 shows no app prompt but the OS shows its own pairing dialog instead, **stop**: the spec's fallback applies, and the person decides.

Ledger the result of each step, and the DMA number from Task 1's method on this final build.

- [ ] **Step 3: Verify and open the PR**

```bash
firmware/host/run.sh && pnpm lint && pnpm typecheck && pnpm test
```

Expected: all pass. Stage, `pre-commit run`, one `timeshare run` commits `Document Bluetooth pairing`, push, open the PR as a draft with the hardware results, run the light `senior-code-reviewer` pass, and mark ready only when CI is green and the person accepts the check on the board.
