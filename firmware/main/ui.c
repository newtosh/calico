#include "ui.h"

#include "control_center.h"
#include "desk_status.h"
#include "face_cover.h"
#include "icons.h"
#include "idle_cat.h"
#include "idle_cat_anim.h"
#include "lvgl.h"
#include "settings_layout.h"

#include "esp_heap_caps.h"
#include "esp_random.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum {
    SCREEN_PX = 480,
    /* Bezel covers the rounded corners of the 480 panel. 16px clears them. */
    EDGE_PX = 16,
    KEYBOARD_PX = 200,
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
     * 16px bezel plus the 8px lip the dock already clears). The card stays
     * 30px in, so the rounded bottom and Dismiss all stay on the glass.
     * Three 2px rings step out from that stroke and stop on the case line. */
    SHEET_SAFE = EDGE_PX + DOCK_INSET,
    SHEET_Y = EDGE_PX + BAR_H,
    SHEET_RADIUS = 36,
    /* Same stroke on every side. The old 6px rim sat only on the sides and
     * bottom, so the bottom read as a thicker border. */
    SHEET_BORDER = 3,
    SHEET_RING_N = 3,
    SHEET_RING_W = 2,
    /* Outer ring first. Opacities are the border itself; the rings do not
     * overlap, so these are the fringe you see. */
    SHEET_RING_OUT0 = 6,
    SHEET_RING_OPA0 = 12,
    SHEET_RING_OUT1 = 4,
    SHEET_RING_OPA1 = 32,
    SHEET_RING_OUT2 = 2,
    SHEET_RING_OPA2 = 72,
    SHEET_INSET = SHEET_SAFE + SHEET_RING_OUT0,
    SHEET_BOTTOM = SCREEN_PX - SHEET_INSET,
    /* Inside the stroke: 3px at 36/255, then 7px at 14/255. */
    SHEET_INNER_NEAR = 3,
    SHEET_INNER_NEAR_OPA = 36,
    SHEET_INNER_FAR = 7,
    SHEET_INNER_FAR_OPA = 14,
    SHEET_MARK = 120,
    /* 98%. LV_OPA_90 (and the sim's 0.92) still left roster type readable. */
    SHEET_OPA = 250,
    PEEK_OPA = 242,
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
_Static_assert(SHEET_SAFE == 24, "outer glow meets the dock case line");
_Static_assert(SHEET_INSET == 30, "card border stays on the glass");
_Static_assert(SHEET_RING_OUT0 == SHEET_INSET - SHEET_SAFE, "outer ring ends on the case line");
_Static_assert(SHEET_RING_OUT0 - SHEET_RING_OUT1 == SHEET_RING_W, "mid ring tiles against the outer");
_Static_assert(SHEET_RING_OUT1 - SHEET_RING_OUT2 == SHEET_RING_W, "inner ring tiles against the mid");
_Static_assert(SHEET_RING_OUT2 == SHEET_RING_W, "inner ring starts at the stroke");
_Static_assert(SHEET_RING_OPA0 < SHEET_RING_OPA1 && SHEET_RING_OPA1 < SHEET_RING_OPA2,
               "glow fades as it leaves the card");
_Static_assert(SHEET_BORDER == 3, "stroke weight stays even on every side");
_Static_assert((int)SET_SCREEN == (int)SCREEN_PX, "settings screen");
_Static_assert((int)SET_EDGE == (int)EDGE_PX, "settings bezel");
_Static_assert((int)SET_DOCK_INSET == (int)DOCK_INSET, "settings lip");
_Static_assert((int)SET_INSET == (int)SHEET_SAFE, "settings uses the dock case line");
_Static_assert((int)SET_STROKE == (int)SHEET_BORDER, "settings card stroke matches the sheet");
_Static_assert(SET_CONTROL == 48, "settings finger target");
_Static_assert(SET_HEADER >= SET_CONTROL, "header holds Done");
_Static_assert(SET_LIST_H == 102, "scan list is two rows");
_Static_assert(SHEET_INNER_NEAR_OPA > SHEET_INNER_FAR_OPA, "inner highlight is stronger at the stroke");
_Static_assert(SHEET_MARK == MARK_PX * 5, "sheet mark is five times the list mark");
_Static_assert(SHEET_OPA >= 248, "sheet stays opaque enough to hide roster type");
_Static_assert((int)MESSAGE_Y == (int)FACE_MESSAGE_Y, "sleep origin");
_Static_assert(DESK_LINKDOWN_PX == FACE_LINKDOWN_ICON, "the link-down icon fills the space the layout reserves");
_Static_assert((int)CC_DOCK_TOP == (int)DOCK_TOP, "control center dock line");
_Static_assert((int)CC_OPEN_Y + (int)CC_PANEL_H == (int)SCREEN_PX, "control center meets the bottom edge");
_Static_assert((int)CC_GRAB == (int)EDGE_PX + (int)BAR_H, "grab is the status strip");
_Static_assert((int)CC_INSET == (int)SHEET_SAFE, "control center uses the case line");
_Static_assert((int)CC_STROKE == (int)SHEET_BORDER, "control center stroke");

static lv_obj_t *s_title;
static lv_obj_t *s_message;
static lv_obj_t *s_count;
static lv_obj_t *s_sheet;
static lv_obj_t *s_sheet_ring[SHEET_RING_N];
static const int k_sheet_ring_out[SHEET_RING_N] = {SHEET_RING_OUT0, SHEET_RING_OUT1, SHEET_RING_OUT2};
static const lv_opa_t k_sheet_ring_opa[SHEET_RING_N] = {SHEET_RING_OPA0, SHEET_RING_OPA1, SHEET_RING_OPA2};
static lv_obj_t *s_peek1;
static lv_obj_t *s_peek2;
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
static lv_obj_t *s_cat_ear;
static lv_obj_t *s_cat_tail;
static lv_timer_t *s_cat_timer;
static idle_cat_t s_cat;
static int s_asleep;
static lv_obj_t *s_linkdown;
static lv_obj_t *s_linkdown_caption;
static const char *s_linkdown_text;
/* What the face band shows: 0 the list, 1 the sleeping cat, 2 the link-down screen. */
static int s_face_mode = -1;
static int s_list_cover;
static lv_obj_t *s_bar;
static lv_obj_t *s_lamp;
static lv_obj_t *s_bar_title;
static lv_obj_t *s_wifi_bars[3];
static lv_obj_t *s_bt_icon;
static int s_bt_state;
static lv_obj_t *s_rot_ring;
static lv_obj_t *s_rot_lock;
static lv_obj_t *s_cc_scrim;
static lv_obj_t *s_cc_panel;
static lv_obj_t *s_cc_grab;
static lv_obj_t *s_cc_wifi;
static lv_obj_t *s_cc_bt;
static lv_obj_t *s_cc_rot;
static lv_obj_t *s_cc_mic;
static lv_obj_t *s_cc_spk;
static lv_obj_t *s_cc_wifi_state;
static lv_obj_t *s_cc_bt_state;
static lv_obj_t *s_cc_rot_state;
static lv_obj_t *s_cc_mic_state;
static lv_obj_t *s_cc_spk_state;
static lv_obj_t *s_cc_wifi_bars[3];
static lv_obj_t *s_cc_bt_icon;
static lv_obj_t *s_cc_rot_ring;
static lv_obj_t *s_cc_rot_lock;
static int s_cc_reveal;
static int s_cc_press_y;
static uint32_t s_cc_press_ms;
static desk_cc_t s_cc;
static int s_sta_on = 1;
static int s_mic_mute;
static int s_spk_mute;
static ui_toggle_fn s_on_sta;
static ui_toggle_fn s_on_bt;
/* The footer's centre label: the count, or what is wrong with the link. */
static char s_count_text[32] = "idle";
static int s_count_running;
static char s_footer_status[24];
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
static char s_phase_text[24];
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
static const int8_t k_hexagon[] = {12, 1, 22, 7, 22, 17, 12, 23, 2, 17, 2, 7};
/* Point-up triangle with the base corners pulled in. The picker triangle is
 * rounded there; a sharp corner at 24px reads as a spike. */
static const int8_t k_triangle[] = {12, 1, 22, 20, 20, 23, 4, 23, 2, 20};

/* Two eyes, each x,y,w,h on the 24px grid. The 120px card is five times this.
 * The default pair is a 3x4 block starting 7px down (upper face), with a 6px
 * gap. Narrow crowns move the pair into the body. Nothing here blinks. */
