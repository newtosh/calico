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
/* NVS desk flag. "1" is set. Absent is clear. Not a Wi-Fi slot. */
#define NET_STA_OFF_KEY "staoff"
#define NET_BT_OFF_KEY "btoff"
int net_desk_flag(const char *key);
void net_desk_flag_set(const char *key, int on);
/* 1 when Control Center allows the STA to associate. Default is on.
 * Off disconnects and holds reconnect. It does not call esp_wifi_stop,
 * so the RX buffers allocated before the NimBLE host stay put. */
int net_sta_enabled(void);
/* Persists staoff. On connects when an SSID is already in the STA config
 * and returns 1. On with an empty config returns 0 so the caller can scan. */
int net_sta_set_enabled(int on);
void net_link(net_link_t *out);
/* Associated SSID, or empty when the STA is down or not joined. */
void net_joined_ssid(char *out, size_t out_len);
/* A status poll completed. The STA give-up latch is stale. */
void net_mark_reachable(void);
/* esp_wifi_init only. Call before the NimBLE host task and wifi-join. */
void net_wifi_prepare(void);
void net_wifi_start(const desk_settings_t *in);
/* Associate in RAM only. Does not write NVS.
 * 1 joined, 0 rejected (*reason_out is a Wi-Fi reason, or 200 on our wait),
 * -1 the radio could not start the attempt.
 * Failure restores the previous STA config. Success leaves the trial
 * association up until reboot. */
int net_wifi_probe(const char *ssid, const char *pass, int *reason_out);
int net_wifi_scan(net_ap_t *out, int max_out);
/* 0 and fills chosen, 1 if no saved network is in range, -1 if the scan failed. */
int net_wifi_select(const wifi_store_t *store, desk_settings_t *chosen);
int net_fetch_status(const desk_settings_t *in, char *body, size_t body_len);
void net_dismiss(const desk_settings_t *in);
/* Clears one waiting agent. An empty id does not post. */
void net_dismiss_agent(const desk_settings_t *in, const char *agent_id);
void net_clear_unread(const desk_settings_t *in);
/* POST a top-down RGB565 BMP. pixels may have a stride wider than width*2. */
void net_post_frame(const desk_settings_t *in, const uint8_t *pixels, int width, int height,
                    int stride);
