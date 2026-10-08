#pragma once

/* Settings geometry. The page is the dock glass. ui.c asserts the inset
 * against the dock case line (bezel + lip). Host tests compile this
 * without LVGL. */

enum {
    SET_SCREEN = 480,
    SET_EDGE = 16,
    SET_DOCK_INSET = 8,
    /* Rounded case. Same 24px line the dock buttons and the sheet glow use. */
    SET_INSET = SET_EDGE + SET_DOCK_INSET,
    SET_HEADER = 56,
    /* Finger on a 2.16" 480px panel. Shorter than the 58px dock button. */
    SET_CONTROL = 48,
    SET_GAP = 8,
    SET_CARD_PAD = 8,
    SET_CARD_R = 16,
    /* Even on every side. Same weight as the needs-you card. Not a bottom rim. */
    SET_STROKE = 3,
    /* Outline outside that stroke, drawn at low opacity. */
    SET_GLOW = 2,
    SET_OUTLINE_PAD = 1,
    /* Selected network. Even, and lighter than the card so the row stays type. */
    SET_ROW_STROKE = 2,
    /* Two rows stay on the glass with the password and the scan actions.
     * More networks scroll inside the list. */
    SET_LIST_ROWS = 2,
    SET_LIST_GAP = 6,
    SET_LIST_H = (SET_CONTROL * SET_LIST_ROWS) + (SET_LIST_GAP * (SET_LIST_ROWS - 1)),
    /* One row while the keyboard covers the glass. */
    SET_LIST_KB = SET_CONTROL
};
