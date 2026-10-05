#include "desk_status.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static void glance(const char *phase, int failures, int ip, int retries, int gave_up, int lamp,
                   const char *text, const char *msg) {
    desk_glance_t got = desk_glance(phase, failures, ip, retries, gave_up);
    check(got.lamp == lamp && got.text && strcmp(got.text, text) == 0, msg);
}

static int stage_after(desk_toast_t *toast, int ms) {
    int opacity = 0;
    int shift = 0;
    return desk_toast_tick(toast, ms, &opacity, &shift);
}

int main(void) {
    desk_toast_t toast;
    int opacity = 0;
    int shift = 0;
    int stage;

    glance("IDLE", 0, 1, 0, 0, DESK_LAMP_GREEN, "IDLE", "idle");
    glance("RUNNING", 0, 1, 0, 0, DESK_LAMP_GREEN, "RUNNING", "running");
    glance("NEEDS YOU", 0, 1, 0, 0, DESK_LAMP_GREEN, "NEEDS YOU", "needs you still reachable");
    glance("IDLE", 0, 0, 0, 0, DESK_LAMP_AMBER, "IDLE", "joining keeps the phase word");
    glance("RUNNING", 0, 0, 3, 0, DESK_LAMP_AMBER, "reconnecting", "reconnecting");
    glance("RUNNING", 1, 1, 0, 0, DESK_LAMP_AMBER, "reconnecting", "one miss");
    glance("RUNNING", 2, 1, 0, 0, DESK_LAMP_AMBER, "reconnecting", "two misses");
    glance("link down", 3, 1, 0, 0, DESK_LAMP_RED, "link down", "link down");
    glance("RUNNING", 3, 1, 0, 0, DESK_LAMP_RED, "link down", "three misses");
    glance("NO NETWORK", 0, 0, 0, 0, DESK_LAMP_RED, "NO NETWORK", "no network");
    glance("SCAN FAILED", 0, 0, 0, 0, DESK_LAMP_RED, "SCAN FAILED", "scan failed");
    glance("RUNNING", 0, 0, 10, 1, DESK_LAMP_RED, "link down", "wifi gave up");
    glance(NULL, 0, 1, 0, 0, DESK_LAMP_GREEN, "IDLE", "null phase with ip");
    glance(NULL, 0, 0, 0, 0, DESK_LAMP_AMBER, "IDLE", "null phase while joining");

    check(desk_wifi_bars(0, -40) == 0, "down has no bars");
    check(desk_wifi_bars(1, -50) == 3, "strong");
    check(desk_wifi_bars(1, -60) == 3, "strong edge");
    check(desk_wifi_bars(1, -61) == 2, "mid");
    check(desk_wifi_bars(1, -75) == 2, "mid edge");
    check(desk_wifi_bars(1, -76) == 1, "weak");

    desk_toast_init(&toast);
    check(desk_toast_push(&toast, "") == 0, "empty push");
    check(desk_toast_push(&toast, "IDLE") == 1, "first push");
    check(strcmp(toast.showing, "IDLE") == 0, "showing idle");
    check(desk_toast_push(&toast, "IDLE") == 0, "same text does not restart");
    check(desk_toast_push(&toast, "RUNNING") == 1, "queue running");
    check(strcmp(toast.showing, "IDLE") == 0, "current stays up");
    check(desk_toast_push(&toast, "link down") == 1, "newest replaces the waiter");
    check(toast.waiting[0] != '\0', "one waiter");
    check(strcmp(toast.waiting, "link down") == 0, "waiter is link down");
    check(strcmp(toast.showing, "IDLE") == 0, "screen not replaced");

    stage = desk_toast_tick(&toast, 0, &opacity, &shift);
    check(stage == DESK_TOAST_IN && opacity == 0 && shift == -12, "slide starts above");
    stage = desk_toast_tick(&toast, DESK_TOAST_IN_MS / 2, &opacity, &shift);
    check(stage == DESK_TOAST_IN && opacity == 127 && shift == -6, "halfway in");
    check(stage_after(&toast, DESK_TOAST_IN_MS) == DESK_TOAST_HOLD, "then hold");
    check(stage_after(&toast, DESK_TOAST_HOLD_MS) == DESK_TOAST_IN, "waiter promotes");
    check(strcmp(toast.showing, "link down") == 0, "now showing link down");
    check(toast.waiting[0] == '\0', "queue empty");
    check(stage_after(&toast, DESK_TOAST_IN_MS) == DESK_TOAST_HOLD, "second hold");
    check(stage_after(&toast, DESK_TOAST_HOLD_MS) == DESK_TOAST_OUT, "then out");
    check(stage_after(&toast, DESK_TOAST_OUT_MS) == DESK_TOAST_HIDDEN, "then gone");
    check(desk_toast_push(&toast, "RUNNING") == 1, "push after dismiss");
    check(desk_toast_push(&toast, "IDLE") == 1, "queue again");
    check(desk_toast_push(&toast, "RUNNING") == 1, "newest matching the screen drops the waiter");
    check(toast.waiting[0] == '\0', "no waiter");
    check(strcmp(toast.showing, "RUNNING") == 0, "still the first one");

    return g_failed;
}
