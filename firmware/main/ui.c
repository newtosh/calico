#include "ui.h"

#include "desk_status.h"
#include "face_cover.h"
#include "icons.h"
#include "lvgl.h"

#include "esp_heap_caps.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum {
    SCREEN_PX = 480,
    /* Bezel covers the rounded corners of the 480 panel. 16px clears them. */
    EDGE_PX = 16,
    KEYBOARD_PX = 200,
    HEADER_PX = 48,
    PAD_PX = EDGE_PX,
    /* 32px status bar under the 16px bezel. Face gaps start just under it. */
    BAR_H = 32,
    TITLE_Y = 50,
    MESSAGE_Y = 74,
    /* Half of the old 24px message band (98 - 74) stays as air under the title.
     * A centered note still starts the list at 98 so it does not cover row 0. */
    AGENT_Y = 86,
    AGENT_NOTE_Y = 98,
    AGENT_ROW_H = 30,
    AGENT_GAP = 2,
    MARK_PX = 24,
    ASIDE_SCROLL_MS = 20000,
    /* One pass of the aside marquee, so the line finishes inside the 20s window. */
    ASIDE_PASS_MS = 8000,
    ROW_PAD = 8,
    ROW_GAP = 12,
    /* Floor for the status text when a name would otherwise take the row. */
    ASIDE_MIN = 48,
    /* 90% of 64x80. The case radius was clipping the old squares. */
    BTN_H = 58,
    BTN_W = 72,
    /* Past the 16px glass bezel, so the printed corner misses the button. */
    DOCK_INSET = 8,
    /* Same air as the bezel. The buttons stay put; the list ends above this. */
    DOCK_GAP = 16,
    /* Top of the dock strip. Buttons sit DOCK_GAP below it. The count sits with them. */
    DOCK_TOP = SCREEN_PX - EDGE_PX - DOCK_INSET - DOCK_GAP - BTN_H,
    /* Under the status strip. The printed case clips the outer 24px (the
     * 16px bezel plus the 8px lip the dock already clears). The halo's outer
     * edge sits on that line. The card border is one halo thickness inside
     * it, so the rounded bottom and Dismiss all stay on the glass. The old
     * card ran 36px past the panel and the lip cut both. */
    SHEET_SAFE = EDGE_PX + DOCK_INSET,
    SHEET_HALO_PX = 6,
    SHEET_INSET = SHEET_SAFE + SHEET_HALO_PX,
    SHEET_Y = EDGE_PX + BAR_H,
    SHEET_BOTTOM = SCREEN_PX - SHEET_INSET,
    SHEET_MARK = 120,
    /* Two solid discs behind the silhouette. A blurred shadow would want
     * another full frame; these do not. */
    SHEET_GLOW = 148,
    SHEET_GLOW_CORE = 136,
    SHEET_GLOW_OPA = 140,
    SHEET_GLOW_CORE_OPA = 210,
    /* 98%. LV_OPA_90 (and the sim's 0.92) still left roster type readable. */
    SHEET_OPA = 250,
    PEEK_OPA = 242,
    SHEET_HALO_OPA = 160,
    SHEET_BORDER = 3,
    SHEET_PAD_TOP = 8,
    SHEET_PAD_H = 20,
    SHEET_PAD_BOTTOM = 12,
    SHEET_PAD_ROW = 6,
    /* How far a card behind this one peeks above the front sheet. */
    SHEET_PEEK = 14,
    /* Far enough that the rear peek is still off the glass. */
    SHEET_PARK = SCREEN_PX + (SHEET_PEEK * 2),
    SHEET_MS = 280,
    INK = 0xefe7d6,
    INK_DIM = 0xa39b88,
    BG = 0x14160f,
    FIELD = 0x2a2d24,
    FIELD_EDGE = 0x6d6756,
    ROW = 0x2a2d24,
    ROW_ON = 0x3d4f32,
    /* Hot agent row. FIELD (#2a2d24) sank into the #14160f face. This olive
     * stays under the cream type. The sage edge is what reads across the desk. */
    ROW_HOT = 0x527044,
    ROW_HOT_INK = 0xd4ccba,
    ROW_MARK = 0x9bb57a,
    LAMP_AMBER = 0xe2a23a,
    LAMP_RED = 0xc4544a,
    /* One step under the olive face. Top status bar and bottom dock. */
    DOCK = 0x0c0e09
};

/* int casts: these are two anonymous enums, and -Werror=enum-compare rejects the compare. */
_Static_assert((int)SCREEN_PX == (int)FACE_SCREEN, "face band width");
_Static_assert((int)EDGE_PX == (int)FACE_EDGE, "face band edge");
_Static_assert((int)BAR_H == (int)FACE_BAR_H, "face band top");
_Static_assert((int)BTN_H == (int)FACE_BTN_H, "face band dock");
_Static_assert((int)DOCK_INSET == (int)FACE_DOCK_INSET, "face band inset");
_Static_assert((int)DOCK_GAP == (int)FACE_DOCK_GAP, "face band gap");
_Static_assert((int)DOCK_TOP == (int)FACE_DOCK_TOP, "face band bottom");
_Static_assert(BTN_W == 72 && BTN_H == 58, "dock buttons are about 10% under 80x64");
_Static_assert(SHEET_SAFE == 24, "sheet halo meets the dock case line");
_Static_assert(SHEET_INSET == 30, "card border sits inside the halo");
_Static_assert(SHEET_BOTTOM + SHEET_HALO_PX == SCREEN_PX - 24, "halo ends on the case line");
_Static_assert(SHEET_OPA >= 248, "sheet stays opaque enough to hide roster type");
_Static_assert((int)MESSAGE_Y == (int)FACE_MESSAGE_Y, "sleep origin");

static lv_obj_t *s_title;
static lv_obj_t *s_message;
static lv_obj_t *s_count;
static lv_obj_t *s_sheet;
static lv_obj_t *s_sheet_halo;
static lv_obj_t *s_peek1;
static lv_obj_t *s_peek2;
static lv_obj_t *s_sheet_glow;
static lv_obj_t *s_sheet_glow_core;
static lv_obj_t *s_sheet_mark;
static lv_obj_t *s_sheet_count;
static lv_obj_t *s_sheet_count_label;
static lv_obj_t *s_sheet_title;
static lv_obj_t *s_sheet_body;
static lv_obj_t *s_sheet_text;
static lv_obj_t *s_sheet_all;
static lv_timer_t *s_sheet_timer;
static int s_sheet_up;
static int s_sheet_leaving;
static int s_sheet_suppress;
static int s_sheet_pressed;
static int s_sheet_dragged;
static int s_sheet_press_x;
static int s_sheet_press_y;
static int s_sheet_rest;
static int s_sheet_steps;
static int s_sheet_at;
static uint32_t s_sheet_press_ms;
static char s_sheet_focus_id[40];
static char s_sheet_bound[40];
static char s_sheet_leave_id[40];
static char s_sheet_skip[DESK_AGENT_MAX][40];
static int s_sheet_skip_n;
static char s_sheet_seen[DESK_AGENT_MAX][40];
static int s_sheet_seen_n;
static lv_obj_t *s_settings;
static lv_obj_t *s_header;
static lv_obj_t *s_body;
static lv_obj_t *s_status;
static lv_obj_t *s_list;
static lv_obj_t *s_selected;
static lv_obj_t *s_ssid_box;
static lv_obj_t *s_ssid;
static lv_obj_t *s_pass;
static lv_obj_t *s_url;
static lv_obj_t *s_token;
static lv_obj_t *s_keyboard;
static lv_obj_t *s_rows[NET_SCAN_MAX];
static lv_obj_t *s_agent_box;
static lv_obj_t *s_agent_rows[DESK_AGENT_MAX];
static lv_obj_t *s_agent_marks[DESK_AGENT_MAX];
static lv_obj_t *s_agent_labels[DESK_AGENT_MAX];
static lv_obj_t *s_agent_aside[DESK_AGENT_MAX];
static int s_aside_w[DESK_AGENT_MAX];
static lv_timer_t *s_aside_timer;
static net_ap_t s_aps[NET_SCAN_MAX];
static int s_row_count;
static ui_save_fn s_on_save;
static void (*s_on_dismiss)(const char *agent_id);
static void (*s_on_clear_unread)(void);
static ui_scan_fn s_on_scan;
static lv_timer_t *s_mic_timer;
static int s_hiding;
static wifi_net_t s_known[WIFI_NET_MAX];
static int s_known_count;
static char s_global_url[128];
static char s_global_token[128];
static lv_obj_t *s_sleep;
static lv_obj_t *s_head;
static lv_obj_t *s_eye_l;
static lv_obj_t *s_eye_r;
static lv_obj_t *s_zzz;
static int s_asleep;
static int s_face_asleep = -1;
static int s_list_cover;
static lv_obj_t *s_lamp;
static lv_obj_t *s_toast_label;
static lv_obj_t *s_wifi_bars[3];
static lv_obj_t *s_lock;
static lv_obj_t *s_lock_label;
static lv_timer_t *s_toast_timer;
static desk_toast_t s_toast_state;
static ui_rotlock_fn s_on_rotlock;
static int s_rot_locked;
static int s_wifi_ip;
static int s_wifi_rssi;
static int s_wifi_retries;
static int s_wifi_gave_up;
static int s_fail_count;
static int s_applied;
static int s_applied_failures;
static desk_view_t s_applied_view;
static int s_last_lamp = DESK_LAMP_AMBER;
static int s_status_seen_ok;
static char s_phase_text[24];
static char s_status_seen[24];
static lv_obj_t *s_new_btn;
static lv_obj_t *s_new_label;
static int s_unseen;

static void copy_text(char *dest, size_t dest_len, const char *src) {
    size_t i;
    if (dest_len == 0) {
        return;
    }
    if (!src) {
        dest[0] = '\0';
        return;
    }
    for (i = 0; i + 1 < dest_len && src[i]; i++) {
        dest[i] = src[i];
    }
    dest[i] = '\0';
}

/* Show this SSID's own URL and token when it has them, otherwise the global default. */
static void show_endpoint_for(const char *ssid) {
    const char *url = s_global_url;
    const char *token = s_global_token;
    int i;
    if (!s_url || !s_token) {
        return;
    }
    for (i = 0; i < s_known_count; i++) {
        if (ssid && ssid[0] && strcmp(s_known[i].ssid, ssid) == 0) {
            if (s_known[i].url[0]) {
                url = s_known[i].url;
            }
            if (s_known[i].token[0]) {
                token = s_known[i].token;
            }
            break;
        }
    }
    lv_textarea_set_text(s_url, url);
    lv_textarea_set_text(s_token, token);
}

static void style_text(lv_obj_t *label) {
    lv_obj_set_style_text_color(label, lv_color_hex(INK), 0);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_16, 0);
}

static void paint_triangle(lv_draw_triangle_dsc_t *dsc, lv_color_t color) {
    lv_draw_triangle_dsc_init(dsc);
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    dsc->bg_color = color;
    dsc->bg_opa = LV_OPA_COVER;
#else
    dsc->color = color;
    dsc->opa = LV_OPA_COVER;
#endif
}

static void fill_tri(lv_layer_t *layer, lv_draw_triangle_dsc_t *dsc, int x0, int y0, int x1, int y1,
                     int x2, int y2) {
    dsc->p[0].x = x0;
    dsc->p[0].y = y0;
    dsc->p[1].x = x1;
    dsc->p[1].y = y1;
    dsc->p[2].x = x2;
    dsc->p[2].y = y2;
    lv_draw_triangle(layer, dsc);
}

/* Fan from the box center. Every polygon here is visible from that point. */
static int mark_box(const lv_area_t *area) {
    int w = (int)(area->x2 - area->x1 + 1);
    return w > 0 ? w : 1;
}

/* Tables are drawn for a 24px mark. A larger widget uses the same points. */
static int sc(int v, int w) {
    return v * w / 24;
}

static void fill_poly(lv_layer_t *layer, lv_draw_triangle_dsc_t *dsc, const lv_area_t *box,
                      const int8_t *xy, int n) {
    int i;
    int w = mark_box(box);
    int cx = (box->x1 + box->x2) / 2;
    int cy = (box->y1 + box->y2) / 2;
    for (i = 0; i < n; i++) {
        int j = (i + 1) % n;
        fill_tri(layer, dsc, cx, cy, box->x1 + sc(xy[2 * i], w), box->y1 + sc(xy[2 * i + 1], w),
                 box->x1 + sc(xy[2 * j], w), box->y1 + sc(xy[2 * j + 1], w));
    }
}

