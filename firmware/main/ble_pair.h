#pragma once

#include <stddef.h>
#include <stdint.h>

/* The numeric comparison code is 6 digits, shown on the glass as "123 456". */
#define BLE_PAIR_TEXT_MAX 8
/* How long the glass waits for Yes before it answers No. */
#define BLE_PAIR_ASK_MS 30000u
/* A Yes this soon after the code shows is ignored: a tap meant for whatever the card covered,
 * or for the card it replaced, must not accept a pairing. No is live at once. */
#define BLE_PAIR_ASK_MIN_MS 800u

int ble_pair_format(uint32_t code, char *out, size_t cap);

/* One numeric comparison waiting for the person at the glass. */
typedef struct {
    int open;
    uint16_t conn;
    uint32_t since_ms;
} ble_pair_ask_t;

void ble_pair_ask_open(ble_pair_ask_t *ask, uint16_t conn, uint32_t now_ms);
/* Closes the ask and returns what to send for *conn: 1 accept, 0 reject,
 * -1 nothing (no ask open, or a yes before BLE_PAIR_ASK_MIN_MS, which leaves
 * the ask open). A yes after BLE_PAIR_ASK_MS is a reject. */
int ble_pair_ask_answer(ble_pair_ask_t *ask, int yes, uint32_t now_ms, uint16_t *conn);
/* Closes the ask when its link drops. */
void ble_pair_ask_drop(ble_pair_ask_t *ask, uint16_t conn);

/* The computer's name, from the app's write to the peer characteristic. */
#define BLE_PAIR_PEER_MAX 32
/* "Paired with " plus the name. */
#define BLE_PAIR_DONE_MAX (12 + BLE_PAIR_PEER_MAX + 1)

/* Printable ASCII for the glass font: control bytes and NUL go, each non-ASCII UTF-8 character
 * becomes one '?', spaces at either end go, at most BLE_PAIR_PEER_MAX characters. Returns the
 * length; out is always terminated (empty for a blank name). */
int ble_pair_peer_name(const uint8_t *in, size_t len, char *out, size_t cap);
/* "Paired with <name>", or "Paired" for an empty or NULL name. Returns the length, 0 if it does
 * not fit. */
int ble_pair_done_text(const char *name, char *out, size_t cap);

/* 1 when an encrypted link's keys may stay: MITM-authenticated (the code was confirmed) with a
 * full 16-byte key. A Just Works pairing is encrypted but not authenticated, and is refused. */
int ble_pair_link_trusted(int encrypted, int authenticated, int key_size);

/* NimBLE's BLE_STORE_EVENT_OVERFLOW and BLE_STORE_EVENT_FULL (ble_link.c checks they match). */
#define BLE_PAIR_STORE_OVERFLOW 1
#define BLE_PAIR_STORE_FULL 2
/* 1 when the bond store should refuse. bond: the record is a bond (our or peer keys, peer
 * address). FULL comes at the pairing request, so refusing it stops a new computer before a
 * code or a Paired card; a computer that already has a bond may re-pair, as its bond is
 * replaced. A bond write that overflows is refused rather than evicting the owner's bond. */
int ble_pair_store_refuse(int event_code, int bond, int peer_bonded);
