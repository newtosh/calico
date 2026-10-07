#include "ble_link.h"

#include "ble_desk.h"
#include "dma_stripe.h"
#include "net.h"

#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "sdkconfig.h"

#include <stdint.h>
#include <string.h>

#if CONFIG_BT_NIMBLE_ENABLED
#include "host/ble_att.h"
#include "host/ble_hs.h"
#include "host/ble_hs_mbuf.h"
#include "host/ble_store.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#endif

#ifndef DESK_FW_SHA
#define DESK_FW_SHA "unknown"
#endif

/* One write is a URL or token (127) or SSID, a newline, and a password (32+1+64). */
#define BLE_LINK_WRITE_MAX 160

static const char *TAG = "desk-ble";
static wifi_store_t *s_store;
static ble_link_state_fn s_on_state;
static ble_link_restart_fn s_on_restart;
static SemaphoreHandle_t s_mu;
static int s_state;

static void note(int state) {
    if (s_state == state) {
        return;
    }
    s_state = state;
    if (s_on_state) {
        s_on_state(state);
    }
}

void ble_link_enter(void) {
    if (s_mu) {
        xSemaphoreTake(s_mu, portMAX_DELAY);
    }
}

void ble_link_leave(void) {
    if (s_mu) {
        xSemaphoreGive(s_mu);
    }
}

#if CONFIG_BT_NIMBLE_ENABLED

static uint8_t s_own_addr_type;
static int s_gatt_ok;

/* Little-endian UUID bytes. The 13th byte is the time_low LSB:
 * 0x10 service, 0x11 status, 0x12 url, 0x13 token, 0x14 wifi, 0x15 reboot.
 * scripts/test_ble_provision.py checks these against the strings in ble_desk.h. */
static const ble_uuid128_t s_uuid_svc =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x10,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_status =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x11,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_url =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x12,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_token =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x13,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_wifi =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x14,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_reboot =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x15,
                     0x4b, 0x7c, 0x8d);

static int access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt,
                  void *arg);
static int advertise(void);
static int gap_event(struct ble_gap_event *event, void *arg);

static const struct ble_gatt_svc_def s_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &s_uuid_svc.u,
        .characteristics =
            (struct ble_gatt_chr_def[]){
                {
                    .uuid = &s_uuid_status.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_STATUS,
                    .flags = BLE_GATT_CHR_F_READ,
                },
                {
                    .uuid = &s_uuid_url.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_URL,
                    .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE,
                },
                {
                    .uuid = &s_uuid_token.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_TOKEN,
                    .flags = BLE_GATT_CHR_F_WRITE,
                },
                {
                    .uuid = &s_uuid_wifi.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_WIFI,
                    .flags = BLE_GATT_CHR_F_WRITE,
                },
                {
                    .uuid = &s_uuid_reboot.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_REBOOT,
                    .flags = BLE_GATT_CHR_F_WRITE,
                },
                {
                    0,
                },
            },
    },
    {
        0,
    },
};

