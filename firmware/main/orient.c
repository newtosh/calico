#include "orient.h"

#include <stdlib.h>

/* QMI8658 at rest: the axis pointing up reads positive (right-handed chip frame).
 * +Y is treated as the top edge of the picture the panel boots with.
 * The schematic does not mark that arrow on the glass. Flat, weak, or
 * near-diagonal samples return -1 so the caller keeps the last quarter. */

int orient_from_accel(int ax_mg, int ay_mg, int az_mg) {
    int ax = abs(ax_mg);
    int ay = abs(ay_mg);
    int az = abs(az_mg);
    if (az >= ax && az >= ay) {
        return -1;
    }
    if (ax > ay) {
        if (ax < 500 || ax * 4 < ay * 5) {
            return -1;
        }
        return ax_mg > 0 ? 1 : 3;
    }
    if (ay < 500 || ay * 4 < ax * 5) {
        return -1;
    }
    return ay_mg > 0 ? 0 : 2;
}

void orient_debounce_init(orient_debounce_t *state) {
    state->shown = 0;
    state->pending = -1;
    state->streak = 0;
}

int orient_debounce_feed(orient_debounce_t *state, int sample) {
    if (sample < 0 || sample > 3 || sample == state->shown) {
        state->pending = -1;
        state->streak = 0;
        return state->shown;
    }
    if (sample != state->pending) {
        state->pending = sample;
        state->streak = 1;
        return state->shown;
    }
    state->streak++;
    if (state->streak >= 4) {
        state->shown = sample;
        state->pending = -1;
        state->streak = 0;
    }
    return state->shown;
}

void orient_touch_point(int quarter, int *x, int *y) {
    int last = 479;
    int nx = *x;
    int ny = *y;
    if (quarter == 1) {
        nx = *y;
        ny = last - *x;
    } else if (quarter == 2) {
        nx = last - *x;
        ny = last - *y;
    } else if (quarter == 3) {
        nx = last - *y;
        ny = *x;
    }
    *x = nx;
    *y = ny;
}
