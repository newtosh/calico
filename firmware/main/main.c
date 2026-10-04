#include "net.h"
#include "ui.h"

#include "bsp/esp-bsp.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_lv_adapter.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static wifi_store_t s_store;
static desk_settings_t s_active;
static int s_failures;
static char s_status_body[8192];
static volatile int s_scan_busy;

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
    if (url && s_store.url[0] && strcmp(url, s_store.url) == 0) {
        net_url = "";
    }
    if (token && strcmp(token, s_store.token) == 0) {
        net_token = "";
    }
    if (wifi_upsert(&s_store, ssid, pass, net_url, net_token) != 0) {
        ui_set_settings_status("Could not save that network.");
        return;
    }
    net_save(&s_store);
    esp_restart();
}

static void dismiss_alert(void) {
    net_dismiss(&s_active);
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
static void apply_panel_push(const char *body) {
    desk_panel_t panel;
    if (desk_panel_from_json(body, &panel) != 0) {
        return;
    }
    if (!desk_panel_should_apply(&panel, s_store.url, s_store.token)) {
        return;
    }
    copy_setting(s_store.url, sizeof(s_store.url), panel.url);
    if (panel.token_set) {
        copy_setting(s_store.token, sizeof(s_store.token), panel.token);
    }
    net_save_globals(s_store.url, s_store.token);
    esp_restart();
}

static void poll_task(void *arg) {
    desk_view_t view;
    (void)arg;
    memset(&view, 0, sizeof(view));
    while (1) {
        desk_view_t next;
        if (net_fetch_status(&s_active, s_status_body, sizeof(s_status_body)) == 0) {
            apply_panel_push(s_status_body);
            if (desk_view_from_json(s_status_body, &next) == 0) {
                s_failures = 0;
                view = next;
            } else if (s_failures < 3) {
                s_failures++;
            }
        } else if (s_failures < 3) {
            s_failures++;
        }
        if (lock_lvgl()) {
            ui_apply(&view, s_failures);
            unlock_lvgl();
        }
        vTaskDelay(pdMS_TO_TICKS(2000));
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
        if (selected < 0) {
            ui_show_panel_note("SCAN FAILED", "Could not scan for Wi-Fi.");
        } else {
            ui_show_panel_note("NO NETWORK", "No saved network in range");
        }
        unlock_lvgl();
    }
    vTaskDelete(NULL);
}

void app_main(void) {
    esp_err_t err = nvs_flash_init();
    desk_settings_t fields;
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    bsp_display_start();
    net_load(&s_store);
    memset(&fields, 0, sizeof(fields));
    copy_setting(fields.url, sizeof(fields.url), s_store.url);
    copy_setting(fields.token, sizeof(fields.token), s_store.token);
    if (lock_lvgl()) {
        ui_init(save_and_restart, dismiss_alert, request_scan);
        ui_set_fields(&fields);
        ui_set_known(&s_store);
        if (s_store.count == 0) {
            ui_open_settings();
        }
        unlock_lvgl();
    }
    if (s_store.count == 0) {
        return;
    }
    if (xTaskCreate(join_task, "wifi-join", 12288, NULL, 4, NULL) != pdPASS) {
        if (lock_lvgl()) {
            ui_show_panel_note("SCAN FAILED", "Could not scan for Wi-Fi.");
            unlock_lvgl();
        }
    }
}