static int read_flat(struct os_mbuf *om, uint8_t *buf, uint16_t *len) {
    uint16_t om_len;
    if (!om) {
        *len = 0;
        return 0;
    }
    om_len = OS_MBUF_PKTLEN(om);
    if (om_len > BLE_LINK_WRITE_MAX) {
        return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    if (om_len == 0) {
        *len = 0;
        return 0;
    }
    if (ble_hs_mbuf_to_flat(om, buf, BLE_LINK_WRITE_MAX, len) != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    return 0;
}

static int append_text(struct os_mbuf *om, const char *text, int n) {
    if (n < 0) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (os_mbuf_append(om, text, (uint16_t)n) != 0) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return 0;
}

static int read_status(struct os_mbuf *om) {
    char ssid[33];
    char url[128];
    char body[256];
    int token_set = 0;
    int n;
    ssid[0] = '\0';
    url[0] = '\0';
    ble_link_enter();
    if (s_store) {
        net_joined_ssid(ssid, sizeof(ssid));
        memcpy(url, s_store->url, sizeof(url));
        url[sizeof(url) - 1] = '\0';
        token_set = s_store->token[0] != '\0';
    }
    ble_link_leave();
    n = ble_desk_format_status(body, sizeof(body), DESK_FW_SHA, ssid, url, token_set);
    return append_text(om, body, n);
}

static int read_url(struct os_mbuf *om) {
    char url[128];
    url[0] = '\0';
    ble_link_enter();
    if (s_store) {
        memcpy(url, s_store->url, sizeof(url));
        url[sizeof(url) - 1] = '\0';
    }
    ble_link_leave();
    return append_text(om, url, (int)strlen(url));
}

static int write_url(const uint8_t *buf, uint16_t len) {
    char url[128];
    if (ble_desk_parse_url(buf, len, url, sizeof(url)) != 0 || !s_store) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    if (ble_desk_set_url(s_store, url) != 0) {
        ble_link_leave();
        return BLE_ATT_ERR_UNLIKELY;
    }
    net_save_globals(s_store->url, s_store->token);
    ble_link_leave();
    ESP_LOGI(TAG, "url %s", url);
    return 0;
}

static int write_token(const uint8_t *buf, uint16_t len) {
    char token[128];
    if (ble_desk_parse_token(buf, len, token, sizeof(token)) != 0 || !s_store) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    if (ble_desk_set_token(s_store, token) != 0) {
        ble_link_leave();
        return BLE_ATT_ERR_UNLIKELY;
    }
    net_save_globals(s_store->url, s_store->token);
    ble_link_leave();
    ESP_LOGI(TAG, "token %s", token[0] ? "set" : "cleared");
    return 0;
}

static int write_wifi(const uint8_t *buf, uint16_t len) {
    char ssid[33];
    char pass[65];
    if (ble_desk_parse_wifi(buf, len, ssid, sizeof(ssid), pass, sizeof(pass)) != 0 || !s_store) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    if (ble_desk_upsert_wifi(s_store, ssid, pass) != 0) {
        ble_link_leave();
        return BLE_ATT_ERR_UNLIKELY;
    }
    net_save(s_store);
    ble_link_leave();
    ESP_LOGI(TAG, "wifi %s", ssid);
    return 0;
}

static int access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt,
                  void *arg) {
    uintptr_t op = (uintptr_t)arg;
    uint8_t buf[BLE_LINK_WRITE_MAX];
    uint16_t len = 0;
    int rc;
    (void)conn_handle;
    (void)attr_handle;
    if (!ctxt) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        if (op == BLE_DESK_OP_STATUS) {
            return read_status(ctxt->om);
        }
        if (op == BLE_DESK_OP_URL) {
            return read_url(ctxt->om);
        }
        return BLE_ATT_ERR_READ_NOT_PERMITTED;
    }
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    rc = read_flat(ctxt->om, buf, &len);
    if (rc != 0) {
        return rc;
    }
    if (op == BLE_DESK_OP_URL) {
        return write_url(buf, len);
    }
    if (op == BLE_DESK_OP_TOKEN) {
        return write_token(buf, len);
    }
    if (op == BLE_DESK_OP_WIFI) {
        return write_wifi(buf, len);
    }
    if (op == BLE_DESK_OP_REBOOT) {
        if (ble_desk_parse_reboot(buf, len) != 0 || !s_on_restart) {
            return BLE_ATT_ERR_UNLIKELY;
        }
        ESP_LOGI(TAG, "reboot");
        s_on_restart();
        return 0;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static int advertise(void) {
    struct ble_gap_adv_params params;
    struct ble_hs_adv_fields fields;
    const char *name;
    int rc;
    if (ble_gap_adv_active()) {
        return 0;
    }
    memset(&fields, 0, sizeof(fields));
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    name = ble_svc_gap_device_name();
    fields.name = (uint8_t *)name;
    fields.name_len = name ? (uint8_t)strlen(name) : 0;
    fields.name_is_complete = 1;
    rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv fields %d", rc);
        return rc;
    }
    memset(&params, 0, sizeof(params));
    params.conn_mode = BLE_GAP_CONN_MODE_UND;
    params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    rc = ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv start %d", rc);
    }
    return rc;
}