static const int8_t k_eyes[][8] = {
    [DESK_SHAPE_CIRCLE] = {6, 7, 3, 4, 15, 7, 3, 4},
    [DESK_SHAPE_SQUARE] = {6, 7, 3, 4, 15, 7, 3, 4},
    [DESK_SHAPE_DIAMOND] = {6, 8, 3, 4, 15, 8, 3, 4},
    [DESK_SHAPE_TRIANGLE] = {8, 12, 3, 3, 13, 12, 3, 3},
    [DESK_SHAPE_CLOUD] = {6, 10, 3, 4, 15, 10, 3, 4},
    [DESK_SHAPE_ROUNDED] = {6, 7, 3, 4, 15, 7, 3, 4},
    [DESK_SHAPE_STAR] = {8, 11, 2, 3, 14, 11, 2, 3},
    [DESK_SHAPE_FLOWER] = {5, 5, 3, 3, 16, 5, 3, 3},
    [DESK_SHAPE_HEART] = {5, 6, 3, 3, 16, 6, 3, 3},
    [DESK_SHAPE_BLOB] = {7, 9, 3, 3, 14, 9, 3, 3},
    [DESK_SHAPE_DROP] = {7, 13, 3, 4, 14, 13, 3, 4},
    [DESK_SHAPE_PILL] = {6, 9, 3, 3, 15, 9, 3, 3},
    [DESK_SHAPE_PENTAGON] = {7, 10, 3, 3, 14, 10, 3, 3},
    [DESK_SHAPE_SUN] = {7, 9, 3, 3, 14, 9, 3, 3},
    [DESK_SHAPE_HEXAGON] = {6, 9, 3, 4, 15, 9, 3, 4},
    [DESK_SHAPE_OVAL] = {6, 8, 3, 4, 15, 8, 3, 4},
};

/* Body divided by 6, so a bright swatch keeps a dark slit. A body darker
 * than luma 80 uses the cream ink so the pair still reads. */
static lv_color_t slit_ink(lv_color_t body) {
    lv_color32_t c = lv_color_to_32(body, LV_OPA_COVER);
    int luma = ((int)c.red * 3 + (int)c.green * 6 + (int)c.blue) / 10;
    if (luma < 80) {
        return lv_color_hex(0xefe7d6);
    }
    return lv_color_make((uint8_t)(c.red / 6), (uint8_t)(c.green / 6), (uint8_t)(c.blue / 6));
}

static void fill_slit(lv_layer_t *layer, lv_color_t color, int x, int y, int w, int h) {
    lv_draw_rect_dsc_t dsc;
    lv_area_t area;
    int radius;
    if (w < 1 || h < 1) {
        return;
    }
    radius = w < h ? w / 2 : h / 2;
    lv_draw_rect_dsc_init(&dsc);
    dsc.bg_color = color;
    dsc.bg_opa = LV_OPA_COVER;
    dsc.radius = radius;
    area.x1 = x;
    area.y1 = y;
    area.x2 = x + w - 1;
    area.y2 = y + h - 1;
    lv_draw_rect(layer, &dsc, &area);
}

