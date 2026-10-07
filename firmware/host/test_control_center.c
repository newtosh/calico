#include "control_center.h"

#include <stdio.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static int feed(desk_cc_t *cc, int pressed, int grab, int on_panel, int outside, int dy, int dt,
                int reveal) {
    return desk_cc_pointer(cc, pressed, grab, on_panel, outside, dy, dt, reveal);
}

int main(void) {
    desk_cc_t cc;
    int decision;

    check(CC_GRAB == 48, "grab height");
    check(CC_OPEN_Y + CC_PANEL_H < CC_DOCK_TOP, "room to tap outside");
    check(CC_TILE_W > 80, "tile is a finger target");

    desk_cc_init(&cc);
    decision = feed(&cc, 1, 0, 0, 0, 0, 0, 0);
    check(decision == DESK_CC_NONE && !cc.open, "a press below the strip does nothing");
    decision = feed(&cc, 0, 0, 0, 0, 40, 100, 0);
    check(decision == DESK_CC_NONE && !cc.open, "release below the strip stays closed");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 1, 1, 0, 0, 30, 0, 0);
    check(desk_cc_reveal(&cc) == 30, "the sheet follows the finger");
    feed(&cc, 1, 1, 0, 0, CC_PANEL_H + 40, 0, 0);
    check(desk_cc_reveal(&cc) == CC_PANEL_H, "the sheet stops fully open");
    decision = feed(&cc, 0, 1, 0, 0, 80, 500, 0);
    check(decision == DESK_CC_OPEN && cc.open, "a long pull opens");
    check(desk_cc_reveal(&cc) == CC_PANEL_H, "open reveal is the sheet");
    check(desk_cc_ate_click(&cc) == 1, "the pull is not a click");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    decision = feed(&cc, 0, 1, 0, 0, 20, 800, 0);
    check(decision == DESK_CC_CLOSE && !cc.open, "a short pull snaps shut");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    decision = feed(&cc, 0, 1, 0, 0, 4, 100, 0);
    check(decision == DESK_CC_NONE && !cc.open, "a tap on the strip stays closed");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 1, 1, 0, 0, -20, 0, 0);
    check(desk_cc_reveal(&cc) == 0, "an upward pull on the strip does not reveal");
    decision = feed(&cc, 0, 1, 0, 0, -20, 100, 0);
    check(decision == DESK_CC_NONE && !cc.open, "an upward pull does not open");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    decision = feed(&cc, 0, 1, 0, 0, CC_FLICK_DY, CC_FLICK_MS, 0);
    check(decision == DESK_CC_OPEN && cc.open, "a fast flick opens");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    decision = feed(&cc, 0, 1, 0, 0, CC_FLICK_DY, CC_FLICK_MS + 1, 0);
    check(decision == DESK_CC_CLOSE && !cc.open, "a slow short pull does not flick open");

    /* Settings cover the strip: the caller passes grab as 0. */
    desk_cc_init(&cc);
    decision = feed(&cc, 1, 0, 0, 0, 0, 0, 0);
    decision = feed(&cc, 0, 0, 0, 0, 90, 100, 0);
    check(decision == DESK_CC_NONE && !cc.open, "settings block the swipe");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 0, 1, 0, 0, 80, 200, 0);
    feed(&cc, 1, 0, 1, 0, 0, 0, CC_PANEL_H);
    decision = feed(&cc, 0, 0, 1, 0, 3, 120, CC_PANEL_H);
    check(decision == DESK_CC_NONE && cc.open, "a tap on a tile stays open");
    check(desk_cc_ate_click(&cc) == 0, "a tap still clicks");

    feed(&cc, 1, 0, 1, 0, 0, 0, CC_PANEL_H);
    feed(&cc, 1, 0, 1, 0, -40, 0, CC_PANEL_H);
    check(desk_cc_reveal(&cc) == CC_PANEL_H - 40, "swipe up follows the finger");
    decision = feed(&cc, 0, 0, 1, 0, -40, 500, CC_PANEL_H);
    check(decision == DESK_CC_OPEN && cc.open, "a short swipe up snaps back");
    check(desk_cc_ate_click(&cc) == 1, "that swipe is not a tile click");

    feed(&cc, 1, 0, 1, 0, 0, 0, CC_PANEL_H);
    check(desk_cc_ate_click(&cc) == 0, "the next press clears the eaten click");
    decision = feed(&cc, 0, 0, 1, 0, -CC_OPEN_DY, 800, CC_PANEL_H);
    check(decision == DESK_CC_CLOSE && !cc.open, "a long swipe up closes");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 0, 1, 0, 0, 80, 200, 0);
    feed(&cc, 1, 0, 1, 0, 0, 0, CC_PANEL_H);
    decision = feed(&cc, 0, 0, 1, 0, -CC_FLICK_DY, 200, CC_PANEL_H);
    check(decision == DESK_CC_CLOSE && !cc.open, "a fast swipe up closes");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 0, 1, 0, 0, 80, 200, 0);
    feed(&cc, 1, 0, 0, 1, 0, 0, CC_PANEL_H);
    decision = feed(&cc, 0, 0, 0, 1, 2, 80, CC_PANEL_H);
    check(decision == DESK_CC_CLOSE && !cc.open, "a tap outside closes");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 0, 1, 0, 0, 80, 200, 0);
    feed(&cc, 1, 0, 1, 0, 0, 0, CC_PANEL_H);
    feed(&cc, 0, 0, 1, 0, -CC_OPEN_DY, 800, CC_PANEL_H);
    feed(&cc, 1, 1, 0, 0, 0, 0, 90);
    check(desk_cc_reveal(&cc) == 90, "a grab during close keeps the current reveal");
    decision = feed(&cc, 0, 1, 0, 0, 20, 400, 90);
    check(decision == DESK_CC_CLOSE && !cc.open, "a short re-grab still snaps shut");

    desk_cc_init(&cc);
    feed(&cc, 1, 1, 0, 0, 0, 0, 0);
    feed(&cc, 0, 1, 0, 0, 80, 200, 0);
    feed(&cc, 1, 0, 0, 1, 0, 0, 100);
    check(desk_cc_reveal(&cc) == 100, "a press mid-animation keeps the current reveal");
    decision = feed(&cc, 0, 0, 0, 1, -CC_OPEN_DY, 200, 100);
    check(decision == DESK_CC_CLOSE && !cc.open, "a swipe up during the animation closes");

    desk_cc_init(NULL);
    check(desk_cc_pointer(NULL, 1, 1, 0, 0, 80, 0, 0) == DESK_CC_NONE, "null gesture");
    check(desk_cc_reveal(NULL) == 0, "null reveal");
    check(desk_cc_ate_click(NULL) == 0, "null click");

    if (g_failed) {
        return 1;
    }
    return 0;
}