static void fill_round(lv_layer_t *layer, lv_color_t color, int x, int y, int w, int h) {
    lv_draw_rect_dsc_t dsc;
    lv_area_t area;
    lv_draw_rect_dsc_init(&dsc);
    dsc.bg_color = color;
    dsc.bg_opa = LV_OPA_COVER;
    dsc.radius = LV_RADIUS_CIRCLE;
    area.x1 = x;
    area.y1 = y;
    area.x2 = x + w - 1;
    area.y2 = y + h - 1;
    lv_draw_rect(layer, &dsc, &area);
}

static const int8_t k_star[] = {12, 0, 14, 9, 22, 12, 14, 14, 12, 22, 9, 14, 0, 12, 9, 9};
static const int8_t k_blob[] = {12, 0,  16, 4,  20, 6,  18, 12, 21, 17, 16, 18,
                                12, 18, 7,  20, 5,  15, 0,  12, 4,  7,  8,  5};
static const int8_t k_pentagon[] = {12, 0, 22, 8, 18, 20, 5, 20, 1, 8};
static const int8_t k_sun[] = {12, 0,  14, 5,  19, 4,  18, 9,  22, 12, 18, 14, 19, 19, 14, 18,
                               12, 22, 9,  18, 4,  19, 5,  14, 0,  12, 5,  9,  4,  4,  9,  5};
static const int8_t k_hexagon[] = {12, 0, 21, 6, 21, 17, 12, 22, 2, 17, 2, 6};

static void draw_mark(lv_event_t *event) {
    lv_obj_t *obj = lv_event_get_target(event);
    intptr_t shape = (intptr_t)lv_obj_get_user_data(obj);
    lv_layer_t *layer;
    lv_area_t area;
    lv_draw_triangle_dsc_t dsc;
    lv_color_t color;
    int x;
    int y;
    int cx;
    int cy;
    if (shape == DESK_SHAPE_CIRCLE || shape == DESK_SHAPE_SQUARE || shape == DESK_SHAPE_ROUNDED) {
        return;
    }
    layer = lv_event_get_layer(event);
    if (!layer) {
        return;
    }
    lv_obj_get_coords(obj, &area);
    color = lv_obj_get_style_bg_color(obj, LV_PART_MAIN);
    paint_triangle(&dsc, color);
    x = area.x1;
    y = area.y1;
    cx = (area.x1 + area.x2) / 2;
    cy = (area.y1 + area.y2) / 2;
    if (shape == DESK_SHAPE_TRIANGLE) {
        fill_tri(layer, &dsc, cx, area.y1, area.x1, area.y2, area.x2, area.y2);
        return;
    }
    if (shape == DESK_SHAPE_DIAMOND) {
        fill_tri(layer, &dsc, cx, area.y1, area.x2, cy, cx, area.y2);
        fill_tri(layer, &dsc, cx, area.y1, area.x1, cy, cx, area.y2);
        return;
    }
    if (shape == DESK_SHAPE_CLOUD) {
        int w = mark_box(&area);
        fill_round(layer, color, x + sc(1, w), y + sc(10, w), sc(14, w), sc(14, w));
        fill_round(layer, color, x + sc(8, w), y + sc(8, w), sc(15, w), sc(15, w));
        fill_round(layer, color, x + sc(5, w), y + sc(3, w), sc(11, w), sc(11, w));
        fill_round(layer, color, x + sc(12, w), y + sc(4, w), sc(10, w), sc(10, w));
        return;
    }
    if (shape == DESK_SHAPE_FLOWER) {
        int w = mark_box(&area);
        fill_round(layer, color, x + sc(1, w), y + sc(1, w), sc(12, w), sc(12, w));
        fill_round(layer, color, x + sc(11, w), y + sc(1, w), sc(12, w), sc(12, w));
        fill_round(layer, color, x + sc(1, w), y + sc(11, w), sc(12, w), sc(12, w));
        fill_round(layer, color, x + sc(11, w), y + sc(11, w), sc(12, w), sc(12, w));
        return;
    }
    if (shape == DESK_SHAPE_HEART) {
        int w = mark_box(&area);
        fill_round(layer, color, x + sc(1, w), y + sc(3, w), sc(12, w), sc(12, w));
        fill_round(layer, color, x + sc(11, w), y + sc(3, w), sc(12, w), sc(12, w));
        fill_tri(layer, &dsc, x + sc(2, w), y + sc(10, w), x + sc(22, w), y + sc(10, w), x + sc(12, w),
                 y + sc(22, w));
        return;
    }
    if (shape == DESK_SHAPE_DROP) {
        int w = mark_box(&area);
        fill_round(layer, color, x + sc(4, w), y + sc(8, w), sc(16, w), sc(16, w));
        fill_tri(layer, &dsc, x + sc(12, w), y + sc(1, w), x + sc(4, w), y + sc(14, w), x + sc(20, w),
                 y + sc(14, w));
        return;
    }
    if (shape == DESK_SHAPE_PILL) {
        int w = mark_box(&area);
        fill_round(layer, color, x + sc(5, w), y + sc(1, w), sc(14, w), sc(22, w));
        return;
    }
    if (shape == DESK_SHAPE_STAR) {
        fill_poly(layer, &dsc, &area, k_star, (int)(sizeof(k_star) / 2));
    } else if (shape == DESK_SHAPE_BLOB) {
        fill_poly(layer, &dsc, &area, k_blob, (int)(sizeof(k_blob) / 2));
    } else if (shape == DESK_SHAPE_PENTAGON) {
        fill_poly(layer, &dsc, &area, k_pentagon, (int)(sizeof(k_pentagon) / 2));
    } else if (shape == DESK_SHAPE_SUN) {
        fill_poly(layer, &dsc, &area, k_sun, (int)(sizeof(k_sun) / 2));
    } else if (shape == DESK_SHAPE_HEXAGON) {
        fill_poly(layer, &dsc, &area, k_hexagon, (int)(sizeof(k_hexagon) / 2));
    }
}

static void apply_mark(lv_obj_t *mark, uint32_t color, int shape) {
    int radius = 0;
    int side = (int)lv_obj_get_width(mark);
    lv_opa_t opa = LV_OPA_TRANSP;
    if (side < 1) {
        side = MARK_PX;
    }
    lv_obj_set_style_bg_color(mark, lv_color_hex(color), 0);
    lv_obj_set_style_outline_width(mark, 0, 0);
    lv_obj_set_user_data(mark, (void *)(intptr_t)shape);
    if (shape == DESK_SHAPE_SQUARE) {
        radius = 2 * side / 24;
        opa = LV_OPA_COVER;
    } else if (shape == DESK_SHAPE_ROUNDED) {
        radius = 6 * side / 24;
        opa = LV_OPA_COVER;
    } else if (shape == DESK_SHAPE_CIRCLE) {
        radius = LV_RADIUS_CIRCLE;
        opa = LV_OPA_COVER;
    }
    lv_obj_set_style_radius(mark, radius, 0);
    lv_obj_set_style_bg_opa(mark, opa, 0);
    lv_obj_invalidate(mark);
}

static void place_agents(int message_line) {
    int y = message_line ? AGENT_NOTE_Y : AGENT_Y;
    int h = DOCK_TOP - y;
    lv_obj_set_hidden(s_message, !message_line);
    /* Resizing the list clamps its scroll. Skip that when the box is already there. */
    if ((int)lv_obj_get_y(s_agent_box) != y || (int)lv_obj_get_height(s_agent_box) != h) {
        lv_obj_set_size(s_agent_box, SCREEN_PX - (EDGE_PX * 2), h);
        lv_obj_align(s_agent_box, LV_ALIGN_TOP_MID, 0, y);
    }
    if (s_new_btn) {
        lv_obj_align(s_new_btn, LV_ALIGN_TOP_MID, 0, y);
    }
}

/* Face message stays centered only when no row is carrying it. */
static const char *centered_note(const desk_view_t *view) {
    int i;
    for (i = 0; i < view->agent_count; i++) {
        const char *aside = "";
        desk_agent_hot(view, i, &aside);
        if (aside[0]) {
            return "";
        }
    }
    return view->message;
}

static void show_note(const char *text) {
    int line = text && text[0];
    lv_label_set_text(s_message, line ? text : "");
    place_agents(line);
}

static int label_text_px(lv_obj_t *label, const char *text) {
    const lv_font_t *font;
    lv_point_t size;
    if (!label || !text || !text[0]) {
        return 0;
    }
    font = lv_obj_get_style_text_font(label, LV_PART_MAIN);
    if (!font) {
        return 0;
    }
    lv_text_get_size(&size, text, font, lv_obj_get_style_text_letter_space(label, LV_PART_MAIN),
                     lv_obj_get_style_text_line_space(label, LV_PART_MAIN), LV_COORD_MAX,
                     LV_TEXT_FLAG_NONE);
    /* Two pixels of slack so CLIP does not eat the last glyph. */
    return size.x > 0 ? size.x + 2 : 0;
}

/* LONG_DOT drops expand and then grows to the wrapped height, so a content-sized
 * aside wraps onto the next row once the circular scroll stops. CLIP stays one line. */
static void pin_aside_line(lv_obj_t *aside) {
    const lv_font_t *font = lv_obj_get_style_text_font(aside, LV_PART_MAIN);
    int line = font ? (int)lv_font_get_line_height(font) : 20;
    if (line < 1) {
        line = 1;
    }
    lv_obj_set_height(aside, line);
}

static void lay_row_text(int index, lv_obj_t *name, lv_obj_t *aside, const char *text, int scroll) {
    int show = text && text[0];
    int inner = (SCREEN_PX - (EDGE_PX * 2)) - (ROW_PAD * 2);
    int avail = inner - MARK_PX - ROW_GAP;
    int name_w = 0;
    int aside_w = 0;
    int width_changed;
    lv_label_long_mode_t mode = scroll ? LV_LABEL_LONG_SCROLL_CIRCULAR : LV_LABEL_LONG_CLIP;
    const char *shown = show ? text : "";
    desk_row_spans(avail, label_text_px(name, lv_label_get_text(name)), ROW_GAP, ASIDE_MIN, show,
                   &name_w, &aside_w);
    if (strcmp(lv_label_get_text(aside), shown) != 0) {
        lv_label_set_text(aside, shown);
    }
    lv_obj_set_hidden(aside, !show);
    width_changed = index >= 0 && index < DESK_AGENT_MAX && s_aside_w[index] != aside_w;
    lv_obj_set_width(name, name_w);
    lv_obj_set_width(aside, aside_w);
    if (lv_label_get_long_mode(aside) != mode || (scroll && width_changed)) {
        lv_obj_set_style_text_align(aside, LV_TEXT_ALIGN_LEFT, 0);
        lv_label_set_long_mode(aside, mode);
        lv_obj_set_width(aside, aside_w);
    }
    pin_aside_line(aside);
    if (index >= 0 && index < DESK_AGENT_MAX) {
        s_aside_w[index] = aside_w;
    }
}

