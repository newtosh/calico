#include "ble_link.h"

#include "ble_desk.h"
#include "ble_pair.h"
#include "dma_stripe.h"
#include "net.h"

#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
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

/* ESP-IDF NimBLE does not declare this in a public header. */
void ble_store_config_init(void);
#endif

#ifndef DESK_FW_SHA
#define DESK_FW_SHA "unknown"
#endif

/* The longest write is wifi with this network's own url and token (354 bytes).
 * That is longer than one ATT packet, so the central sends it as a long write:
 * at MTU 256 two of the four prepare entries (CONFIG_BT_NIMBLE_ATT_MAX_PREP_ENTRIES). */
#define BLE_LINK_WRITE_MAX BLE_DESK_WIFI_CFG_MAX
_Static_assert(BLE_LINK_WRITE_MAX >= 160, "a write still fits a url, a token and a two-line wifi");

static const char *TAG = "desk-ble";
static wifi_store_t *s_store;
static ble_link_state_fn s_on_state;
static ble_link_restart_fn s_on_restart;
static SemaphoreHandle_t s_mu;
static int s_state;
/* Control Center off: stop advertising, do not power the controller down. */
static int s_user_off;

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
static int s_host_up;
/* NimBLE's none handle. A live connection is anything else. */
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

/* The code waiting for Yes or No on the glass. The host task opens and drops
 * it; the LVGL task answers it. */
static ble_pair_ask_t s_ask;
static portMUX_TYPE s_ask_mux = portMUX_INITIALIZER_UNLOCKED;

static uint32_t now_ms(void) {
    return (uint32_t)(esp_timer_get_time() / 1000);
}

static void ask_drop(uint16_t conn) {
    taskENTER_CRITICAL(&s_ask_mux);
    ble_pair_ask_drop(&s_ask, conn);
    taskEXIT_CRITICAL(&s_ask_mux);
    pair_hide();
}

void ble_link_pair_answer(int yes) {
    struct ble_sm_io io;
    uint16_t conn = 0;
    int accept;
    int rc;
    taskENTER_CRITICAL(&s_ask_mux);
    accept = ble_pair_ask_answer(&s_ask, yes, now_ms(), &conn);
    taskEXIT_CRITICAL(&s_ask_mux);
    if (accept < 0) {
        /* An early Yes keeps the card up. No with nothing open still clears it. */
        if (!yes) {
            pair_hide();
        }
        return;
    }
    pair_hide();
    memset(&io, 0, sizeof io);
    io.action = BLE_SM_IOACT_NUMCMP;
    io.numcmp_accept = (uint8_t)accept;
    rc = ble_sm_inject_io(conn, &io);
    if (rc != 0) {
        ESP_LOGE(TAG, "numcmp inject %d", rc);
    }
}

enum { BLE_LINK_NO_CONN = 0xFFFF, BLE_LINK_TERM_USER = 0x13 };
static uint16_t s_conn = BLE_LINK_NO_CONN;
/* The link that just paired fresh, until its peer name arrives. A reconnect on a stored
 * bond never sets it, so the glass only greets a new pairing. Host task only. */
static uint16_t s_fresh_conn = BLE_LINK_NO_CONN;
static ble_link_paired_fn s_paired;

void ble_link_set_paired_callback(ble_link_paired_fn fn) {
    s_paired = fn;
}
static char s_scan_text[BLE_DESK_SCAN_TEXT];
#define BLE_LINK_PROBE_TEXT 128
static char s_probe_text[BLE_LINK_PROBE_TEXT];
/* GATT access runs only on the NimBLE host task, so one scratch serves every write and the
 * nets read. It is PSRAM, allocated once at host start: on the host task's 6144-byte internal
 * stack the 354-byte write, the parsed network and the nets text would take about 1 KB of
 * headroom, and as static .bss they would take internal RAM the station needs. `before` is the
 * saved networks as they were, put back if the NVS save fails. */
