#pragma once

#include <stddef.h>

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

/* NVS namespace "desk", key "rotlock". Value "0".."3" is locked at that
 * quarter. Missing or anything else is auto-rotate. */
#define ORIENT_ROTLOCK_KEY "rotlock"

int orient_rotlock_parse(const char *stored, int *quarter);
void orient_rotlock_format(int quarter, char *out, size_t out_len);
int orient_frozen(int locked, int settings_open);
