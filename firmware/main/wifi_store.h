#pragma once

#include <stddef.h>
#include <stdint.h>

/* NVS namespace "desk".
 * Global default: "url", "token".
 * Legacy single network, loaded only when no indexed SSID exists: "ssid", "pass".
 * Known network i (0 .. WIFI_NET_MAX-1): "n{i}ssid", "n{i}pass",
 * and optional "n{i}url", "n{i}token". The password key stays "pass".
 * An empty per-network url uses the global url, then WIFI_DEFAULT_URL.
 */

#define WIFI_NET_MAX 8
#define WIFI_DEFAULT_URL "http://192.168.4.30:8787"

typedef struct {
    char ssid[33];
    char pass[65];
    char url[128];
    char token[128];
} wifi_net_t;

typedef struct {
    char url[128];
    char token[128];
    wifi_net_t nets[WIFI_NET_MAX];
    int count;
} wifi_store_t;

typedef struct {
    const char *ssid;
    int rssi;
} wifi_heard_t;

void wifi_store_init(wifi_store_t *store);
void wifi_migrate_legacy(wifi_store_t *store, const char *ssid, const char *pass);
int wifi_upsert(wifi_store_t *store, const char *ssid, const char *pass, const char *url,
                const char *token);
int wifi_remove(wifi_store_t *store, const char *ssid);
int wifi_pick(const wifi_store_t *store, const wifi_heard_t *heard, int heard_count);
void wifi_endpoint(const wifi_store_t *store, int index, char *url, size_t url_len, char *token,
                   size_t token_len);
