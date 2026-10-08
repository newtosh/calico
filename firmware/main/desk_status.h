#pragma once

#include <stddef.h>

/* Traffic lamp and toast text. Inputs are the phase label already on the
 * face, the poll-failure count, and the Wi-Fi facts net.c already tracks.
 * First match wins:
 *   NO NETWORK / SCAN FAILED                         red, that label
 *   failures >= 3, or label "link down"              red, "link down"
 *   IP up and zero misses                            green, that label
 *   Wi-Fi gave up and there is no IP                 red, "link down"
 *   STA retries in progress, or failures 1-2         amber, "reconnecting"
 *   no IP yet                                        amber, phase label kept
 * A STA give-up or a leftover retry count does not override a poll that
 * just succeeded while the station still has an address. NEEDS YOU is
 * green: the companion answered.
 */

enum {
    DESK_LAMP_GREEN = 0,
    DESK_LAMP_AMBER = 1,
    DESK_LAMP_RED = 2
};

enum {
    DESK_TOAST_HIDDEN = 0,
    DESK_TOAST_IN,
    DESK_TOAST_HOLD,
    DESK_TOAST_OUT
};

#define DESK_TOAST_TEXT 24
#define DESK_TOAST_IN_MS 180
#define DESK_TOAST_HOLD_MS 2800
#define DESK_TOAST_OUT_MS 220

typedef struct {
    int lamp;
    const char *text;
} desk_glance_t;

typedef struct {
    char showing[DESK_TOAST_TEXT];
    char waiting[DESK_TOAST_TEXT];
    int stage;
    int elapsed_ms;
} desk_toast_t;

desk_glance_t desk_glance(const char *phase, int failures, int wifi_has_ip, int wifi_retries,
                          int wifi_gave_up);
/* 0 disconnected, else 1..3 bars. -60 dBm and up is 3, -75 dBm and up is 2. */
int desk_wifi_bars(int wifi_has_ip, int rssi);

void desk_toast_init(desk_toast_t *toast);
/* One on screen, one waiting. A third push replaces the waiting text. */
int desk_toast_push(desk_toast_t *toast, const char *text);
int desk_toast_tick(desk_toast_t *toast, int dt_ms, int *opacity, int *shift_px);
