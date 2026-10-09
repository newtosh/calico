#include "idle_cat_anim.h"

/* One gesture is three poses: out, farthest, back. The ear flicks quickly. The tail
 * lifts slowly and holds. */
static const uint8_t k_frames[3] = {1, 2, 1};
static const uint16_t k_ear_ms[3] = {120, 150, 120};
static const uint16_t k_tail_ms[3] = {450, 700, 450};

void idle_cat_init(idle_cat_t *s) {
    s->tail_next = 0;
    s->step = 0;
}

idle_cat_pose_t idle_cat_next(idle_cat_t *s, uint32_t rnd) {
    idle_cat_pose_t p = {0, 0, 0};
    if (s->step == 0) {
        p.wait_ms = (uint16_t)(IDLE_CAT_REST_MIN_MS + rnd % IDLE_CAT_REST_SPAN_MS);
        s->step = 1;
        return p;
    }
    if (s->tail_next) {
        p.tail = k_frames[s->step - 1];
        p.wait_ms = k_tail_ms[s->step - 1];
    } else {
        p.ear = k_frames[s->step - 1];
        p.wait_ms = k_ear_ms[s->step - 1];
    }
    if (s->step == 3) {
        s->step = 0;
        s->tail_next = !s->tail_next;
    } else {
        s->step++;
    }
    return p;
}
