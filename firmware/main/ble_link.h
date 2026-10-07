#pragma once

#include "wifi_store.h"

/* 0 struck through, 1 advertising, 2 connected. Matches ui_set_bt. */
enum {
    BLE_LINK_OFF = 0,
    BLE_LINK_ADV = 1,
    BLE_LINK_CONN = 2
};

typedef void (*ble_link_state_fn)(int state);
typedef void (*ble_link_restart_fn)(void);

/* Starts advertising even when no Wi-Fi network is saved. A missing
 * controller logs and returns; the mark stays off. */
void ble_link_start(wifi_store_t *store, ble_link_state_fn on_state, ble_link_restart_fn on_restart);

/* Serializes NVS desk writes with the BLE apply path. */
void ble_link_enter(void);
void ble_link_leave(void);
