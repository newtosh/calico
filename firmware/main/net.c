#include "net.h"
#include "orient.h"

#include "esp_check.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "nvs_flash.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "desk-net";
static volatile int s_wifi_retries;
static volatile int s_wifi_has_ip;
static volatile int s_wifi_gave_up;
static int s_wifi_up;

typedef struct {
    char *body;
    size_t cap;
    size_t len;
} http_buf_t;

static void copy_field(char *dest, size_t dest_len, const char *src) {
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

static void read_str(nvs_handle_t handle, const char *key, char *dest, size_t dest_len) {
    size_t length = dest_len;
    dest[0] = '\0';
    if (nvs_get_str(handle, key, dest, &length) != ESP_OK) {
        dest[0] = '\0';
    }
}

static void slot_key(char *dest, size_t dest_len, int index, const char *field) {
    snprintf(dest, dest_len, "n%d%s", index, field);
}

static void set_or_erase(nvs_handle_t handle, const char *key, const char *value, int keep_empty) {
    esp_err_t err;
    if (value && (value[0] || keep_empty)) {
        ESP_ERROR_CHECK(nvs_set_str(handle, key, value ? value : ""));
        return;
    }
    err = nvs_erase_key(handle, key);
    if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
        ESP_ERROR_CHECK(err);
    }
}

void net_load(wifi_store_t *out) {
    nvs_handle_t handle;
    char key[16];
    char legacy_ssid[33];
    char legacy_pass[65];
    int i;
    wifi_store_init(out);
    if (nvs_open("desk", NVS_READONLY, &handle) != ESP_OK) {
        return;
    }
    read_str(handle, "url", out->url, sizeof(out->url));
    if (!out->url[0]) {
        copy_field(out->url, sizeof(out->url), WIFI_DEFAULT_URL);
    }
    read_str(handle, "token", out->token, sizeof(out->token));
    for (i = 0; i < WIFI_NET_MAX; i++) {
        slot_key(key, sizeof(key), i, "ssid");
        read_str(handle, key, out->nets[out->count].ssid, sizeof(out->nets[0].ssid));
        if (!out->nets[out->count].ssid[0]) {
            continue;
        }
        slot_key(key, sizeof(key), i, "pass");
        read_str(handle, key, out->nets[out->count].pass, sizeof(out->nets[0].pass));
        slot_key(key, sizeof(key), i, "url");
        read_str(handle, key, out->nets[out->count].url, sizeof(out->nets[0].url));
        slot_key(key, sizeof(key), i, "token");
        read_str(handle, key, out->nets[out->count].token, sizeof(out->nets[0].token));
        out->count++;
    }
    if (out->count == 0) {
        read_str(handle, "ssid", legacy_ssid, sizeof(legacy_ssid));
        read_str(handle, "pass", legacy_pass, sizeof(legacy_pass));
        wifi_migrate_legacy(out, legacy_ssid, legacy_pass);
    }
    nvs_close(handle);
}

void net_save(const wifi_store_t *in) {
    nvs_handle_t handle;
    char key[16];
    int i;
    ESP_ERROR_CHECK(nvs_open("desk", NVS_READWRITE, &handle));
    set_or_erase(handle, "url", in->url, 0);
    set_or_erase(handle, "token", in->token, 1);
    set_or_erase(handle, "ssid", "", 0);
    set_or_erase(handle, "pass", "", 0);
    for (i = 0; i < WIFI_NET_MAX; i++) {
        const wifi_net_t *net = i < in->count ? &in->nets[i] : NULL;
        slot_key(key, sizeof(key), i, "ssid");
        set_or_erase(handle, key, net ? net->ssid : "", 0);
        slot_key(key, sizeof(key), i, "pass");
        set_or_erase(handle, key, net ? net->pass : "", net != NULL);
        slot_key(key, sizeof(key), i, "url");
        set_or_erase(handle, key, net ? net->url : "", 0);
        slot_key(key, sizeof(key), i, "token");
        set_or_erase(handle, key, net && net->token[0] ? net->token : "", 0);
    }
    ESP_ERROR_CHECK(nvs_commit(handle));
    nvs_close(handle);
}

void net_save_globals(const char *url, const char *token) {
    nvs_handle_t handle;
    ESP_ERROR_CHECK(nvs_open("desk", NVS_READWRITE, &handle));
    set_or_erase(handle, "url", url, 0);
    set_or_erase(handle, "token", token, 1);
    ESP_ERROR_CHECK(nvs_commit(handle));
    nvs_close(handle);
}

void net_rotlock_load(char *out, size_t out_len) {
    nvs_handle_t handle;
    if (!out || out_len == 0) {
        return;
    }
    out[0] = '\0';
    if (nvs_open("desk", NVS_READONLY, &handle) != ESP_OK) {
        return;
    }
    read_str(handle, ORIENT_ROTLOCK_KEY, out, out_len);
    nvs_close(handle);
}

