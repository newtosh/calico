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
 *   scan    ...16  read, write
 *   verify  ...17  read, write
 * The node bytes 67726f6b6465 are "grokde".
 *
 * Scan write is the four bytes "scan". The read is one record per line:
 * "state=idle|busy|ready|fail", then "rssi<TAB>ssid" while ready. An SSID
 * that contains a tab or a newline is left out, because the central writes
 * that text back as the network name. At most BLE_DESK_SCAN_MAX rows.
 *
 * Verify write is the same body as wifi. The desk associates in RAM and
 * does not touch NVS. The read is "state=idle|busy|ok|fail", then ssid,
 * and on failure "reason=auth|missing|timeout|radio|other".
 */

#define BLE_DESK_NAME "ginger"

#define BLE_DESK_UUID_SVC "8d7c4b10-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_STATUS "8d7c4b11-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_URL "8d7c4b12-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_TOKEN "8d7c4b13-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_WIFI "8d7c4b14-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_REBOOT "8d7c4b15-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_SCAN "8d7c4b16-6e2a-4f91-a3c5-67726f6b6465"
#define BLE_DESK_UUID_VERIFY "8d7c4b17-6e2a-4f91-a3c5-67726f6b6465"

/* Field sizes match wifi_store_t and the USB provisioner. */
#define BLE_DESK_SSID_MAX 32
#define BLE_DESK_PASS_MAX 64
#define BLE_DESK_URL_MAX 127
#define BLE_DESK_TOKEN_MAX 127
/* Same cap as net_wifi_scan. 16 rows of "-128\t" + 32-byte SSID fit in the text buffer. */
#define BLE_DESK_SCAN_MAX 16
#define BLE_DESK_SCAN_TEXT (12 + BLE_DESK_SCAN_MAX * (4 + 1 + BLE_DESK_SSID_MAX + 1) + 1)

enum {
    BLE_DESK_OP_STATUS = 1,
    BLE_DESK_OP_URL = 2,
    BLE_DESK_OP_TOKEN = 3,
    BLE_DESK_OP_WIFI = 4,
    BLE_DESK_OP_REBOOT = 5,
    BLE_DESK_OP_SCAN = 6,
    BLE_DESK_OP_VERIFY = 7
};

enum {
    BLE_DESK_PROBE_IDLE = 0,
    BLE_DESK_PROBE_BUSY = 1,
    BLE_DESK_PROBE_OK = 2,
    BLE_DESK_PROBE_FAIL = 3
};

enum {
    BLE_DESK_SCAN_IDLE = 0,
    BLE_DESK_SCAN_BUSY = 1,
    BLE_DESK_SCAN_READY = 2,
    BLE_DESK_SCAN_FAIL = 3
};

typedef struct {
    char ssid[BLE_DESK_SSID_MAX + 1];
    int8_t rssi;
} ble_desk_ap_t;

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
/* 0 when the write is "scan". One trailing CR/LF run is ignored. */
int ble_desk_parse_scan(const uint8_t *in, size_t len);

/* NUL-terminated body. Returns the length without the NUL, or -1 if it
 * does not fit (out is then empty). Rows are kept in the order given.
 * state other than ready writes only the state line. */
int ble_desk_format_scan(char *out, size_t cap, int state, const ble_desk_ap_t *aps, int count);

/* NUL-terminated. idle is only the state line. busy and ok are state and
 * ssid. fail adds reason. -1 clears out. */
int ble_desk_format_probe(char *out, size_t cap, int state, const char *ssid, const char *reason);
/* Wi-Fi disconnect reason to a verify token. 15, 202, and 204 are auth.
 * 201 is missing. 200 is timeout. Anything else, including 0, is other.
 * "radio" is not a disconnect reason; the link layer uses it when the
 * attempt never starts. */
const char *ble_desk_probe_reason(int wifi_reason);
/* wifi_auth_mode_t: 0 is WIFI_AUTH_OPEN, 3 is WIFI_AUTH_WPA2_PSK.
 * A password must not use the open threshold, or an open AP associates
 * and the password looks right. */
int ble_desk_sta_authmode(int has_password);

int ble_desk_set_url(wifi_store_t *store, const char *url);
int ble_desk_set_token(wifi_store_t *store, const char *token);
/* Updates the password of an existing SSID and keeps that slot's url
 * and token. A new SSID is appended with an empty per-network url and token. */
int ble_desk_upsert_wifi(wifi_store_t *store, const char *ssid, const char *pass);
