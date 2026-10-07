#pragma once

/* Control Center. A downward swipe that starts on the status strip pulls
 * the sheet out from under the bar. Host tests compile this without LVGL.
 * The sheet uses the 24px case line and stops above the dock. */

enum {
    CC_SCREEN = 480,
    CC_EDGE = 16,
    CC_BAR = 32,
    /* Bezel plus the 32px status bar. Presses that start here can open. */
    CC_GRAB = CC_EDGE + CC_BAR,
    CC_INSET = 24,
    CC_OPEN_Y = CC_GRAB,
    CC_PAD = 16,
    CC_GAP = 12,
    CC_STROKE = 3,
    CC_COLS = 2,
    CC_ROWS = 3,
    CC_TILE_H = 72,
    CC_PANEL_W = CC_SCREEN - (CC_INSET * 2),
    CC_TILE_W = (CC_PANEL_W - (CC_STROKE * 2) - (CC_PAD * 2) - (CC_GAP * (CC_COLS - 1))) / CC_COLS,
    CC_PANEL_H = (CC_STROKE * 2) + (CC_PAD * 2) + (CC_TILE_H * CC_ROWS) + (CC_GAP * (CC_ROWS - 1)),
    /* ui.c dock top: 480 - 16 - 8 - 16 - 58. */
    CC_DOCK_TOP = 382,
    CC_SLOP = 10,
    CC_OPEN_DY = 64,
    CC_FLICK_DY = 28,
    CC_FLICK_MS = 320,
    CC_RADIUS = 28
};

_Static_assert(CC_GRAB == 48, "grab is the status strip");
_Static_assert(CC_INSET == 24, "case line");
_Static_assert(CC_OPEN_Y + CC_PANEL_H < CC_DOCK_TOP, "sheet stops above the dock");
_Static_assert(CC_TILE_W * CC_COLS + CC_GAP * (CC_COLS - 1) + CC_PAD * 2 + CC_STROKE * 2 == CC_PANEL_W,
               "a row of tiles fills the sheet");
_Static_assert(CC_TILE_H * CC_ROWS + CC_GAP * (CC_ROWS - 1) + CC_PAD * 2 + CC_STROKE * 2 == CC_PANEL_H,
               "the rows fill the sheet");
_Static_assert(CC_OPEN_DY > CC_FLICK_DY, "a flick is shorter than a full pull");
_Static_assert(CC_SLOP < CC_FLICK_DY, "a flick clears the slop");

enum {
    DESK_CC_NONE = 0,
    DESK_CC_OPEN = 1,
    DESK_CC_CLOSE = 2
};

typedef struct {
    int open;
    int down;
    int tracking;
    int moved;
    int ate;
    int from_grab;
    int on_panel;
    int outside;
    int base;
    int dy;
} desk_cc_t;

void desk_cc_init(desk_cc_t *cc);

/* pressed is 1 while the finger is down. grab, on_panel, and outside
 * describe where this press began. Pass the same flags on the later
 * samples. dy is downward pixels from the press. dt_ms is the press
 * length and is read on release. reveal_now is the pixels currently
 * showing, so a press during the snap animation does not jump.
 * Returns DESK_CC_OPEN, DESK_CC_CLOSE, or DESK_CC_NONE.
 * The caller passes grab as 0 while settings cover the strip. */
int desk_cc_pointer(desk_cc_t *cc, int pressed, int grab, int on_panel, int outside, int dy,
                    int dt_ms, int reveal_now);

/* 0 hidden, CC_PANEL_H fully open. */
int desk_cc_reveal(const desk_cc_t *cc);

/* 1 after a drag, until the next press. A tile click should ignore itself. */
int desk_cc_ate_click(const desk_cc_t *cc);