void net_rotlock_save(const char *value) {
    nvs_handle_t handle;
    ESP_ERROR_CHECK(nvs_open("desk", NVS_READWRITE, &handle));
    set_or_erase(handle, ORIENT_ROTLOCK_KEY, value, 0);
    ESP_ERROR_CHECK(nvs_commit(handle));
    nvs_close(handle);
}

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)data;
    if (base != WIFI_EVENT || id != WIFI_EVENT_STA_DISCONNECTED) {
        return;
    }
    s_wifi_has_ip = 0;
    if (s_wifi_retries < 10) {
        s_wifi_retries++;
        esp_wifi_connect();
        return;
    }
    s_wifi_gave_up = 1;
}

static void on_ip(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)base;
    (void)id;
    (void)data;
    s_wifi_retries = 0;
    s_wifi_has_ip = 1;
    s_wifi_gave_up = 0;
}

void net_link(net_link_t *out) {
    wifi_ap_record_t ap;
    if (!out) {
        return;
    }
    out->has_ip = s_wifi_has_ip;
    out->rssi = 0;
    out->retries = s_wifi_retries;
    out->gave_up = s_wifi_gave_up;
    if (s_wifi_has_ip && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        out->rssi = ap.rssi;
    }
}

static void wifi_bringup(void) {
    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    if (s_wifi_up) {
        return;
    }
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, on_wifi, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_ip, NULL, NULL));
    esp_netif_create_default_wifi_sta();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());
    s_wifi_up = 1;
}

void net_wifi_start(const desk_settings_t *in) {
    wifi_config_t wifi = {0};
    wifi_bringup();
    copy_field((char *)wifi.sta.ssid, sizeof(wifi.sta.ssid), in->ssid);
    copy_field((char *)wifi.sta.password, sizeof(wifi.sta.password), in->pass);
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));
    ESP_ERROR_CHECK(esp_wifi_connect());
    ESP_LOGI(TAG, "joining %s", in->ssid);
}

int net_wifi_scan(net_ap_t *out, int max_out) {
    wifi_scan_config_t scan = {
        .show_hidden = true,
    };
    wifi_ap_record_t *recs = NULL;
    net_ap_t *found = NULL;
    const int found_cap = 48;
    uint16_t count = 48;
    uint16_t got = 0;
    int n = 0;
    int i;
    int j;
    if (!out || max_out <= 0) {
        return -1;
    }
    if (max_out > NET_SCAN_MAX) {
        max_out = NET_SCAN_MAX;
    }
    wifi_bringup();
    if (esp_wifi_scan_start(&scan, true) != ESP_OK) {
        return -1;
    }
    if (esp_wifi_scan_get_ap_num(&got) != ESP_OK) {
        return -1;
    }
    if (got == 0) {
        return 0;
    }
    if (count > got) {
        count = got;
    }
    recs = calloc(count, sizeof(*recs));
    if (!recs) {
        return -1;
    }
    if (esp_wifi_scan_get_ap_records(&count, recs) != ESP_OK) {
        free(recs);
        return -1;
    }
    found = calloc((size_t)found_cap, sizeof(*found));
    if (!found) {
        free(recs);
        return -1;
    }
    for (i = 0; i < (int)count; i++) {
        const char *ssid = (const char *)recs[i].ssid;
        if (!ssid[0]) {
            continue;
        }
        for (j = 0; j < n; j++) {
            if (strcmp(found[j].ssid, ssid) == 0) {
                break;
            }
        }
        if (j < n) {
            if (recs[i].rssi > found[j].rssi) {
                found[j].rssi = recs[i].rssi;
            }
            continue;
        }
        if (n >= found_cap) {
            continue;
        }
        copy_field(found[n].ssid, sizeof(found[n].ssid), ssid);
        found[n].rssi = recs[i].rssi;
        n++;
    }
    free(recs);
    for (i = 1; i < n; i++) {
        net_ap_t key = found[i];
        j = i;
        while (j > 0 && found[j - 1].rssi < key.rssi) {
            found[j] = found[j - 1];
            j--;
        }
        found[j] = key;
    }
    if (n > max_out) {
        n = max_out;
    }
    for (i = 0; i < n; i++) {
        out[i] = found[i];
    }
    free(found);
    ESP_LOGI(TAG, "scan found %d", n);
    return n;
}

static int scan_one(const char *ssid, int *rssi_out) {
    wifi_scan_config_t scan = {0};
    wifi_ap_record_t *recs;
    uint8_t ssid_buf[33];
    uint16_t count = 8;
    int i;
    int found = 0;
    int rssi = 0;
    memset(ssid_buf, 0, sizeof(ssid_buf));
    copy_field((char *)ssid_buf, sizeof(ssid_buf), ssid);
    scan.ssid = ssid_buf;
    scan.show_hidden = 1;
    if (esp_wifi_scan_start(&scan, true) != ESP_OK) {
        return 0;
    }
    recs = calloc(count, sizeof(*recs));
    if (!recs) {
        return 0;
    }
    if (esp_wifi_scan_get_ap_records(&count, recs) != ESP_OK) {
        free(recs);
        return 0;
    }
    for (i = 0; i < (int)count; i++) {
        if (!found || recs[i].rssi > rssi) {
            rssi = recs[i].rssi;
            found = 1;
        }
    }
    free(recs);
    if (found && rssi_out) {
        *rssi_out = rssi;
    }
    return found;
}

