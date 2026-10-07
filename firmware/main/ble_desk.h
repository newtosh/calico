#pragma once

#include "wifi_store.h"

#include <stddef.h>
#include <stdint.h>

/* Desk provisioning over BLE. Same NVS namespace as the settings screen
 * and scripts/provision-wifi.py. Strings here are the canonical UUIDs;
 * firmware/main/ble_link.c stores them little-endian. scripts/ble-provision.py
 * must use the same text.
 *
 * Service 8d7c4b10-6e2a-4f91-a3c5-67726f6b6465
 *   status  ...11  read
 *   url     ...12  read, write
 *   token   ...13  write
 *   wifi    ...14  write
 *   reboot  ...15  write
 * The node bytes 67726f6b6465 are "grokde".
 */

#define BLE_DESK_NAME "grokbot-buddy"

#define BLE_DESK_UUID_SVC "8d7c4b10-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_STATUS "8d7c4b11-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_URL "8d7c4b12-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_TOKEN "8d7c4b13-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_WIFI "8d7c4b14-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_REBOOT "8d7c4b15-6e2a-4f91-a3c5-67726f6b6465"

/* Field sizes match wifi_store_t and the USB provisioner. */
#define BLE_DESK_SSID_MAX 32
#define BLE_DESK_PASS_MAX 64
#define BLE_DESK_URL_MAX 127
#define BLE_DESK_TOKEN_MAX 127

enum {
    BLE_DESK_OP_STATUS = 1,
    BLE_DESK_OP_URL = 2,
    BLE_DESK_OP_TOKEN = 3,
    BLE_DESK_OP_WIFI = 4,
    BLE_DESK_OP_REBOOT = 5
};

/* NUL-terminated body. Returns the length without the NUL, or -1 if it
 * does not fit. ssid or url empty is written as "none". token_set is
 * "set" or "none". The bearer itself is not an argument. */
int ble_desk_format_status(char *out, size_t cap, const char *fw, const char *ssid, const char *url,
                           int token_set);

/* Pointer plus length. One trailing CR/LF run is ignored. Embedded CR,
 * LF, or NUL is rejected. 0 copies into out. -1 leaves out alone. */
int ble_desk_parse_url(const uint8_t *in, size_t len, char *out, size_t cap);
int ble_desk_parse_token(const uint8_t *in, size_t len, char *out, size_t cap);
int ble_desk_parse_wifi(const uint8_t *in, size_t len, char *ssid, size_t ssid_cap, char *pass,
                        size_t pass_cap);
int ble_desk_parse_reboot(const uint8_t *in, size_t len);

int ble_desk_set_url(wifi_store_t *store, const char *url);
int ble_desk_set_token(wifi_store_t *store, const char *token);
/* Updates the password of an existing SSID and keeps that slot's url
 * and token. A new SSID is appended with an empty per-network url and token. */
int ble_desk_upsert_wifi(wifi_store_t *store, const char *ssid, const char *pass);
