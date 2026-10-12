# Panel Battery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the panel's AXP2101 battery in a macOS-style widget at the top right of its status bar, report it to Calico on the panel's existing poll, and show it in the app.

**Architecture:** A pure C decoder (`power.c`) turns five AXP2101 register bytes into a reading. An ESP-IDF task (`power_task.c`) reads the chip every 10 s and notifies the UI. The panel appends `?bat=&chg=&ext=` to its `GET /api/status` poll. The companion validates and stores the latest value with its receipt time, `CalicoInfo` carries it to the renderer, and a header chip shows it while fresh.

**Tech Stack:** ESP-IDF 5.5 C and LVGL 9 (firmware, host tests with system gcc), TypeScript, Node http server, Electron, React 19, Tailwind, Lucide, vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-panel-battery-design.md`

## Global Constraints

- Firmware palette only: cream `INK 0xefe7d6`, sage `ROW_MARK 0x9bb57a`, amber `LAMP_AMBER 0xe2a23a`, red `LAMP_RED 0xc4544a`. No new colors.
- App: Tailwind classes only, no inline styles, Lucide icons, no new colors (`DESIGN.md`).
- `GET /api/status` stays unauthenticated. The battery is display-only.
- Report only from non-loopback callers, as `lastPanelPoll` does.
- A reading older than 60 000 ms is shown as nothing.
- Test first. Run `pre-commit run --files <files>` before any commit. One `timeshare run` per commit, run from `~/bin/src/calico` (timeshare cannot see a worktree's `.git`), commit trailers as in prior commits, and no Claude session link in PR bodies.
- Prose and comments: avoid em-dashes.

## Review Focus

- Unplugged USB: the VBUS ADC reads garbage (`0x3FF3`). Output must never carry a VBUS voltage. (Task 1)
- Chip absent or unanswered: the widget is hidden and the poll sends no query, so an older or newer companion sees "no battery data". (Tasks 1, 2, 3)
- Percent over 100 or a battery under 2500 mV: clamped, or treated as no battery. (Task 1)
- Malformed, partial or out-of-range query values: ignored, previous value kept. (Task 5)
- Panel off or unreachable: the app shows no figure after 60 s, never a stale one. (Task 8)

---

## File Structure

- Create `firmware/main/power.h`, `firmware/main/power.c`: pure decode, query string, fill choice. Host-testable.
- Create `firmware/main/power_task.c`: I2C read task, `power_start`, `power_get`. ESP-IDF only.
- Create `firmware/host/test_power.c`: host test for `power.c`.
- Modify `firmware/host/run.sh`, `firmware/main/CMakeLists.txt`: register the new files.
- Modify `firmware/main/net.c`: query on the status poll.
- Modify `firmware/main/ui.c`, `firmware/main/ui.h`: the widget and `ui_set_battery`.
- Modify `firmware/main/main.c`: start the task, forward readings to the UI.
- Create `src/server/panel-battery.ts`, `test/server/panel-battery.test.ts`: query parser.
- Modify `src/server/http.ts`, `test/server/http.test.ts`: record and stats field.
- Modify `src/shared/ipc.ts`, `src/main/index.ts`: `PanelBatteryInfo` and `CalicoInfo.panelBattery`.
- Modify the two `CalicoInfo` test fixtures: `src/renderer/src/device/DeviceView.test.tsx`, `src/renderer/src/settings/AgentUpdatesSection.test.tsx`.
- Create `src/renderer/src/lib/panel-battery.ts` and its test, `src/renderer/src/shell/PanelBattery.tsx` and its test. Modify `src/renderer/src/App.tsx`.
- Modify `firmware/README.md`: document the widget and query.

Commit grouping: Tasks 1 to 4 are one commit, Tasks 5 to 7 one commit, Task 8 and 9 one commit.

---

### Task 1: Decode the chip (pure C)

**Files:**

- Create: `firmware/main/power.h`, `firmware/main/power.c`, `firmware/host/test_power.c`
- Modify: `firmware/host/run.sh`

**Interfaces:**

- Produces:
  - `typedef struct { int present; int percent; int millivolts; int charging; int external; } power_reading_t;`
  - `void power_decode(const uint8_t regs[5], power_reading_t *out);` where `regs` is the bytes of registers `0x00`, `0x01`, `0xA4`, `0x34`, `0x35` in that order.
  - `int power_query(const power_reading_t *r, char *out, size_t cap);` writes `?bat=81&chg=1&ext=1`, or `""` when absent. Returns the length written.
  - `typedef enum { POWER_FILL_INK, POWER_FILL_AMBER, POWER_FILL_RED, POWER_FILL_SAGE } power_fill_t;` and `power_fill_t power_fill(const power_reading_t *r);`
  - `typedef void (*power_listener_t)(const power_reading_t *r);`, `void power_start(power_listener_t on_change);`, `void power_get(power_reading_t *out);` (declared here, implemented in Task 2).

- [ ] **Step 1: Write the failing test** `firmware/host/test_power.c`

```c
#include "power.h"

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
    /* Bytes captured on the real board. Order: 0x00 0x01 0xA4 0x34 0x35. */
    const uint8_t plugged[5] = {0x38, 0x32, 0x51, 0x0F, 0x88};
    const uint8_t unplugged[5] = {0x18, 0x55, 0x51, 0x0F, 0x62};
    uint8_t regs[5];
    power_reading_t r;
    char q[48];

    power_decode(plugged, &r);
    check(r.present == 1, "plugged present");
    check(r.percent == 81, "plugged percent");
    check(r.millivolts == 3976, "plugged mv");
    check(r.charging == 1, "plugged charging");
    check(r.external == 1, "plugged external");
    check(power_fill(&r) == POWER_FILL_SAGE, "charging is sage");

    power_decode(unplugged, &r);
    check(r.charging == 0, "unplugged not charging");
    check(r.external == 0, "unplugged not external");
    check(r.millivolts == 3938, "unplugged mv");
    check(power_fill(&r) == POWER_FILL_INK, "81 percent on battery is ink");

    memcpy(regs, unplugged, sizeof regs);
    regs[2] = 0xFF;
    power_decode(regs, &r);
    check(r.percent == 100, "percent over 100 clamps");

    memcpy(regs, unplugged, sizeof regs);
    regs[3] = 0x00;
    regs[4] = 0x10;
    power_decode(regs, &r);
    check(r.present == 0, "under 2500 mV is no battery");

    regs[3] = 0xFF;
    power_decode(regs, &r);
    check(r.millivolts == (0x3F << 8 | 0x10), "top two bits of the high byte are masked");

    memcpy(regs, unplugged, sizeof regs);
    regs[2] = 20;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_AMBER, "20 is amber");
    regs[2] = 21;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_INK, "21 is ink");
    regs[2] = 10;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_RED, "10 is red");
    regs[1] = 0x32;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_SAGE, "charging at 10 is sage");

    power_decode(plugged, &r);
    check(power_query(&r, q, sizeof q) > 0 && strcmp(q, "?bat=81&chg=1&ext=1") == 0, "query");
    power_decode(unplugged, &r);
    power_query(&r, q, sizeof q);
    check(strcmp(q, "?bat=81&chg=0&ext=0") == 0, "query on battery");
    memset(&r, 0, sizeof r);
    check(power_query(&r, q, sizeof q) == 0 && q[0] == '\0', "absent sends no query");
    check(power_query(&r, q, 4) == 0, "absent with a tiny buffer is safe");
    power_decode(plugged, &r);
    check(power_query(&r, q, 6) == 0 && q[0] == '\0', "too small a buffer yields empty");

    if (g_failed) {
        return 1;
    }
    puts("test_power ok");
    return 0;
}
```

- [ ] **Step 2: Register it, run it, watch it fail**

Add this line to `firmware/host/run.sh` after the `test_orient` line (keep alphabetical order):

```bash
run test_power firmware/main/power.c
```

Run: `firmware/host/run.sh`
Expected: FAIL to compile with `power.h: No such file or directory`.

- [ ] **Step 3: Write the minimal implementation**

`firmware/main/power.h`:

```c
#pragma once

