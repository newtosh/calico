#include "settings_layout.h"

#include <stdio.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

int main(void) {
    check(SET_SCREEN == 480, "settings is the 480 panel");
    check(SET_EDGE == 16, "bezel is 16px");
    check(SET_DOCK_INSET == 8, "lip past the bezel is 8px");
    check(SET_INSET == 24, "content clears the 24px case line");
    check(SET_INSET == SET_EDGE + SET_DOCK_INSET, "inset is bezel plus lip");
    check(SET_HEADER >= SET_CONTROL, "header holds the Done button");
    check(SET_CONTROL == 48, "fields and rows are a 48px finger target");
    check(SET_CONTROL < 58, "form controls stay under the dock button");
    check(SET_STROKE == 3, "card stroke matches the sheet weight");
    check(SET_GLOW > 0 && SET_GLOW < SET_STROKE, "glow is lighter than the stroke");
    check(SET_INSET >= SET_EDGE + SET_GLOW + SET_OUTLINE_PAD, "glow stays past the bezel");
    check(SET_ROW_STROKE == 2, "a selected row is an even 2px stroke");
    check(SET_LIST_ROWS == 2, "scan list shows two rows");
    check(SET_LIST_H == 102, "two 48px rows plus the gap");
    check(SET_LIST_H == (SET_CONTROL * SET_LIST_ROWS) + (SET_LIST_GAP * (SET_LIST_ROWS - 1)),
          "list height is the rows");
    check(SET_LIST_KB == SET_CONTROL, "keyboard keeps a single row");
    check(SET_CARD_PAD >= SET_GAP, "card padding is at least the section gap");
    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
