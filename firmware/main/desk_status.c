#include "desk_status.h"

#include <string.h>

static int same_text(const char *a, const char *b) {
    if (!a || !b) {
        return 0;
    }
    return strcmp(a, b) == 0;
}

desk_glance_t desk_glance(const char *phase, int failures, int wifi_has_ip, int wifi_retries,
                          int wifi_gave_up) {
    desk_glance_t out;
    out.lamp = DESK_LAMP_GREEN;
    out.text = (phase && phase[0]) ? phase : "IDLE";
    if (same_text(phase, "NO NETWORK") || same_text(phase, "SCAN FAILED")) {
        out.lamp = DESK_LAMP_RED;
        out.text = phase;
        return out;
    }
    if (failures >= 3 || same_text(phase, "link down")) {
        out.lamp = DESK_LAMP_RED;
        out.text = "link down";
        return out;
    }
    /* Give-up stays set when the lease is kept: GOT_IP does not fire again. */
    if (wifi_has_ip && failures == 0) {
        return out;
    }
    if (wifi_gave_up && !wifi_has_ip) {
        out.lamp = DESK_LAMP_RED;
        out.text = "link down";
        return out;
    }
    if ((!wifi_has_ip && wifi_retries > 0) || failures > 0) {
        out.lamp = DESK_LAMP_AMBER;
        out.text = "reconnecting";
        return out;
    }
    if (!wifi_has_ip) {
        out.lamp = DESK_LAMP_AMBER;
    }
    return out;
}

int desk_wifi_bars(int wifi_has_ip, int rssi) {
    if (!wifi_has_ip) {
        return 0;
    }
    if (rssi >= -60) {
        return 3;
    }
    if (rssi >= -75) {
        return 2;
    }
    return 1;
}

const char *desk_footer_status(const desk_glance_t *glance) {
    if (!glance || !glance->text) {
        return NULL;
    }
    if (glance->lamp == DESK_LAMP_RED) {
        return glance->text;
    }
    if (glance->lamp == DESK_LAMP_AMBER && same_text(glance->text, "reconnecting")) {
        return glance->text;
    }
    return NULL;
}
