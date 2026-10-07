#include "ble_link.h"
#include "dma_stripe.h"
#include "net.h"
#include "orient.h"
#include "ui.h"

#include "bsp/esp-bsp.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_lv_adapter.h"
#include "esp_system.h"
#include "qmi8658.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

_Static_assert(BSP_LCD_H_RES == DESK_DMA_WIDTH, "DMA stripe width");
_Static_assert(BSP_LCD_BITS_PER_PIXEL / 8 == DESK_DMA_BPP, "DMA stripe depth");

static wifi_store_t s_store;
static desk_settings_t s_active;
static int s_failures;
/* 1 means the link is up and not retrying. RSSI is not part of it. -1 is unpublished. */
static int s_lamp_key = -1;
/* 24 agents with icons, plus last_event, before the events tail is cut. */
static char s_status_body[16384];
static volatile int s_fetch_gen;
static volatile int s_dismiss_gen;
static volatile int s_scan_busy;
static int s_quarter;
static volatile int s_rot_locked;
static lv_indev_read_cb_t s_touch_read;

/* Panel init writes MADCTL 0xA0. bsp_display_rotation_set calls that value
 * 270, and each step after it is +90 clockwise. Quarter 0 is the boot picture. */
static const bsp_display_rotation_t s_panel_quarter[4] = {
    BSP_DISPLAY_ROTATE_270,
    BSP_DISPLAY_ROTATE_0,
    BSP_DISPLAY_ROTATE_90,
    BSP_DISPLAY_ROTATE_180,
};

static void copy_setting(char *dest, size_t dest_len, const char *src) {
    size_t i;
    if (dest_len == 0) {
        return;
    }
    if (!src) {
        dest[0] = '\0';
        return;
    }
    for (i = 0; i + 1 < dest_len && src[i]; i++) {
        dest[i] = src[i];
    }
    dest[i] = '\0';
}

static void save_and_restart(const char *ssid, const char *pass, const char *url, const char *token) {
    const char *net_url = url;
    const char *net_token = token;
    if (!ssid || !ssid[0]) {
        ui_set_settings_status("Select or type an SSID.");
        return;
    }
    /* Same text as the global default means this network keeps following it. */
    ble_link_enter();
    if (url && s_store.url[0] && strcmp(url, s_store.url) == 0) {
        net_url = "";
    }
    if (token && strcmp(token, s_store.token) == 0) {
        net_token = "";
    }
    if (wifi_upsert(&s_store, ssid, pass, net_url, net_token) != 0) {
        ble_link_leave();
        ui_set_settings_status("Could not save that network.");
        return;
    }
    net_save(&s_store);
    ble_link_leave();
    esp_restart();
}

static void dismiss_alert(const char *agent_id) {
    if (agent_id && agent_id[0]) {
        net_dismiss_agent(&s_active, agent_id);
    } else {
        net_dismiss(&s_active);
    }
    /* After the POST, so a fetch that overlapped the request cannot reopen the sheet. */
    s_dismiss_gen = s_fetch_gen;
}

static void clear_unread(void) {
    net_clear_unread(&s_active);
}

/* waveshare/esp32_s3_touch_amoled_2_16 2.0.1 declares bsp_display_lock as
 * bool and returns esp_lv_adapter_lock() unchanged. That call is esp_err_t,
 * and ESP_OK is 0, so a taken lock is false. Callers that branch on the bool
 * keep the mutex and the LVGL task blocks with no panic. */
static bool lock_lvgl(void) {
    return esp_lv_adapter_lock(-1) == ESP_OK;
}

static void unlock_lvgl(void) {
    esp_lv_adapter_unlock();
}

static void scan_task(void *arg) {
    net_ap_t aps[NET_SCAN_MAX];
    int count;
    (void)arg;
    count = net_wifi_scan(aps, NET_SCAN_MAX);
    if (lock_lvgl()) {
        ui_show_networks(count < 0 ? NULL : aps, count);
        unlock_lvgl();
    }
    s_scan_busy = 0;
    vTaskDelete(NULL);
}

static void request_scan(void) {
    if (s_scan_busy) {
        return;
    }
    s_scan_busy = 1;
    ui_show_scanning();
    if (xTaskCreate(scan_task, "wifi-scan", 12288, NULL, 4, NULL) != pdPASS) {
        s_scan_busy = 0;
        ui_show_networks(NULL, -1);
    }
}

/* URL and token ride the status poll the panel already makes. This writes
 * only the global url and token. Wi-Fi passwords are not on this path.
 * A failed poll never gets here. */
static int probe_url(const char *url, const char *token) {
    desk_settings_t trial;
    char scratch[8];
    memset(&trial, 0, sizeof(trial));
    copy_setting(trial.url, sizeof(trial.url), url);
    copy_setting(trial.token, sizeof(trial.token), token);
    return net_fetch_status(&trial, scratch, sizeof(scratch)) == 0;
}

