#include "ble_pair.h"

#include <stdio.h>

int ble_pair_format(uint32_t code, char *out, size_t cap) {
    int n;
    if (!out || cap == 0) {
        return 0;
    }
    out[0] = '\0';
    if (cap < BLE_PAIR_TEXT_MAX) {
        return 0;
    }
    n = snprintf(out, cap, "%03u %03u", (unsigned)(code / 1000u), (unsigned)(code % 1000u));
    if (n != 7) {
        out[0] = '\0';
        return 0;
    }
    return n;
}

void ble_pair_ask_open(ble_pair_ask_t *ask, uint16_t conn, uint32_t now_ms) {
    ask->open = 1;
    ask->conn = conn;
    ask->since_ms = now_ms;
}

int ble_pair_ask_answer(ble_pair_ask_t *ask, int yes, uint32_t now_ms, uint16_t *conn) {
    uint32_t age = now_ms - ask->since_ms; /* unsigned: a wrapped clock stays correct */
    if (!ask->open || (yes && age < BLE_PAIR_ASK_MIN_MS)) {
        return -1;
    }
    ask->open = 0;
    *conn = ask->conn;
    if (age >= BLE_PAIR_ASK_MS) {
        return 0;
    }
    return yes ? 1 : 0;
}

void ble_pair_ask_drop(ble_pair_ask_t *ask, uint16_t conn) {
    if (ask->open && ask->conn == conn) {
        ask->open = 0;
    }
}

int ble_pair_peer_name(const uint8_t *in, size_t len, char *out, size_t cap) {
    size_t n = 0;
    size_t max;
    size_t i;
    if (!out || cap == 0) {
        return 0;
    }
    max = cap - 1 < BLE_PAIR_PEER_MAX ? cap - 1 : BLE_PAIR_PEER_MAX;
    for (i = 0; in && i < len && n < max; i++) {
        uint8_t c = in[i];
        if (c >= 0x80 && c < 0xc0) {
            continue; /* UTF-8 continuation byte */
        }
        if (c >= 0xc0) {
            c = '?';
        } else if (c < 0x20 || c == 0x7f || (c == ' ' && n == 0)) {
            continue;
        }
        out[n++] = (char)c;
    }
    while (n > 0 && out[n - 1] == ' ') {
        n--;
    }
    out[n] = '\0';
    return (int)n;
}

int ble_pair_done_text(const char *name, char *out, size_t cap) {
    int n;
    if (!out || cap == 0) {
        return 0;
    }
    n = (name && name[0]) ? snprintf(out, cap, "Paired with %s", name) : snprintf(out, cap, "Paired");
    if (n < 0 || (size_t)n >= cap) {
        out[0] = '\0';
        return 0;
    }
    return n;
}

int ble_pair_link_trusted(int encrypted, int authenticated, int key_size) {
    return encrypted && authenticated && key_size == 16;
}

int ble_pair_store_refuse(int event_code, int bond, int peer_bonded) {
    if (!bond) {
        return 0;
    }
    if (event_code == BLE_PAIR_STORE_OVERFLOW) {
        return 1;
    }
    return event_code == BLE_PAIR_STORE_FULL && !peer_bonded;
}
