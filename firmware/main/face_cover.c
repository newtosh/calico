#include "face_cover.h"

void face_cover_band(face_rect_t *out) {
    out->x1 = 0;
    out->y1 = FACE_EDGE + FACE_BAR_H;
    out->x2 = FACE_SCREEN - 1;
    out->y2 = FACE_DOCK_TOP - 1;
}

void face_sleep_widget(face_box_t *out) {
    int y = (FACE_MESSAGE_Y + 28 + FACE_DOCK_TOP - IDLE_CAT_H) / 2;
    out->w = IDLE_CAT_W;
    out->h = IDLE_CAT_H;
    out->x = (FACE_SCREEN - IDLE_CAT_W) / 2;
    out->y = y - (y % 2);
}

void face_linkdown_widget(face_box_t *out) {
    int h = FACE_LINKDOWN_ICON + FACE_LINKDOWN_GAP + FACE_LINKDOWN_CAPTION_H;
    int y = (FACE_MESSAGE_Y + 28 + FACE_DOCK_TOP - h) / 2;
    out->w = FACE_LINKDOWN_W;
    out->h = h;
    out->x = (FACE_SCREEN - FACE_LINKDOWN_W) / 2;
    out->y = y - (y % 2);
}
