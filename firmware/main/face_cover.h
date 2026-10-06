#pragma once

/* Layout numbers shared with ui.c. The face band is the region that has to
 * be rewritten when the desk switches between the sleep glyph and the list. */

enum {
    FACE_SCREEN = 480,
    FACE_EDGE = 16,
    FACE_BAR_H = 32,
    FACE_BTN_H = 64,
    FACE_DOCK_TOP = FACE_SCREEN - FACE_EDGE - FACE_BTN_H,
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