typedef struct {
    uint8_t write[BLE_LINK_WRITE_MAX];
    ble_desk_wifi_t wifi;
    char nets[BLE_DESK_NETS_TEXT];
    wifi_store_t before;
} ble_link_scratch_t;
static ble_link_scratch_t *s_scratch;
static int s_scan_busy;
static int s_job;
static char s_verify_ssid[33];
static char s_verify_pass[65];
static TaskHandle_t s_scan_task;
static SemaphoreHandle_t s_scan_go;
static StackType_t *s_scan_stack;
static StaticTask_t s_scan_tcb;
static TaskHandle_t s_reboot_task;
static SemaphoreHandle_t s_reboot_go;
static StackType_t *s_reboot_stack;
static StaticTask_t s_reboot_tcb;

enum {
    BLE_LINK_JOB_SCAN = 1,
    BLE_LINK_JOB_VERIFY = 2
};

/* Little-endian UUID bytes. The 13th byte is the time_low LSB:
 * 0x10 service, 0x11 status, 0x12 url, 0x13 token, 0x14 wifi, 0x15 reboot,
 * 0x16 scan, 0x17 verify, 0x18 peer, 0x19 nets, 0x1a forget. Status is open; every other characteristic needs a paired link.
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
static const ble_uuid128_t s_uuid_scan =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x16,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_verify =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x17,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_peer =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x18,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_nets =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x19,
                     0x4b, 0x7c, 0x8d);
static const ble_uuid128_t s_uuid_forget =
    BLE_UUID128_INIT(0x65, 0x64, 0x6b, 0x6f, 0x72, 0x67, 0xc5, 0xa3, 0x91, 0x4f, 0x2a, 0x6e, 0x1a,
                     0x4b, 0x7c, 0x8d);

static int access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt,
                  void *arg);
static int advertise(void);
static int gap_event(struct ble_gap_event *event, void *arg);
static void resume_adv(void);

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
                    .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_AUTHEN | BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
                {
                    .uuid = &s_uuid_token.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_TOKEN,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
                {
                    .uuid = &s_uuid_wifi.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_WIFI,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
                {
                    .uuid = &s_uuid_reboot.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_REBOOT,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
                {
                    .uuid = &s_uuid_scan.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_SCAN,
                    .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_AUTHEN | BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
                {
                    .uuid = &s_uuid_verify.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_VERIFY,
                    .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_AUTHEN | BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
                {
                    .uuid = &s_uuid_peer.u,
                    .access_cb = access,
                    .arg = (void *)(uintptr_t)BLE_DESK_OP_PEER,
                    .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_AUTHEN,
                },
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

static int read_status(uint16_t conn_handle, struct os_mbuf *om) {
    char ssid[33];
    char url[128];
    char body[256];
    struct ble_gap_conn_desc desc;
    int token_set = 0;
    int n;
    /* Until the link is paired and authenticated, the status says only that this panel pairs. */
    if (ble_gap_conn_find(conn_handle, &desc) != 0 || !desc.sec_state.authenticated) {
        n = ble_desk_format_status_locked(body, sizeof(body), DESK_FW_SHA);
        return append_text(om, body, n);
    }
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

static void publish_scan(int state, const ble_desk_ap_t *aps, int count) {
    char body[BLE_DESK_SCAN_TEXT];
    size_t n;
    if (ble_desk_format_scan(body, sizeof(body), state, aps, count) < 0) {
        ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_FAIL, NULL, 0);
    }
    n = strlen(body) + 1;
    ble_link_enter();
    memcpy(s_scan_text, body, n);
    s_scan_busy = 0;
    ble_link_leave();
}

_Static_assert(BLE_DESK_SCAN_MAX == NET_SCAN_MAX, "scan cap");

/* 12288 matches the glass wifi-scan, which is PSRAM too.
 * The 48-record gather is on the heap.
 * 3b2db6d logged "ble-scan not started, largest internal 7680" after the
 * host task, with DMA still 45056 before Wi-Fi. 12288 and 8192 are both
 * bigger than 7680, so this stack is PSRAM, same pool as the NimBLE mbufs.
 * It is not taken from the STA's DMA block. */
#define BLE_SCAN_STACK 12288