static void apply_panel_push(const char *body) {
    desk_panel_t panel;
    char cur_url[128];
    char cur_token[128];
    int answers = 1;
    if (desk_panel_from_json(body, &panel) != 0 || !panel.present) {
        return;
    }
    ble_link_enter();
    copy_setting(cur_url, sizeof(cur_url), s_store.url);
    copy_setting(cur_token, sizeof(cur_token), s_store.token);
    ble_link_leave();
    /* A pushed URL on another host is stored only if that host answers. */
    if (strcmp(panel.url, cur_url) != 0) {
        answers = probe_url(panel.url, panel.token_set ? panel.token : cur_token);
    }
    if (!desk_panel_adopt(&panel, cur_url, cur_token, answers)) {
        return;
    }
    ble_link_enter();
    /* A BLE write landed while the probe was in flight. Leave it. The next poll can push again. */
    if (strcmp(s_store.url, cur_url) != 0 || strcmp(s_store.token, cur_token) != 0) {
        ble_link_leave();
        return;
    }
    copy_setting(s_store.url, sizeof(s_store.url), panel.url);
    if (panel.token_set) {
        copy_setting(s_store.token, sizeof(s_store.token), panel.token);
    }
    net_save_globals(s_store.url, s_store.token);
    ble_link_leave();
    esp_restart();
}

static void publish_link(void);

static int lamp_key(const net_link_t *link) {
    return (link->has_ip ? 1 : 0) | (link->gave_up ? 2 : 0) | (link->retries > 0 ? 4 : 0);
}

