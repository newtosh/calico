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
static uint8_t s_logged[3] = {0xFF, 0xFF, 0xFF};

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
    changed = !power_same(&s_last, next);
    s_last = *next;
    xSemaphoreGive(s_lock);
    if (changed) {
        ESP_LOGI(TAG, "battery %s%d%%%s%s%s", next->estimated ? "~" : "", next->percent,
                 next->present ? "" : " (absent)", next->charging ? ", charging" : "",
                 next->external ? ", external power" : "");
    }
    if (changed && s_listener) {
        s_listener(next);
    }
}

static void power_task(void *arg) {
    i2c_master_dev_handle_t dev = NULL;
    power_hold_t hold;
    (void)arg;
    memset(&hold, 0, sizeof hold);
    for (;;) {
        power_reading_t fresh;
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
            /* Bytes 0 to 2 are the flags and percent. Log them when they change, so a
             * board without a battery can be told apart from one that has it. */
            if (memcmp(regs, s_logged, sizeof s_logged) != 0) {
                memcpy(s_logged, regs, sizeof s_logged);
                ESP_LOGI(TAG, "regs %02X %02X %02X %02X %02X", regs[0], regs[1], regs[2], regs[3],
                         regs[4]);
            }
            power_decode(regs, &fresh);
            power_hold(&hold, &fresh, &next);
        } else {
            power_hold(&hold, NULL, &next);
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
