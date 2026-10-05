#include "orient.h"

#include <stdio.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

int main(void) {
    orient_debounce_t deb;
    int x;
    int y;
    int i;

    check(orient_from_accel(0, 1000, 0) == 0, "top up");
    check(orient_from_accel(1000, 0, 0) == 1, "right up");
    check(orient_from_accel(0, -1000, 0) == 2, "bottom up");
    check(orient_from_accel(-1000, 0, 0) == 3, "left up");
    check(orient_from_accel(100, 80, 1000) == -1, "flat holds");
    check(orient_from_accel(800, 700, 0) == -1, "diagonal holds");
    check(orient_from_accel(100, 100, 100) == -1, "weak holds");
    check(orient_from_accel(1000, 400, 200) == 1, "clear x");

    orient_debounce_init(&deb);
    check(orient_debounce_feed(&deb, -1) == 0, "flat keeps 0");
    for (i = 0; i < 3; i++) {
        check(orient_debounce_feed(&deb, 2) == 0, "streak holds");
    }
    check(orient_debounce_feed(&deb, 2) == 2, "fourth sample snaps");
    check(orient_debounce_feed(&deb, 1) == 2, "one opposite does not snap");
    check(orient_debounce_feed(&deb, 2) == 2, "return to shown clears streak");

    x = 10;
    y = 20;
    orient_touch_point(0, &x, &y);
    check(x == 10 && y == 20, "touch 0");
    x = 10;
    y = 20;
    orient_touch_point(1, &x, &y);
    check(x == 20 && y == 469, "touch 90");
    x = 10;
    y = 20;
    orient_touch_point(2, &x, &y);
    check(x == 469 && y == 459, "touch 180");
    x = 10;
    y = 20;
    orient_touch_point(3, &x, &y);
    check(x == 459 && y == 10, "touch 270");

    return g_failed;
}
