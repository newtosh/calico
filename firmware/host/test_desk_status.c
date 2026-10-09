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

static void footer(const char *phase, int failures, int ip, int retries, int gave_up,
                   const char *want, const char *msg) {
    desk_glance_t got = desk_glance(phase, failures, ip, retries, gave_up);
    const char *text = desk_footer_status(&got);
    check(want ? (text && strcmp(text, want) == 0) : text == NULL, msg);
}

int main(void) {
    glance("IDLE", 0, 1, 0, 0, DESK_LAMP_GREEN, "IDLE", "idle");
    glance("RUNNING", 0, 1, 0, 0, DESK_LAMP_GREEN, "RUNNING", "running");
    glance("NEEDS YOU", 0, 1, 0, 0, DESK_LAMP_GREEN, "NEEDS YOU", "needs you still reachable");
    glance("IDLE", 0, 1, 0, 1, DESK_LAMP_GREEN, "IDLE", "stale give-up with a live idle poll");
    glance("RUNNING", 0, 1, 4, 1, DESK_LAMP_GREEN, "RUNNING", "stale retries with a live poll");
    glance("NEEDS YOU", 0, 1, 10, 1, DESK_LAMP_GREEN, "NEEDS YOU", "needs you beats the latch");
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

    /* The footer says what is wrong. A healthy desk keeps its count, and NEEDS YOU is carried
     * by the banner, so it never replaces the count. */
    footer("IDLE", 0, 1, 0, 0, NULL, "idle leaves the count");
    footer("RUNNING", 0, 1, 0, 0, NULL, "running leaves the count");
    footer("NEEDS YOU", 0, 1, 0, 0, NULL, "needs you leaves the count");
    footer("IDLE", 0, 0, 0, 0, NULL, "joining Wi-Fi leaves the count");
    footer(NULL, 0, 0, 0, 0, NULL, "no phase while joining leaves the count");
    footer("RUNNING", 1, 1, 0, 0, "reconnecting", "one miss");
    footer("RUNNING", 0, 0, 3, 0, "reconnecting", "Wi-Fi retrying");
    footer("RUNNING", 3, 1, 0, 0, "link down", "three misses");
    footer("RUNNING", 0, 0, 10, 1, "link down", "Wi-Fi gave up");
    footer("NO NETWORK", 0, 0, 0, 0, "NO NETWORK", "no network");
    footer("SCAN FAILED", 0, 0, 0, 0, "SCAN FAILED", "scan failed");

    check(desk_wifi_bars(0, -40) == 0, "down has no bars");
    check(desk_wifi_bars(1, -50) == 3, "strong");
    check(desk_wifi_bars(1, -60) == 3, "strong edge");
    check(desk_wifi_bars(1, -61) == 2, "mid");
    check(desk_wifi_bars(1, -75) == 2, "mid edge");
    check(desk_wifi_bars(1, -76) == 1, "weak");

    return g_failed;
}