static void draw_eyes(lv_layer_t *layer, const lv_area_t *box, int shape, lv_color_t body) {
    const int8_t *eye = k_eyes[DESK_SHAPE_CIRCLE];
    int side = mark_box(box);
    int i;
    lv_color_t ink;
    if (shape >= 0 && shape <= DESK_SHAPE_OVAL && k_eyes[shape][2] > 0) {
        eye = k_eyes[shape];
    }
    ink = slit_ink(body);
    for (i = 0; i < 2; i++) {
        const int8_t *e = eye + (i * 4);
        fill_slit(layer, ink, box->x1 + sc(e[0], side), box->y1 + sc(e[1], side), sc(e[2], side),
                  sc(e[3], side));
    }
}

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
    layer = lv_event_get_layer(event);
    if (!layer) {
        return;
    }
    lv_obj_get_coords(obj, &area);
    color = lv_obj_get_style_bg_color(obj, LV_PART_MAIN);
    if (shape != DESK_SHAPE_CIRCLE && shape != DESK_SHAPE_SQUARE && shape != DESK_SHAPE_ROUNDED) {
        paint_triangle(&dsc, color);
        x = area.x1;
        y = area.y1;
        cx = (area.x1 + area.x2) / 2;
        cy = (area.y1 + area.y2) / 2;
        if (shape == DESK_SHAPE_TRIANGLE) {
            fill_poly(layer, &dsc, &area, k_triangle, (int)(sizeof(k_triangle) / 2));
        } else if (shape == DESK_SHAPE_DIAMOND) {
            fill_tri(layer, &dsc, cx, area.y1, area.x2, cy, cx, area.y2);
            fill_tri(layer, &dsc, cx, area.y1, area.x1, cy, cx, area.y2);
        } else if (shape == DESK_SHAPE_CLOUD) {
            int w = mark_box(&area);
            fill_round(layer, color, x + sc(1, w), y + sc(10, w), sc(13, w), sc(13, w));
            fill_round(layer, color, x + sc(10, w), y + sc(9, w), sc(13, w), sc(13, w));
            fill_round(layer, color, x + sc(4, w), y + sc(3, w), sc(11, w), sc(11, w));
            fill_round(layer, color, x + sc(13, w), y + sc(6, w), sc(9, w), sc(9, w));
        } else if (shape == DESK_SHAPE_FLOWER) {
            int w = mark_box(&area);
            fill_round(layer, color, x + sc(1, w), y + sc(1, w), sc(12, w), sc(12, w));
            fill_round(layer, color, x + sc(11, w), y + sc(1, w), sc(12, w), sc(12, w));
            fill_round(layer, color, x + sc(1, w), y + sc(11, w), sc(12, w), sc(12, w));
            fill_round(layer, color, x + sc(11, w), y + sc(11, w), sc(12, w), sc(12, w));
        } else if (shape == DESK_SHAPE_HEART) {
            int w = mark_box(&area);
            fill_round(layer, color, x + sc(1, w), y + sc(3, w), sc(12, w), sc(12, w));
            fill_round(layer, color, x + sc(11, w), y + sc(3, w), sc(12, w), sc(12, w));
            fill_tri(layer, &dsc, x + sc(2, w), y + sc(10, w), x + sc(22, w), y + sc(10, w), x + sc(12, w),
                     y + sc(22, w));
        } else if (shape == DESK_SHAPE_DROP) {
            int w = mark_box(&area);
            fill_round(layer, color, x + sc(4, w), y + sc(8, w), sc(16, w), sc(16, w));
            fill_tri(layer, &dsc, x + sc(12, w), y + sc(1, w), x + sc(4, w), y + sc(14, w), x + sc(20, w),
                     y + sc(14, w));
        } else if (shape == DESK_SHAPE_PILL) {
            int w = mark_box(&area);
            fill_round(layer, color, x + sc(1, w), y + sc(6, w), sc(22, w), sc(13, w));
        } else if (shape == DESK_SHAPE_OVAL) {
            int w = mark_box(&area);
            fill_round(layer, color, x + sc(1, w), y + sc(3, w), sc(22, w), sc(18, w));
        } else if (shape == DESK_SHAPE_STAR) {
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
    draw_eyes(layer, &area, (int)shape, color);
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
    int open = s_keyboard && !lv_obj_has_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN);
    int h = SCREEN_PX - (SET_INSET * 2) - SET_HEADER - SET_GAP - (open ? KEYBOARD_PX : 0);
    if (h < 40) {
        h = 40;
    }
    lv_obj_set_height(s_body, h);
    if (s_list) {
        lv_obj_set_height(s_list, open ? SET_LIST_KB : SET_LIST_H);
    }
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
    lv_obj_set_size(s_keyboard, SCREEN_PX - (SET_INSET * 2), KEYBOARD_PX);
    lv_obj_align(s_keyboard, LV_ALIGN_BOTTOM_MID, 0, -SET_INSET);
    lv_obj_set_hidden(s_keyboard, false);
    lv_obj_move_foreground(s_keyboard);
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
    lv_obj_set_style_bg_color(btn, lv_color_hex(on ? ROW_ON : FIELD), 0);
    lv_obj_set_style_border_color(btn, lv_color_hex(ROW_MARK), 0);
    lv_obj_set_style_border_width(btn, on ? SET_ROW_STROKE : 0, 0);
    lv_obj_set_style_border_side(btn, LV_BORDER_SIDE_FULL, 0);
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
    lv_obj_set_height(btn, SET_CONTROL);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(btn, 12, 0);
    lv_obj_set_style_pad_hor(btn, 12, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    style_row(btn, 0);
    lv_label_set_text_fmt(label, "%s   %d", s_aps[index].ssid, (int)s_aps[index].rssi);
    lv_obj_set_width(label, lv_pct(100));
    lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
    style_text(label);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_20, 0);
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

static void sheet_rings_show(int show) {
    int i;
    for (i = 0; i < SHEET_RING_N; i++) {
        if (!s_sheet_ring[i]) {
            continue;
        }
        if (show) {
            lv_obj_clear_flag(s_sheet_ring[i], LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(s_sheet_ring[i], LV_OBJ_FLAG_HIDDEN);
        }
    }
}

static void sheet_place(int y) {
    int i;
    for (i = 0; i < SHEET_RING_N; i++) {
        if (s_sheet_ring[i]) {
            lv_obj_set_y(s_sheet_ring[i], y - k_sheet_ring_out[i]);
        }
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
    sheet_rings_show(0);
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
    sheet_rings_show(0);
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

static void cc_front(void);

static void sheet_front(void) {
    int i;
    /* Rings first, then the peeks, so a stack tab is not washed by the top glow. */
    for (i = 0; i < SHEET_RING_N; i++) {
        if (s_sheet_ring[i]) {
            lv_obj_move_foreground(s_sheet_ring[i]);
        }
    }
    if (s_peek2) {
        lv_obj_move_foreground(s_peek2);
    }
    if (s_peek1) {
        lv_obj_move_foreground(s_peek1);
    }
    if (s_sheet) {
        lv_obj_move_foreground(s_sheet);
    }
    if (s_settings && !lv_obj_has_flag(s_settings, LV_OBJ_FLAG_HIDDEN)) {
        lv_obj_move_foreground(s_settings);
    }
    cc_front();
}

static void sheet_rise(void) {
    lv_anim_t a;
    if (!s_sheet || s_sheet_up || s_sheet_leaving) {
        return;
    }
    s_sheet_up = 1;
    sheet_place(SHEET_PARK);
    lv_obj_set_hidden(s_sheet, false);
    sheet_rings_show(1);
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
    sheet_rings_show(1);
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
        int i;
        if (h < 1) {
            h = 1;
        }
        lv_obj_set_height(s_sheet, h);
        for (i = 0; i < SHEET_RING_N; i++) {
            if (s_sheet_ring[i]) {
                lv_obj_set_height(s_sheet_ring[i], h + (k_sheet_ring_out[i] * 2));
            }
        }
    }
    apply_mark(s_sheet_mark, color, desk_mark_shape(agent->shape));
    {
        int ring;
        for (ring = 0; ring < SHEET_RING_N; ring++) {
            if (s_sheet_ring[ring]) {
                lv_obj_set_style_border_color(s_sheet_ring[ring], lv_color_hex(color), 0);
            }
        }
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
    lv_obj_set_style_text_color(label, lv_color_hex(INK_DIM), 0);
    lv_textarea_set_one_line(ta, true);
    lv_textarea_set_placeholder_text(ta, placeholder);
    if (secret) {
        lv_textarea_set_password_mode(ta, true);
    }
    lv_obj_set_width(ta, lv_pct(100));
    lv_obj_set_height(ta, SET_CONTROL);
    lv_obj_set_style_bg_color(ta, lv_color_hex(FIELD), 0);
    lv_obj_set_style_bg_opa(ta, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(ta, lv_color_hex(INK), 0);
    lv_obj_set_style_text_font(ta, &lv_font_montserrat_20, 0);
    lv_obj_set_style_pad_hor(ta, 12, 0);
    lv_obj_set_style_pad_ver(ta, 8, 0);
    lv_obj_set_style_border_color(ta, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(ta, 1, 0);
    lv_obj_set_style_border_side(ta, LV_BORDER_SIDE_FULL, 0);
    lv_obj_set_style_radius(ta, 12, 0);
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
    lv_obj_set_height(btn, SET_CONTROL);
    lv_obj_set_style_bg_color(btn, lv_color_hex(0x3a3d32), 0);
    lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(btn, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(btn, 1, 0);
    lv_obj_set_style_border_side(btn, LV_BORDER_SIDE_FULL, 0);
    lv_obj_set_style_radius(btn, 12, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    lv_obj_set_style_pad_hor(btn, 12, 0);
    lv_label_set_text(label, text);
    style_text(label);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_20, 0);
    lv_obj_center(label);
    lv_obj_clear_flag(label, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(btn, cb, LV_EVENT_CLICKED, NULL);
    return btn;
}

static lv_obj_t *section_label(lv_obj_t *parent, const char *text) {
    lv_obj_t *label = lv_label_create(parent);
    lv_label_set_text(label, text);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(INK_DIM), 0);
    return label;
}

static void on_card_clicked(lv_event_t *event) {
    if (lv_event_get_target(event) != lv_event_get_current_target(event)) {
        return;
    }
    hide_keyboard(1);
}

/* Form card. Even stroke, same weight as the sheet, plus a faint outline.
 * No bottom rim and no sheet rings. */
static lv_obj_t *settings_card(lv_obj_t *parent) {
    lv_obj_t *card = lv_obj_create(parent);
    lv_obj_set_width(card, lv_pct(100));
    lv_obj_set_height(card, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(card, SET_CARD_PAD, 0);
    lv_obj_set_style_pad_row(card, SET_GAP, 0);
    lv_obj_set_style_bg_color(card, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(card, LV_OPA_COVER, 0);
    lv_obj_set_style_border_color(card, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(card, SET_STROKE, 0);
    lv_obj_set_style_border_side(card, LV_BORDER_SIDE_FULL, 0);
    lv_obj_set_style_radius(card, SET_CARD_R, 0);
    lv_obj_set_style_outline_width(card, SET_GLOW, 0);
    lv_obj_set_style_outline_color(card, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_outline_opa(card, 40, 0);
    lv_obj_set_style_outline_pad(card, SET_OUTLINE_PAD, 0);
    lv_obj_set_style_shadow_width(card, 0, 0);
    lv_obj_set_scrollable(card, false);
    lv_obj_add_event_cb(card, on_card_clicked, LV_EVENT_CLICKED, NULL);
    return card;
}

static void anim_delete(void *var) {
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    lv_anim_del(var, NULL);
#else
    lv_anim_delete(var, NULL);
#endif
}

/* Shows the next pose and asks again when its wait is over. Only the ear or the tail
 * changes, so the panel rewrites one small patch box, never the whole cat. */
static void cat_tick(lv_timer_t *timer) {
    idle_cat_pose_t pose = idle_cat_next(&s_cat, esp_random());
    lv_image_set_src(s_cat_ear, &idle_cat_ear_img[pose.ear]);
    lv_image_set_src(s_cat_tail, &idle_cat_tail_img[pose.tail]);
    lv_timer_set_period(timer, pose.wait_ms);
}

static void cat_timer_drop(void) {
    lv_timer_t *timer = s_cat_timer;
    if (!timer) {
        return;
    }
    s_cat_timer = NULL;
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    lv_timer_del(timer);
#else
    lv_timer_delete(timer);
#endif
}

/* The sleeping cat in the empty middle of the 480 panel. 16px bezel stays.
 * It is one fixed box, so hide dirties every pixel of it. */
static void place_sleep(void) {
    face_box_t box;
    face_sleep_widget(&box);
    lv_obj_set_size(s_sleep, box.w, box.h);
    lv_obj_set_pos(s_sleep, box.x, box.y);
}

static void sleep_stop(void) {
    if (!s_sleep) {
        return;
    }
    if (!s_asleep && lv_obj_has_flag(s_sleep, LV_OBJ_FLAG_HIDDEN)) {
        return;
    }
    cat_timer_drop();
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
    idle_cat_init(&s_cat);
    s_cat_timer = lv_timer_create(cat_tick, IDLE_CAT_REST_MIN_MS, NULL);
    cat_tick(s_cat_timer);
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

/* Link down with nothing listed: a cat-off icon and one line saying why. The caption
 * is set only when the reason changes, so a repeat apply does not redraw it. */
static void linkdown_show(void) {
    face_box_t box;
    const char *text = s_wifi_ip ? "Can't reach Calico" : "No Wi-Fi";
    if (lv_obj_is_hidden(s_linkdown)) {
        face_linkdown_widget(&box);
        lv_obj_set_size(s_linkdown, box.w, box.h);
        lv_obj_set_pos(s_linkdown, box.x, box.y);
        lv_obj_set_hidden(s_linkdown, false);
    }
    if (s_linkdown_text != text) {
        s_linkdown_text = text;
        lv_label_set_text_static(s_linkdown_caption, text);
    }
}

static void linkdown_hide(void) {
    if (s_linkdown && !lv_obj_is_hidden(s_linkdown)) {
        lv_obj_set_hidden(s_linkdown, true);
    }
}

/* Whatever the idle face is showing goes away: settings or a note takes the screen. */
static void face_idle_stop(void) {
    sleep_stop();
    linkdown_hide();
    s_face_mode = -1; /* the next sync repaints the band whatever it shows */
}

static void sync_sleep(const desk_view_t *view, int failures, int lamp) {
    int listed = view && view->known_count > 0;
    int closed = lv_obj_is_hidden(s_settings);
    int asleep = closed && desk_show_sleep(view, failures) && lamp != DESK_LAMP_RED;
    int down = closed && lamp == DESK_LAMP_RED && desk_roster_empty(view);
    int mode = asleep ? 1 : (down ? 2 : 0);
    if (asleep) {
        cover_agents(0);
        sleep_show();
    } else {
        sleep_stop();
        cover_agents(listed);
    }
    if (down) {
        linkdown_show();
    } else {
        linkdown_hide();
    }
    if (s_face_mode != mode) {
        s_face_mode = mode;
        paint_face_band();
    }
}

/* One piece of the cat: an A8 mask tinted the dim ink, so the idle screen stays quiet. */
static lv_obj_t *cat_piece(lv_obj_t *parent, const lv_image_dsc_t *img, int x, int y) {
    lv_obj_t *piece = lv_image_create(parent);
    lv_image_set_src(piece, img);
    lv_obj_set_pos(piece, x, y);
    lv_obj_set_style_image_recolor(piece, lv_color_hex(INK_DIM), 0);
    lv_obj_set_style_image_recolor_opa(piece, LV_OPA_COVER, 0);
    lv_obj_clear_flag(piece, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    return piece;
}

static void build_sleep(lv_obj_t *screen) {
    s_sleep = lv_obj_create(screen);
    flatten(s_sleep);
    lv_obj_clear_flag(s_sleep, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    cat_piece(s_sleep, &idle_cat_base_img, 0, 0);
    s_cat_ear = cat_piece(s_sleep, &idle_cat_ear_img[0], IDLE_CAT_EAR_X, IDLE_CAT_EAR_Y);
    s_cat_tail = cat_piece(s_sleep, &idle_cat_tail_img[0], IDLE_CAT_TAIL_X, IDLE_CAT_TAIL_Y);
    lv_obj_set_hidden(s_sleep, true);
}

static void build_linkdown(lv_obj_t *screen) {
    s_linkdown = lv_obj_create(screen);
    flatten(s_linkdown);
    lv_obj_clear_flag(s_linkdown, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    cat_piece(s_linkdown, &desk_icon_linkdown, (FACE_LINKDOWN_W - FACE_LINKDOWN_ICON) / 2, 0);
    s_linkdown_caption = lv_label_create(s_linkdown);
    lv_obj_set_width(s_linkdown_caption, FACE_LINKDOWN_W);
    lv_label_set_long_mode(s_linkdown_caption, LV_LABEL_LONG_CLIP);
    lv_obj_set_pos(s_linkdown_caption, 0, FACE_LINKDOWN_ICON + FACE_LINKDOWN_GAP);
    lv_obj_set_style_text_font(s_linkdown_caption, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_align(s_linkdown_caption, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(s_linkdown_caption, lv_color_hex(INK_DIM), 0);
    lv_obj_clear_flag(s_linkdown_caption, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_hidden(s_linkdown, true);
}

static void paint_tile(lv_obj_t *tile, int on) {
    lv_color_t bg = lv_color_hex(on ? ROW_ON : FIELD);
    lv_color_t edge = lv_color_hex(on ? ROW_MARK : FIELD_EDGE);
    if (!tile) {
        return;
    }
    lv_obj_set_style_bg_color(tile, bg, 0);
    lv_obj_set_style_bg_color(tile, bg, LV_STATE_PRESSED);
    lv_obj_set_style_border_color(tile, edge, 0);
    lv_obj_set_style_border_color(tile, edge, LV_STATE_PRESSED);
}

static lv_obj_t *glyph_frame(lv_obj_t *parent, int w, int h) {
    lv_obj_t *box = lv_obj_create(parent);
    lv_obj_set_size(box, w, h);
    flatten(box);
    lv_obj_clear_flag(box, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    return box;
}

static lv_obj_t *ink_rect(lv_obj_t *parent, int w, int h, int radius, int fill) {
    lv_obj_t *obj = lv_obj_create(parent);
    lv_obj_set_size(obj, w, h);
    lv_obj_set_style_radius(obj, radius, 0);
    lv_obj_set_style_bg_color(obj, lv_color_hex(INK), 0);
    lv_obj_set_style_bg_opa(obj, fill ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_color(obj, lv_color_hex(INK), 0);
    lv_obj_set_style_border_width(obj, fill ? 0 : 2, 0);
    lv_obj_set_style_pad_all(obj, 0, 0);
    lv_obj_set_style_shadow_width(obj, 0, 0);
    lv_obj_clear_flag(obj, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    return obj;
}

/* 04536e1 built the sheet and this glyph with mallocs at or under 512 bytes,
 * so they came out of the internal DMA block. esp_wifi_init then logged
 * "Expected to init 10 rx buffer, actual is 7" and aborted in wifi_bringup
 * (ESP_ERR_NO_MEM). Limit 0 sends the next objects to PSRAM. psram_objects_end
 * puts CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL back. NimBLE and the STA still
 * need that cut. Do not grow the stripe and do not drop the RX count. */
static void psram_objects_begin(void) {
    heap_caps_malloc_extmem_enable(0);
}

static void psram_objects_end(void) {
    heap_caps_malloc_extmem_enable(CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL);
}

/* Arrow-path while rotation may snap. Padlock while it is held. Not a button.
 * desk_icon_rot is the Heroicons outline (stroke 1.5, 24 viewBox) as A8 in
 * flash. Recolor makes it cream. The image object is a malloc, so callers
 * build this inside the PSRAM window. */
static lv_obj_t *make_rot_symbol(lv_obj_t *parent, int px, lv_obj_t **ring_out, lv_obj_t **lock_out) {
    lv_obj_t *box = glyph_frame(parent, px, px);
    lv_obj_t *ring = lv_image_create(box);
    lv_obj_t *lock = glyph_frame(box, px, px);
    lv_obj_t *shackle;
    lv_obj_t *body;
    int shackle_w = px / 2;
    int body_w = px - 4;
    if (shackle_w < 6) {
        shackle_w = 6;
    }
    if (body_w < 8) {
        body_w = 8;
    }
    lv_image_set_src(ring, &desk_icon_rot);
    lv_obj_set_style_image_recolor(ring, lv_color_hex(INK), 0);
    lv_obj_set_style_image_recolor_opa(ring, LV_OPA_COVER, 0);
    lv_obj_align(ring, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(ring, LV_OBJ_FLAG_CLICKABLE);
    shackle = lv_obj_create(lock);
    lv_obj_set_size(shackle, shackle_w, px / 2);
    lv_obj_align(shackle, LV_ALIGN_TOP_MID, 0, 0);
    lv_obj_set_style_radius(shackle, px / 4, 0);
    lv_obj_set_style_bg_opa(shackle, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(shackle, 2, 0);
    lv_obj_set_style_border_side(shackle,
                                LV_BORDER_SIDE_TOP | LV_BORDER_SIDE_LEFT | LV_BORDER_SIDE_RIGHT, 0);
    lv_obj_set_style_border_color(shackle, lv_color_hex(ROW_MARK), 0);
    lv_obj_set_style_pad_all(shackle, 0, 0);
    lv_obj_set_style_shadow_width(shackle, 0, 0);
    lv_obj_clear_flag(shackle, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    body = ink_rect(lock, body_w, px / 2, 2, 1);
    lv_obj_set_style_bg_color(body, lv_color_hex(ROW_MARK), 0);
    lv_obj_align(body, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_clear_flag(lock, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    if (ring_out) {
        *ring_out = ring;
    }
    if (lock_out) {
        *lock_out = lock;
    }
    return box;
}

static void cc_front(void) {
    if (s_cc_scrim) {
        lv_obj_move_foreground(s_cc_scrim);
    }
    if (s_cc_panel) {
        lv_obj_move_foreground(s_cc_panel);
    }
    if (s_bar) {
        lv_obj_move_foreground(s_bar);
    }
    if (s_cc_grab) {
        lv_obj_move_foreground(s_cc_grab);
    }
    if (s_settings && !lv_obj_has_flag(s_settings, LV_OBJ_FLAG_HIDDEN)) {
        lv_obj_move_foreground(s_settings);
        if (s_keyboard && !lv_obj_has_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN)) {
            lv_obj_move_foreground(s_keyboard);
        }
    }
}

static void cc_place(int reveal) {
    int y;
    int was_hidden = 1;
    if (reveal < 0) {
        reveal = 0;
    }
    if (reveal > CC_PANEL_H) {
        reveal = CC_PANEL_H;
    }
    s_cc_reveal = reveal;
    /* Top stays under the strip. Height grows to the bottom edge, so the
     * tiles lead and the empty glass follows. Sliding a full-height sheet
     * would show that empty glass first. */
    y = CC_OPEN_Y;
    if (s_cc_panel) {
        was_hidden = lv_obj_has_flag(s_cc_panel, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_y(s_cc_panel, y);
        if (reveal > 0) {
            lv_obj_set_height(s_cc_panel, reveal);
        }
    }
    if (!s_cc_scrim || !s_cc_panel) {
        return;
    }
    if (reveal <= 0) {
        lv_obj_add_flag(s_cc_scrim, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(s_cc_panel, LV_OBJ_FLAG_HIDDEN);
        return;
    }
    lv_obj_clear_flag(s_cc_scrim, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(s_cc_panel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_style_bg_opa(s_cc_scrim, (lv_opa_t)(reveal * 120 / CC_PANEL_H), 0);
    if (was_hidden) {
        cc_front();
    }
}

static void cc_anim_exec(void *obj, int32_t value) {
    (void)obj;
    cc_place((int)value);
}

static void cc_animate(int to) {
    lv_anim_t anim;
    if (!s_cc_panel || s_cc_reveal == to) {
        cc_place(to);
        return;
    }
    anim_delete(s_cc_panel);
    lv_anim_init(&anim);
    lv_anim_set_var(&anim, s_cc_panel);
    lv_anim_set_exec_cb(&anim, cc_anim_exec);
    lv_anim_set_values(&anim, s_cc_reveal, to);
    lv_anim_set_duration(&anim, 220);
    lv_anim_set_path_cb(&anim, lv_anim_path_ease_out);
    lv_anim_start(&anim);
}

static void cc_close_now(void) {
    desk_cc_init(&s_cc);
    if (s_cc_panel) {
        anim_delete(s_cc_panel);
    }
    cc_place(0);
}

static int cc_read_point(lv_point_t *point) {
    lv_indev_t *indev;
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    indev = lv_indev_get_act();
#else
    indev = lv_indev_active();
#endif
    if (!indev) {
        return 0;
    }
    lv_indev_get_point(indev, point);
    return 1;
}

static void on_cc(lv_event_t *event) {
    lv_point_t point;
    lv_event_code_t code = lv_event_get_code(event);
    int kind = (int)(intptr_t)lv_event_get_user_data(event);
    int pressed;
    int dy = 0;
    int dt = 0;
    int decision;
    if (code != LV_EVENT_PRESSED && code != LV_EVENT_PRESSING && code != LV_EVENT_RELEASED) {
        return;
    }
    if (ui_settings_is_open()) {
        return;
    }
    if (!cc_read_point(&point)) {
        return;
    }
    pressed = code != LV_EVENT_RELEASED;
    if (pressed && !s_cc.down) {
        s_cc_press_y = point.y;
        s_cc_press_ms = lv_tick_get();
    }
    dy = point.y - s_cc_press_y;
    if (!pressed) {
        dt = (int)(lv_tick_get() - s_cc_press_ms);
    }
    decision = desk_cc_pointer(&s_cc, pressed, kind == 1, kind == 2, kind == 3, dy, dt, s_cc_reveal);
    if (pressed) {
        if (s_cc_panel) {
            anim_delete(s_cc_panel);
        }
        cc_place(desk_cc_reveal(&s_cc));
        return;
    }
    if (decision == DESK_CC_NONE && desk_cc_reveal(&s_cc) == s_cc_reveal) {
        return;
    }
    cc_animate(desk_cc_reveal(&s_cc));
}

static void bind_cc(lv_obj_t *obj, int kind) {
    void *user = (void *)(intptr_t)kind;
    lv_obj_add_event_cb(obj, on_cc, LV_EVENT_PRESSED, user);
    lv_obj_add_event_cb(obj, on_cc, LV_EVENT_PRESSING, user);
    lv_obj_add_event_cb(obj, on_cc, LV_EVENT_RELEASED, user);
}

static void paint_cc_sta(void) {
    int i;
    if (s_cc_wifi) {
        paint_tile(s_cc_wifi, s_sta_on);
    }
    if (s_cc_wifi_state) {
        lv_label_set_text(s_cc_wifi_state, s_sta_on ? "On" : "Off");
    }
    for (i = 0; i < 3; i++) {
        if (!s_cc_wifi_bars[i]) {
            continue;
        }
        lv_obj_set_style_bg_opa(s_cc_wifi_bars[i], s_sta_on ? LV_OPA_COVER : LV_OPA_30, 0);
    }
}

static void paint_cc_bt(void) {
    int on = s_bt_state != 0;
    uint32_t color = INK_DIM;
    if (s_cc_bt) {
        paint_tile(s_cc_bt, on);
    }
    if (s_bt_state == 2) {
        color = ROW_MARK;
    } else if (on) {
        color = INK;
    }
    if (s_cc_bt_icon) {
        lv_image_set_src(s_cc_bt_icon, on ? &desk_icon_bt_on : &desk_icon_bt);
        lv_obj_set_style_image_recolor(s_cc_bt_icon, lv_color_hex(color), 0);
        lv_obj_set_style_image_recolor_opa(s_cc_bt_icon, LV_OPA_COVER, 0);
        lv_obj_set_style_opa(s_cc_bt_icon, on ? LV_OPA_COVER : LV_OPA_40, 0);
    }
    if (s_cc_bt_state) {
        lv_label_set_text(s_cc_bt_state, on ? "On" : "Off");
    }
}

static void paint_cc_mute(void) {
    if (s_cc_mic) {
        paint_tile(s_cc_mic, s_mic_mute);
    }
    if (s_cc_mic_state) {
        lv_label_set_text(s_cc_mic_state, s_mic_mute ? "Muted" : "On");
    }
    if (s_cc_spk) {
        paint_tile(s_cc_spk, s_spk_mute);
    }
    if (s_cc_spk_state) {
        lv_label_set_text(s_cc_spk_state, s_spk_mute ? "Muted" : "On");
    }
}

static void paint_rotlock(void) {
    if (s_rot_ring) {
        lv_obj_set_hidden(s_rot_ring, s_rot_locked ? true : false);
    }
    if (s_rot_lock) {
        lv_obj_set_hidden(s_rot_lock, s_rot_locked ? false : true);
    }
    if (s_cc_rot_ring) {
        lv_obj_set_hidden(s_cc_rot_ring, s_rot_locked ? true : false);
    }
    if (s_cc_rot_lock) {
        lv_obj_set_hidden(s_cc_rot_lock, s_rot_locked ? false : true);
    }
    if (s_cc_rot) {
        paint_tile(s_cc_rot, s_rot_locked);
    }
    if (s_cc_rot_state) {
        lv_label_set_text(s_cc_rot_state, s_rot_locked ? "Lock" : "Auto");
    }
}

static void on_cc_sta(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || desk_cc_ate_click(&s_cc)) {
        return;
    }
    s_sta_on = !s_sta_on;
    paint_cc_sta();
    if (s_on_sta) {
        s_on_sta(s_sta_on);
    }
}

static void on_cc_bt(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || desk_cc_ate_click(&s_cc)) {
        return;
    }
    if (s_on_bt) {
        s_on_bt(s_bt_state == 0);
    }
}

static void on_cc_rot(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || desk_cc_ate_click(&s_cc)) {
        return;
    }
    s_rot_locked = !s_rot_locked;
    paint_rotlock();
    if (s_on_rotlock) {
        s_on_rotlock(s_rot_locked);
    }
}

static void on_cc_mic(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || desk_cc_ate_click(&s_cc)) {
        return;
    }
    /* TODO: no mic codec on this board. The tile only flips its glass. */
    s_mic_mute = !s_mic_mute;
    paint_cc_mute();
}

static void on_cc_spk(lv_event_t *event) {
    if (lv_event_get_code(event) != LV_EVENT_CLICKED || desk_cc_ate_click(&s_cc)) {
        return;
    }
    /* TODO: no speaker path on this board. The tile only flips its glass. */
    s_spk_mute = !s_spk_mute;
    paint_cc_mute();
}

static lv_obj_t *cc_row(lv_obj_t *panel) {
    lv_obj_t *row = lv_obj_create(panel);
    lv_obj_set_width(row, lv_pct(100));
    lv_obj_set_height(row, CC_TILE_H);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(row, CC_GAP, 0);
    flatten(row);
    lv_obj_set_style_pad_column(row, CC_GAP, 0);
    lv_obj_clear_flag(row, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(row, LV_OBJ_FLAG_EVENT_BUBBLE);
    return row;
}

static lv_obj_t *cc_tile(lv_obj_t *row, lv_event_cb_t cb) {
    lv_obj_t *tile = lv_button_create(row);
    lv_obj_set_size(tile, CC_TILE_W, CC_TILE_H);
    lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(tile, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_all(tile, 4, 0);
    lv_obj_set_style_pad_row(tile, 0, 0);
    lv_obj_set_style_radius(tile, SET_CARD_R, 0);
    lv_obj_set_style_border_width(tile, 2, 0);
    lv_obj_set_style_border_side(tile, LV_BORDER_SIDE_FULL, 0);
    lv_obj_set_style_shadow_width(tile, 0, 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_clear_flag(tile, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(tile, LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_add_event_cb(tile, cb, LV_EVENT_CLICKED, NULL);
    paint_tile(tile, 0);
    return tile;
}

static void cc_caption(lv_obj_t *tile, const char *name, lv_obj_t **state_out) {
    lv_obj_t *label = lv_label_create(tile);
    lv_obj_t *state = lv_label_create(tile);
    lv_label_set_text(label, name);
    lv_obj_set_style_text_font(label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(INK), 0);
    lv_obj_clear_flag(label, LV_OBJ_FLAG_CLICKABLE);
    lv_label_set_text(state, "Off");
    lv_obj_set_style_text_font(state, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(state, lv_color_hex(INK_DIM), 0);
    lv_obj_clear_flag(state, LV_OBJ_FLAG_CLICKABLE);
    if (state_out) {
        *state_out = state;
    }
}

static void cc_wifi_glyph(lv_obj_t *tile) {
    lv_obj_t *box = glyph_frame(tile, 16, 14);
    static const int heights[3] = {6, 10, 14};
    int i;
    for (i = 0; i < 3; i++) {
        s_cc_wifi_bars[i] = ink_rect(box, 4, heights[i], 1, 1);
        lv_obj_align(s_cc_wifi_bars[i], LV_ALIGN_BOTTOM_LEFT, i * 6, 0);
    }
}

static void cc_mic_glyph(lv_obj_t *tile) {
    lv_obj_t *box = glyph_frame(tile, 22, 18);
    lv_obj_t *capsule = ink_rect(box, 8, 12, LV_RADIUS_CIRCLE, 0);
    lv_obj_t *stem = ink_rect(box, 2, 4, 1, 1);
    lv_obj_t *base = ink_rect(box, 10, 2, 1, 1);
    lv_obj_align(capsule, LV_ALIGN_TOP_MID, 0, 0);
    lv_obj_align(stem, LV_ALIGN_BOTTOM_MID, 0, -2);
    lv_obj_align(base, LV_ALIGN_BOTTOM_MID, 0, 0);
}

static void cc_spk_glyph(lv_obj_t *tile) {
    lv_obj_t *box = glyph_frame(tile, 22, 16);
    lv_obj_t *body = ink_rect(box, 7, 10, 2, 1);
    lv_obj_t *near = ink_rect(box, 2, 8, 1, 1);
    lv_obj_t *far = ink_rect(box, 2, 12, 1, 1);
    lv_obj_align(body, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_align(near, LV_ALIGN_LEFT_MID, 10, 0);
    lv_obj_align(far, LV_ALIGN_LEFT_MID, 15, 0);
}

static void build_control_center(lv_obj_t *screen) {
    lv_obj_t *row;
    desk_cc_init(&s_cc);
    s_cc_scrim = lv_obj_create(screen);
    lv_obj_set_size(s_cc_scrim, SCREEN_PX, SCREEN_PX);
    lv_obj_set_pos(s_cc_scrim, 0, 0);
    lv_obj_set_style_bg_color(s_cc_scrim, lv_color_hex(0), 0);
    lv_obj_set_style_bg_opa(s_cc_scrim, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(s_cc_scrim, 0, 0);
    lv_obj_set_style_radius(s_cc_scrim, 0, 0);
    lv_obj_set_style_pad_all(s_cc_scrim, 0, 0);
    lv_obj_set_style_shadow_width(s_cc_scrim, 0, 0);
    lv_obj_clear_flag(s_cc_scrim, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(s_cc_scrim, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_HIDDEN);
    bind_cc(s_cc_scrim, 3);

    s_cc_panel = lv_obj_create(screen);
    lv_obj_set_size(s_cc_panel, CC_PANEL_W, CC_PANEL_H);
    lv_obj_set_x(s_cc_panel, CC_INSET);
    lv_obj_set_style_bg_color(s_cc_panel, lv_color_hex(DOCK), 0);
    lv_obj_set_style_bg_opa(s_cc_panel, SHEET_OPA, 0);
    lv_obj_set_style_border_color(s_cc_panel, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_border_width(s_cc_panel, CC_STROKE, 0);
    lv_obj_set_style_border_side(s_cc_panel, LV_BORDER_SIDE_FULL, 0);
    lv_obj_set_style_radius(s_cc_panel, CC_RADIUS, 0);
    lv_obj_set_style_outline_width(s_cc_panel, SET_GLOW, 0);
    lv_obj_set_style_outline_color(s_cc_panel, lv_color_hex(FIELD_EDGE), 0);
    lv_obj_set_style_outline_opa(s_cc_panel, 40, 0);
    lv_obj_set_style_outline_pad(s_cc_panel, SET_OUTLINE_PAD, 0);
    lv_obj_set_style_shadow_width(s_cc_panel, 0, 0);
    lv_obj_set_style_pad_all(s_cc_panel, CC_PAD, 0);
    lv_obj_set_style_pad_row(s_cc_panel, CC_GAP, 0);
    lv_obj_set_flex_flow(s_cc_panel, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(s_cc_panel, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    lv_obj_clear_flag(s_cc_panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(s_cc_panel, LV_OBJ_FLAG_CLICKABLE);
    bind_cc(s_cc_panel, 2);

    row = cc_row(s_cc_panel);
    s_cc_wifi = cc_tile(row, on_cc_sta);
    cc_wifi_glyph(s_cc_wifi);
    cc_caption(s_cc_wifi, "Wi-Fi", &s_cc_wifi_state);
    s_cc_bt = cc_tile(row, on_cc_bt);
    s_cc_bt_icon = lv_image_create(s_cc_bt);
    lv_obj_clear_flag(s_cc_bt_icon, LV_OBJ_FLAG_CLICKABLE);
    cc_caption(s_cc_bt, "Bluetooth", &s_cc_bt_state);

    row = cc_row(s_cc_panel);
    s_cc_rot = cc_tile(row, on_cc_rot);
    make_rot_symbol(s_cc_rot, DESK_ROT_PX, &s_cc_rot_ring, &s_cc_rot_lock);
    cc_caption(s_cc_rot, "Rotation", &s_cc_rot_state);
    s_cc_mic = cc_tile(row, on_cc_mic);
    cc_mic_glyph(s_cc_mic);
    cc_caption(s_cc_mic, "Mic", &s_cc_mic_state);

    row = cc_row(s_cc_panel);
    s_cc_spk = cc_tile(row, on_cc_spk);
    cc_spk_glyph(s_cc_spk);
    cc_caption(s_cc_spk, "Speaker", &s_cc_spk_state);

    s_cc_grab = lv_obj_create(screen);
    lv_obj_set_size(s_cc_grab, SCREEN_PX, CC_GRAB);
    lv_obj_set_pos(s_cc_grab, 0, 0);
    flatten(s_cc_grab);
    lv_obj_add_flag(s_cc_grab, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_clear_flag(s_cc_grab, LV_OBJ_FLAG_SCROLLABLE);
    bind_cc(s_cc_grab, 1);

    paint_cc_sta();
    paint_cc_bt();
    paint_cc_mute();
    paint_rotlock();
    cc_place(0);
    cc_front();
}

/* The count in the footer, unless the link is in trouble: then it says so, in the lamp's color. */
static void paint_footer(void) {
    if (!s_count) {
        return;
    }
    if (s_footer_status[0]) {
        lv_label_set_text(s_count, s_footer_status);
        lv_obj_set_style_text_color(
            s_count, lv_color_hex(s_last_lamp == DESK_LAMP_RED ? LAMP_RED : LAMP_AMBER), 0);
        return;
    }
    lv_label_set_text(s_count, s_count_text);
    lv_obj_set_style_text_color(s_count, lv_color_hex(s_count_running ? ROW_MARK : INK_DIM), 0);
}

static void paint_bt(void) {
    int on = s_bt_state != 0;
    uint32_t color = INK_DIM;
    if (!s_bt_icon) {
        return;
    }
    if (s_bt_state == 2) {
        color = ROW_MARK;
    } else if (on) {
        color = INK;
    }
    lv_image_set_src(s_bt_icon, on ? &desk_icon_bt_on : &desk_icon_bt);
    lv_obj_set_style_image_recolor(s_bt_icon, lv_color_hex(color), 0);
    lv_obj_set_style_image_recolor_opa(s_bt_icon, LV_OPA_COVER, 0);
    lv_obj_set_style_opa(s_bt_icon, on ? LV_OPA_COVER : LV_OPA_40, 0);
    paint_cc_bt();
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
    {
        const char *trouble = desk_footer_status(&glance);
        copy_text(s_footer_status, sizeof(s_footer_status), trouble ? trouble : "");
        paint_footer();
    }
    return glance.lamp;
}

/* BT starts as the dim rune. ui_set_bt swaps in the dotted mark once the radio is up. */
static void build_status_bar(lv_obj_t *screen) {
    lv_obj_t *cluster;
    lv_obj_t *wifi;
    int i;
    lv_obj_t *bar;
    static const int heights[3] = {6, 10, 14};
    bar = lv_obj_create(screen);
    s_bar = bar;
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

    s_bar_title = lv_label_create(bar);
    lv_obj_set_width(s_bar_title, 168);
    lv_label_set_long_mode(s_bar_title, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(s_bar_title, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(s_bar_title, lv_color_hex(INK), 0);
    lv_obj_set_style_text_align(s_bar_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(s_bar_title, LV_ALIGN_CENTER, 0, 0);
    lv_obj_clear_flag(s_bar_title, LV_OBJ_FLAG_CLICKABLE);
    lv_label_set_text_static(s_bar_title, "ginger");

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

    s_bt_icon = lv_image_create(cluster);
    lv_obj_clear_flag(s_bt_icon, LV_OBJ_FLAG_CLICKABLE);
    paint_bt();

    psram_objects_begin();
    make_rot_symbol(cluster, DESK_ROT_PX, &s_rot_ring, &s_rot_lock);
    psram_objects_end();
    paint_rotlock();
    paint_bars(0);
}

static void build_new_pill(lv_obj_t *screen);

static void paint_edge(lv_layer_t *layer, const lv_area_t *area, int radius, int width, lv_color_t color,
                       lv_opa_t opa) {
    lv_draw_rect_dsc_t dsc;
    if (!layer || width < 1 || area->x2 <= area->x1 || area->y2 <= area->y1) {
        return;
    }
    lv_draw_rect_dsc_init(&dsc);
    dsc.bg_opa = LV_OPA_TRANSP;
    dsc.radius = radius;
    dsc.border_width = width;
    dsc.border_opa = opa;
    dsc.border_color = color;
    dsc.border_side = LV_BORDER_SIDE_FULL;
    lv_draw_rect(layer, &dsc, area);
}

/* Two border bands inside the fill. No shadow buffer. Drawn with the card,
 * under the mark and the type. */
static void draw_sheet_inner(lv_event_t *event) {
    lv_obj_t *obj = lv_event_get_target(event);
    lv_layer_t *layer = lv_event_get_layer(event);
    lv_area_t area;
    lv_area_t far;
    lv_color_t color;
    int radius;
    if (!layer) {
        return;
    }
    lv_obj_get_coords(obj, &area);
    area.x1 += SHEET_BORDER;
    area.y1 += SHEET_BORDER;
    area.x2 -= SHEET_BORDER;
    area.y2 -= SHEET_BORDER;
    radius = SHEET_RADIUS - SHEET_BORDER;
    color = lv_obj_get_style_border_color(obj, LV_PART_MAIN);
    paint_edge(layer, &area, radius, SHEET_INNER_NEAR, color, SHEET_INNER_NEAR_OPA);
    far.x1 = area.x1 + SHEET_INNER_NEAR;
    far.y1 = area.y1 + SHEET_INNER_NEAR;
    far.x2 = area.x2 - SHEET_INNER_NEAR;
    far.y2 = area.y2 - SHEET_INNER_NEAR;
    paint_edge(layer, &far, radius - SHEET_INNER_NEAR, SHEET_INNER_FAR, color, SHEET_INNER_FAR_OPA);
}

/* A 2px border on a round-rect that sticks out `outset` px on every side.
 * The center stays clear. Filled slabs were the heavy bottom rim. */
static lv_obj_t *make_ring(lv_obj_t *screen, int outset, lv_opa_t opa) {
    lv_obj_t *ring = lv_obj_create(screen);
    int w = (SCREEN_PX - (SHEET_INSET * 2)) + (outset * 2);
    int h = (SHEET_BOTTOM - SHEET_Y) + (outset * 2);
    lv_obj_set_size(ring, w, h);
    lv_obj_set_pos(ring, SHEET_INSET - outset, SCREEN_PX);
    lv_obj_set_style_bg_opa(ring, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(ring, SHEET_RING_W, 0);
    lv_obj_set_style_border_opa(ring, opa, 0);
    lv_obj_set_style_border_color(ring, lv_color_hex(DESK_MARK_NEUTRAL), 0);
    lv_obj_set_style_radius(ring, SHEET_RADIUS + outset, 0);
    lv_obj_set_style_outline_width(ring, 0, 0);
    lv_obj_set_style_shadow_width(ring, 0, 0);
    lv_obj_set_style_pad_all(ring, 0, 0);
    lv_obj_clear_flag(ring, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(ring, LV_OBJ_FLAG_HIDDEN);
    return ring;
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
    lv_obj_t *done;
    lv_obj_t *scan;
    lv_obj_t *wifi_card;
    lv_obj_t *companion;
    lv_obj_t *actions;
    s_on_save = on_save;
    s_on_dismiss = on_dismiss;
    s_on_scan = on_scan;
    lv_obj_set_scrollable(screen, false);
    lv_obj_set_style_bg_color(screen, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
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
    build_linkdown(screen);
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
    lv_label_set_text(s_count, s_count_text);
    lv_obj_set_style_text_font(s_count, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(s_count, lv_color_hex(INK_DIM), 0);
    settings_btn = icon_button(dock, &desk_icon_settings, on_open_settings, 0);
    lv_obj_set_size(settings_btn, BTN_W, BTN_H);
    build_new_pill(screen);

    /* Outer ring first. Peeks are created after, so a stack tab stays in front. */
    {
        int ring;
        for (ring = 0; ring < SHEET_RING_N; ring++) {
            s_sheet_ring[ring] = make_ring(screen, k_sheet_ring_out[ring], k_sheet_ring_opa[ring]);
        }
    }
    /* Each card behind steps in 12px, then 24px, from the front card. */
    s_peek2 = make_peek(screen, SHEET_INSET + 24);
    s_peek1 = make_peek(screen, SHEET_INSET + 12);
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
    lv_obj_set_style_radius(s_sheet, SHEET_RADIUS, 0);
    lv_obj_add_event_cb(s_sheet, draw_sheet_inner, LV_EVENT_DRAW_MAIN_END, NULL);
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
    /* Silhouette only. A same-color disc behind this mark reads as a flat
     * badge: the cloud disappears into the plate, and a circle grows a ring.
     * Eyes are drawn on the shape. The card glass is the dark edge behind it. */
    s_sheet_mark = lv_obj_create(s_sheet);
    lv_obj_set_size(s_sheet_mark, SHEET_MARK, SHEET_MARK);
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
    lv_obj_set_style_bg_color(s_settings, lv_color_hex(DOCK), 0);
    lv_obj_set_style_bg_opa(s_settings, LV_OPA_COVER, 0);
    lv_obj_set_style_text_color(s_settings, lv_color_hex(INK), 0);
    lv_obj_set_style_pad_all(s_settings, SET_INSET, 0);
    lv_obj_set_style_pad_row(s_settings, SET_GAP, 0);
    lv_obj_set_style_border_width(s_settings, 0, 0);
    lv_obj_set_style_radius(s_settings, 0, 0);
    lv_obj_set_scrollable(s_settings, false);
    lv_obj_set_hidden(s_settings, true);

    s_header = lv_obj_create(s_settings);
    lv_obj_set_width(s_header, lv_pct(100));
    lv_obj_set_height(s_header, SET_HEADER);
    lv_obj_set_flex_flow(s_header, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(s_header, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_scrollable(s_header, false);
    flatten(s_header);
    lv_obj_set_style_pad_hor(s_header, SET_GLOW + SET_OUTLINE_PAD, 0);
    heading = lv_label_create(s_header);
    lv_label_set_text(heading, "Settings");
    lv_obj_set_style_text_color(heading, lv_color_hex(INK), 0);
    lv_obj_set_style_text_font(heading, &lv_font_montserrat_28, 0);
    done = action_button(s_header, "Done", on_done);
    lv_obj_set_width(done, 104);
    lv_obj_set_style_radius(done, LV_RADIUS_CIRCLE, 0);

    s_body = lv_obj_create(s_settings);
    lv_obj_set_width(s_body, lv_pct(100));
    lv_obj_set_flex_flow(s_body, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_scrollbar_mode(s_body, LV_SCROLLBAR_MODE_AUTO);
    lv_obj_add_event_cb(s_body, on_body_clicked, LV_EVENT_CLICKED, NULL);
    flatten(s_body);
    lv_obj_set_style_pad_hor(s_body, SET_GLOW + SET_OUTLINE_PAD, 0);
    lv_obj_set_style_pad_row(s_body, SET_GAP, 0);

    {
        lv_obj_t *wifi_head = lv_obj_create(s_body);
        lv_obj_set_width(wifi_head, lv_pct(100));
        lv_obj_set_height(wifi_head, LV_SIZE_CONTENT);
        lv_obj_set_flex_flow(wifi_head, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(wifi_head, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER);
        lv_obj_set_scrollable(wifi_head, false);
        flatten(wifi_head);
        section_label(wifi_head, "Wi-Fi");
        s_status = lv_label_create(wifi_head);
        lv_label_set_long_mode(s_status, LV_LABEL_LONG_DOT);
        lv_obj_set_flex_grow(s_status, 1);
        lv_obj_set_style_min_width(s_status, 0, 0);
        lv_obj_set_style_text_align(s_status, LV_TEXT_ALIGN_RIGHT, 0);
        lv_label_set_text(s_status, "Scan to add a network. Others stay saved.");
        style_text(s_status);
        lv_obj_set_style_text_color(s_status, lv_color_hex(INK_DIM), 0);
    }
    wifi_card = settings_card(s_body);

    s_list = lv_obj_create(wifi_card);
    lv_obj_set_width(s_list, lv_pct(100));
    lv_obj_set_height(s_list, SET_LIST_H);
    lv_obj_set_flex_flow(s_list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(s_list, 0, 0);
    lv_obj_set_style_pad_row(s_list, SET_LIST_GAP, 0);
    lv_obj_set_style_bg_opa(s_list, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(s_list, 0, 0);
    lv_obj_set_style_radius(s_list, 0, 0);
    lv_obj_set_scrollbar_mode(s_list, LV_SCROLLBAR_MODE_AUTO);

    s_selected = lv_label_create(wifi_card);
    lv_obj_set_width(s_selected, lv_pct(100));
    lv_label_set_long_mode(s_selected, LV_LABEL_LONG_DOT);
    lv_label_set_text(s_selected, "Selected: none");
    style_text(s_selected);
    lv_obj_set_style_text_font(s_selected, &lv_font_montserrat_20, 0);

    s_pass = make_field(wifi_card, "Password", "Wi-Fi password", 1, NULL);
    actions = lv_obj_create(wifi_card);
    lv_obj_set_width(actions, lv_pct(100));
    lv_obj_set_height(actions, SET_CONTROL);
    lv_obj_set_flex_flow(actions, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(actions, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_scrollable(actions, false);
    flatten(actions);
    lv_obj_set_style_pad_column(actions, SET_GAP, 0);
    scan = action_button(actions, "Scan", on_scan_clicked);
    manual = action_button(actions, "Type SSID", on_manual);
    lv_obj_set_flex_grow(scan, 1);
    lv_obj_set_flex_grow(manual, 1);
    lv_obj_set_height(scan, SET_CONTROL);
    lv_obj_set_height(manual, SET_CONTROL);
    s_ssid = make_field(wifi_card, "SSID", "Network name", 0, &s_ssid_box);
    lv_obj_set_hidden(s_ssid_box, true);

    section_label(s_body, "Companion");
    companion = settings_card(s_body);
    s_url = make_field(companion, "URL for this network", "http://192.168.4.30:8787", 0, NULL);
    s_token = make_field(companion, "Token for this network", "optional", 0, NULL);

    save = action_button(s_body, "Save", on_save_clicked);
    lv_obj_set_width(save, lv_pct(100));
    lv_obj_set_style_bg_color(save, lv_color_hex(ROW_HOT), 0);
    lv_obj_set_style_border_color(save, lv_color_hex(ROW_MARK), 0);
    lv_obj_set_style_border_width(save, SET_STROKE, 0);
    lv_obj_set_style_border_side(save, LV_BORDER_SIDE_FULL, 0);
    lv_obj_set_style_radius(save, LV_RADIUS_CIRCLE, 0);

    s_keyboard = lv_keyboard_create(screen);
    lv_obj_set_size(s_keyboard, SCREEN_PX - (SET_INSET * 2), KEYBOARD_PX);
    lv_obj_align(s_keyboard, LV_ALIGN_BOTTOM_MID, 0, -SET_INSET);
    lv_obj_set_hidden(s_keyboard, true);
    lv_obj_add_event_cb(s_keyboard, on_keyboard, LV_EVENT_READY, NULL);
    lv_obj_add_event_cb(s_keyboard, on_keyboard, LV_EVENT_CANCEL, NULL);
    psram_objects_begin();
    build_control_center(screen);
    psram_objects_end();
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

void ui_bind_sta(int on, ui_toggle_fn on_toggle) {
    s_on_sta = on_toggle;
    ui_set_sta(on);
}

void ui_bind_bt(ui_toggle_fn on_toggle) {
    s_on_bt = on_toggle;
}

void ui_set_sta(int on) {
    s_sta_on = on ? 1 : 0;
    if (!s_sta_on) {
        s_fail_count = 0;
        s_wifi_ip = 0;
        s_wifi_retries = 0;
        s_wifi_gave_up = 0;
        if (s_lamp) {
            present_status(s_phase_text[0] ? s_phase_text : "IDLE", 0);
        }
    }
    paint_cc_sta();
}

void ui_set_bt(int state) {
    if (state < 0 || state > 2) {
        state = 0;
    }
    s_bt_state = state;
    paint_bt();
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
    cc_close_now();
    face_idle_stop();
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
    face_idle_stop();
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
        copy_text(s_count_text, sizeof(s_count_text), count);
        s_count_running = view->running_count > 0;
        paint_footer();
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
