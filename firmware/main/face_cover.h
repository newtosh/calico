#pragma once

#include "idle_cat_geom.h"

/* Layout numbers shared with ui.c. The face band is the region that has to
 * be rewritten when the desk switches between the sleeping cat and the list. */

enum {
    FACE_SCREEN = 480,
    FACE_EDGE = 16,
    FACE_BAR_H = 32,
    /* 90% of the old 64px dock button, so the case radius clears the corner. */
    FACE_BTN_H = 58,
    /* Past the 16px glass bezel. The printed case clips a button on that line. */
    FACE_DOCK_INSET = 8,
    /* Dock chrome above the buttons, so the list band does not sit on their tops. */
    FACE_DOCK_GAP = 16,
    FACE_DOCK_TOP = FACE_SCREEN - FACE_EDGE - FACE_DOCK_INSET - FACE_DOCK_GAP - FACE_BTN_H,
    FACE_MESSAGE_Y = 74,
    /* The link-down screen: a cat-off icon, a gap, and one line of caption. */
    FACE_LINKDOWN_ICON = 168,
    FACE_LINKDOWN_W = 280,
    FACE_LINKDOWN_GAP = 20,
    /* lv_font_montserrat_24 line_height is 27. */
    FACE_LINKDOWN_CAPTION_H = 30
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

/* Where the sleeping cat sits: centered across the panel and between the message
 * line and the dock. Starts on even pixels, and so do its patch boxes. */
void face_sleep_widget(face_box_t *out);

/* Where the link-down screen sits: the same centering as the cat, even pixels. */
void face_linkdown_widget(face_box_t *out);
