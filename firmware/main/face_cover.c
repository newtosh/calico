#include "face_cover.h"

void face_cover_band(face_rect_t *out) {
    out->x1 = 0;
    out->y1 = FACE_EDGE + FACE_BAR_H;
    out->x2 = FACE_SCREEN - 1;
    out->y2 = FACE_DOCK_TOP - 1;
}

void face_sleep_widget(int bob, face_box_t *out) {
    int rest;
    if (bob < 0) {
        bob = 0;
    }
    if (bob > FACE_SLEEP_BOB) {
        bob = FACE_SLEEP_BOB;
    }
    rest = (FACE_MESSAGE_Y + 28 + FACE_DOCK_TOP - FACE_SLEEP_SPAN) / 2;
    out->w = FACE_SLEEP_W;
    out->h = FACE_SLEEP_RISE + FACE_SLEEP_SPAN;
    out->x = (FACE_SCREEN - out->w) / 2;
    out->y = rest - FACE_SLEEP_RISE + bob;
}

int face_zzz_y(int rise) {
    if (rise < 0) {
        rise = 0;
    }
    if (rise > FACE_SLEEP_RISE) {
        rise = FACE_SLEEP_RISE;
    }
    return (FACE_SLEEP_RISE + 4) - rise;
}
