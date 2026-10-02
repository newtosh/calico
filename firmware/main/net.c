#include "net.h"

#include "esp_check.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "nvs_flash.h"

#include <stdio.h>
#include <string.h>

static const char *TAG = "desk-net";
static int s_wifi_retries;

typedef struct {
    char *body;
    size_t cap;
    size_t len;
} http_buf_t;

static void copy_field(char *dest, size_t dest_len, const char *src) {
    if (!src) {
        dest[0] = '\0';
        return;
    }
    snprintf(dest, dest_len, "%s", src);
}

void net_load(desk_settings_t *out) {
    nvs_handle_t handle;
    size_t length;
    memset(out, 0, sizeof(*out));
    snprintf(out->url, sizeof(out->url), "%s", "http://192.168.1.10:8787");
    if (nvs_open("desk", NVS_READONLY, &handle) != ESP_OK) {
        return;
    }
    length = sizeof(out->ssid);
    nvs_get_str(handle, "ssid", out->ssid, &length);
    length = sizeof(out->pass);
    nvs_get_str(handle, "pass", out->pass, &length);
    length = sizeof(out->url);
    nvs_get_str(handle, "url", out->url, &length);
    length = sizeof(out->token);
    nvs_get_str(handle, "token", out->token, &length);
    nvs_close(handle);
}

void net_save(const desk_settings_t *in) {
    nvs_handle_t handle;
    ESP_ERROR_CHECK(nvs_open("desk", NVS_READWRITE, &handle));
    ESP_ERROR_CHECK(nvs_set_str(handle, "ssid", in->ssid));
    ESP_ERROR_CHECK(nvs_set_str(handle, "pass", in->pass));
    ESP_ERROR_CHECK(nvs_set_str(handle, "url", in->url));
    ESP_ERROR_CHECK(nvs_set_str(handle, "token", in->token));
    ESP_ERROR_CHECK(nvs_commit(handle));
    nvs_close(handle);
}

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED && s_wifi_retries < 10) {
        s_wifi_retries++;
        esp_wifi_connect();
    }
}

static void on_ip(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)base;
    (void)id;
    (void)data;
    s_wifi_retries = 0;
}

void net_wifi_start(const desk_settings_t *in) {
    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    wifi_config_t wifi = {0};
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, on_wifi, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_ip, NULL, NULL));
    esp_netif_create_default_wifi_sta();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    copy_field((char *)wifi.sta.ssid, sizeof(wifi.sta.ssid), in->ssid);
    copy_field((char *)wifi.sta.password, sizeof(wifi.sta.password), in->pass);
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_connect());
    ESP_LOGI(TAG, "joining %s", in->ssid);
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