static void poll_task(void *arg) {
    /* 24-agent views are about 4 KB each. Keep them off this 16 KB stack. */
    static desk_view_t view;
    static desk_view_t next;
    (void)arg;
    while (1) {
        net_link_t link;
        int fetched;
        int parsed = 0;
        int same;
        int key;
        s_fetch_gen++;
        fetched = net_fetch_status(&s_active, s_status_body, sizeof(s_status_body)) == 0;
        if (fetched) {
            net_mark_reachable();
            apply_panel_push(s_status_body);
            if (desk_view_from_json(s_status_body, &next) == 0) {
                s_failures = 0;
                view = next;
                parsed = 1;
            } else if (s_failures < 3) {
                s_failures++;
            }
        }
        net_link(&link);
        /* Misses before a lease are the join, not a dead companion. */
        if (!fetched && link.has_ip && s_failures < 3) {
            s_failures++;
        }
        same = ui_status_current(&view, s_failures);
        key = lamp_key(&link);
        {
            int mine = s_fetch_gen;
            int release = parsed && s_dismiss_gen && mine > s_dismiss_gen;
            int want_cap = parsed && view.capture;
            if (release) {
                s_dismiss_gen = 0;
            }
            /* Unchanged face and lamp inputs stay off the LVGL lock so touch can take it.
             * A capture request and a dismiss release still take it. */
            if ((!same || key != s_lamp_key || release || want_cap) && lock_lvgl()) {
                uint8_t *frame = NULL;
                int frame_stride = 0;
                if (release) {
                    ui_release_sheet_suppress();
                }
                if (!same || key != s_lamp_key || release) {
                    publish_link();
                    ui_apply(&view, s_failures);
                    s_lamp_key = key;
                }
                if (want_cap && !ui_settings_is_open() &&
                    ui_capture_frame(&frame, &frame_stride) == 0) {
                    unlock_lvgl();
                    net_post_frame(&s_active, frame, 480, 480, frame_stride);
                    heap_caps_free(frame);
                } else {
                    unlock_lvgl();
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(desk_poll_ms(&view, s_failures, key == 1)));
    }
}

/* Off app_main. A stack net_ap_t found[48] in net_wifi_scan overflowed
 * the main task before esp_wifi_scan_start, so abort() ran before any
 * scan. Same 12KB stack as wifi-scan. */
static void join_task(void *arg) {
    int selected;
    (void)arg;
    selected = net_wifi_select(&s_store, &s_active);
    if (selected == 0) {
        net_wifi_start(&s_active);
        xTaskCreate(poll_task, "poll", 16384, NULL, 5, NULL);
    } else if (lock_lvgl()) {
        publish_link();
        if (selected < 0) {
            ui_show_panel_note("SCAN FAILED", "Could not scan for Wi-Fi.");
        } else {
            ui_show_panel_note("NO NETWORK", "No saved network in range");
        }
        unlock_lvgl();
    }
    vTaskDelete(NULL);
}

static void touch_read(lv_indev_t *indev, lv_indev_data_t *data) {
    int x;
    int y;
    s_touch_read(indev, data);
    x = data->point.x;
    y = data->point.y;
    orient_touch_point(s_quarter, &x, &y);
    data->point.x = x;
    data->point.y = y;
}

static void apply_quarter(int quarter) {
    lv_indev_t *indev;
    if (quarter == s_quarter) {
        return;
    }
    if (bsp_display_rotation_set(s_panel_quarter[quarter]) != ESP_OK) {
        return;
    }
    s_quarter = quarter;
    indev = bsp_display_get_input_dev();
    if (indev) {
        lv_indev_reset(indev, NULL);
    }
    lv_obj_invalidate(lv_screen_active());
    ESP_LOGI("orient", "quarter %d", quarter);
}

static void publish_link(void) {
    net_link_t link;
    net_link(&link);
    ui_set_link(link.has_ip, link.rssi, link.retries, link.gave_up);
}

static void on_rotlock(int locked) {
    char stored[4];
    if (locked) {
        orient_rotlock_format(s_quarter, stored, sizeof(stored));
        net_rotlock_save(stored);
        s_rot_locked = 1;
        return;
    }
    net_rotlock_save("");
    s_rot_locked = 0;
}

/* BSP stripes live in PSRAM, so IDF 5.5 copies each flush into internal DMA.
 * Pin one smaller DMA stripe before Wi-Fi and LVGL flushes it directly.
 * Two 50-line stripes left a 29696-byte DMA block; wifi_bringup then never
 * logged a scan or a join. One 20-line stripe leaves a 50-line region free. */
static void pin_dma_draw_buffers(void) {
    lv_display_t *disp = lv_display_get_default();
    void *buf;
    if (!disp) {
        ESP_LOGE("desk", "no display for DMA buffer");
        return;
    }
    buf = heap_caps_aligned_alloc(64, DESK_DMA_BYTES, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    if (!buf) {
        ESP_LOGE("desk", "DMA draw buffer %u bytes failed; flushes will copy from PSRAM",
                 (unsigned)DESK_DMA_BYTES);
        return;
    }
    lv_display_set_buffers(disp, buf, NULL, DESK_DMA_BYTES, LV_DISPLAY_RENDER_MODE_PARTIAL);
    ESP_LOGI("desk", "DMA draw buffer %u bytes x%d (%d lines), largest internal %u",
             (unsigned)DESK_DMA_BYTES, DESK_DMA_BUFS, DESK_DMA_LINES,
             (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA));
}

static void on_ble_state(int state) {
    if (!lock_lvgl()) {
        ESP_LOGW("desk", "BT mark not updated");
        return;
    }
    ui_set_bt(state);
    unlock_lvgl();
}

static void on_ble_restart(void) {
    esp_restart();
}

static void load_rotlock(void) {
    char stored[8];
    int quarter = 0;
    net_rotlock_load(stored, sizeof(stored));
    if (!orient_rotlock_parse(stored, &quarter)) {
        return;
    }
    s_rot_locked = 1;
    apply_quarter(quarter);
}

static void hook_touch(void) {
    lv_indev_t *indev = bsp_display_get_input_dev();
    if (!indev) {
        return;
    }
    s_touch_read = lv_indev_get_read_cb(indev);
    if (s_touch_read) {
        lv_indev_set_read_cb(indev, touch_read);
    }
}

static void imu_task(void *arg) {
    qmi8658_dev_t dev;
    orient_debounce_t deb;
    (void)arg;
    if (qmi8658_init(&dev, bsp_i2c_get_handle(), QMI8658_ADDRESS_HIGH) != ESP_OK) {
        ESP_LOGE("orient", "QMI8658 not readable at 0x6B");
        vTaskDelete(NULL);
        return;
    }
    orient_debounce_init(&deb);
    for (;;) {
        float ax;
        float ay;
        float az;
        int shown;
        if (qmi8658_read_accel(&dev, &ax, &ay, &az) == ESP_OK) {
            shown = orient_debounce_feed(&deb, orient_from_accel((int)ax, (int)ay, (int)az));
            if (shown != s_quarter && lock_lvgl()) {
                if (!orient_frozen(s_rot_locked, ui_settings_is_open())) {
                    apply_quarter(shown);
                }
                unlock_lvgl();
            }
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void app_main(void) {
    esp_err_t err = nvs_flash_init();
    desk_settings_t fields;
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    bsp_display_start();
    if (lock_lvgl()) {
        pin_dma_draw_buffers();
        hook_touch();
        load_rotlock();
        unlock_lvgl();
    }
    if (xTaskCreate(imu_task, "imu", 4096, NULL, 3, NULL) != pdPASS) {
        ESP_LOGE("orient", "imu task not started");
    }
    net_load(&s_store);
    memset(&fields, 0, sizeof(fields));
    copy_setting(fields.url, sizeof(fields.url), s_store.url);
    copy_setting(fields.token, sizeof(fields.token), s_store.token);
    if (lock_lvgl()) {
        ui_init(save_and_restart, dismiss_alert, request_scan);
        ui_bind_unread(clear_unread);
        ui_bind_rotlock(s_rot_locked, on_rotlock);
        ui_set_fields(&fields);
        ui_set_known(&s_store);
        if (s_store.count == 0) {
            ui_open_settings();
        }
        unlock_lvgl();
    }
    ble_link_start(&s_store, on_ble_state, on_ble_restart);
    if (s_store.count == 0) {
        return;
    }
    if (xTaskCreate(join_task, "wifi-join", 12288, NULL, 4, NULL) != pdPASS) {
        if (lock_lvgl()) {
            publish_link();
            ui_show_panel_note("SCAN FAILED", "Could not scan for Wi-Fi.");
            unlock_lvgl();
        }
    }
}