static void publish_probe(int state, const char *ssid, const char *reason) {
    char body[BLE_LINK_PROBE_TEXT];
    size_t n;
    if (ble_desk_format_probe(body, sizeof(body), state, ssid, reason) < 0) {
        ble_desk_format_probe(body, sizeof(body), BLE_DESK_PROBE_FAIL, ssid, "other");
    }
    n = strlen(body) + 1;
    ble_link_enter();
    memcpy(s_probe_text, body, n);
    s_scan_busy = 0;
    ble_link_leave();
}

static void run_verify(const char *ssid, const char *pass) {
    int reason = 0;
    int n = net_wifi_probe(ssid, pass, &reason);
    if (n > 0) {
        publish_probe(BLE_DESK_PROBE_OK, ssid, NULL);
        return;
    }
    if (n < 0) {
        publish_probe(BLE_DESK_PROBE_FAIL, ssid, "radio");
        return;
    }
    publish_probe(BLE_DESK_PROBE_FAIL, ssid, ble_desk_probe_reason(reason));
}

/* Off the NimBLE host. esp_wifi_scan_start and the join probe block for the
 * air time, and the host has to keep answering the link. The task is created
 * once, after esp_wifi_init. A write must not allocate it. Scan and verify
 * share it so a second 12KB stack is not taken from internal RAM. */
