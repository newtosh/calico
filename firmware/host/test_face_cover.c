#include "face_cover.h"

#include <stdio.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static int inside_band(const face_rect_t *band, const face_box_t *box) {
    return box->x >= band->x1 && box->y >= band->y1 && box->x + box->w - 1 <= band->x2 &&
           box->y + box->h - 1 <= band->y2;
}

int main(void) {
    face_rect_t band;
    face_box_t cat;
    int width;
    int height;
    face_cover_band(&band);
    width = band.x2 - band.x1 + 1;
    height = band.y2 - band.y1 + 1;
    check(band.x1 == 0 && band.x2 == FACE_SCREEN - 1, "band is the full panel width");
    check(band.y1 == FACE_EDGE + FACE_BAR_H, "band starts under the status bar");
    check(band.y2 == FACE_DOCK_TOP - 1, "band stops above the dock");
    check(FACE_BTN_H == 58, "dock button height is about 10% under 64");
    check(FACE_DOCK_INSET == 8, "buttons sit 8px past the bezel");
    check(FACE_DOCK_GAP == 16, "dock chrome sits above the buttons");
    check(FACE_DOCK_TOP + FACE_DOCK_GAP == 398, "buttons stay clear of the case corner");
    check(FACE_DOCK_TOP == 382, "list stops above that gap");
    check((band.x1 % 2) == 0 && (band.y1 % 2) == 0, "band start is even");
    check((band.x2 % 2) == 1 && (band.y2 % 2) == 1, "band end is odd");
    check((width % 2) == 0 && (height % 2) == 0, "band size is even");
    face_sleep_widget(&cat);
    check(inside_band(&band, &cat), "the cat is inside the band");
    check(cat.w == IDLE_CAT_W && cat.h == IDLE_CAT_H, "the widget is exactly the cat's canvas");
    check((cat.x % 2) == 0 && (cat.y % 2) == 0, "the cat starts on an even pixel");
    check(cat.x + cat.w / 2 == FACE_SCREEN / 2, "the cat is centered across the panel");
    check(cat.y >= FACE_MESSAGE_Y + 28, "the cat clears the message line");
    check(cat.y + cat.h <= FACE_DOCK_TOP, "the cat clears the dock chrome");
    check(IDLE_CAT_W <= FACE_SCREEN - 2 * FACE_EDGE, "the cat clears the bezel");
    check(IDLE_CAT_EAR_X + IDLE_CAT_EAR_W <= IDLE_CAT_W && IDLE_CAT_EAR_Y + IDLE_CAT_EAR_H <= IDLE_CAT_H,
          "the ear patch is inside the cat");
    check(IDLE_CAT_TAIL_X + IDLE_CAT_TAIL_W <= IDLE_CAT_W && IDLE_CAT_TAIL_Y + IDLE_CAT_TAIL_H <= IDLE_CAT_H,
          "the tail patch is inside the cat");
    check(((cat.x + IDLE_CAT_EAR_X) % 2) == 0 && ((cat.y + IDLE_CAT_EAR_Y) % 2) == 0,
          "the ear patch starts on an even panel pixel");
    check(((cat.x + IDLE_CAT_TAIL_X) % 2) == 0 && ((cat.y + IDLE_CAT_TAIL_Y) % 2) == 0,
          "the tail patch starts on an even panel pixel");
    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