#include <stddef.h>
#include <stdint.h>

/* AXP2101 on the shared I2C bus. The five registers, in this order:
 * 0x00 status 1 (bit 5: external power), 0x01 status 2 (bits 6:5: 01 charging),
 * 0xA4 battery percent, 0x34 and 0x35 battery millivolts (14 bit). VBUS
 * millivolts are never read: they float to garbage with nothing plugged in. */
#define POWER_I2C_ADDR 0x34
#define POWER_NO_BATTERY_MV 2500

typedef struct {
    int present;
    int percent;
    int millivolts;
    int charging;
    int external;
} power_reading_t;

void power_decode(const uint8_t regs[5], power_reading_t *out);

/* "?bat=81&chg=1&ext=1", or "" when there is no reading. Returns the length. */
int power_query(const power_reading_t *r, char *out, size_t cap);

typedef enum {
    POWER_FILL_INK,
    POWER_FILL_AMBER,
    POWER_FILL_RED,
    POWER_FILL_SAGE,
} power_fill_t;

power_fill_t power_fill(const power_reading_t *r);

/* ESP-IDF only (power_task.c). The listener runs on the power task. */
typedef void (*power_listener_t)(const power_reading_t *r);
void power_start(power_listener_t on_change);
void power_get(power_reading_t *out);
```

`firmware/main/power.c`:

```c
#include "power.h"

