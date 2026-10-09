#pragma once

#include <stdint.h>

#include "idle_cat_geom.h"

/* How long the cat holds still between gestures. Random in [MIN, MIN + SPAN). */
enum { IDLE_CAT_REST_MIN_MS = 3000, IDLE_CAT_REST_SPAN_MS = 5000 };

typedef struct {
    uint8_t ear;     /* 0 rest, 1 and 2 the two turns */
    uint8_t tail;    /* 0 rest, 1 and 2 the two lifts */
    uint16_t wait_ms; /* how long to show this pose before asking again */
} idle_cat_pose_t;

typedef struct {
    uint8_t tail_next; /* the next gesture is the tail, not the ear */
    uint8_t step;      /* 0 at rest, then 1..3 inside a gesture */
} idle_cat_t;

void idle_cat_init(idle_cat_t *s);

/* Pose to show now and how long to hold it. Call again when the wait is over.
 * rnd is any 32-bit random number; only the rest waits use it. */
idle_cat_pose_t idle_cat_next(idle_cat_t *s, uint32_t rnd);
