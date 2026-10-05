#include "orient.h"

#include <stdio.h>
#include <string.h>

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

    check(orient_rotlock_parse(NULL, &i) == 0, "missing lock");
    check(orient_rotlock_parse("", &i) == 0, "empty lock");
    check(orient_rotlock_parse("off", &i) == 0, "off lock");
    check(orient_rotlock_parse("4", &i) == 0, "quarter 4");
    check(orient_rotlock_parse("90", &i) == 0, "degrees are not a quarter");
    check(orient_rotlock_parse("ssid", &i) == 0, "ssid is not the lock");
    check(orient_rotlock_parse("n0ssid", &i) == 0, "slot key is not the lock");
    check(strcmp(ORIENT_ROTLOCK_KEY, "ssid") != 0, "key not ssid");
    check(strcmp(ORIENT_ROTLOCK_KEY, "pass") != 0, "key not pass");
    check(strcmp(ORIENT_ROTLOCK_KEY, "url") != 0, "key not url");
    check(strcmp(ORIENT_ROTLOCK_KEY, "token") != 0, "key not token");
    check(strcmp(ORIENT_ROTLOCK_KEY, "rotlock") == 0, "key name");
    for (i = 0; i < 4; i++) {
        char stored[4];
        int quarter = -1;
        orient_rotlock_format(i, stored, sizeof(stored));
        check(orient_rotlock_parse(stored, &quarter) == 1, "round trip");
        check(quarter == i, "round trip quarter");
    }
    check(orient_frozen(0, 0) == 0, "auto turns");
    check(orient_frozen(1, 0) == 1, "lock holds");
    check(orient_frozen(0, 1) == 1, "settings holds");
    check(orient_frozen(1, 1) == 1, "both hold");

    return g_failed;
}
