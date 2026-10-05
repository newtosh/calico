#pragma once

/* Quarter turns clockwise from the boot picture. -1 means hold the current one. */

int orient_from_accel(int ax_mg, int ay_mg, int az_mg);

typedef struct {
    int shown;
    int pending;
    int streak;
} orient_debounce_t;

void orient_debounce_init(orient_debounce_t *state);
int orient_debounce_feed(orient_debounce_t *state, int sample);

/* Inverse of a clockwise quarter turn on the 480 panel. */
void orient_touch_point(int quarter, int *x, int *y);
