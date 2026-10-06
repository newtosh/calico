#pragma once

/* Layout numbers shared with ui.c. The face band is the region that has to
 * be rewritten when the desk switches between the sleep glyph and the list. */

enum {
    FACE_SCREEN = 480,
    FACE_EDGE = 16,
    FACE_BAR_H = 32,
    /* 90% of the old 64px dock button, so the case radius clears the corner. */
    FACE_BTN_H = 58,
    /* Past the 16px glass bezel. The printed case clips a button on that line. */
    FACE_DOCK_INSET = 8,
    FACE_DOCK_TOP = FACE_SCREEN - FACE_EDGE - FACE_DOCK_INSET - FACE_BTN_H,
    FACE_MESSAGE_Y = 74,
    FACE_SLEEP_HEAD = 96,
    /* Head plus the gap the Zzz used to occupy above it. */
    FACE_SLEEP_SPAN = 96 + 36,
    FACE_SLEEP_W = 96 + 56,
    FACE_SLEEP_BOB = 10,
    FACE_SLEEP_RISE = 12
};

typedef struct {
    int x1;
    int y1;
    int x2;
    int y2;
} face_rect_t;

typedef struct {
    int x;
    int y;
    int w;
    int h;
} face_box_t;

/* Inclusive. Full panel width, under the status bar through the pixel above
 * the dock. Start is even and end is odd so a CO5300 window (even size) fits. */
void face_cover_band(face_rect_t *out);

/* Widget box at this bob (0..FACE_SLEEP_BOB). The rise pad is inside the box,
 * so the Zzz never draws outside it. */
void face_sleep_widget(int bob, face_box_t *out);

/* Y of the Zzz inside the widget at this rise (0..FACE_SLEEP_RISE). */
int face_zzz_y(int rise);
