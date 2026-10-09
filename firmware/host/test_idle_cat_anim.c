#include "idle_cat_anim.h"

#include <stdint.h>
#include <stdio.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static void expect(idle_cat_t *s, uint32_t rnd, int ear, int tail, const char *what) {
    idle_cat_pose_t p = idle_cat_next(s, rnd);
    char msg[96];
    snprintf(msg, sizeof msg, "%s: ear %d tail %d", what, p.ear, p.tail);
    check(p.ear == ear && p.tail == tail, msg);
}

int main(void) {
    idle_cat_t s;
    idle_cat_pose_t p;
    uint32_t rnd;
    int i;

    /* It starts at rest, and the rest wait is random inside its range. */
    idle_cat_init(&s);
    p = idle_cat_next(&s, 0);
    check(p.ear == 0 && p.tail == 0, "starts at rest");
    check(p.wait_ms == IDLE_CAT_REST_MIN_MS, "lowest roll waits the minimum");
    idle_cat_init(&s);
    p = idle_cat_next(&s, 0xffffffffu);
    check(p.wait_ms >= IDLE_CAT_REST_MIN_MS && p.wait_ms < IDLE_CAT_REST_MIN_MS + IDLE_CAT_REST_SPAN_MS,
          "highest roll stays inside the range");

    /* The ear flicks, then rest, then the tail lifts, then rest, then the ear again. */
    idle_cat_init(&s);
    expect(&s, 0, 0, 0, "rest 1");
    p = idle_cat_next(&s, 0);
    check(p.ear == 1 && p.tail == 0 && p.wait_ms == 120, "ear turns left, briefly");
    p = idle_cat_next(&s, 0);
    check(p.ear == 2 && p.tail == 0 && p.wait_ms == 150, "ear turns right");
    p = idle_cat_next(&s, 0);
    check(p.ear == 1 && p.tail == 0 && p.wait_ms == 120, "ear comes back through the first pose");
    expect(&s, 0, 0, 0, "rest 2");
    p = idle_cat_next(&s, 0);
    check(p.ear == 0 && p.tail == 1 && p.wait_ms == 450, "tail starts to lift");
    p = idle_cat_next(&s, 0);
    check(p.ear == 0 && p.tail == 2 && p.wait_ms == 700, "tail holds at the top");
    p = idle_cat_next(&s, 0);
    check(p.ear == 0 && p.tail == 1 && p.wait_ms == 450, "tail comes back down");
    expect(&s, 0, 0, 0, "rest 3");
    p = idle_cat_next(&s, 0);
    check(p.ear == 1 && p.tail == 0, "the ear is next again");

    /* Whatever the dice say, only one part moves at a time and a pose is always valid. */
    idle_cat_init(&s);
    for (i = 0, rnd = 12345; i < 200; i++, rnd = rnd * 1664525u + 1013904223u) {
        p = idle_cat_next(&s, rnd);
        check(!(p.ear && p.tail), "never moves both parts at once");
        check(p.ear < IDLE_CAT_POSES && p.tail < IDLE_CAT_POSES, "pose is in range");
        check(p.wait_ms >= 100, "no pose is shorter than 100 ms");
    }

    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
