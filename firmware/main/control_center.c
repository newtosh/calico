#include "control_center.h"

void desk_cc_init(desk_cc_t *cc) {
    if (!cc) {
        return;
    }
    cc->open = 0;
    cc->down = 0;
    cc->tracking = 0;
    cc->moved = 0;
    cc->ate = 0;
    cc->from_grab = 0;
    cc->on_panel = 0;
    cc->outside = 0;
    cc->base = 0;
    cc->dy = 0;
}

static int clamp_reveal(int reveal) {
    if (reveal < 0) {
        return 0;
    }
    if (reveal > CC_PANEL_H) {
        return CC_PANEL_H;
    }
    return reveal;
}

int desk_cc_reveal(const desk_cc_t *cc) {
    int reveal;
    if (!cc) {
        return 0;
    }
    if (cc->down) {
        reveal = cc->base + cc->dy;
        /* The grab follows a downward pull. An open sheet follows an upward one. */
        if (cc->from_grab && cc->dy < 0) {
            reveal = cc->base;
        }
        if ((cc->on_panel || cc->outside) && cc->dy > 0) {
            reveal = cc->base;
        }
    } else {
        reveal = cc->open ? CC_PANEL_H : 0;
    }
    return clamp_reveal(reveal);
}

static int flick(int dist, int dt_ms) {
    return dist >= CC_FLICK_DY && dt_ms > 0 && dt_ms <= CC_FLICK_MS;
}

int desk_cc_pointer(desk_cc_t *cc, int pressed, int grab, int on_panel, int outside, int dy,
                    int dt_ms, int reveal_now) {
    int up;
    if (!cc) {
        return DESK_CC_NONE;
    }
    if (pressed) {
        if (!cc->down) {
            cc->down = 1;
            cc->tracking = 0;
            cc->moved = 0;
            cc->ate = 0;
            cc->dy = 0;
            cc->from_grab = grab && !cc->open;
            cc->on_panel = on_panel && cc->open;
            cc->outside = outside && cc->open;
            if (!cc->from_grab && !cc->on_panel && !cc->outside) {
                cc->down = 0;
                return DESK_CC_NONE;
            }
            /* reveal_now is the pixels on screen, including a snap still
             * running. A new grab continues from there. */
            cc->base = reveal_now;
            return DESK_CC_NONE;
        }
        cc->dy = dy;
        if (dy >= CC_SLOP || dy <= -CC_SLOP) {
            cc->moved = 1;
        }
        if (cc->from_grab && dy >= CC_SLOP) {
            cc->tracking = 1;
        }
        if ((cc->on_panel || cc->outside) && dy <= -CC_SLOP) {
            cc->tracking = 1;
        }
        return DESK_CC_NONE;
    }
    if (!cc->down) {
        return DESK_CC_NONE;
    }
    cc->down = 0;
    cc->tracking = 0;
    if (cc->moved) {
        cc->ate = 1;
    }
    if (cc->from_grab) {
        if (dy >= CC_OPEN_DY || flick(dy, dt_ms)) {
            cc->open = 1;
            return DESK_CC_OPEN;
        }
        cc->open = 0;
        if (dy >= CC_SLOP) {
            return DESK_CC_CLOSE;
        }
        return DESK_CC_NONE;
    }
    if (cc->on_panel || cc->outside) {
        up = -dy;
        if (up >= CC_OPEN_DY || flick(up, dt_ms)) {
            cc->open = 0;
            return DESK_CC_CLOSE;
        }
        if (cc->outside) {
            cc->open = 0;
            cc->ate = 1;
            return DESK_CC_CLOSE;
        }
        if (cc->moved) {
            return DESK_CC_OPEN;
        }
        return DESK_CC_NONE;
    }
    return DESK_CC_NONE;
}

int desk_cc_ate_click(const desk_cc_t *cc) {
    return cc && cc->ate;
}