static int gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status != 0) {
            ESP_LOGW(TAG, "connect failed %d", event->connect.status);
            if (advertise() == 0) {
                note(BLE_LINK_ADV);
            } else {
                note(BLE_LINK_OFF);
            }
            return 0;
        }
        note(BLE_LINK_CONN);
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnect %d", event->disconnect.reason);
        if (advertise() == 0) {
            note(BLE_LINK_ADV);
        } else {
            note(BLE_LINK_OFF);
        }
        return 0;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        if (advertise() == 0) {
            note(BLE_LINK_ADV);
        } else {
            note(BLE_LINK_OFF);
        }
        return 0;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "mtu %d", event->mtu.value);
        return 0;
    default:
        return 0;
    }
}

static void on_reset(int reason) {
    ESP_LOGE(TAG, "host reset %d", reason);
    note(BLE_LINK_OFF);
}

static void on_sync(void) {
    int rc = ble_hs_util_ensure_addr(0);
    if (rc != 0) {
        ESP_LOGE(TAG, "no address %d", rc);
        note(BLE_LINK_OFF);
        return;
    }
    rc = ble_hs_id_infer_auto(0, &s_own_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "address type %d", rc);
        note(BLE_LINK_OFF);
        return;
    }
    if (advertise() == 0) {
        note(BLE_LINK_ADV);
        return;
    }
    note(BLE_LINK_OFF);
}

static void host_task(void *arg) {
    (void)arg;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static void log_dma(void) {
    size_t dma = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    ESP_LOGI(TAG, "largest internal DMA %u after NimBLE", (unsigned)dma);
    if (dma < DESK_DMA_LEFT_AFTER_PAIR) {
        ESP_LOGW(TAG,
                 "internal DMA block %u is under %u; the STA failed to join at that size before. "
                 "Shrink NimBLE, do not grow the DMA stripe",
                 (unsigned)dma, DESK_DMA_LEFT_AFTER_PAIR);
    }
}

static void start_radio(void) {
    esp_err_t err;
    int rc;
    err = nimble_port_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "nimble_port_init %s", esp_err_to_name(err));
        return;
    }
    log_dma();
    /* ponytail: open GATT, no pairing. Proximity is the gate until the glass can show a PIN. */
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
#if CONFIG_BT_NIMBLE_SECURITY_ENABLE
    ble_hs_cfg.sm_io_cap = BLE_HS_IO_NO_INPUT_OUTPUT;
    ble_hs_cfg.sm_bonding = 0;
    ble_hs_cfg.sm_mitm = 0;
    ble_hs_cfg.sm_sc = 0;
#endif
    ble_svc_gap_init();
    ble_svc_gatt_init();
    rc = ble_gatts_count_cfg(s_svcs);
    if (rc == 0) {
        rc = ble_gatts_add_svcs(s_svcs);
    }
    if (rc != 0) {
        ESP_LOGE(TAG, "gatt %d", rc);
        return;
    }
    rc = ble_svc_gap_device_name_set(BLE_DESK_NAME);
    if (rc != 0) {
        ESP_LOGE(TAG, "name %d", rc);
        return;
    }
    s_gatt_ok = 1;
    nimble_port_freertos_init(host_task);
}

#endif /* CONFIG_BT_NIMBLE_ENABLED */

void ble_link_start(wifi_store_t *store, ble_link_state_fn on_state, ble_link_restart_fn on_restart) {
    s_store = store;
    s_on_state = on_state;
    s_on_restart = on_restart;
    if (!s_mu) {
        s_mu = xSemaphoreCreateMutex();
    }
#if CONFIG_BT_NIMBLE_ENABLED
    start_radio();
    if (!s_gatt_ok) {
        note(BLE_LINK_OFF);
    }
#else
    ESP_LOGW(TAG, "NimBLE is off in sdkconfig. Delete firmware/sdkconfig and reconfigure. Do not erase NVS.");
    note(BLE_LINK_OFF);
#endif
}