static void build_agent_rows(lv_obj_t *screen) {
    int i;
    s_agent_box = lv_obj_create(screen);
    lv_obj_set_size(s_agent_box, SCREEN_PX - (EDGE_PX * 2), DOCK_TOP - AGENT_Y);
    lv_obj_align(s_agent_box, LV_ALIGN_TOP_MID, 0, AGENT_Y);
    lv_obj_set_flex_flow(s_agent_box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(s_agent_box, 0, 0);
    lv_obj_set_style_pad_row(s_agent_box, AGENT_GAP, 0);
    lv_obj_set_style_bg_opa(s_agent_box, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(s_agent_box, 0, 0);
    lv_obj_set_style_radius(s_agent_box, 0, 0);
    lv_obj_set_scrollbar_mode(s_agent_box, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_scroll_dir(s_agent_box, LV_DIR_VER);
    lv_obj_clear_flag(s_agent_box, LV_OBJ_FLAG_SCROLL_ELASTIC);
    for (i = 0; i < DESK_AGENT_MAX; i++) {
        lv_obj_t *row = lv_obj_create(s_agent_box);
        lv_obj_t *mark = lv_obj_create(row);
        lv_obj_t *label = lv_label_create(row);
        lv_obj_t *aside = lv_label_create(row);
        s_agent_rows[i] = row;
        s_agent_marks[i] = mark;
        s_agent_labels[i] = label;
        s_agent_aside[i] = aside;
        lv_obj_clear_flag(row, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_width(row, lv_pct(100));
        lv_obj_set_height(row, AGENT_ROW_H);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_all(row, 0, 0);
        lv_obj_set_style_pad_left(row, ROW_PAD, 0);
        lv_obj_set_style_pad_right(row, ROW_PAD, 0);
        lv_obj_set_style_pad_column(row, ROW_GAP, 0);
        lv_obj_set_style_bg_color(row, lv_color_hex(ROW_HOT), 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_color(row, lv_color_hex(ROW_MARK), 0);
        lv_obj_set_style_border_side(row, LV_BORDER_SIDE_LEFT, 0);
        lv_obj_set_style_border_width(row, 0, 0);
        lv_obj_set_style_radius(row, 8, 0);
        lv_obj_set_size(mark, MARK_PX, MARK_PX);
        lv_obj_set_style_border_width(mark, 0, 0);
        lv_obj_set_style_pad_all(mark, 0, 0);
        lv_obj_set_style_shadow_width(mark, 0, 0);
        lv_obj_clear_flag(mark, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(mark, draw_mark, LV_EVENT_DRAW_POST, NULL);
        apply_mark(mark, DESK_MARK_NEUTRAL, DESK_SHAPE_CIRCLE);
        lv_obj_clear_flag(label, LV_OBJ_FLAG_CLICKABLE);
        lv_label_set_long_mode(label, LV_LABEL_LONG_CLIP);
        style_text(label);
        lv_obj_set_style_text_font(label, &lv_font_montserrat_24, 0);
        lv_label_set_text(label, "");
        lv_obj_clear_flag(aside, LV_OBJ_FLAG_CLICKABLE);
        lv_label_set_long_mode(aside, LV_LABEL_LONG_CLIP);
        lv_obj_set_style_text_font(aside, &lv_font_montserrat_20, 0);
        lv_obj_set_style_text_color(aside, lv_color_hex(INK_DIM), 0);
        lv_obj_set_style_text_align(aside, LV_TEXT_ALIGN_LEFT, 0);
        lv_obj_set_style_anim_duration(aside, ASIDE_PASS_MS, 0);
        lay_row_text(i, label, aside, "", 0);
        lv_obj_set_hidden(row, true);
    }
}

static void layout_settings(void) {
    int h = lv_obj_get_height(s_settings) - HEADER_PX - (PAD_PX * 2) - 6;
    if (h < 40) {
        h = 40;
    }
    lv_obj_set_height(s_body, h);
}

static void set_selected_label(const char *ssid) {
    if (ssid && ssid[0]) {
        lv_label_set_text_fmt(s_selected, "Selected: %s", ssid);
    } else {
        lv_label_set_text(s_selected, "Selected: none");
    }
}

static void hide_keyboard(int reset_indev) {
    lv_obj_t *ta;
    if (s_hiding) {
        return;
    }
    s_hiding = 1;
    ta = lv_keyboard_get_textarea(s_keyboard);
    lv_obj_set_hidden(s_keyboard, true);
    lv_obj_set_height(s_settings, SCREEN_PX);
    layout_settings();
    if (ta) {
        lv_keyboard_set_textarea(s_keyboard, NULL);
        if (reset_indev) {
            lv_obj_remove_state(ta, LV_STATE_FOCUSED);
            lv_indev_reset(NULL, ta);
        }
    }
    s_hiding = 0;
}

static void show_keyboard(lv_obj_t *ta) {
    lv_obj_t *box;
    lv_keyboard_set_textarea(s_keyboard, ta);
    lv_obj_set_size(s_keyboard, SCREEN_PX - (EDGE_PX * 2), KEYBOARD_PX);
    lv_obj_align(s_keyboard, LV_ALIGN_BOTTOM_MID, 0, -EDGE_PX);
    lv_obj_set_hidden(s_keyboard, false);
    lv_obj_move_foreground(s_keyboard);
    lv_obj_set_height(s_settings, SCREEN_PX - KEYBOARD_PX - EDGE_PX);
    layout_settings();
    box = lv_obj_get_parent(ta);
    if (box) {
        lv_obj_scroll_to_view(box, LV_ANIM_OFF);
    }
}

static void on_field(lv_event_t *event) {
    lv_event_code_t code = lv_event_get_code(event);
    lv_obj_t *ta = lv_event_get_target(event);
    if (code == LV_EVENT_FOCUSED) {
        show_keyboard(ta);
    } else if (code == LV_EVENT_DEFOCUSED) {
        hide_keyboard(0);
    } else if (code == LV_EVENT_READY || code == LV_EVENT_CANCEL) {
        hide_keyboard(1);
    } else if (code == LV_EVENT_VALUE_CHANGED && ta == s_ssid) {
        const char *typed = lv_textarea_get_text(s_ssid);
        const char *url_now = lv_textarea_get_text(s_url);
        set_selected_label(typed);
        if (!url_now || (s_global_url[0] && strcmp(url_now, s_global_url) == 0)) {
            show_endpoint_for(typed);
        }
    }
}

static void on_keyboard(lv_event_t *event) {
    (void)event;
    hide_keyboard(1);
}

static void sync_sleep(const desk_view_t *view, int failures, int lamp);

static void on_done(lv_event_t *event) {
    (void)event;
    hide_keyboard(1);
    lv_obj_set_hidden(s_settings, true);
    /* Closing settings is what starts idle sleep. The poll does not take the lock to notice. */
    if (s_applied) {
        sync_sleep(&s_applied_view, s_applied_failures, s_last_lamp);
    }
}

static void on_body_clicked(lv_event_t *event) {
    if (lv_event_get_target(event) != s_body) {
        return;
    }
    hide_keyboard(1);
}

static void style_row(lv_obj_t *btn, int on) {
    lv_obj_set_style_bg_color(btn, lv_color_hex(on ? ROW_ON : ROW), 0);
    lv_obj_set_style_border_color(btn, lv_color_hex(on ? ROW_MARK : ROW), 0);
    lv_obj_set_style_border_width(btn, on ? 3 : 0, 0);
    lv_obj_set_style_border_side(btn, LV_BORDER_SIDE_LEFT, 0);
}

static void on_pick(lv_event_t *event) {
    intptr_t index = (intptr_t)lv_event_get_user_data(event);
    int i;
    if (index < 0 || index >= s_row_count) {
        return;
    }
    lv_textarea_set_text(s_ssid, s_aps[index].ssid);
    lv_textarea_set_text(s_pass, "");
    set_selected_label(s_aps[index].ssid);
    show_endpoint_for(s_aps[index].ssid);
    for (i = 0; i < s_row_count; i++) {
        style_row(s_rows[i], i == (int)index);
    }
    hide_keyboard(1);
}

static lv_obj_t *add_row(int index) {
    lv_obj_t *btn = lv_button_create(s_list);
    lv_obj_t *label = lv_label_create(btn);
    lv_obj_set_width(btn, lv_pct(100));
    lv_obj_set_height(btn, 40);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(btn, 6, 0);
    lv_obj_set_style_pad_hor(btn, 8, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    style_row(btn, 0);
    lv_label_set_text_fmt(label, "%s   %d", s_aps[index].ssid, (int)s_aps[index].rssi);
    lv_obj_set_width(label, lv_pct(100));
    lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
    style_text(label);
    lv_obj_align(label, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_add_event_cb(btn, on_pick, LV_EVENT_CLICKED, (void *)(intptr_t)index);
    return btn;
}

static void show_unread(int count) {
    if (!s_title) {
        return;
    }
    if (count < 1) {
        lv_label_set_text(s_title, "");
        lv_obj_set_hidden(s_title, true);
        return;
    }
    if (count > 99) {
        lv_label_set_text(s_title, "99+ unread");
    } else {
        lv_label_set_text_fmt(s_title, "%d unread", count);
    }
    lv_obj_set_hidden(s_title, false);
}

static void anim_delete(void *var);

static void sheet_place(int y) {
    if (s_sheet_halo) {
        lv_obj_set_y(s_sheet_halo, y);
    }
    if (s_sheet) {
        lv_obj_set_y(s_sheet, y);
    }
    if (s_peek1) {
        lv_obj_set_y(s_peek1, y - SHEET_PEEK);
    }
    if (s_peek2) {
        lv_obj_set_y(s_peek2, y - (SHEET_PEEK * 2));
    }
}

static void sheet_exec_y(void *obj, int32_t v) {
    (void)obj;
    sheet_place(v);
}

static void sheet_timer_drop(void) {
    if (!s_sheet_timer) {
        return;
    }
    lv_timer_delete(s_sheet_timer);
    s_sheet_timer = NULL;
}

static void sheet_forget(void) {
    s_sheet_at = 0;
    s_sheet_steps = 0;
    s_sheet_rest = SHEET_Y;
    s_sheet_focus_id[0] = '\0';
    s_sheet_bound[0] = '\0';
    s_sheet_seen_n = 0;
}

static void sheet_hide_now(void) {
    sheet_timer_drop();
    s_sheet_leaving = 0;
    s_sheet_up = 0;
    s_sheet_pressed = 0;
    sheet_forget();
    if (s_peek1) {
        lv_obj_add_flag(s_peek1, LV_OBJ_FLAG_HIDDEN);
    }
    if (s_peek2) {
        lv_obj_add_flag(s_peek2, LV_OBJ_FLAG_HIDDEN);
    }
    if (!s_sheet) {
        return;
    }
    anim_delete(s_sheet);
    sheet_place(SHEET_PARK);
    lv_obj_set_hidden(s_sheet, true);
    if (s_sheet_halo) {
        lv_obj_set_hidden(s_sheet_halo, true);
    }
}

static void sheet_leave_done(lv_timer_t *timer) {
    char id[40];
    (void)timer;
    /* The one-shot timer is ending. Deleting it here would free the callback. */
    s_sheet_timer = NULL;
    copy_text(id, sizeof(id), s_sheet_leave_id);
    s_sheet_leave_id[0] = '\0';
    s_sheet_leaving = 0;
    s_sheet_up = 0;
    s_sheet_pressed = 0;
    sheet_forget();
    if (s_peek1) {
        lv_obj_add_flag(s_peek1, LV_OBJ_FLAG_HIDDEN);
    }
    if (s_peek2) {
        lv_obj_add_flag(s_peek2, LV_OBJ_FLAG_HIDDEN);
    }
    if (s_sheet) {
        anim_delete(s_sheet);
        sheet_place(SHEET_PARK);
        lv_obj_set_hidden(s_sheet, true);
    }
    if (s_sheet_halo) {
        lv_obj_set_hidden(s_sheet_halo, true);
    }
    if (s_on_dismiss) {
        s_on_dismiss(id[0] ? id : NULL);
    }
}

static void sheet_leave(void) {
    if (!s_sheet || s_sheet_leaving || !s_sheet_up) {
        return;
    }
    s_sheet_leaving = 1;
    s_sheet_suppress = 1;
    s_sheet_pressed = 0;
    anim_delete(s_sheet);
    {
        lv_anim_t a;
        lv_anim_init(&a);
        lv_anim_set_var(&a, s_sheet);
        lv_anim_set_exec_cb(&a, sheet_exec_y);
        lv_anim_set_values(&a, lv_obj_get_y(s_sheet), SHEET_PARK);
        lv_anim_set_duration(&a, SHEET_MS);
        lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
        lv_anim_start(&a);
    }
    sheet_timer_drop();
    s_sheet_timer = lv_timer_create(sheet_leave_done, SHEET_MS, NULL);
    lv_timer_set_repeat_count(s_sheet_timer, 1);
}

static int sheet_overflow(void) {
    if (!s_sheet_body) {
        return 0;
    }
    return lv_obj_get_scroll_top(s_sheet_body) > 0 || lv_obj_get_scroll_bottom(s_sheet_body) > 0;
}

static int sheet_skipped(const char *id) {
    int i;
    if (!id) {
        return 0;
    }
    for (i = 0; i < s_sheet_skip_n; i++) {
        if (strcmp(s_sheet_skip[i], id) == 0) {
            return 1;
        }
    }
    return 0;
}

static void sheet_skip_add(const char *id) {
    if (!id || !id[0] || sheet_skipped(id) || s_sheet_skip_n >= DESK_AGENT_MAX) {
        return;
    }
    copy_text(s_sheet_skip[s_sheet_skip_n], sizeof(s_sheet_skip[0]), id);
    s_sheet_skip_n++;
}

static int sheet_collect(const desk_view_t *view, int *stack) {
    int raw[DESK_AGENT_MAX];
    int raw_n;
    int i;
    int n = 0;
    if (!view) {
        return 0;
    }
    raw_n = desk_sheet_stack(view, raw, DESK_AGENT_MAX);
    for (i = 0; i < raw_n; i++) {
        if (sheet_skipped(view->agents[raw[i]].id)) {
            continue;
        }
        stack[n++] = raw[i];
    }
    return n;
}

static int sheet_was_seen(const char *id) {
    int i;
    for (i = 0; i < s_sheet_seen_n; i++) {
        if (strcmp(s_sheet_seen[i], id) == 0) {
            return 1;
        }
    }
    return 0;
}

static int sheet_fresh(const desk_view_t *view, const int *stack, int n) {
    int i;
    for (i = 0; i < n; i++) {
        if (!sheet_was_seen(view->agents[stack[i]].id)) {
            return 1;
        }
    }
    return 0;
}

static void sheet_mark_seen(const desk_view_t *view, const int *stack, int n) {
    int i;
    s_sheet_seen_n = 0;
    for (i = 0; i < n && s_sheet_seen_n < DESK_AGENT_MAX; i++) {
        copy_text(s_sheet_seen[s_sheet_seen_n], sizeof(s_sheet_seen[0]), view->agents[stack[i]].id);
        s_sheet_seen_n++;
    }
}

static uint32_t sheet_color(const desk_agent_t *agent) {
    uint32_t parsed;
    if (agent && desk_mark_color(agent->color, &parsed) == 0) {
        return parsed;
    }
    return DESK_MARK_NEUTRAL;
}

static void sheet_front(void) {
    if (s_peek2) {
        lv_obj_move_foreground(s_peek2);
    }
    if (s_peek1) {
        lv_obj_move_foreground(s_peek1);
    }
    if (s_sheet_halo) {
        lv_obj_move_foreground(s_sheet_halo);
    }
    if (s_sheet) {
        lv_obj_move_foreground(s_sheet);
    }
    if (s_settings && !lv_obj_has_flag(s_settings, LV_OBJ_FLAG_HIDDEN)) {
        lv_obj_move_foreground(s_settings);
    }
}

static void sheet_rise(void) {
    lv_anim_t a;
    if (!s_sheet || s_sheet_up || s_sheet_leaving) {
        return;
    }
    s_sheet_up = 1;
    sheet_place(SHEET_PARK);
    lv_obj_set_hidden(s_sheet, false);
    if (s_sheet_halo) {
        lv_obj_set_hidden(s_sheet_halo, false);
    }
    sheet_front();
    lv_anim_init(&a);
    lv_anim_set_var(&a, s_sheet);
    lv_anim_set_exec_cb(&a, sheet_exec_y);
    lv_anim_set_values(&a, SHEET_PARK, s_sheet_rest);
    lv_anim_set_duration(&a, SHEET_MS);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_start(&a);
}

static void sheet_open(void) {
    if (!s_sheet || s_sheet_leaving) {
        return;
    }
    if (!s_sheet_up) {
        sheet_rise();
        return;
    }
    anim_delete(s_sheet);
    sheet_place(s_sheet_rest);
    lv_obj_set_hidden(s_sheet, false);
    if (s_sheet_halo) {
        lv_obj_set_hidden(s_sheet_halo, false);
    }
    sheet_front();
}

static void sheet_peek(lv_obj_t *peek, int on, uint32_t color) {
    if (!peek) {
        return;
    }
    if (!on) {
        lv_obj_add_flag(peek, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    lv_obj_set_style_border_color(peek, lv_color_hex(color), 0);
    lv_obj_clear_flag(peek, LV_OBJ_FLAG_HIDDEN);
}

static void sheet_count_set(int behind) {
    if (!s_sheet_count) {
        return;
    }
    if (behind < 1) {
        lv_obj_add_flag(s_sheet_count, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    if (behind > 99) {
        lv_label_set_text(s_sheet_count_label, "99+ new");
    } else {
        lv_label_set_text_fmt(s_sheet_count_label, "%d new", behind);
    }
    lv_obj_clear_flag(s_sheet_count, LV_OBJ_FLAG_HIDDEN);
}

static void sheet_paint(const desk_view_t *view, const int *stack, int at, int n) {
    const desk_agent_t *agent = &view->agents[stack[at]];
    const char *aside = "";
    const char *title = agent->title[0] ? agent->title : (agent->id[0] ? agent->id : "NEEDS YOU");
    uint32_t color = sheet_color(agent);
    int behind = desk_sheet_behind(n, at);
    int steps = behind > 2 ? 2 : behind;
    desk_agent_hot(view, stack[at], &aside);
    s_sheet_steps = steps;
    s_sheet_rest = SHEET_Y + (steps * SHEET_PEEK);
    if (s_sheet) {
        int h = SHEET_BOTTOM - s_sheet_rest;
        lv_obj_set_height(s_sheet, h > 0 ? h : 1);
    }
    if (s_sheet_halo && s_sheet) {
        lv_obj_set_height(s_sheet_halo, lv_obj_get_height(s_sheet) + SHEET_HALO_PX);
    }
    apply_mark(s_sheet_mark, color, desk_mark_shape(agent->shape));
    lv_obj_set_style_bg_color(s_sheet_glow, lv_color_hex(color), 0);
    if (s_sheet_glow_core) {
        lv_obj_set_style_bg_color(s_sheet_glow_core, lv_color_hex(color), 0);
    }
    if (s_sheet_halo) {
        lv_obj_set_style_bg_color(s_sheet_halo, lv_color_hex(color), 0);
    }
    lv_obj_set_style_border_color(s_sheet, lv_color_hex(color), 0);
    if (s_sheet_count) {
        lv_obj_set_style_border_color(s_sheet_count, lv_color_hex(color), 0);
    }
    sheet_peek(s_peek1, steps >= 1, steps >= 1 ? sheet_color(&view->agents[stack[at + 1]]) : color);
    sheet_peek(s_peek2, steps >= 2, steps >= 2 ? sheet_color(&view->agents[stack[at + 2]]) : color);
    sheet_count_set(behind);
    if (s_sheet_all) {
        if (n > 1) {
            lv_obj_clear_flag(s_sheet_all, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(s_sheet_all, LV_OBJ_FLAG_HIDDEN);
        }
    }
    /* Setting the same string still resets the body's scroll. */
    if (strcmp(s_sheet_bound, agent->id) != 0) {
        copy_text(s_sheet_bound, sizeof(s_sheet_bound), agent->id);
        if (s_sheet_body) {
            lv_obj_scroll_to_y(s_sheet_body, 0, LV_ANIM_OFF);
        }
    }
    if (strcmp(lv_label_get_text(s_sheet_title), title) != 0) {
        lv_label_set_text(s_sheet_title, title);
    }
    if (strcmp(lv_label_get_text(s_sheet_text), aside ? aside : "") != 0) {
        lv_label_set_text(s_sheet_text, aside ? aside : "");
    }
}

static void sheet_show(const desk_view_t *view, int prefer_front) {
    int stack[DESK_AGENT_MAX];
    int n = sheet_collect(view, stack);
    int at = 0;
    int i;
    if (n < 1) {
        if (!s_sheet_leaving) {
            sheet_hide_now();
        }
        return;
    }
    if (!prefer_front && s_sheet_focus_id[0]) {
        for (i = 0; i < n; i++) {
            if (strcmp(view->agents[stack[i]].id, s_sheet_focus_id) == 0) {
                at = i;
                break;
            }
        }
    }
    s_sheet_at = at;
    copy_text(s_sheet_focus_id, sizeof(s_sheet_focus_id), view->agents[stack[at]].id);
    sheet_mark_seen(view, stack, n);
    sheet_paint(view, stack, at, n);
    sheet_open();
}

static void sheet_drop_current(void) {
    int stack[DESK_AGENT_MAX];
    int n;
    char id[40];
    if (!s_applied || s_sheet_leaving || !s_sheet_up) {
        return;
    }
    n = sheet_collect(&s_applied_view, stack);
    if (n < 1 || s_sheet_at < 0 || s_sheet_at >= n) {
        s_sheet_leave_id[0] = '\0';
        sheet_leave();
        return;
    }
    copy_text(id, sizeof(id), s_applied_view.agents[stack[s_sheet_at]].id);
    if (n == 1) {
        copy_text(s_sheet_leave_id, sizeof(s_sheet_leave_id), id);
        sheet_leave();
        return;
    }
    sheet_skip_add(id);
    n = sheet_collect(&s_applied_view, stack);
    if (n < 1) {
        copy_text(s_sheet_leave_id, sizeof(s_sheet_leave_id), id);
        sheet_leave();
        return;
    }
    if (s_sheet_at >= n) {
        s_sheet_at = n - 1;
    }
    copy_text(s_sheet_focus_id, sizeof(s_sheet_focus_id), s_applied_view.agents[stack[s_sheet_at]].id);
    sheet_show(&s_applied_view, 0);
    if (s_on_dismiss) {
        s_on_dismiss(id);
    }
}

static void sheet_step(int dir) {
    int stack[DESK_AGENT_MAX];
    int n;
    int at;
    if (!s_applied || s_sheet_leaving || !s_sheet_up) {
        return;
    }
    n = sheet_collect(&s_applied_view, stack);
    at = s_sheet_at + dir;
    if (at < 0 || at >= n) {
        return;
    }
    s_sheet_at = at;
    copy_text(s_sheet_focus_id, sizeof(s_sheet_focus_id), s_applied_view.agents[stack[at]].id);
    sheet_show(&s_applied_view, 0);
}

static void on_dismiss_all(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED) {
        return;
    }
    s_sheet_dragged = 1;
    s_sheet_leave_id[0] = '\0';
    s_sheet_skip_n = 0;
    sheet_leave();
}

static void on_sheet(lv_event_t *event) {
    lv_indev_t *indev;
    lv_point_t point;
    lv_event_code_t code = lv_event_get_code(event);
    if (code == LV_EVENT_CLICKED) {
        /* A pan already decided. A flick dismisses from RELEASED. */
        if (!s_sheet_dragged) {
            sheet_drop_current();
        }
        s_sheet_dragged = 0;
        return;
    }
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    indev = lv_indev_get_act();
#else
    indev = lv_indev_active();
#endif
    if (!indev) {
        return;
    }
    lv_indev_get_point(indev, &point);
    if (code == LV_EVENT_PRESSED) {
        s_sheet_pressed = 1;
        s_sheet_dragged = 0;
        s_sheet_press_x = point.x;
        s_sheet_press_y = point.y;
        s_sheet_press_ms = lv_tick_get();
        return;
    }
    if (code != LV_EVENT_RELEASED || !s_sheet_pressed) {
        return;
    }
    s_sheet_pressed = 0;
    {
        int dx = point.x - s_sheet_press_x;
        int dy = point.y - s_sheet_press_y;
        int gesture;
        if (dx > 8 || dx < -8 || dy > 8 || dy < -8) {
            s_sheet_dragged = 1;
        }
        gesture = desk_sheet_gesture(sheet_overflow(), dx, dy, (int)(lv_tick_get() - s_sheet_press_ms));
        if (gesture == DESK_SHEET_DISMISS) {
            sheet_drop_current();
        } else if (gesture == DESK_SHEET_OLDER) {
            sheet_step(1);
        } else if (gesture == DESK_SHEET_NEWER) {
            sheet_step(-1);
        }
    }
}

static void present_sheet(const desk_view_t *view, int failures) {
    int stack[DESK_AGENT_MAX];
    int n;
    int show = view && view->needs_you && failures < 3 && !s_sheet_suppress;
    if (!show) {
        if (!s_sheet_leaving) {
            sheet_hide_now();
        }
        return;
    }
    n = sheet_collect(view, stack);
    sheet_show(view, sheet_fresh(view, stack, n));
}

static void on_unread(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || !s_on_clear_unread) {
        return;
    }
    s_on_clear_unread();
    show_unread(0);
    if (s_applied) {
        s_applied_view.unread = 0;
    }
}

static void mic_restore(lv_timer_t *timer) {
    (void)timer;
    s_mic_timer = NULL;
    if (s_message && s_applied) {
        show_note(centered_note(&s_applied_view));
    }
}

static void on_mic(lv_event_t *event) {
    (void)event;
    lv_label_set_text(s_message, "Voice not in this PoC");
    place_agents(1);
    if (s_mic_timer) {
        lv_timer_reset(s_mic_timer);
        return;
    }
    s_mic_timer = lv_timer_create(mic_restore, 6000, NULL);
    if (s_mic_timer) {
        lv_timer_set_repeat_count(s_mic_timer, 1);
    }
}

static void on_open_settings(lv_event_t *event) {
    (void)event;
    ui_open_settings();
}

static void on_scan_clicked(lv_event_t *event) {
    (void)event;
    hide_keyboard(1);
    if (s_on_scan) {
        s_on_scan();
    }
}

static void on_manual(lv_event_t *event) {
    (void)event;
    lv_obj_set_hidden(s_ssid_box, false);
    lv_obj_scroll_to_view(s_ssid_box, LV_ANIM_OFF);
}

static void on_save_clicked(lv_event_t *event) {
    (void)event;
    if (s_on_save) {
        s_on_save(lv_textarea_get_text(s_ssid), lv_textarea_get_text(s_pass),
                  lv_textarea_get_text(s_url), lv_textarea_get_text(s_token));
    }
}

static void flatten(lv_obj_t *obj) {
    lv_obj_set_style_bg_opa(obj, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(obj, 0, 0);
    lv_obj_set_style_pad_all(obj, 0, 0);
    lv_obj_set_style_radius(obj, 0, 0);
    lv_obj_set_style_shadow_width(obj, 0, 0);
}

static lv_obj_t *make_field(lv_obj_t *parent, const char *name, const char *placeholder, int secret,
                            lv_obj_t **box_out) {
    lv_obj_t *box = lv_obj_create(parent);
    lv_obj_t *label = lv_label_create(box);
    lv_obj_t *ta = lv_textarea_create(box);
    lv_obj_set_width(box, lv_pct(100));
    lv_obj_set_height(box, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_scrollable(box, false);
    flatten(box);
    lv_obj_set_style_pad_row(box, 4, 0);
    lv_label_set_text(label, name);
    style_text(label);
    lv_textarea_set_one_line(ta, true);
    lv_textarea_set_placeholder_text(ta, placeholder);
    if (secret) {
        lv_textarea_set_password_mode(ta, true);
    }
    lv_obj_set_width(ta, lv_pct(100));
    lv_obj_set_height(ta, 42);
    lv_obj_set_style_bg_color(ta, lv_color_hex(FIELD), 0);
    lv_obj_set_style_bg_opa(ta, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(ta, lv_color_hex(INK), 0);
    lv_obj_set_style_text_font(ta, &lv_font_montserrat_16, 0);
    lv_obj_set_style_border_color(ta, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(ta, 1, 0);
    lv_obj_set_style_radius(ta, 6, 0);
    lv_obj_set_style_text_color(ta, lv_color_hex(INK_DIM), LV_PART_TEXTAREA_PLACEHOLDER);
    lv_obj_set_style_border_color(ta, lv_color_hex(INK), LV_PART_CURSOR | LV_STATE_FOCUSED);
    lv_obj_add_event_cb(ta, on_field, LV_EVENT_ALL, NULL);
    if (box_out) {
        *box_out = box;
    }
    return ta;
}

static lv_obj_t *icon_button(lv_obj_t *parent, const lv_image_dsc_t *icon, lv_event_cb_t cb, int dim) {
    lv_obj_t *btn = lv_button_create(parent);
    lv_obj_t *img = lv_image_create(btn);
    lv_obj_set_style_bg_color(btn, lv_color_hex(dim ? 0x24261f : 0x3a3d32), 0);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(btn, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(btn, 1, 0);
    lv_obj_set_style_border_opa(btn, dim ? LV_OPA_40 : LV_OPA_COVER, 0);
    lv_obj_set_style_radius(btn, 6, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    lv_obj_set_style_pad_all(btn, 0, 0);
    lv_image_set_src(img, icon);
    lv_obj_set_style_image_recolor(img, lv_color_hex(INK), 0);
    lv_obj_set_style_image_recolor_opa(img, dim ? LV_OPA_50 : LV_OPA_COVER, 0);
    lv_obj_center(img);
    lv_obj_clear_flag(img, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(btn, cb, LV_EVENT_CLICKED, NULL);
    return btn;
}

static lv_obj_t *action_button(lv_obj_t *parent, const char *text, lv_event_cb_t cb) {
    lv_obj_t *btn = lv_button_create(parent);
    lv_obj_t *label = lv_label_create(btn);
    lv_obj_set_height(btn, 36);
    lv_obj_set_style_bg_color(btn, lv_color_hex(0x3a3d32), 0);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(btn, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(btn, 1, 0);
    lv_obj_set_style_radius(btn, 6, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    lv_obj_set_style_pad_hor(btn, 10, 0);
    lv_label_set_text(label, text);
    style_text(label);
    lv_obj_center(label);
    lv_obj_add_event_cb(btn, cb, LV_EVENT_CLICKED, NULL);
    return btn;
}

static void anim_delete(void *var) {
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    lv_anim_del(var, NULL);
#else
    lv_anim_delete(var, NULL);
#endif
}

static void sleep_bob(void *obj, int32_t v) {
    face_box_t box;
    face_sleep_widget((int)v, &box);
    lv_obj_set_pos(obj, box.x, box.y);
}

/* v is 0..100. Opacity is 0 at both ends so the repeat does not pop. */
static void sleep_zzz(void *obj, int32_t v) {
    int opa = LV_OPA_COVER;
    int rise = 0;
    if (v < 20) {
        opa = v * LV_OPA_COVER / 20;
    } else if (v > 80) {
        opa = (100 - v) * LV_OPA_COVER / 20;
        rise = 12;
    } else {
        rise = ((v - 20) * 12) / 60;
    }
    lv_obj_set_y(obj, face_zzz_y(rise));
    lv_obj_set_style_opa(obj, (lv_opa_t)opa, 0);
}

static void start_anim(lv_obj_t *obj, lv_anim_exec_xcb_t exec, int32_t from, int32_t to, uint32_t time,
                       int playback) {
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, obj);
    lv_anim_set_exec_cb(&a, exec);
    lv_anim_set_values(&a, from, to);
    lv_anim_set_duration(&a, time);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    if (playback) {
        lv_anim_set_playback_duration(&a, time);
        lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out);
    }
    lv_anim_start(&a);
}

/* Large face in the empty middle of the 480 panel. 16px bezel stays.
 * The bob and the Zzz stay inside the widget, so hide dirties every pixel. */
static void place_sleep(void) {
    face_box_t box;
    face_sleep_widget(0, &box);
    lv_obj_set_size(s_sleep, box.w, box.h);
    lv_obj_set_pos(s_sleep, box.x, box.y);
    lv_obj_set_size(s_head, FACE_SLEEP_HEAD, FACE_SLEEP_HEAD);
    lv_obj_set_size(s_eye_l, 22, 4);
    lv_obj_set_size(s_eye_r, 22, 4);
    lv_obj_align(s_eye_l, LV_ALIGN_CENTER, -16, 3);
    lv_obj_align(s_eye_r, LV_ALIGN_CENTER, 16, 3);
    lv_obj_set_style_text_font(s_zzz, &lv_font_montserrat_24, 0);
    lv_obj_align(s_head, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_set_pos(s_zzz, FACE_SLEEP_HEAD - 4, face_zzz_y(0));
}

static void sleep_stop(void) {
    if (!s_sleep) {
        return;
    }
    if (!s_asleep && lv_obj_has_flag(s_sleep, LV_OBJ_FLAG_HIDDEN)) {
        return;
    }
    anim_delete(s_sleep);
    anim_delete(s_zzz);
    s_asleep = 0;
    lv_obj_set_hidden(s_sleep, true);
}

static void sleep_show(void) {
    if (s_asleep) {
        return;
    }
    place_sleep();
    lv_obj_set_hidden(s_sleep, false);
    s_asleep = 1;
    lv_obj_set_style_opa(s_zzz, LV_OPA_TRANSP, 0);
    start_anim(s_sleep, sleep_bob, 0, FACE_SLEEP_BOB, 2200, 1);
    start_anim(s_zzz, sleep_zzz, 0, 100, 4200, 0);
}

/* The CO5300 rewrites the dirty window. A narrow one can miss the ring.
 * The band is the full width of the open face, so the next refresh paints
 * every one of those scanlines. The screen is already opaque. */
static void paint_face_band(void) {
    lv_area_t area;
    face_rect_t band;
    face_cover_band(&band);
    area.x1 = band.x1;
    area.y1 = band.y1;
    area.x2 = band.x2;
    area.y2 = band.y2;
    lv_obj_invalidate_area(lv_screen_active(), &area);
}

/* Gaps between rows are the list's own pixels. Opaque while agents are stored
 * so a later row update fills with the face color. */
static void cover_agents(int on) {
    on = on ? 1 : 0;
    if (!s_agent_box || s_list_cover == on) {
        return;
    }
    s_list_cover = on;
    lv_obj_set_style_bg_color(s_agent_box, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(s_agent_box, on ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
}

static void sync_sleep(const desk_view_t *view, int failures, int lamp) {
    int listed = view && view->known_count > 0;
    int asleep = lv_obj_is_hidden(s_settings) && desk_show_sleep(view, failures) && lamp != DESK_LAMP_RED;
    if (asleep) {
        cover_agents(0);
        sleep_show();
    } else {
        sleep_stop();
        cover_agents(listed);
    }
    if (s_face_asleep != asleep) {
        s_face_asleep = asleep;
        paint_face_band();
    }
}

static lv_obj_t *sleep_eye(lv_obj_t *parent) {
    lv_obj_t *bar = lv_obj_create(parent);
    lv_obj_set_style_bg_color(bar, lv_color_hex(INK_DIM), 0);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(bar, 0, 0);
    lv_obj_set_style_radius(bar, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_pad_all(bar, 0, 0);
    lv_obj_set_style_shadow_width(bar, 0, 0);
    lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    return bar;
}

static void build_sleep(lv_obj_t *screen) {
    s_sleep = lv_obj_create(screen);
    s_head = lv_obj_create(s_sleep);
    s_eye_l = sleep_eye(s_head);
    s_eye_r = sleep_eye(s_head);
    s_zzz = lv_label_create(s_sleep);
    flatten(s_sleep);
    lv_obj_clear_flag(s_sleep, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_radius(s_head, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(s_head, lv_color_hex(INK_DIM), 0);
    lv_obj_set_style_bg_opa(s_head, LV_OPA_20, 0);
    lv_obj_set_style_border_color(s_head, lv_color_hex(INK_DIM), 0);
    lv_obj_set_style_border_width(s_head, 3, 0);
    lv_obj_set_style_pad_all(s_head, 0, 0);
    lv_obj_set_style_shadow_width(s_head, 0, 0);
    lv_obj_clear_flag(s_head, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_label_set_text(s_zzz, "Zzz");
    lv_obj_set_style_text_color(s_zzz, lv_color_hex(INK_DIM), 0);
    lv_obj_clear_flag(s_zzz, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_hidden(s_sleep, true);
}

static void paint_rotlock(void) {
    if (!s_lock || !s_lock_label) {
        return;
    }
    lv_label_set_text(s_lock_label, s_rot_locked ? "Lock" : "Auto");
    lv_obj_set_style_bg_color(s_lock, lv_color_hex(s_rot_locked ? ROW_ON : 0x3a3d32), 0);
    lv_obj_set_style_border_color(s_lock, lv_color_hex(s_rot_locked ? ROW_MARK : FIELD_EDGE), 0);
}

static void on_rotlock(lv_event_t *event) {
    (void)event;
    s_rot_locked = !s_rot_locked;
    paint_rotlock();
    if (s_on_rotlock) {
        s_on_rotlock(s_rot_locked);
    }
}

static void toast_apply(int opacity, int shift) {
    if (!s_toast_label) {
        return;
    }
    if (s_toast_state.stage == DESK_TOAST_HIDDEN) {
        lv_label_set_text(s_toast_label, "grokbot-buddy");
        lv_obj_set_style_opa(s_toast_label, LV_OPA_COVER, 0);
        lv_obj_set_style_translate_y(s_toast_label, 0, 0);
        lv_obj_set_hidden(s_toast_label, false);
        return;
    }
    lv_label_set_text(s_toast_label, s_toast_state.showing);
    lv_obj_set_style_opa(s_toast_label, (lv_opa_t)opacity, 0);
    lv_obj_set_style_translate_y(s_toast_label, shift, 0);
    lv_obj_set_hidden(s_toast_label, opacity <= 0);
}

static void toast_cb(lv_timer_t *timer) {
    int opacity = 0;
    int shift = 0;
    int stage;
    (void)timer;
    stage = desk_toast_tick(&s_toast_state, 50, &opacity, &shift);
    toast_apply(opacity, shift);
    if (stage == DESK_TOAST_HIDDEN && s_toast_timer) {
        lv_timer_t *done = s_toast_timer;
        s_toast_timer = NULL;
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
        lv_timer_del(done);
#else
        lv_timer_delete(done);
#endif
    }
}

static void toast_kick(void) {
    if (!s_toast_timer) {
        s_toast_timer = lv_timer_create(toast_cb, 50, NULL);
    }
}

static void paint_bars(int bars) {
    int i;
    for (i = 0; i < 3; i++) {
        int on = i < bars;
        lv_obj_set_style_bg_color(s_wifi_bars[i], lv_color_hex(on ? INK : INK_DIM), 0);
        lv_obj_set_style_bg_opa(s_wifi_bars[i], on ? LV_OPA_COVER : LV_OPA_30, 0);
    }
}

static int present_status(const char *phase, int failures) {
    desk_glance_t glance;
    const char *text;
    uint32_t color = LAMP_AMBER;
    if (!s_lamp) {
        return DESK_LAMP_AMBER;
    }
    copy_text(s_phase_text, sizeof(s_phase_text), phase);
    s_fail_count = failures;
    glance = desk_glance(s_phase_text, failures, s_wifi_ip, s_wifi_retries, s_wifi_gave_up);
    if (glance.lamp == DESK_LAMP_GREEN) {
        color = ROW_MARK;
    } else if (glance.lamp == DESK_LAMP_RED) {
        color = LAMP_RED;
    }
    lv_obj_set_style_bg_color(s_lamp, lv_color_hex(color), 0);
    paint_bars(desk_wifi_bars(s_wifi_ip, s_wifi_rssi));
    s_last_lamp = glance.lamp;
    text = glance.text ? glance.text : "IDLE";
    if (!s_status_seen_ok) {
        copy_text(s_status_seen, sizeof(s_status_seen), text);
        s_status_seen_ok = 1;
        return glance.lamp;
    }
    if (strcmp(s_status_seen, text) != 0) {
        copy_text(s_status_seen, sizeof(s_status_seen), text);
        if (desk_toast_push(&s_toast_state, text)) {
            toast_kick();
        }
    }
    return glance.lamp;
}

/* Bluetooth is drawn struck through. The controller is not started. */
static void build_status_bar(lv_obj_t *screen) {
    lv_obj_t *cluster;
    lv_obj_t *wifi;
    lv_obj_t *bt;
    lv_obj_t *bt_label;
    lv_obj_t *strike;
    int i;
    lv_obj_t *bar;
    static const int heights[3] = {6, 10, 14};
    bar = lv_obj_create(screen);
    /* Strip meets the glass. Lamp and labels stay inside the 16px bezel. */
    lv_obj_set_size(bar, SCREEN_PX, EDGE_PX + BAR_H);
    lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, 0);
    flatten(bar);
    lv_obj_set_style_pad_top(bar, EDGE_PX, 0);
    lv_obj_set_style_pad_left(bar, EDGE_PX, 0);
    lv_obj_set_style_pad_right(bar, EDGE_PX, 0);
    lv_obj_set_style_bg_color(bar, lv_color_hex(DOCK), 0);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
    lv_obj_add_flag(bar, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

    s_lamp = lv_obj_create(bar);
    lv_obj_set_size(s_lamp, 14, 14);
    lv_obj_align(s_lamp, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_set_style_radius(s_lamp, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(s_lamp, lv_color_hex(LAMP_AMBER), 0);
    lv_obj_set_style_bg_opa(s_lamp, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(s_lamp, 0, 0);
    lv_obj_set_style_pad_all(s_lamp, 0, 0);
    lv_obj_set_style_shadow_width(s_lamp, 0, 0);
    lv_obj_clear_flag(s_lamp, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

    s_toast_label = lv_label_create(bar);
    lv_obj_set_width(s_toast_label, 168);
    lv_label_set_long_mode(s_toast_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(s_toast_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(s_toast_label, lv_color_hex(INK), 0);
    lv_obj_set_style_text_align(s_toast_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(s_toast_label, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(s_toast_label, LV_OBJ_FLAG_CLICKABLE);
    toast_apply(0, 0);

    cluster = lv_obj_create(bar);
    lv_obj_set_height(cluster, BAR_H);
    lv_obj_set_width(cluster, LV_SIZE_CONTENT);
    lv_obj_align(cluster, LV_ALIGN_RIGHT_MID, 0, 0);
    lv_obj_set_flex_flow(cluster, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(cluster, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(cluster, 8, 0);
    flatten(cluster);
    lv_obj_clear_flag(cluster, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

    wifi = lv_obj_create(cluster);
    lv_obj_set_size(wifi, 16, 14);
    flatten(wifi);
    lv_obj_clear_flag(wifi, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    for (i = 0; i < 3; i++) {
        s_wifi_bars[i] = lv_obj_create(wifi);
        lv_obj_set_size(s_wifi_bars[i], 4, heights[i]);
        lv_obj_align(s_wifi_bars[i], LV_ALIGN_BOTTOM_LEFT, i * 6, 0);
        lv_obj_set_style_radius(s_wifi_bars[i], 1, 0);
        lv_obj_set_style_border_width(s_wifi_bars[i], 0, 0);
        lv_obj_set_style_pad_all(s_wifi_bars[i], 0, 0);
        lv_obj_set_style_shadow_width(s_wifi_bars[i], 0, 0);
        lv_obj_clear_flag(s_wifi_bars[i], LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    }

    bt = lv_obj_create(cluster);
    lv_obj_set_size(bt, 28, 18);
    flatten(bt);
    lv_obj_clear_flag(bt, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    bt_label = lv_label_create(bt);
    lv_label_set_text(bt_label, "BT");
    lv_obj_set_style_text_font(bt_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(bt_label, lv_color_hex(INK_DIM), 0);
    lv_obj_set_style_opa(bt_label, LV_OPA_40, 0);
    lv_obj_center(bt_label);
    lv_obj_clear_flag(bt_label, LV_OBJ_FLAG_CLICKABLE);
    strike = lv_obj_create(bt);
    lv_obj_set_size(strike, 22, 1);
    lv_obj_set_style_bg_color(strike, lv_color_hex(INK_DIM), 0);
    lv_obj_set_style_bg_opa(strike, LV_OPA_50, 0);
    lv_obj_set_style_border_width(strike, 0, 0);
    lv_obj_set_style_radius(strike, 0, 0);
    lv_obj_set_style_pad_all(strike, 0, 0);
    lv_obj_align(strike, LV_ALIGN_CENTER, 0, 1);
    lv_obj_clear_flag(strike, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);

    s_lock = lv_button_create(cluster);
    s_lock_label = lv_label_create(s_lock);
    lv_obj_set_size(s_lock, 64, 28);
    lv_obj_set_style_bg_opa(s_lock, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(s_lock, 1, 0);
    lv_obj_set_style_radius(s_lock, 6, 0);
    lv_obj_set_style_shadow_width(s_lock, 0, 0);
    lv_obj_set_style_pad_hor(s_lock, 6, 0);
    lv_obj_set_style_text_font(s_lock_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(s_lock_label, lv_color_hex(INK), 0);
    lv_obj_center(s_lock_label);
    lv_obj_add_event_cb(s_lock, on_rotlock, LV_EVENT_CLICKED, NULL);
    paint_rotlock();
    paint_bars(0);
}

static void build_new_pill(lv_obj_t *screen);

static lv_obj_t *make_disc(lv_obj_t *parent, int size, lv_opa_t opa) {
    lv_obj_t *disc = lv_obj_create(parent);
    lv_obj_set_size(disc, size, size);
    lv_obj_set_style_radius(disc, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(disc, lv_color_hex(DESK_MARK_NEUTRAL), 0);
    lv_obj_set_style_bg_opa(disc, opa, 0);
    lv_obj_set_style_border_width(disc, 0, 0);
    lv_obj_set_style_outline_width(disc, 0, 0);
    lv_obj_set_style_shadow_width(disc, 0, 0);
    lv_obj_set_style_pad_all(disc, 0, 0);
    lv_obj_clear_flag(disc, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    return disc;
}

static lv_obj_t *make_peek(lv_obj_t *screen, int inset) {
    lv_obj_t *peek = lv_obj_create(screen);
    lv_obj_set_size(peek, SCREEN_PX - (inset * 2), 36 + SHEET_PEEK);
    lv_obj_set_pos(peek, inset, SCREEN_PX);
    lv_obj_set_style_bg_color(peek, lv_color_hex(0x16180f), 0);
    lv_obj_set_style_bg_opa(peek, PEEK_OPA, 0);
    lv_obj_set_style_radius(peek, 28, 0);
    lv_obj_set_style_border_width(peek, 2, 0);
    lv_obj_set_style_border_opa(peek, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(peek, lv_color_hex(DESK_MARK_NEUTRAL), 0);
    lv_obj_set_style_outline_width(peek, 0, 0);
    lv_obj_set_style_shadow_width(peek, 0, 0);
    lv_obj_clear_flag(peek, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(peek, LV_OBJ_FLAG_HIDDEN);
    return peek;
}

void ui_init(ui_save_fn on_save, void (*on_dismiss)(const char *agent_id), ui_scan_fn on_scan) {
    lv_obj_t *screen = lv_screen_active();
    static const desk_view_t blank;
    lv_obj_t *settings_btn;
    lv_obj_t *mic;
    lv_obj_t *dock;
    lv_obj_t *heading;
    lv_obj_t *manual;
    lv_obj_t *save;
    s_on_save = on_save;
    s_on_dismiss = on_dismiss;
    s_on_scan = on_scan;
    lv_obj_set_scrollable(screen, false);
    lv_obj_set_style_bg_color(screen, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    desk_toast_init(&s_toast_state);
    build_status_bar(screen);
    s_title = lv_label_create(screen);
    lv_obj_set_size(s_title, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_label_set_long_mode(s_title, LV_LABEL_LONG_CLIP);
    lv_obj_set_style_text_font(s_title, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(s_title, lv_color_hex(LAMP_AMBER), 0);
    lv_obj_set_style_bg_color(s_title, lv_color_hex(FIELD), 0);
    lv_obj_set_style_bg_opa(s_title, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(s_title, lv_color_hex(LAMP_AMBER), 0);
    lv_obj_set_style_border_width(s_title, 1, 0);
    lv_obj_set_style_radius(s_title, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_pad_hor(s_title, 10, 0);
    lv_obj_set_style_pad_ver(s_title, 0, 0);
    lv_obj_add_flag(s_title, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(s_title, on_unread, LV_EVENT_CLICKED, NULL);
    lv_obj_align(s_title, LV_ALIGN_TOP_MID, 0, TITLE_Y);
    lv_obj_set_hidden(s_title, true);
    s_message = lv_label_create(screen);
    lv_obj_set_width(s_message, SCREEN_PX - (EDGE_PX * 2));
    lv_label_set_long_mode(s_message, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(s_message, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_align(s_message, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(s_message, lv_color_hex(INK_DIM), 0);
    lv_obj_align(s_message, LV_ALIGN_TOP_MID, 0, MESSAGE_Y);
    /* Sleeper under the list. */
    build_sleep(screen);
    build_agent_rows(screen);
    dock = lv_obj_create(screen);
    lv_obj_set_size(dock, SCREEN_PX, BTN_H + EDGE_PX + DOCK_INSET + DOCK_GAP);
    lv_obj_align(dock, LV_ALIGN_BOTTOM_MID, 0, 0);
    flatten(dock);
    lv_obj_set_style_bg_color(dock, lv_color_hex(DOCK), 0);
    lv_obj_set_style_bg_opa(dock, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_top(dock, DOCK_GAP, 0);
    lv_obj_set_style_pad_hor(dock, EDGE_PX + DOCK_INSET, 0);
    lv_obj_set_style_pad_bottom(dock, EDGE_PX + DOCK_INSET, 0);
    lv_obj_set_flex_flow(dock, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(dock, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER,
                          LV_FLEX_ALIGN_CENTER);
    lv_obj_clear_flag(dock, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    mic = icon_button(dock, &desk_icon_mic, on_mic, 1);
    lv_obj_set_size(mic, BTN_W, BTN_H);
    s_count = lv_label_create(dock);
    lv_obj_set_style_text_font(s_count, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(s_count, lv_color_hex(INK_DIM), 0);
    settings_btn = icon_button(dock, &desk_icon_settings, on_open_settings, 0);
    lv_obj_set_size(settings_btn, BTN_W, BTN_H);
    build_new_pill(screen);

    /* Each card behind steps in 12px, then 24px, from the front card. */
    s_peek2 = make_peek(screen, SHEET_INSET + 24);
    s_peek1 = make_peek(screen, SHEET_INSET + 12);
    s_sheet_halo = lv_obj_create(screen);
    lv_obj_set_size(s_sheet_halo, SCREEN_PX - (SHEET_SAFE * 2),
                    (SHEET_BOTTOM - SHEET_Y) + SHEET_HALO_PX);
    lv_obj_set_pos(s_sheet_halo, SHEET_SAFE, SCREEN_PX);
    lv_obj_set_style_bg_color(s_sheet_halo, lv_color_hex(DESK_MARK_NEUTRAL), 0);
    lv_obj_set_style_bg_opa(s_sheet_halo, SHEET_HALO_OPA, 0);
    lv_obj_set_style_radius(s_sheet_halo, 36 + SHEET_HALO_PX, 0);
    lv_obj_set_style_border_width(s_sheet_halo, 0, 0);
    lv_obj_set_style_outline_width(s_sheet_halo, 0, 0);
    lv_obj_set_style_shadow_width(s_sheet_halo, 0, 0);
    lv_obj_set_style_pad_all(s_sheet_halo, 0, 0);
    lv_obj_clear_flag(s_sheet_halo, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(s_sheet_halo, LV_OBJ_FLAG_HIDDEN);
    s_sheet = lv_obj_create(screen);
    lv_obj_set_size(s_sheet, SCREEN_PX - (SHEET_INSET * 2), SHEET_BOTTOM - SHEET_Y);
    lv_obj_set_pos(s_sheet, SHEET_INSET, SCREEN_PX);
    lv_obj_set_style_bg_color(s_sheet, lv_color_hex(DOCK), 0);
    lv_obj_set_style_bg_opa(s_sheet, SHEET_OPA, 0);
    lv_obj_set_style_border_width(s_sheet, SHEET_BORDER, 0);
    lv_obj_set_style_border_opa(s_sheet, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(s_sheet, lv_color_hex(DESK_MARK_NEUTRAL), 0);
    lv_obj_set_style_outline_width(s_sheet, 0, 0);
    lv_obj_set_style_shadow_width(s_sheet, 0, 0);
    lv_obj_set_style_radius(s_sheet, 36, 0);
    lv_obj_set_style_pad_top(s_sheet, SHEET_PAD_TOP, 0);
    lv_obj_set_style_pad_hor(s_sheet, SHEET_PAD_H, 0);
    lv_obj_set_style_pad_bottom(s_sheet, SHEET_PAD_BOTTOM, 0);
    lv_obj_set_style_pad_row(s_sheet, SHEET_PAD_ROW, 0);
    lv_obj_set_flex_flow(s_sheet, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(s_sheet, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_scrollbar_mode(s_sheet, LV_SCROLLBAR_MODE_OFF);
    lv_obj_clear_flag(s_sheet, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(s_sheet, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(s_sheet, on_sheet, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(s_sheet, on_sheet, LV_EVENT_RELEASED, NULL);
    lv_obj_add_event_cb(s_sheet, on_sheet, LV_EVENT_CLICKED, NULL);
    lv_obj_set_hidden(s_sheet, true);
    s_sheet_glow = make_disc(s_sheet, SHEET_GLOW, SHEET_GLOW_OPA);
    s_sheet_glow_core = make_disc(s_sheet_glow, SHEET_GLOW_CORE, SHEET_GLOW_CORE_OPA);
    lv_obj_center(s_sheet_glow_core);
    s_sheet_mark = lv_obj_create(s_sheet_glow_core);
    lv_obj_set_size(s_sheet_mark, SHEET_MARK, SHEET_MARK);
    lv_obj_center(s_sheet_mark);
    lv_obj_set_style_border_width(s_sheet_mark, 0, 0);
    lv_obj_set_style_outline_width(s_sheet_mark, 0, 0);
    lv_obj_set_style_pad_all(s_sheet_mark, 0, 0);
    lv_obj_set_style_shadow_width(s_sheet_mark, 0, 0);
    lv_obj_clear_flag(s_sheet_mark, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(s_sheet_mark, draw_mark, LV_EVENT_DRAW_POST, NULL);
    apply_mark(s_sheet_mark, DESK_MARK_NEUTRAL, DESK_SHAPE_CIRCLE);
    s_sheet_count = lv_obj_create(s_sheet);
    s_sheet_count_label = lv_label_create(s_sheet_count);
    lv_obj_set_size(s_sheet_count, LV_SIZE_CONTENT, 32);
    lv_obj_set_style_bg_color(s_sheet_count, lv_color_hex(FIELD), 0);
    lv_obj_set_style_bg_opa(s_sheet_count, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(s_sheet_count, lv_color_hex(DESK_MARK_NEUTRAL), 0);
    lv_obj_set_style_border_width(s_sheet_count, 1, 0);
    lv_obj_set_style_radius(s_sheet_count, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_shadow_width(s_sheet_count, 0, 0);
    lv_obj_set_style_pad_hor(s_sheet_count, 14, 0);
    lv_obj_set_style_pad_ver(s_sheet_count, 0, 0);
    lv_label_set_text(s_sheet_count_label, "1 new");
    lv_obj_set_style_text_font(s_sheet_count_label, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(s_sheet_count_label, lv_color_hex(INK), 0);
    lv_obj_center(s_sheet_count_label);
    lv_obj_clear_flag(s_sheet_count, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    lv_obj_clear_flag(s_sheet_count_label, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(s_sheet_count, LV_OBJ_FLAG_HIDDEN);
    s_sheet_title = lv_label_create(s_sheet);
    lv_obj_set_width(s_sheet_title, lv_pct(100));
    lv_label_set_long_mode(s_sheet_title, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(s_sheet_title, &lv_font_montserrat_48, 0);
    lv_obj_set_style_text_color(s_sheet_title, lv_color_hex(INK), 0);
    lv_obj_set_style_text_align(s_sheet_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_text(s_sheet_title, "");
    s_sheet_body = lv_obj_create(s_sheet);
    lv_obj_set_width(s_sheet_body, lv_pct(100));
    lv_obj_set_flex_grow(s_sheet_body, 1);
    /* A long aside scrolls inside the body. The button stays on the card. */
    lv_obj_set_style_min_height(s_sheet_body, 0, 0);
    lv_obj_set_style_bg_opa(s_sheet_body, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(s_sheet_body, 0, 0);
    lv_obj_set_style_pad_all(s_sheet_body, 0, 0);
    lv_obj_set_scrollbar_mode(s_sheet_body, LV_SCROLLBAR_MODE_AUTO);
    lv_obj_set_scroll_dir(s_sheet_body, LV_DIR_VER);
    lv_obj_add_flag(s_sheet_body, LV_OBJ_FLAG_EVENT_BUBBLE);
    s_sheet_text = lv_label_create(s_sheet_body);
    lv_obj_set_width(s_sheet_text, lv_pct(100));
    lv_label_set_long_mode(s_sheet_text, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_font(s_sheet_text, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(s_sheet_text, lv_color_hex(INK), 0);
    lv_obj_set_style_text_align(s_sheet_text, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_text(s_sheet_text, "");
    lv_obj_add_flag(s_sheet_text, LV_OBJ_FLAG_EVENT_BUBBLE);
    s_sheet_all = lv_button_create(s_sheet);
    {
        lv_obj_t *all_label = lv_label_create(s_sheet_all);
        lv_obj_set_width(s_sheet_all, lv_pct(100));
        lv_obj_set_height(s_sheet_all, 44);
        lv_obj_set_style_bg_opa(s_sheet_all, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_color(s_sheet_all, lv_color_hex(FIELD_EDGE), 0);
        lv_obj_set_style_border_width(s_sheet_all, 1, 0);
        lv_obj_set_style_radius(s_sheet_all, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_shadow_width(s_sheet_all, 0, 0);
        lv_label_set_text(all_label, "Dismiss all");
        lv_obj_set_style_text_font(all_label, &lv_font_montserrat_20, 0);
        lv_obj_set_style_text_color(all_label, lv_color_hex(INK), 0);
        lv_obj_center(all_label);
        lv_obj_clear_flag(all_label, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_clear_flag(s_sheet_all, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_add_event_cb(s_sheet_all, on_dismiss_all, LV_EVENT_CLICKED, NULL);
        lv_obj_add_flag(s_sheet_all, LV_OBJ_FLAG_HIDDEN);
    }

    s_settings = lv_obj_create(screen);
    lv_obj_set_size(s_settings, SCREEN_PX, SCREEN_PX);
    lv_obj_set_flex_flow(s_settings, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_bg_color(s_settings, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(s_settings, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(s_settings, lv_color_hex(INK), 0);
    lv_obj_set_style_pad_all(s_settings, PAD_PX, 0);
    lv_obj_set_style_pad_row(s_settings, 6, 0);
    lv_obj_set_style_border_width(s_settings, 0, 0);
    lv_obj_set_style_radius(s_settings, 0, 0);
    lv_obj_set_scrollable(s_settings, false);
    lv_obj_set_hidden(s_settings, true);

    s_header = lv_obj_create(s_settings);
    lv_obj_set_width(s_header, lv_pct(100));
    lv_obj_set_height(s_header, HEADER_PX);
    lv_obj_set_flex_flow(s_header, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(s_header, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_scrollable(s_header, false);
    flatten(s_header);
    heading = lv_label_create(s_header);
    lv_label_set_text(heading, "Settings");
    lv_obj_set_style_text_color(heading, lv_color_hex(INK), 0);
    lv_obj_set_style_text_font(heading, &lv_font_montserrat_20, 0);
    action_button(s_header, "Done", on_done);
    action_button(s_header, "Scan", on_scan_clicked);

    s_body = lv_obj_create(s_settings);
    lv_obj_set_width(s_body, lv_pct(100));
    lv_obj_set_flex_flow(s_body, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_scrollbar_mode(s_body, LV_SCROLLBAR_MODE_AUTO);
    lv_obj_add_event_cb(s_body, on_body_clicked, LV_EVENT_CLICKED, NULL);
    flatten(s_body);
    lv_obj_set_style_pad_row(s_body, 8, 0);

    s_status = lv_label_create(s_body);
    lv_obj_set_width(s_status, lv_pct(100));
    lv_label_set_long_mode(s_status, LV_LABEL_LONG_WRAP);
    lv_label_set_text(s_status, "Scan to add a network. Others stay saved.");
    style_text(s_status);

    s_list = lv_obj_create(s_body);
    lv_obj_set_width(s_list, lv_pct(100));
    lv_obj_set_height(s_list, 132);
    lv_obj_set_flex_flow(s_list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(s_list, 4, 0);
    lv_obj_set_style_pad_row(s_list, 4, 0);
    lv_obj_set_style_bg_color(s_list, lv_color_hex(0x1c1e17), 0);
    lv_obj_set_style_bg_opa(s_list, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(s_list, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(s_list, 1, 0);
    lv_obj_set_style_radius(s_list, 8, 0);
    lv_obj_set_scrollbar_mode(s_list, LV_SCROLLBAR_MODE_AUTO);

    s_selected = lv_label_create(s_body);
    lv_obj_set_width(s_selected, lv_pct(100));
    lv_label_set_long_mode(s_selected, LV_LABEL_LONG_WRAP);
    lv_label_set_text(s_selected, "Selected: none");
    style_text(s_selected);

    s_pass = make_field(s_body, "Password", "Wi-Fi password", 1, NULL);
    s_url = make_field(s_body, "URL for this network", "http://192.168.4.30:8787", 0, NULL);
    s_token = make_field(s_body, "Token for this network", "optional", 0, NULL);
    manual = action_button(s_body, "Type SSID", on_manual);
    lv_obj_set_width(manual, lv_pct(100));
    s_ssid = make_field(s_body, "SSID", "Network name", 0, &s_ssid_box);
    lv_obj_set_hidden(s_ssid_box, true);
    save = action_button(s_body, "Save", on_save_clicked);
    lv_obj_set_width(save, lv_pct(100));
    lv_obj_set_height(save, 44);

    s_keyboard = lv_keyboard_create(screen);
    lv_obj_set_size(s_keyboard, SCREEN_PX - (EDGE_PX * 2), KEYBOARD_PX);
    lv_obj_align(s_keyboard, LV_ALIGN_BOTTOM_MID, 0, -EDGE_PX);
    lv_obj_set_hidden(s_keyboard, true);
    lv_obj_add_event_cb(s_keyboard, on_keyboard, LV_EVENT_READY, NULL);
    lv_obj_add_event_cb(s_keyboard, on_keyboard, LV_EVENT_CANCEL, NULL);
    layout_settings();
    ui_apply(&blank, 0);
}

void ui_bind_unread(void (*on_clear)(void)) {
    s_on_clear_unread = on_clear;
}

void ui_bind_rotlock(int locked, ui_rotlock_fn on_toggle) {
    s_rot_locked = locked ? 1 : 0;
    s_on_rotlock = on_toggle;
    paint_rotlock();
}

void ui_set_link(int has_ip, int rssi, int retries, int gave_up) {
    s_wifi_ip = has_ip ? 1 : 0;
    s_wifi_rssi = rssi;
    s_wifi_retries = retries;
    s_wifi_gave_up = gave_up ? 1 : 0;
    if (s_lamp) {
        present_status(s_phase_text[0] ? s_phase_text : "IDLE", s_fail_count);
    }
}

int ui_settings_is_open(void) {
    return s_settings && !lv_obj_has_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
}

void ui_open_settings(void) {
    sleep_stop();
    lv_obj_set_hidden(s_settings, false);
    lv_obj_move_foreground(s_settings);
    if (!lv_obj_is_hidden(s_keyboard)) {
        lv_obj_move_foreground(s_keyboard);
    }
    if (s_on_scan) {
        s_on_scan();
    }
}

void ui_set_fields(const desk_settings_t *settings) {
    if (!settings) {
        return;
    }
    copy_text(s_global_url, sizeof(s_global_url), settings->url);
    copy_text(s_global_token, sizeof(s_global_token), settings->token);
    lv_textarea_set_text(s_ssid, settings->ssid);
    lv_textarea_set_text(s_pass, "");
    lv_textarea_set_text(s_url, settings->url);
    lv_textarea_set_text(s_token, settings->token);
    set_selected_label(settings->ssid);
}

void ui_set_known(const wifi_store_t *store) {
    int i;
    s_known_count = 0;
    if (!store) {
        return;
    }
    copy_text(s_global_url, sizeof(s_global_url), store->url);
    copy_text(s_global_token, sizeof(s_global_token), store->token);
    for (i = 0; i < store->count && i < WIFI_NET_MAX; i++) {
        memset(&s_known[i], 0, sizeof(s_known[i]));
        copy_text(s_known[i].ssid, sizeof(s_known[i].ssid), store->nets[i].ssid);
        copy_text(s_known[i].url, sizeof(s_known[i].url), store->nets[i].url);
        copy_text(s_known[i].token, sizeof(s_known[i].token), store->nets[i].token);
        s_known_count++;
    }
}

void ui_set_settings_status(const char *text) {
    if (!s_status) {
        return;
    }
    lv_label_set_text(s_status, text && text[0] ? text : "");
}

void ui_show_panel_note(const char *phase, const char *message) {
    sleep_stop();
    if (!s_message) {
        return;
    }
    show_note(message);
    present_status(phase && phase[0] ? phase : "IDLE", s_fail_count);
}

void ui_show_scanning(void) {
    lv_label_set_text(s_status, "Scanning...");
    lv_obj_clean(s_list);
    s_row_count = 0;
}

void ui_show_networks(const net_ap_t *aps, int count) {
    const char *current;
    int i;
    lv_obj_clean(s_list);
    s_row_count = 0;
    if (count < 0 || !aps) {
        lv_label_set_text(s_status, "Scan failed. Tap Scan to retry.");
        return;
    }
    if (count == 0) {
        lv_label_set_text(s_status, "No networks. Tap Scan, or type an SSID.");
        return;
    }
    if (count > NET_SCAN_MAX) {
        count = NET_SCAN_MAX;
    }
    current = lv_textarea_get_text(s_ssid);
    lv_label_set_text_fmt(s_status, "%d networks", count);
    for (i = 0; i < count; i++) {
        s_aps[i] = aps[i];
        s_rows[i] = add_row(i);
        s_row_count++;
        if (current && current[0] && strcmp(current, aps[i].ssid) == 0) {
            style_row(s_rows[i], 1);
        }
    }
}

static void aside_drop_timer(void) {
    lv_timer_t *done;
    if (!s_aside_timer) {
        return;
    }
    done = s_aside_timer;
    s_aside_timer = NULL;
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    lv_timer_del(done);
#else
    lv_timer_delete(done);
#endif
}

static void aside_settle(lv_timer_t *timer) {
    lv_obj_t *aside = s_agent_aside[0];
    (void)timer;
    s_aside_timer = NULL;
    if (!aside) {
        return;
    }
    /* DOT clears expand, measures the line wrapped to the column, and grows
     * the label to that height. CLIP keeps the start of the line. */
    lv_obj_set_width(aside, s_aside_w[0]);
    lv_label_set_long_mode(aside, LV_LABEL_LONG_CLIP);
    lv_obj_set_style_text_align(aside, LV_TEXT_ALIGN_LEFT, 0);
    lv_obj_set_width(aside, s_aside_w[0]);
    pin_aside_line(aside);
}

static void aside_begin(void) {
    if (s_aside_timer) {
        lv_timer_reset(s_aside_timer);
        lv_timer_set_repeat_count(s_aside_timer, 1);
        return;
    }
    s_aside_timer = lv_timer_create(aside_settle, ASIDE_SCROLL_MS, NULL);
    if (s_aside_timer) {
        lv_timer_set_repeat_count(s_aside_timer, 1);
    }
}

static int agent_scrolled(void) {
    if (!s_agent_box) {
        return 0;
    }
    return lv_obj_get_scroll_y(s_agent_box) > 0;
}

static void show_unseen(void) {
    if (!s_new_btn) {
        return;
    }
    if (s_unseen < 1 || s_asleep || !agent_scrolled()) {
        lv_obj_set_hidden(s_new_btn, true);
        return;
    }
    if (s_unseen > 99) {
        lv_label_set_text(s_new_label, "99+ new");
    } else {
        lv_label_set_text_fmt(s_new_label, "%d new", s_unseen);
    }
    lv_obj_set_hidden(s_new_btn, false);
}

static void on_agent_scroll(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_SCROLL) {
        return;
    }
    if (!agent_scrolled()) {
        s_unseen = 0;
    }
    show_unseen();
}

static void on_new_jump(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || !s_agent_box) {
        return;
    }
    s_unseen = 0;
    lv_obj_scroll_to_y(s_agent_box, 0, LV_ANIM_OFF);
    show_unseen();
}

static void build_new_pill(lv_obj_t *screen) {
    s_new_btn = lv_button_create(screen);
    s_new_label = lv_label_create(s_new_btn);
    lv_obj_set_size(s_new_btn, LV_SIZE_CONTENT, 32);
    lv_obj_set_style_bg_color(s_new_btn, lv_color_hex(ROW_HOT), 0);
    lv_obj_set_style_bg_opa(s_new_btn, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(s_new_btn, lv_color_hex(ROW_MARK), 0);
    lv_obj_set_style_border_width(s_new_btn, 1, 0);
    lv_obj_set_style_radius(s_new_btn, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_shadow_width(s_new_btn, 0, 0);
    lv_obj_set_style_pad_hor(s_new_btn, 14, 0);
    lv_obj_set_style_pad_ver(s_new_btn, 0, 0);
    lv_label_set_text(s_new_label, "1 new");
    lv_obj_set_style_text_font(s_new_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(s_new_label, lv_color_hex(INK), 0);
    lv_obj_center(s_new_label);
    lv_obj_clear_flag(s_new_label, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_clear_flag(s_new_btn, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(s_new_btn, on_new_jump, LV_EVENT_CLICKED, NULL);
    lv_obj_align(s_new_btn, LV_ALIGN_TOP_MID, 0, AGENT_Y);
    lv_obj_set_hidden(s_new_btn, true);
    lv_obj_add_event_cb(s_agent_box, on_agent_scroll, LV_EVENT_SCROLL, NULL);
}

static void note_unseen(const desk_view_t *view) {
    int add = 0;
    if (s_applied && agent_scrolled()) {
        add = desk_unseen_updates(&s_applied_view, view);
    }
    if (!agent_scrolled()) {
        s_unseen = 0;
    } else if (add > 0) {
        s_unseen = s_unseen > 999 - add ? 999 : s_unseen + add;
    }
}

void ui_apply(const desk_view_t *view, int failures) {
    char count[32];
    int i;
    int lamp = present_status(desk_phase_label(view, failures), failures);
    int fresh;
    fresh = !s_applied || !desk_status_same(&s_applied_view, s_applied_failures, view, failures);
    if (fresh) {
        note_unseen(view);
    }
    if (!s_mic_timer) {
        const char *note = centered_note(view);
        if (fresh || strcmp(lv_label_get_text(s_message), note) != 0) {
            show_note(note);
        }
    }
    if (fresh) {
        show_unread(desk_unread_count(view));
        {
            int scroll_top = 0;
            if (view->agent_count > 0) {
                scroll_top = desk_aside_scroll(s_applied ? &s_applied_view : NULL, view);
            } else {
                aside_drop_timer();
            }
            for (i = 0; i < DESK_AGENT_MAX; i++) {
                const desk_agent_t *agent;
                uint32_t color = DESK_MARK_NEUTRAL;
                uint32_t parsed;
                const char *label;
                const char *aside = "";
                int hot;
                int scroll = 0;
                if (i >= view->agent_count) {
                    lv_obj_set_hidden(s_agent_rows[i], true);
                    continue;
                }
                agent = &view->agents[i];
                if (desk_mark_color(agent->color, &parsed) == 0) {
                    color = parsed;
                }
                apply_mark(s_agent_marks[i], color, desk_mark_shape(agent->shape));
                label = agent->title[0] ? agent->title : agent->id;
                lv_label_set_text(s_agent_labels[i], label[0] ? label : "agent");
                hot = desk_agent_hot(view, i, &aside);
                if (i == 0) {
                    scroll = scroll_top || (s_aside_timer && aside[0]);
                    if (scroll_top) {
                        aside_begin();
                    } else if (!scroll) {
                        aside_drop_timer();
                    }
                }
                lay_row_text(i, s_agent_labels[i], s_agent_aside[i], aside, scroll);
                lv_obj_set_style_bg_opa(s_agent_rows[i], hot ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
                lv_obj_set_style_border_width(s_agent_rows[i], hot ? 2 : 0, 0);
                lv_obj_set_style_text_color(s_agent_aside[i], lv_color_hex(hot ? ROW_HOT_INK : INK_DIM), 0);
                lv_obj_set_hidden(s_agent_rows[i], false);
            }
        }
        desk_count_text(view, count, sizeof(count));
        lv_label_set_text(s_count, count);
        lv_obj_set_style_text_color(
            s_count, lv_color_hex(view->running_count > 0 ? ROW_MARK : INK_DIM), 0);
        if (!agent_scrolled()) {
            s_unseen = 0;
        }
        s_applied_view = *view;
        s_applied_failures = failures;
        s_applied = 1;
    }
    /* Also when the desk is unchanged: a dismiss release clears suppress and
     * this is the only pass that can raise the sheet again. */
    present_sheet(view, failures);
    sync_sleep(view, failures, lamp);
    show_unseen();
}

int ui_status_current(const desk_view_t *view, int failures) {
    return s_applied && desk_status_same(&s_applied_view, s_applied_failures, view, failures);
}

void ui_release_sheet_suppress(void) {
    s_sheet_skip_n = 0;
    /* A sheet already sliding off keeps its suppress until that POST's fetch. */
    if (!s_sheet_leaving) {
        s_sheet_suppress = 0;
    }
}

int ui_capture_frame(uint8_t **pixels, int *stride) {
#if LV_USE_SNAPSHOT
    lv_draw_buf_t draw;
    uint32_t row;
    size_t bytes;
    uint8_t *raw;
    void *aligned;
    if (!pixels || !stride || ui_settings_is_open()) {
        return -1;
    }
    *pixels = NULL;
    *stride = 0;
    row = lv_draw_buf_width_to_stride(SCREEN_PX, LV_COLOR_FORMAT_RGB565);
    bytes = (size_t)row * (SCREEN_PX + 16);
    raw = heap_caps_aligned_alloc(64, bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!raw) {
        return -1;
    }
    aligned = lv_draw_buf_align(raw, LV_COLOR_FORMAT_RGB565);
    if (lv_draw_buf_init(&draw, SCREEN_PX, SCREEN_PX, LV_COLOR_FORMAT_RGB565, row, aligned,
                         (uint32_t)bytes) != LV_RESULT_OK ||
        lv_snapshot_take_to_draw_buf(lv_screen_active(), LV_COLOR_FORMAT_RGB565, &draw) !=
            LV_RESULT_OK) {
        heap_caps_free(raw);
        return -1;
    }
    if (aligned != raw) {
        /* The caller frees one pointer. Repack only when alignment slid the pixels. */
        memmove(raw, aligned, (size_t)row * SCREEN_PX);
    }
    *pixels = raw;
    *stride = (int)row;
    return 0;
#else
    (void)pixels;
    (void)stride;
    return -1;
#endif
}
