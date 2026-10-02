#include "net.h"
#include "ui.h"

#include "bsp/display.h"
#include "bsp/esp-bsp.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include <stdio.h>
#include <string.h>

static desk_settings_t s_settings;
static int s_failures;
static char s_status_body[8192];

static void save_and_restart(const char *ssid, const char *pass, const char *url, const char *token) {
    snprintf(s_settings.ssid, sizeof(s_settings.ssid), "%s", ssid);
    snprintf(s_settings.pass, sizeof(s_settings.pass), "%s", pass);
    snprintf(s_settings.url, sizeof(s_settings.url), "%s", url);
    snprintf(s_settings.token, sizeof(s_settings.token), "%s", token);
    net_save(&s_settings);
    esp_restart();
}

static void dismiss_alert(void) {
    net_dismiss(&s_settings);
}

static void poll_task(void *arg) {
    desk_view_t view;
    (void)arg;
    memset(&view, 0, sizeof(view));
    while (1) {
        desk_view_t next;
        if (net_fetch_status(&s_settings, s_status_body, sizeof(s_status_body)) == 0 &&
            desk_view_from_json(s_status_body, &next) == 0) {
            s_failures = 0;
            view = next;
        } else if (s_failures < 3) {
            s_failures++;
        }
        bsp_display_lock(-1);
        ui_apply(&view, s_failures);
        bsp_display_unlock();
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
    bsp_display_lock(-1);
    ui_init(save_and_restart, dismiss_alert);
    if (s_settings.ssid[0] == '\0') {
        ui_open_settings();
    }
    bsp_display_unlock();
    if (s_settings.ssid[0]) {
        net_wifi_start(&s_settings);
        xTaskCreate(poll_task, "poll", 16384, NULL, 5, NULL);
    }
}
