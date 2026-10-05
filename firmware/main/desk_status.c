#include "desk_status.h"

#include <string.h>

static void copy_text(char *dest, size_t dest_len, const char *src) {
    size_t i;
    if (dest_len == 0) {
        return;
    }
    if (!src) {
        dest[0] = '\0';
        return;
    }
    for (i = 0; i + 1 < dest_len && src[i]; i++) {
        dest[i] = src[i];
    }
    dest[i] = '\0';
}

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
    if (failures >= 3 || same_text(phase, "link down") || wifi_gave_up) {
        out.lamp = DESK_LAMP_RED;
        out.text = "link down";
        return out;
    }
    if ((!wifi_has_ip && wifi_retries > 0) || failures > 0) {
        out.lamp = DESK_LAMP_AMBER;
        out.text = "reconnecting";
        return out;
    }
    if (!wifi_has_ip || wifi_retries > 0) {
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

void desk_toast_init(desk_toast_t *toast) {
    memset(toast, 0, sizeof(*toast));
}

int desk_toast_push(desk_toast_t *toast, const char *text) {
    if (!text || !text[0]) {
        return 0;
    }
    if (toast->stage == DESK_TOAST_HIDDEN) {
        copy_text(toast->showing, sizeof(toast->showing), text);
        toast->waiting[0] = '\0';
        toast->stage = DESK_TOAST_IN;
        toast->elapsed_ms = 0;
        return 1;
    }
    if (same_text(toast->showing, text)) {
        if (!toast->waiting[0]) {
            return 0;
        }
        toast->waiting[0] = '\0';
        return 1;
    }
    if (toast->waiting[0] && same_text(toast->waiting, text)) {
        return 0;
    }
    copy_text(toast->waiting, sizeof(toast->waiting), text);
    return 1;
}

int desk_toast_tick(desk_toast_t *toast, int dt_ms, int *opacity, int *shift_px) {
    int opa = 0;
    int shift = 0;
    int elapsed;
    if (dt_ms < 0) {
        dt_ms = 0;
    }
    if (toast->stage == DESK_TOAST_HIDDEN) {
        toast->elapsed_ms = 0;
    } else {
        toast->elapsed_ms += dt_ms;
        if (toast->stage == DESK_TOAST_IN && toast->elapsed_ms >= DESK_TOAST_IN_MS) {
            toast->stage = DESK_TOAST_HOLD;
            toast->elapsed_ms = 0;
        } else if (toast->stage == DESK_TOAST_HOLD && toast->elapsed_ms >= DESK_TOAST_HOLD_MS) {
            if (toast->waiting[0]) {
                copy_text(toast->showing, sizeof(toast->showing), toast->waiting);
                toast->waiting[0] = '\0';
                toast->stage = DESK_TOAST_IN;
                toast->elapsed_ms = 0;
            } else {
                toast->stage = DESK_TOAST_OUT;
                toast->elapsed_ms = 0;
            }
        } else if (toast->stage == DESK_TOAST_OUT && toast->elapsed_ms >= DESK_TOAST_OUT_MS) {
            toast->stage = DESK_TOAST_HIDDEN;
            toast->elapsed_ms = 0;
            toast->showing[0] = '\0';
        }
    }
    elapsed = toast->elapsed_ms;
    if (toast->stage == DESK_TOAST_IN) {
        opa = elapsed * 255 / DESK_TOAST_IN_MS;
        shift = -12 + (12 * elapsed / DESK_TOAST_IN_MS);
    } else if (toast->stage == DESK_TOAST_HOLD) {
        opa = 255;
    } else if (toast->stage == DESK_TOAST_OUT) {
        opa = 255 - (elapsed * 255 / DESK_TOAST_OUT_MS);
        shift = -(8 * elapsed / DESK_TOAST_OUT_MS);
    }
    if (opacity) {
        *opacity = opa;
    }
    if (shift_px) {
        *shift_px = shift;
    }
    return toast->stage;
}
