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
    face_box_t rest;
    face_box_t bobbed;
    int width;
    int height;
    int rise;
    /* lv_font_montserrat_24 line_height. The label has to clear the head. */
    enum { ZZZ_LINE = 27 };
    face_cover_band(&band);
    width = band.x2 - band.x1 + 1;
    height = band.y2 - band.y1 + 1;
    check(band.x1 == 0 && band.x2 == FACE_SCREEN - 1, "band is the full panel width");
    check(band.y1 == FACE_EDGE + FACE_BAR_H, "band starts under the status bar");
    check(band.y2 == FACE_DOCK_TOP - 1, "band stops above the dock");
    check(FACE_BTN_H == 58, "dock button height is about 10% under 64");
    check(FACE_DOCK_INSET == 8, "buttons sit 8px past the bezel");
    check(FACE_DOCK_TOP == 398, "list stops above the inset dock");
    check((band.x1 % 2) == 0 && (band.y1 % 2) == 0, "band start is even");
    check((band.x2 % 2) == 1 && (band.y2 % 2) == 1, "band end is odd");
    check((width % 2) == 0 && (height % 2) == 0, "band size is even");
    face_sleep_widget(0, &rest);
    face_sleep_widget(FACE_SLEEP_BOB, &bobbed);
    check(inside_band(&band, &rest), "resting glyph is inside the band");
    check(inside_band(&band, &bobbed), "bobbed glyph is inside the band");
    check(bobbed.y == rest.y + FACE_SLEEP_BOB, "bob moves the widget down");
    check(rest.h == FACE_SLEEP_RISE + FACE_SLEEP_SPAN, "widget includes the Zzz rise");
    for (rise = 0; rise <= FACE_SLEEP_RISE; rise++) {
        int y = face_zzz_y(rise);
        int x = FACE_SLEEP_HEAD - 4;
        check(y >= 0 && y + ZZZ_LINE <= rest.h - FACE_SLEEP_HEAD, "Zzz line stays above the head");
        check(x >= 0 && x < rest.w, "Zzz x stays inside the widget");
    }
    check(face_zzz_y(FACE_SLEEP_RISE) < face_zzz_y(0), "Zzz rises");
    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
