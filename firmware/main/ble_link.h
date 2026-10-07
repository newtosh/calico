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

/* Brings up the controller and the GATT table. Does not advertise yet:
 * the host task is an internal DMA stack, and Wi-Fi init has to run
 * while the post-controller block is still intact. */
void ble_link_start(wifi_store_t *store, ble_link_state_fn on_state, ble_link_restart_fn on_restart);
/* Starts the host task. Advertising begins on sync. */
void ble_link_host_start(void);

/* Serializes NVS desk writes with the BLE apply path. */
void ble_link_enter(void);
void ble_link_leave(void);
