#pragma once

#include "wifi_store.h"

/* 0 dim rune, 1 advertising, 2 connected. Matches ui_set_bt. */
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
/* Starts the host task. Advertising begins on sync unless Control Center
 * held it off (NVS "btoff"). */
void ble_link_host_start(void);
/* 1 when Control Center wants advertising. Off stops the advertisement
 * and drops a connection. The controller stays up. */
int ble_link_enabled(void);
void ble_link_set_enabled(int on);

typedef void (*ble_link_pair_show_fn)(const char *code_text);
typedef void (*ble_link_pair_hide_fn)(void);
/* The glass shows code_text with Yes and No while a computer pairs, and hides
 * it on an answer or when the link encrypts or drops. */
void ble_link_set_pair_callbacks(ble_link_pair_show_fn show, ble_link_pair_hide_fn hide);
/* The person's answer to the shown code: 1 Yes, 0 No or timed out. */
void ble_link_pair_answer(int yes);

enum {
    BLE_LINK_PAIRED_BEGIN = 0, /* a fresh pairing finished; the computer's name may follow */
    BLE_LINK_PAIRED_NAME = 1,  /* name is the sanitized computer name, maybe empty */
    BLE_LINK_PAIRED_END = 2    /* that link dropped */
};
typedef void (*ble_link_paired_fn)(int event, const char *name);
void ble_link_set_paired_callback(ble_link_paired_fn fn);
/* Clears every stored pairing and drops the current connection. */
void ble_link_forget_pairings(void);

/* Serializes NVS desk writes with the BLE apply path. */
void ble_link_enter(void);
void ble_link_leave(void);