int net_wifi_select(const wifi_store_t *store, desk_settings_t *chosen) {
    net_ap_t aps[NET_SCAN_MAX];
    wifi_heard_t heard[NET_SCAN_MAX + WIFI_NET_MAX];
    int n;
    int h = 0;
    int i;
    int idx;
    if (!store || !chosen || store->count <= 0) {
        return 1;
    }
    n = net_wifi_scan(aps, NET_SCAN_MAX);
    if (n < 0) {
        ESP_LOGI(TAG, "scan failed");
        return -1;
    }
    for (i = 0; i < n && h < (int)(sizeof(heard) / sizeof(heard[0])); i++) {
        heard[h].ssid = aps[i].ssid;
        heard[h].rssi = aps[i].rssi;
        h++;
    }
    for (i = 0; i < store->count; i++) {
        int seen = 0;
        int j;
        int rssi = 0;
        for (j = 0; j < h; j++) {
            if (heard[j].ssid && strcmp(heard[j].ssid, store->nets[i].ssid) == 0) {
                seen = 1;
                break;
            }
        }
        if (seen) {
            continue;
        }
        if (!scan_one(store->nets[i].ssid, &rssi)) {
            continue;
        }
        if (h >= (int)(sizeof(heard) / sizeof(heard[0]))) {
            break;
        }
        heard[h].ssid = store->nets[i].ssid;
        heard[h].rssi = rssi;
        h++;
    }
    idx = wifi_pick(store, heard, h);
    if (idx < 0) {
        ESP_LOGI(TAG, "no saved network in range");
        return 1;
    }
    memset(chosen, 0, sizeof(*chosen));
    copy_field(chosen->ssid, sizeof(chosen->ssid), store->nets[idx].ssid);
    copy_field(chosen->pass, sizeof(chosen->pass), store->nets[idx].pass);
    wifi_endpoint(store, idx, chosen->url, sizeof(chosen->url), chosen->token, sizeof(chosen->token));
    return 0;
}

static esp_err_t on_http(esp_http_client_event_t *event) {
    http_buf_t *buf;
    size_t room;
    if (event->event_id != HTTP_EVENT_ON_DATA || event->data_len <= 0) {
        return ESP_OK;
    }
    buf = event->user_data;
    if (!buf || !buf->body) {
        return ESP_OK;
    }
    room = buf->cap - buf->len - 1;
    if (room > (size_t)event->data_len) {
        room = (size_t)event->data_len;
    }
    memcpy(buf->body + buf->len, event->data, room);
    buf->len += room;
    buf->body[buf->len] = '\0';
    return ESP_OK;
}

static void join_url(char *dest, size_t dest_len, const char *base, const char *suffix) {
    size_t len = strlen(base);
    while (len > 0 && base[len - 1] == '/') {
        len--;
    }
    snprintf(dest, dest_len, "%.*s%s", (int)len, base, suffix);
}

static esp_err_t request(const desk_settings_t *in, const char *suffix, const char *method,
                         http_buf_t *buf) {
    char url[160];
    char bearer[160];
    esp_http_client_config_t cfg = {
        .event_handler = on_http,
        .user_data = buf,
        .timeout_ms = 4000,
    };
    esp_http_client_handle_t client;
    esp_err_t err;
    join_url(url, sizeof(url), in->url, suffix);
    cfg.url = url;
    client = esp_http_client_init(&cfg);
    if (!client) {
        return ESP_FAIL;
    }
    esp_http_client_set_method(client, strcmp(method, "POST") == 0 ? HTTP_METHOD_POST : HTTP_METHOD_GET);
    if (in->token[0]) {
        snprintf(bearer, sizeof(bearer), "Bearer %s", in->token);
        esp_http_client_set_header(client, "Authorization", bearer);
    }
    err = esp_http_client_perform(client);
    if (err == ESP_OK && esp_http_client_get_status_code(client) != 200 &&
        esp_http_client_get_status_code(client) != 204) {
        err = ESP_FAIL;
    }
    esp_http_client_cleanup(client);
    return err;
}

int net_fetch_status(const desk_settings_t *in, char *body, size_t body_len) {
    http_buf_t buf = {.body = body, .cap = body_len, .len = 0};
    if (body_len == 0) {
        return -1;
    }
    body[0] = '\0';
    if (request(in, "/api/status", "GET", &buf) != ESP_OK) {
        return -1;
    }
    return 0;
}

void net_dismiss(const desk_settings_t *in) {
    request(in, "/api/dismiss", "POST", NULL);
}
