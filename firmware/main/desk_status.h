#pragma once

#include <stddef.h>

/* Traffic lamp and status text. Inputs are the phase label already on the
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

typedef struct {
    int lamp;
    const char *text;
} desk_glance_t;

desk_glance_t desk_glance(const char *phase, int failures, int wifi_has_ip, int wifi_retries,
                          int wifi_gave_up);
/* 0 disconnected, else 1..3 bars. -60 dBm and up is 3, -75 dBm and up is 2. */
int desk_wifi_bars(int wifi_has_ip, int rssi);

/* What the footer says in place of its count: the glance text when the link is in trouble
 * (red, or amber "reconnecting"), else NULL, and the footer keeps its count. NEEDS YOU is never
 * returned, since the banner carries it. */
const char *desk_footer_status(const desk_glance_t *glance);
