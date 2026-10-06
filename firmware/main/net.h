#pragma once

#include "wifi_store.h"

#include <stddef.h>
#include <stdint.h>

#define NET_SCAN_MAX 16

typedef struct {
    char ssid[33];
    char pass[65];
    char url[128];
    char token[128];
} desk_settings_t;

typedef struct {
    char ssid[33];
    int8_t rssi;
} net_ap_t;

typedef struct {
    int has_ip;
    int rssi;
    int retries;
    int gave_up;
} net_link_t;

void net_load(wifi_store_t *out);
void net_save(const wifi_store_t *in);
void net_save_globals(const char *url, const char *token);
void net_rotlock_load(char *out, size_t out_len);
void net_rotlock_save(const char *value);
void net_link(net_link_t *out);
/* A status poll completed. The STA give-up latch is stale. */
void net_mark_reachable(void);
void net_wifi_start(const desk_settings_t *in);
int net_wifi_scan(net_ap_t *out, int max_out);
/* 0 and fills chosen, 1 if no saved network is in range, -1 if the scan failed. */
int net_wifi_select(const wifi_store_t *store, desk_settings_t *chosen);
int net_fetch_status(const desk_settings_t *in, char *body, size_t body_len);
void net_dismiss(const desk_settings_t *in);
void net_clear_unread(const desk_settings_t *in);