#include <stdio.h>

void power_decode(const uint8_t regs[5], power_reading_t *out) {
    int percent = regs[2];
    out->millivolts = ((regs[3] & 0x3F) << 8) | regs[4];
    out->present = out->millivolts >= POWER_NO_BATTERY_MV;
    out->percent = percent > 100 ? 100 : percent;
    out->external = (regs[0] >> 5) & 1;
    out->charging = ((regs[1] >> 5) & 3) == 1;
}

int power_query(const power_reading_t *r, char *out, size_t cap) {
    int n;
    if (cap > 0) {
        out[0] = '\0';
    }
    if (!r || !r->present || cap == 0) {
        return 0;
    }
    n = snprintf(out, cap, "?bat=%d&chg=%d&ext=%d", r->percent, r->charging ? 1 : 0,
                 r->external ? 1 : 0);
    if (n < 0 || (size_t)n >= cap) {
        out[0] = '\0';
        return 0;
    }
    return n;
}

power_fill_t power_fill(const power_reading_t *r) {
    if (r->charging) {
        return POWER_FILL_SAGE;
    }
    if (r->percent <= 10) {
        return POWER_FILL_RED;
    }
    if (r->percent <= 20) {
        return POWER_FILL_AMBER;
    }
    return POWER_FILL_INK;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `firmware/host/run.sh`
Expected: `ok   test_power` and every other host test still `ok`.

---

### Task 2: The read task (ESP-IDF)

**Files:**

- Create: `firmware/main/power_task.c`
- Modify: `firmware/main/CMakeLists.txt`

**Interfaces:**

- Consumes: `power_decode`, `power_reading_t`, `power_listener_t`, `POWER_I2C_ADDR` (Task 1); `bsp_i2c_get_handle()` (BSP).
- Produces: `power_start(listener)` creates the task once. `power_get(out)` copies the last reading (all zero until the first read).

This task has no host test: it is hardware I/O. The logic worth testing is in Task 1. Verification is the build plus Task 4's hardware check.

- [ ] **Step 1: Write the task**

`firmware/main/power_task.c`:

```c
#include "power.h"

#include "bsp/esp-bsp.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <string.h>

#define POWER_POLL_MS 10000
#define POWER_I2C_TIMEOUT_MS 100

static const char *TAG = "power";
static const uint8_t k_regs[5] = {0x00, 0x01, 0xA4, 0x34, 0x35};

static SemaphoreHandle_t s_lock;
static power_reading_t s_last;
static power_listener_t s_listener;

/* One register per transaction, as the probe did on the real board. */
static int read_regs(i2c_master_dev_handle_t dev, uint8_t out[5]) {
    for (int i = 0; i < 5; i++) {
        if (i2c_master_transmit_receive(dev, &k_regs[i], 1, &out[i], 1, POWER_I2C_TIMEOUT_MS) !=
            ESP_OK) {
            return -1;
        }
    }
    return 0;
}

static void publish(const power_reading_t *next) {
    int changed;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    changed = memcmp(&s_last, next, sizeof s_last) != 0;
    s_last = *next;
    xSemaphoreGive(s_lock);
    if (changed && s_listener) {
        s_listener(next);
    }
}

static void power_task(void *arg) {
    i2c_master_dev_handle_t dev = NULL;
    (void)arg;
    for (;;) {
        power_reading_t next;
        uint8_t regs[5];
        memset(&next, 0, sizeof next);
        if (!dev) {
            i2c_device_config_t cfg = {
                .dev_addr_length = I2C_ADDR_BIT_LEN_7,
                .device_address = POWER_I2C_ADDR,
                .scl_speed_hz = 100000,
            };
            if (i2c_master_bus_add_device(bsp_i2c_get_handle(), &cfg, &dev) != ESP_OK) {
                dev = NULL;
            }
        }
        if (dev && read_regs(dev, regs) == 0) {
            power_decode(regs, &next);
        }
        publish(&next);
        vTaskDelay(pdMS_TO_TICKS(POWER_POLL_MS));
    }
}

void power_start(power_listener_t on_change) {
    if (s_lock) {
        return;
    }
    s_lock = xSemaphoreCreateMutex();
    s_listener = on_change;
    if (xTaskCreate(power_task, "power", 4096, NULL, 2, NULL) != pdPASS) {
        ESP_LOGE(TAG, "power task not started");
    }
}

void power_get(power_reading_t *out) {
    if (!s_lock) {
        memset(out, 0, sizeof *out);
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    *out = s_last;
    xSemaphoreGive(s_lock);
}
```

- [ ] **Step 2: Register the sources**

In `firmware/main/CMakeLists.txt`, add `"power.c" "power_task.c"` to the `SRCS` list after `"control_center.c"`, and add `driver` to `REQUIRES` (`REQUIRES driver nvs_flash esp_wifi ...`).

- [ ] **Step 3: Build**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build`
Expected: `Project build complete`, no warnings from `power_task.c`.

---

### Task 3: Report on the poll

**Files:**

- Modify: `firmware/main/net.c:797-808` (`net_fetch_status`)

**Interfaces:**

- Consumes: `power_get`, `power_query` (Tasks 1, 2).

- [ ] **Step 1: Write the change**

In `firmware/main/net.c` add `#include "power.h"` with the other includes, and change `net_fetch_status` to:

```c
int net_fetch_status(const desk_settings_t *in, char *body, size_t body_len) {
    http_buf_t buf = {.body = body, .cap = body_len, .len = 0};
    char suffix[48];
    char query[32];
    power_reading_t reading;
    if (body_len == 0) {
        return -1;
    }
    body[0] = '\0';
    power_get(&reading);
    power_query(&reading, query, sizeof query);
    snprintf(suffix, sizeof suffix, "/api/status%s", query);
    if (request(in, suffix, "GET", &buf, NULL) != ESP_OK) {
        return -1;
    }
    return 0;
}
```

The request URL buffer is 160 bytes and `desk_settings_t.url` is 128, so base plus the longest suffix (`/api/status?bat=100&chg=1&ext=1`, 32 bytes) fits.

- [ ] **Step 2: Build**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build`
Expected: `Project build complete`.

---

### Task 4: The status bar widget

**Files:**

- Modify: `firmware/main/ui.h`, `firmware/main/ui.c`, `firmware/main/main.c`

**Interfaces:**

- Consumes: `power_reading_t`, `power_fill` (Task 1), `power_start` (Task 2).
- Produces: `void ui_set_battery(const power_reading_t *reading);` callers hold the LVGL lock.

Widget layout (spec): percent text, then a 25 x 12 outline body with a 2 x 5 nub, a fill inset 2 px that grows left to right, and one mark label over the body: `LV_SYMBOL_CHARGE` while charging, `LV_SYMBOL_USB` on external power but not charging, hidden otherwise. Hidden entirely when `present` is 0.

- [ ] **Step 1: Header and setter declaration**

In `firmware/main/ui.h` add `#include "power.h"` with the other includes and, after `ui_set_bt`:

```c
/* Battery in the status bar. Hidden when no battery is present. */
void ui_set_battery(const power_reading_t *reading);
```

- [ ] **Step 2: The widget**

In `firmware/main/ui.c`, after the `s_bt_icon` declaration (line 228) add:

```c
static lv_obj_t *s_bat_box;
static lv_obj_t *s_bat_pct;
static lv_obj_t *s_bat_fill;
static lv_obj_t *s_bat_mark;
```

Add, before `build_new_pill`'s forward declaration (`static void build_new_pill(lv_obj_t *screen);`), these two functions:

```c
enum { BAT_W = 25, BAT_H = 12, BAT_INSET = 2 };

static uint32_t battery_fill_color(power_fill_t fill) {
    switch (fill) {
    case POWER_FILL_SAGE:
        return ROW_MARK;
    case POWER_FILL_AMBER:
        return LAMP_AMBER;
    case POWER_FILL_RED:
        return LAMP_RED;
    default:
        return INK;
    }
}

/* macOS-style battery: number, outline body with a nub, fill, one mark. */
static void build_battery(lv_obj_t *cluster) {
    lv_obj_t *body;
    lv_obj_t *nub;
    s_bat_box = lv_obj_create(cluster);
    lv_obj_set_height(s_bat_box, BAR_H);
    lv_obj_set_width(s_bat_box, LV_SIZE_CONTENT);
    flatten(s_bat_box);
    lv_obj_set_flex_flow(s_bat_box, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(s_bat_box, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(s_bat_box, 3, 0);
    lv_obj_clear_flag(s_bat_box, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(s_bat_box, LV_OBJ_FLAG_HIDDEN);

    s_bat_pct = lv_label_create(s_bat_box);
    lv_obj_set_style_text_font(s_bat_pct, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(s_bat_pct, lv_color_hex(INK), 0);
    lv_obj_clear_flag(s_bat_pct, LV_OBJ_FLAG_CLICKABLE);

    body = lv_obj_create(s_bat_box);
    lv_obj_set_size(body, BAT_W, BAT_H);
    flatten(body);
    lv_obj_set_style_radius(body, 3, 0);
    lv_obj_set_style_border_width(body, 1, 0);
    lv_obj_set_style_border_color(body, lv_color_hex(INK), 0);
    lv_obj_set_style_border_opa(body, LV_OPA_60, 0);
    lv_obj_clear_flag(body, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

    s_bat_fill = ink_rect(body, 1, BAT_H - 2 * BAT_INSET, 2, 1);
    lv_obj_align(s_bat_fill, LV_ALIGN_LEFT_MID, BAT_INSET - 1, 0);

    s_bat_mark = lv_label_create(body);
    lv_obj_set_style_text_font(s_bat_mark, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(s_bat_mark, lv_color_black(), 0);
    lv_obj_align(s_bat_mark, LV_ALIGN_CENTER, 0, 0);
    lv_obj_add_flag(s_bat_mark, LV_OBJ_FLAG_HIDDEN);

    nub = ink_rect(s_bat_box, 2, 5, 1, 1);
    lv_obj_set_style_bg_opa(nub, LV_OPA_60, 0);
}

void ui_set_battery(const power_reading_t *reading) {
    char text[8];
    int inner = BAT_W - 2 * BAT_INSET - 2;
    int width;
    if (!s_bat_box) {
        return;
    }
    if (!reading || !reading->present) {
        lv_obj_add_flag(s_bat_box, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    snprintf(text, sizeof text, "%d%%", reading->percent);
    lv_label_set_text(s_bat_pct, text);
    width = reading->percent * inner / 100;
    if (width < 1) {
        width = 1;
    }
    lv_obj_set_width(s_bat_fill, width);
    lv_obj_set_style_bg_color(s_bat_fill, lv_color_hex(battery_fill_color(power_fill(reading))), 0);
    if (reading->charging) {
        lv_label_set_text_static(s_bat_mark, LV_SYMBOL_CHARGE);
        lv_obj_clear_flag(s_bat_mark, LV_OBJ_FLAG_HIDDEN);
    } else if (reading->external) {
        lv_label_set_text_static(s_bat_mark, LV_SYMBOL_USB);
        lv_obj_clear_flag(s_bat_mark, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(s_bat_mark, LV_OBJ_FLAG_HIDDEN);
    }
    lv_obj_clear_flag(s_bat_box, LV_OBJ_FLAG_HIDDEN);
}
```

Because `build_battery` is defined after the status bar builder that must call it, place the two functions (and the `enum`) **above** the function that builds the cluster (the one containing `cluster = lv_obj_create(bar);`, around line 2370). If the compiler reports an unknown `ink_rect` or `flatten`, move the block below those helpers (they are at lines 1437 and 1766); both are defined before line 2370.

In the cluster builder, after `make_rot_symbol(...); psram_objects_end();` and before `paint_rotlock();`, add:

```c
    build_battery(cluster);
```

The battery is now the cluster's last child, so it is the rightmost item. The cluster is about 140 px wide next to the 168 px title, so also narrow the title: in the same function change `lv_obj_set_width(title, 168);` to `lv_obj_set_width(title, 136);` with the comment `/* The label is "ginger". Leave the width to the cluster. */`.

- [ ] **Step 3: Start the task and forward readings**

In `firmware/main/main.c` add `#include "power.h"` with the other includes. Before `app_main` add:

```c
static void on_power(const power_reading_t *reading) {
    if (lock_lvgl()) {
        ui_set_battery(reading);
        unlock_lvgl();
    }
}
```

In `app_main`, after the `ui_init(...)` block's closing `unlock_lvgl(); }` (the block that begins `if (lock_lvgl()) { ui_init(save_and_restart, ...`), add:

```c
    power_start(on_power);
```

It only needs to run after `ui_init`, so the widget exists before the first reading arrives.

- [ ] **Step 4: Build, flash, look**

Run: `cd firmware && . ~/esp/esp-idf/export.sh && idf.py build && idf.py -p /dev/ttyACM0 app-flash`
Expected: the panel shows a battery and percent at the far top right, with the lock glyph, Bluetooth and Wi-Fi shifted left and the title not overlapped. With USB plugged in the bolt shows over a sage fill. Unplug USB: the bolt goes, the fill turns cream (above 20%). `app-flash` writes the app only and keeps NVS. Do not erase flash. If the cluster still collides with the title, reduce the title width further.

- [ ] **Step 5: Host tests and commit prep**

Run: `firmware/host/run.sh`
Expected: every test `ok`.

Stage: `git add firmware/main/power.h firmware/main/power.c firmware/main/power_task.c firmware/main/CMakeLists.txt firmware/main/net.c firmware/main/ui.c firmware/main/ui.h firmware/main/main.c firmware/host/test_power.c firmware/host/run.sh`
Then `pre-commit run`, then one `timeshare run` to commit: `Show the battery in the panel's status bar` and push.

---

### Task 5: Parse the query (server, pure)

**Files:**

- Create: `src/server/panel-battery.ts`, `test/server/panel-battery.test.ts`
- Modify: `src/shared/ipc.ts`

**Interfaces:**

- Produces:
  - In `src/shared/ipc.ts`: `export interface PanelBatteryInfo { pct: number; charging: boolean; external: boolean; at: number }`
  - In `src/server/panel-battery.ts`: `export function parsePanelBattery(params: URLSearchParams): Omit<PanelBatteryInfo, "at"> | null`

- [ ] **Step 1: Write the failing test** `test/server/panel-battery.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parsePanelBattery } from "../../src/server/panel-battery";

const q = (s: string) => new URLSearchParams(s);

describe("parsePanelBattery", () => {
  it("reads a full, valid report", () => {
    expect(parsePanelBattery(q("bat=81&chg=1&ext=1"))).toEqual({
      pct: 81,
      charging: true,
      external: true,
    });
    expect(parsePanelBattery(q("bat=0&chg=0&ext=0"))).toEqual({
      pct: 0,
      charging: false,
      external: false,
    });
    expect(parsePanelBattery(q("bat=100&chg=0&ext=1"))?.pct).toBe(100);
  });

  it("has nothing when the panel sent nothing", () => {
    expect(parsePanelBattery(q(""))).toBeNull();
    expect(parsePanelBattery(q("detail=1"))).toBeNull();
  });

  it("ignores a partial set", () => {
    expect(parsePanelBattery(q("bat=81"))).toBeNull();
    expect(parsePanelBattery(q("bat=81&chg=1"))).toBeNull();
    expect(parsePanelBattery(q("chg=1&ext=1"))).toBeNull();
  });

  it("ignores values out of range or not plain integers", () => {
    for (const bad of [
      "bat=101&chg=0&ext=0",
      "bat=-1&chg=0&ext=0",
      "bat=8.5&chg=0&ext=0",
      "bat=abc&chg=0&ext=0",
      "bat=&chg=0&ext=0",
      "bat=1e2&chg=0&ext=0",
      "bat=0081&chg=0&ext=0",
      "bat=81&chg=2&ext=0",
      "bat=81&chg=0&ext=yes",
    ])
      expect(parsePanelBattery(q(bad)), bad).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/server/panel-battery.test.ts`
Expected: FAIL, cannot find module `../../src/server/panel-battery`.

- [ ] **Step 3: Implement**

Add to `src/shared/ipc.ts` directly above `CalicoInfo`:

```ts
/** The panel's last reported battery. `at` is epoch ms when Calico received it. */
export interface PanelBatteryInfo {
  pct: number;
  charging: boolean;
  external: boolean;
  at: number;
}
```

`src/server/panel-battery.ts`:

```ts
import type { PanelBatteryInfo } from "../shared/ipc";

const flag = (value: string | null): boolean | null =>
  value === "1" ? true : value === "0" ? false : null;

/**
 * The panel adds ?bat=81&chg=1&ext=1 to its status poll. Anything that is not
 * a full, in-range set is ignored, so a bad value never replaces a good one.
 */
export function parsePanelBattery(
  params: URLSearchParams,
): Omit<PanelBatteryInfo, "at"> | null {
  const bat = params.get("bat");
  if (bat === null || !/^(0|[1-9]\d{0,2})$/.test(bat)) return null;
  const pct = Number(bat);
  const charging = flag(params.get("chg"));
  const external = flag(params.get("ext"));
  if (pct > 100 || charging === null || external === null) return null;
  return { pct, charging, external };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run test/server/panel-battery.test.ts`
Expected: PASS, 4 tests.

---

### Task 6: Record it on the poll

**Files:**

- Modify: `src/server/http.ts` (`ServerStats`, the `stats` initializer, the `GET /api/status` branch), `test/server/http.test.ts`

**Interfaces:**

- Consumes: `parsePanelBattery`, `PanelBatteryInfo` (Task 5).
- Produces: `stats.panelBattery: PanelBatteryInfo | null`.

- [ ] **Step 1: Write the failing test**

In `test/server/http.test.ts`, directly after the test `"does not count loopback polls as the panel"`, add:

```ts
it("does not record a battery from a loopback poll", async () => {
  const { base, stats } = await start();
  await fetch(`${base}/api/status?bat=81&chg=1&ext=1`);
  expect(stats.panelBattery).toBeNull();
});
```

(The server tests can only call from loopback, so the recording path is covered by the pure parser tests in Task 5 and by the hardware check.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run test/server/http.test.ts -t "battery"`
Expected: FAIL with a type error or `expected undefined to be null` (the field does not exist yet).

- [ ] **Step 3: Implement**

In `src/server/http.ts`:

- Add `import { parsePanelBattery } from "./panel-battery";` and add `PanelBatteryInfo` to the existing `../shared/ipc` import (or add `import type { PanelBatteryInfo } from "../shared/ipc";` if none exists).
- In `ServerStats` add `panelBattery: PanelBatteryInfo | null;` after `lastPanelPoll`.
- In the `stats` initializer add `panelBattery: null,` after `lastPanelPoll: null,`.
- Replace the first lines of the `/api/status` branch:

```ts
      if (path === "/api/status") {
        const params = new URL(req.url ?? "/", "http://calico").searchParams;
        if (!isLoopback(req.socket.remoteAddress)) {
          stats.lastPanelPoll = Date.now();
          const battery = parsePanelBattery(params);
          if (battery) stats.panelBattery = { ...battery, at: Date.now() };
        }
        const detail = params.get("detail") === "1";
        const body = store.status(detail);
```

and keep the rest of the branch (`const panel = ...; return json(...)`) as it is.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run test/server`
Expected: all server tests PASS.

---

### Task 7: Carry it to the renderer

**Files:**

- Modify: `src/shared/ipc.ts` (`CalicoInfo`), `src/main/index.ts:164`, `src/renderer/src/device/DeviceView.test.tsx`, `src/renderer/src/settings/AgentUpdatesSection.test.tsx`

**Interfaces:**

- Consumes: `stats.panelBattery`, `PanelBatteryInfo`.
- Produces: `CalicoInfo.panelBattery: PanelBatteryInfo | null`.

- [ ] **Step 1: Make the types fail first**

In `CalicoInfo` (`src/shared/ipc.ts`), after `lastPanelPoll`, add:

```ts
/** The panel's last reported battery, null until it reports one. */
panelBattery: PanelBatteryInfo | null;
```

Run: `pnpm typecheck`
Expected: FAIL: `panelBattery` is missing in `src/main/index.ts` and in both test fixtures.

- [ ] **Step 2: Fix each**

- `src/main/index.ts`: in the `info` object after `lastPanelPoll: stats.lastPanelPoll,` add `panelBattery: stats.panelBattery,`.
- `src/renderer/src/device/DeviceView.test.tsx` and `src/renderer/src/settings/AgentUpdatesSection.test.tsx`: after `lastPanelPoll: null,` add `panelBattery: null,`.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, the whole suite PASS.

- [ ] **Step 4: Commit prep**

Stage: `git add src/server/panel-battery.ts src/server/http.ts src/shared/ipc.ts src/main/index.ts test/server/panel-battery.test.ts test/server/http.test.ts src/renderer/src/device/DeviceView.test.tsx src/renderer/src/settings/AgentUpdatesSection.test.tsx`
Then `pre-commit run`, then one `timeshare run`: `Report the panel battery to Calico on the status poll`.

---

### Task 8: Show it in the app

**Files:**

- Create: `src/renderer/src/lib/panel-battery.ts`, `src/renderer/src/lib/panel-battery.test.ts`, `src/renderer/src/shell/PanelBattery.tsx`, `src/renderer/src/shell/PanelBattery.test.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `PanelBatteryInfo`.
- Produces: `BATTERY_FRESH_MS = 60_000`, `freshBattery(b: PanelBatteryInfo | null, now: number): PanelBatteryInfo | null`, `batteryState(b: PanelBatteryInfo): "Charging" | "On external power" | "On battery"`, and `<PanelBattery battery={PanelBatteryInfo | null} now={number} />`.

Placement: the header row beside `UrlChip` in `App.tsx`. That row is visible on every view, so it covers both the Dashboard and the Device screen that the spec names, without touching either.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/panel-battery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BATTERY_FRESH_MS, batteryState, freshBattery } from "./panel-battery";

const at = 1_000_000;
const b = { pct: 81, charging: false, external: false, at };

describe("freshBattery", () => {
  it("keeps a recent reading", () => {
    expect(freshBattery(b, at + BATTERY_FRESH_MS)).toBe(b);
  });
  it("drops one older than 60 seconds", () => {
    expect(freshBattery(b, at + BATTERY_FRESH_MS + 1)).toBeNull();
  });
  it("has nothing when there is no reading", () => {
    expect(freshBattery(null, at)).toBeNull();
  });
});

describe("batteryState", () => {
  it("names the three states", () => {
    expect(batteryState({ ...b, charging: true, external: true })).toBe(
      "Charging",
    );
    expect(batteryState({ ...b, external: true })).toBe("On external power");
    expect(batteryState(b)).toBe("On battery");
  });
});
```

`src/renderer/src/shell/PanelBattery.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelBattery } from "./PanelBattery";

const now = 2_000_000;
const reading = { pct: 81, charging: true, external: true, at: now - 5_000 };

describe("PanelBattery", () => {
  it("shows the percent and the state", () => {
    render(<PanelBattery battery={reading} now={now} />);
    expect(screen.getByText("81%")).toBeTruthy();
    expect(screen.getByLabelText("Panel battery 81%, Charging")).toBeTruthy();
  });

  it("shows nothing without a reading", () => {
    const { container } = render(<PanelBattery battery={null} now={now} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing once the reading is stale", () => {
    const { container } = render(
      <PanelBattery battery={{ ...reading, at: now - 61_000 }} now={now} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/renderer/src/lib/panel-battery.test.ts src/renderer/src/shell/PanelBattery.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/panel-battery.ts`:

```ts
import type { PanelBatteryInfo } from "../../../shared/ipc";

/** The panel reports on every poll. A silent minute means it is off or away. */
export const BATTERY_FRESH_MS = 60_000;

export function freshBattery(
  battery: PanelBatteryInfo | null,
  now: number,
): PanelBatteryInfo | null {
  return battery !== null && now - battery.at <= BATTERY_FRESH_MS
    ? battery
    : null;
}

export function batteryState(
  battery: PanelBatteryInfo,
): "Charging" | "On external power" | "On battery" {
  if (battery.charging) return "Charging";
  return battery.external ? "On external power" : "On battery";
}
```

`src/renderer/src/shell/PanelBattery.tsx`:

```tsx
import { BatteryCharging, BatteryFull, BatteryLow } from "lucide-react";
import type { PanelBatteryInfo } from "../../../shared/ipc";
import { batteryState, freshBattery } from "../lib/panel-battery";

export function PanelBattery({
  battery,
  now,
}: {
  battery: PanelBatteryInfo | null;
  now: number;
}) {
  const live = freshBattery(battery, now);
  if (!live) return null;
  const state = batteryState(live);
  const Icon = live.charging
    ? BatteryCharging
    : live.pct <= 20
      ? BatteryLow
      : BatteryFull;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      aria-label={`Panel battery ${live.pct}%, ${state}`}
      title={state}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{live.pct}%</span>
    </span>
  );
}
```

In `src/renderer/src/App.tsx` add `import { PanelBattery } from "./shell/PanelBattery";` and change the header contents to:

```tsx
<PanelBattery battery={info?.panelBattery ?? null} now={Date.now()} />;
{
  lanUrl ? <UrlChip url={lanUrl} /> : null;
}
```

(`info` refreshes every 2 s through `useInfo`, so `now` stays current.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS, lint clean.

- [ ] **Step 5: See it work**

Run: `pnpm dev` with the panel flashed and polling this machine. Expected: the header shows the panel's percent and icon, the charging icon while USB is plugged in, and the chip disappears about a minute after the panel is powered off.

---

### Task 9: Document and finish

**Files:**

- Modify: `firmware/README.md`

- [ ] **Step 1: Add the docs**

In `firmware/README.md`, in the "Status bar" section after the rotation glyph paragraph, add a paragraph:

```
The rightmost item is the battery, read from the AXP2101 power chip on the shared I2C bus (address 0x34) every 10 s: percent from register 0xA4, charging from 0x01 bits 6:5 (01), external power from 0x00 bit 5, millivolts from 0x34 and 0x35. A cream outline body with the percent beside it. The fill goes amber at 20 percent and red at 10, and sage while charging, with a bolt over it. A USB mark shows on external power with no charge. It is hidden when the chip does not answer or the voltage is under 2500 mV. The panel adds `?bat=81&chg=1&ext=1` to its status poll, and sends nothing when there is no reading. Calico shows the last report for a minute.
```

- [ ] **Step 2: Full verification**

Run: `firmware/host/run.sh && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 3: Commit prep and PR**

Stage Tasks 8 and 9 files, `pre-commit run`, one `timeshare run`: `Show the panel battery in the app`. Push, then open the PR with the light `senior-code-reviewer` pass before marking ready. The PR body states the hardware check in Task 4 Step 4 and Task 8 Step 5, and omits any session link.
