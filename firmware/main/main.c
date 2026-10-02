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

static desk_settings_t s_settings;
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
    copy_setting(s_settings.ssid, sizeof(s_settings.ssid), ssid);
    copy_setting(s_settings.pass, sizeof(s_settings.pass), pass);
    copy_setting(s_settings.url, sizeof(s_settings.url), url);
    copy_setting(s_settings.token, sizeof(s_settings.token), token);
    net_save(&s_settings);
    esp_restart();
}

static void dismiss_alert(void) {
    net_dismiss(&s_settings);
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

/* URL and token ride the status poll the panel already makes. SSID and
 * password stay in NVS. A failed poll never gets here. Restart matches Save. */
static void apply_panel_push(const char *body) {
    desk_panel_t panel;
    if (desk_panel_from_json(body, &panel) != 0) {
        return;
    }
    if (!desk_panel_should_apply(&panel, s_settings.url, s_settings.token)) {
        return;
    }
    copy_setting(s_settings.url, sizeof(s_settings.url), panel.url);
    if (panel.token_set) {
        copy_setting(s_settings.token, sizeof(s_settings.token), panel.token);
    }
    net_save(&s_settings);
    esp_restart();
}

static void poll_task(void *arg) {
    desk_view_t view;
    (void)arg;
    memset(&view, 0, sizeof(view));
    while (1) {
        desk_view_t next;
        if (net_fetch_status(&s_settings, s_status_body, sizeof(s_status_body)) == 0) {
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

void app_main(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    bsp_display_start();
    net_load(&s_settings);
    if (lock_lvgl()) {
        ui_init(save_and_restart, dismiss_alert, request_scan);
        ui_set_fields(&s_settings);
        if (s_settings.ssid[0] == '\0') {
            ui_open_settings();
        }
        unlock_lvgl();
    }
    if (s_settings.ssid[0]) {
        net_wifi_start(&s_settings);
        xTaskCreate(poll_task, "poll", 16384, NULL, 5, NULL);
    }
}