static void scan_worker(void *arg) {
    (void)arg;
    for (;;) {
        net_ap_t found[NET_SCAN_MAX];
        ble_desk_ap_t aps[BLE_DESK_SCAN_MAX];
        char ssid[33];
        char pass[65];
        int job;
        int n;
        int i;
        int count;
        if (!s_scan_go || xSemaphoreTake(s_scan_go, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        ble_link_enter();
        job = s_job;
        s_job = 0;
        memcpy(ssid, s_verify_ssid, sizeof(ssid));
        memcpy(pass, s_verify_pass, sizeof(pass));
        memset(s_verify_pass, 0, sizeof(s_verify_pass));
        ble_link_leave();
        if (job == BLE_LINK_JOB_VERIFY) {
            run_verify(ssid, pass);
            memset(pass, 0, sizeof(pass));
            continue;
        }
        memset(pass, 0, sizeof(pass));
        if (job != BLE_LINK_JOB_SCAN) {
            ble_link_enter();
            s_scan_busy = 0;
            ble_link_leave();
            continue;
        }
        n = net_wifi_scan(found, NET_SCAN_MAX);
        if (n < 0) {
            publish_scan(BLE_DESK_SCAN_FAIL, NULL, 0);
        } else {
            count = n;
            memset(aps, 0, sizeof(aps));
            for (i = 0; i < count; i++) {
                memcpy(aps[i].ssid, found[i].ssid, sizeof(aps[i].ssid));
                aps[i].ssid[sizeof(aps[i].ssid) - 1] = '\0';
                aps[i].rssi = found[i].rssi;
            }
            publish_scan(BLE_DESK_SCAN_READY, aps, count);
        }
    }
}

/* esp_restart on the NimBLE host waits for the controller, and the controller
 * waits for that host task. f445c2d did that from the GATT write, so y never
 * reset the desk. This stack is PSRAM and is created with the scan task. */
#define BLE_REBOOT_STACK 3072

static void reboot_worker(void *arg) {
    (void)arg;
    for (;;) {
        if (!s_reboot_go || xSemaphoreTake(s_reboot_go, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        vTaskDelay(pdMS_TO_TICKS(250));
        if (s_on_restart) {
            s_on_restart();
        }
    }
}

static void start_reboot_task(void) {
    if (s_reboot_task) {
        return;
    }
    if (!s_reboot_go) {
        s_reboot_go = xSemaphoreCreateBinary();
    }
    if (!s_reboot_go) {
        ESP_LOGE(TAG, "reboot signal missing");
        return;
    }
    s_reboot_stack =
        heap_caps_aligned_alloc(16, BLE_REBOOT_STACK, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_reboot_stack) {
        ESP_LOGE(TAG, "ble-reboot PSRAM stack missing");
        return;
    }
    s_reboot_task = xTaskCreateStatic(reboot_worker, "ble-reboot", BLE_REBOOT_STACK, NULL, 5,
                                      s_reboot_stack, &s_reboot_tcb);
    if (s_reboot_task) {
        return;
    }
    heap_caps_free(s_reboot_stack);
    s_reboot_stack = NULL;
    ESP_LOGE(TAG, "ble-reboot not started");
}

static void start_scan_task(void) {
    if (s_scan_task) {
        return;
    }
    if (!s_scan_go) {
        s_scan_go = xSemaphoreCreateBinary();
    }
    if (!s_scan_go) {
        ESP_LOGE(TAG, "scan signal missing");
        return;
    }
    s_scan_stack = heap_caps_aligned_alloc(16, BLE_SCAN_STACK, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_scan_stack) {
        ESP_LOGE(TAG, "ble-scan PSRAM stack missing");
        return;
    }
    s_scan_task = xTaskCreateStatic(scan_worker, "ble-scan", BLE_SCAN_STACK, NULL, 4, s_scan_stack,
                                    &s_scan_tcb);
    if (s_scan_task) {
        return;
    }
    heap_caps_free(s_scan_stack);
    s_scan_stack = NULL;
    ESP_LOGE(TAG, "ble-scan not started, PSRAM stack needs CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM");
}

static int read_scan(struct os_mbuf *om) {
    char body[BLE_DESK_SCAN_TEXT];
    ble_link_enter();
    if (!s_scan_text[0]) {
        ble_desk_format_scan(s_scan_text, sizeof(s_scan_text), BLE_DESK_SCAN_IDLE, NULL, 0);
    }
    memcpy(body, s_scan_text, sizeof(body));
    ble_link_leave();
    return append_text(om, body, (int)strlen(body));
}

static int write_scan(const uint8_t *buf, uint16_t len) {
    if (ble_desk_parse_scan(buf, len) != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    if (s_scan_busy) {
        ble_link_leave();
        return 0;
    }
    if (!s_scan_task || !s_scan_go) {
        ble_link_leave();
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    s_scan_busy = 1;
    s_job = BLE_LINK_JOB_SCAN;
    if (ble_desk_format_scan(s_scan_text, sizeof(s_scan_text), BLE_DESK_SCAN_BUSY, NULL, 0) < 0) {
        s_scan_busy = 0;
        s_job = 0;
        ble_link_leave();
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    /* Wake the worker after dropping s_mu. publish_scan takes it at the end,
     * and the host has to send this response before the air time starts. */
    ble_link_leave();
    xSemaphoreGive(s_scan_go);
    ESP_LOGI(TAG, "wifi scan");
    return 0;
}

static int read_verify(struct os_mbuf *om) {
    char body[BLE_LINK_PROBE_TEXT];
    ble_link_enter();
    if (!s_probe_text[0]) {
        ble_desk_format_probe(s_probe_text, sizeof(s_probe_text), BLE_DESK_PROBE_IDLE, NULL, NULL);
    }
    memcpy(body, s_probe_text, sizeof(body));
    ble_link_leave();
    return append_text(om, body, (int)strlen(body));
}

static int write_verify(const uint8_t *buf, uint16_t len) {
    char ssid[33];
    char pass[65];
    if (ble_desk_parse_wifi(buf, len, ssid, sizeof(ssid), pass, sizeof(pass)) != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    if (s_scan_busy) {
        ble_link_leave();
        memset(pass, 0, sizeof(pass));
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (!s_scan_task || !s_scan_go) {
        ble_link_leave();
        memset(pass, 0, sizeof(pass));
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    s_scan_busy = 1;
    s_job = BLE_LINK_JOB_VERIFY;
    memset(s_verify_ssid, 0, sizeof(s_verify_ssid));
    memset(s_verify_pass, 0, sizeof(s_verify_pass));
    memcpy(s_verify_ssid, ssid, strlen(ssid) + 1);
    memcpy(s_verify_pass, pass, strlen(pass) + 1);
    if (ble_desk_format_probe(s_probe_text, sizeof(s_probe_text), BLE_DESK_PROBE_BUSY, ssid, NULL) <
        0) {
        s_scan_busy = 0;
        s_job = 0;
        memset(s_verify_pass, 0, sizeof(s_verify_pass));
        ble_link_leave();
        memset(pass, 0, sizeof(pass));
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    ble_link_leave();
    xSemaphoreGive(s_scan_go);
    ESP_LOGI(TAG, "verify %s", ssid);
    memset(pass, 0, sizeof(pass));
    return 0;
}

static int write_reboot(const uint8_t *buf, uint16_t len) {
    if (ble_desk_parse_reboot(buf, len) != 0 || !s_on_restart) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (!s_reboot_task || !s_reboot_go) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    ESP_LOGI(TAG, "reboot");
    xSemaphoreGive(s_reboot_go);
    return 0;
}

/* Under s_mu, with s_scratch->before holding the store from before this change. On an NVS
 * failure the RAM store goes back to `before` and is saved again, so the panel and the peer
 * agree nothing changed. NVS has no transaction: if that second save fails too, flash can keep
 * a half-written slot until the next good save, and the log says so. */
static int save_store(void) {
    esp_err_t err = net_save(s_store);
    if (err == ESP_OK) {
        return 0;
    }
    ESP_LOGE(TAG, "save networks: %s, change undone", esp_err_to_name(err));
    memcpy(s_store, &s_scratch->before, sizeof(*s_store));
    err = net_save(s_store);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "restore networks: %s, NVS may hold a half-written slot", esp_err_to_name(err));
    }
    return -1;
}

static int write_wifi(const uint8_t *buf, uint16_t len) {
    ble_desk_wifi_t *req = &s_scratch->wifi;
    int rc;
    if (!s_store || ble_desk_parse_wifi_cfg(buf, len, req) != 0) {
        memset(req, 0, sizeof(*req));
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    memcpy(&s_scratch->before, s_store, sizeof(*s_store));
    rc = ble_desk_apply_wifi(s_store, req);
    if (rc == 0) {
        rc = save_store();
    }
    memset(&s_scratch->before, 0, sizeof(s_scratch->before));
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
    int rc = 0;
    int removed;
    if (!s_store || ble_desk_parse_forget(buf, len, ssid, sizeof(ssid)) != 0) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    ble_link_enter();
    memcpy(&s_scratch->before, s_store, sizeof(*s_store));
    removed = wifi_remove(s_store, ssid) == 0;
    if (removed) {
        rc = save_store();
    }
    memset(&s_scratch->before, 0, sizeof(s_scratch->before));
    ble_link_leave();
    if (removed && rc == 0) {
        ESP_LOGI(TAG, "forget %s", ssid);
    }
    return rc == 0 ? 0 : BLE_ATT_ERR_UNLIKELY;
}

/* Accepted on every paired link; only the write that follows a fresh pairing reaches the glass. */
static int write_peer(uint16_t conn_handle, const uint8_t *buf, uint16_t len) {
    char name[BLE_PAIR_PEER_MAX + 1];
    if (conn_handle != s_fresh_conn) {
        return 0;
    }
    s_fresh_conn = BLE_LINK_NO_CONN;
    ble_pair_peer_name(buf, len, name, sizeof name);
    if (s_paired) {
        s_paired(BLE_LINK_PAIRED_NAME, name);
    }
    return 0;
}

static int access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *ctxt,
                  void *arg) {
    uintptr_t op = (uintptr_t)arg;
    uint8_t *buf;
    uint16_t len = 0;
    int rc;
    (void)attr_handle;
    if (!ctxt) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        if (op == BLE_DESK_OP_STATUS) {
            return read_status(conn_handle, ctxt->om);
        }
        if (op == BLE_DESK_OP_URL) {
            return read_url(ctxt->om);
        }
        if (op == BLE_DESK_OP_SCAN) {
            return read_scan(ctxt->om);
        }
        if (op == BLE_DESK_OP_VERIFY) {
            return read_verify(ctxt->om);
        }
        if (op == BLE_DESK_OP_NETS) {
            return read_nets(ctxt->om);
        }
        return BLE_ATT_ERR_READ_NOT_PERMITTED;
    }
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) {
        return BLE_ATT_ERR_UNLIKELY;
    }
    if (!s_scratch) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    buf = s_scratch->write;
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
    if (op == BLE_DESK_OP_SCAN) {
        return write_scan(buf, len);
    }
    if (op == BLE_DESK_OP_VERIFY) {
        return write_verify(buf, len);
    }
    if (op == BLE_DESK_OP_REBOOT) {
        return write_reboot(buf, len);
    }
    if (op == BLE_DESK_OP_PEER) {
        return write_peer(conn_handle, buf, len);
    }
    if (op == BLE_DESK_OP_FORGET) {
        return write_forget(buf, len);
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

/* Advertising when Control Center left it on. Does not call the UI
 * callback from a task that already holds the LVGL lock. */
static void resume_adv(void) {
    if (s_user_off) {
        note(BLE_LINK_OFF);
        return;
    }
    if (advertise() == 0) {
        note(BLE_LINK_ADV);
        return;
    }
    note(BLE_LINK_OFF);
}

static void apply_bt_user(void) {
    if (!s_gatt_ok || !s_host_up) {
        return;
    }
    if (s_user_off) {
        if (s_conn != BLE_LINK_NO_CONN) {
            ble_gap_terminate(s_conn, BLE_LINK_TERM_USER);
        }
        if (ble_gap_adv_active()) {
            ble_gap_adv_stop();
        }
        return;
    }
    if (s_conn != BLE_LINK_NO_CONN) {
        return;
    }
    advertise();
}

/* MITM-authenticated, 16-byte key: the person confirmed the code on the glass. */
static int link_trusted(uint16_t conn) {
    struct ble_gap_conn_desc desc;
    if (ble_gap_conn_find(conn, &desc) != 0) {
        return 0;
    }
    return ble_pair_link_trusted(desc.sec_state.encrypted, desc.sec_state.authenticated,
                                 desc.sec_state.key_size);
}

_Static_assert(BLE_PAIR_STORE_OVERFLOW == BLE_STORE_EVENT_OVERFLOW, "store event codes");
_Static_assert(BLE_PAIR_STORE_FULL == BLE_STORE_EVENT_FULL, "store event codes");

static int is_bond_record(int obj_type) {
    return obj_type == BLE_STORE_OBJ_TYPE_OUR_SEC || obj_type == BLE_STORE_OBJ_TYPE_PEER_SEC ||
           obj_type == BLE_STORE_OBJ_TYPE_PEER_ADDR;
}

/* 1 when the computer on conn already has a bond here (a re-pair replaces it). */
static int peer_bonded(uint16_t conn) {
    struct ble_gap_conn_desc desc;
    struct ble_store_key_sec key;
    struct ble_store_value_sec value;
    if (ble_gap_conn_find(conn, &desc) != 0) {
        return 0;
    }
    memset(&key, 0, sizeof key);
    key.peer_addr = desc.peer_id_addr;
    return ble_store_read_peer_sec(&key, &value) == 0;
}

/* Never evict a bond to make room: the oldest could be the owner's. A full store refuses a new
 * computer at its pairing request (before a code or a Paired card); Forget pairings makes room. */
static int store_status(struct ble_store_status_event *event, void *arg) {
    int bond = 0;
    int bonded = 0;
    if (event->event_code == BLE_STORE_EVENT_OVERFLOW) {
        bond = is_bond_record(event->overflow.obj_type);
    } else if (event->event_code == BLE_STORE_EVENT_FULL) {
        bond = is_bond_record(event->full.obj_type);
        bonded = bond && peer_bonded(event->full.conn_handle);
    }
    if (ble_pair_store_refuse(event->event_code, bond, bonded)) {
        ESP_LOGW(TAG, "bond store full: Forget pairings to add a computer");
        return BLE_HS_ESTORE_CAP;
    }
    return ble_store_util_status_rr(event, arg);
}

static int gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status != 0) {
            ESP_LOGW(TAG, "connect failed %d", event->connect.status);
            s_conn = BLE_LINK_NO_CONN;
            resume_adv();
            return 0;
        }
        s_conn = event->connect.conn_handle;
        if (s_user_off) {
            ble_gap_terminate(s_conn, BLE_LINK_TERM_USER);
            note(BLE_LINK_OFF);
            return 0;
        }
        note(BLE_LINK_CONN);
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ask_drop(event->disconnect.conn.conn_handle);
        s_fresh_conn = BLE_LINK_NO_CONN;
        if (s_paired) {
            s_paired(BLE_LINK_PAIRED_END, NULL);
        }
        ESP_LOGI(TAG, "disconnect %d", event->disconnect.reason);
        s_conn = BLE_LINK_NO_CONN;
        resume_adv();
        return 0;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        resume_adv();
        return 0;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "mtu %d", event->mtu.value);
        return 0;
    case BLE_GAP_EVENT_PASSKEY_ACTION: {
        /* Numeric comparison: the glass shows the code with Yes and No, and
         * ble_link_pair_answer sends the person's answer. No answer in 30 s is No. */
        char text[BLE_PAIR_TEXT_MAX];
        if (event->passkey.params.action != BLE_SM_IOACT_NUMCMP) {
            return 0;
        }
        taskENTER_CRITICAL(&s_ask_mux);
        ble_pair_ask_open(&s_ask, event->passkey.conn_handle, now_ms());
        taskEXIT_CRITICAL(&s_ask_mux);
        if (ble_pair_format(event->passkey.params.numcmp, text, sizeof text) == 0 || !s_pair_show) {
            /* Nobody can compare the code: refuse. */
            ble_link_pair_answer(0);
            return 0;
        }
        s_pair_show(text);
        return 0;
    }
    case BLE_GAP_EVENT_ENC_CHANGE:
        ask_drop(event->enc_change.conn_handle);
        /* NimBLE stored the keys just before this event. sm_mitm only asks for MITM: a central
         * that says it has no display or keyboard still gets Just Works, with no code on the
         * glass. Those keys and that link go, so only a confirmed code ever bonds. */
        if (event->enc_change.status == 0 && !link_trusted(event->enc_change.conn_handle)) {
            struct ble_gap_conn_desc desc;
            ESP_LOGW(TAG, "unauthenticated pairing refused");
            if (ble_gap_conn_find(event->enc_change.conn_handle, &desc) == 0) {
                ble_store_util_delete_peer(&desc.peer_id_addr);
            }
            ble_gap_terminate(event->enc_change.conn_handle, BLE_ERR_AUTH_FAIL);
            if (s_fresh_conn == event->enc_change.conn_handle) {
                s_fresh_conn = BLE_LINK_NO_CONN;
                if (s_paired) {
                    s_paired(BLE_LINK_PAIRED_END, NULL);
                }
            }
        }
        return 0;
    case BLE_GAP_EVENT_PARING_COMPLETE: /* sic, NimBLE spelling */
        /* Only a new pairing raises this; a stored bond just encrypts. Just Works never
         * greets: ENC_CHANGE drops it right after. */
        if (event->pairing_complete.status == 0 && link_trusted(event->pairing_complete.conn_handle)) {
            s_fresh_conn = event->pairing_complete.conn_handle;
            if (s_paired) {
                s_paired(BLE_LINK_PAIRED_BEGIN, NULL);
            }
        }
        return 0;
    case BLE_GAP_EVENT_REPEAT_PAIRING: {
        /* The computer forgot its keys but the panel kept its half of the bond.
         * NimBLE drops the pairing request unless this returns RETRY. Only a request whose
         * method confirms a code (new_authenticated) may replace the bond: otherwise anyone
         * spoofing the owner's address could swap it for a Just Works one. The bond is still
         * deleted before the person taps Yes, so a spoofer who gets No costs the owner a
         * re-pair. That denial of service is accepted; it grants no access. */
        struct ble_gap_conn_desc desc;
        int rc;
        if (!event->repeat_pairing.new_authenticated) {
            ESP_LOGW(TAG, "repeat pairing without a code ignored");
            return BLE_GAP_REPEAT_PAIRING_IGNORE;
        }
        rc = ble_gap_conn_find(event->repeat_pairing.conn_handle, &desc);
        if (rc == 0) {
            rc = ble_store_util_delete_peer(&desc.peer_id_addr);
        }
        if (rc != 0) {
            ESP_LOGW(TAG, "repeat pairing %d", rc);
            return BLE_GAP_REPEAT_PAIRING_IGNORE;
        }
        return BLE_GAP_REPEAT_PAIRING_RETRY;
    }
    default:
        return 0;
    }
}

void ble_link_forget_pairings(void) {
    ble_store_clear();
    if (s_conn != BLE_LINK_NO_CONN) {
        ble_gap_terminate(s_conn, BLE_LINK_TERM_USER);
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
    resume_adv();
}

static void host_task(void *arg) {
    (void)arg;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static void log_dma(void) {
    size_t dma = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    ESP_LOGI(TAG, "largest internal DMA %u after NimBLE", (unsigned)dma);
    /* 29696 is where the STA died after the 2x50-line pin. 48000 is the
     * region left free when the 20-line stripe is the only pin. Wi-Fi init
     * runs before the host task, so this number is the block it sees. */
    if (dma < DESK_DMA_KEPT_FOR_STA) {
        ESP_LOGW(TAG,
                 "internal DMA block %u is under %u. The STA joined from that larger block; "
                 "%u was not enough. Shrink the controller, do not grow the DMA stripe",
                 (unsigned)dma, DESK_DMA_KEPT_FOR_STA, DESK_DMA_LEFT_AFTER_PAIR);
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
    /* Numeric comparison: the glass and the computer show the same code and the person
     * confirms it on both. MITM-protected LE Secure Connections, with the keys kept in NVS
     * so a paired computer reconnects without a new code. */
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.store_status_cb = store_status;
    ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_YESNO;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_mitm = 1;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_sc_only = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_store_config_init();
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
}

void ble_link_host_start(void) {
    if (!s_gatt_ok || s_host_up) {
        return;
    }
    s_host_up = 1;
    /* Before the host task can call access(). PSRAM: see ble_link_scratch_t. */
    s_scratch = heap_caps_calloc(1, sizeof(*s_scratch), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_scratch) {
        ESP_LOGE(TAG, "GATT scratch PSRAM missing: writes and nets are refused");
    }
    /* Host stack first (6144, internal). The scan and reboot stacks are
     * PSRAM after that. A write only gives a semaphore. */
    UBaseType_t tasks = uxTaskGetNumberOfTasks();
    nimble_port_freertos_init(host_task);
    /* ESP-IDF drops the task-create result. Without the host task there is no sync and no
     * advertising, and nothing else logs it: its stack needs internal RAM. Not xTaskGetHandle:
     * it links ~300 B of IRAM out of the same DRAM, which was enough to stop the task starting.
     * Not a heap delta either: other tasks free internal RAM meanwhile and it misfired. */
    if (uxTaskGetNumberOfTasks() <= tasks) {
        ESP_LOGE(TAG, "NimBLE host task did not start: no internal RAM for its stack");
    }
    start_scan_task();
    start_reboot_task();
}

#endif /* CONFIG_BT_NIMBLE_ENABLED */

int ble_link_enabled(void) {
    return s_user_off ? 0 : 1;
}

void ble_link_set_enabled(int on) {
    s_user_off = on ? 0 : 1;
    net_desk_flag_set(NET_BT_OFF_KEY, s_user_off);
#if CONFIG_BT_NIMBLE_ENABLED
    /* Gap events land on the host task, which takes the LVGL lock to paint
     * the rune. Calling note() here would take that lock on the LVGL task. */
    apply_bt_user();
#endif
}

void ble_link_start(wifi_store_t *store, ble_link_state_fn on_state, ble_link_restart_fn on_restart) {
    s_store = store;
    s_on_state = on_state;
    s_on_restart = on_restart;
    s_user_off = net_desk_flag(NET_BT_OFF_KEY);
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

#if !CONFIG_BT_NIMBLE_ENABLED
void ble_link_host_start(void) {}
void ble_link_set_pair_callbacks(ble_link_pair_show_fn show, ble_link_pair_hide_fn hide) {
    (void)show;
    (void)hide;
}
void ble_link_forget_pairings(void) {}
void ble_link_pair_answer(int yes) {
    (void)yes;
}
void ble_link_set_paired_callback(ble_link_paired_fn fn) {
    (void)fn;
}
#endif
