#include "ui.h"

#include "desk_status.h"
#include "icons.h"
#include "lvgl.h"

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
    AGENT_Y = 98,
    AGENT_ROW_H = 32,
    AGENT_GAP = 2,
    AGENT_STRIDE = AGENT_ROW_H + AGENT_GAP,
    MARK_PX = 24,
    BTN_H = 64,
    BTN_MIC_W = 148,
    BTN_SET_W = 204,
    COUNT_H = 28,
    COUNT_GAP = 8,
    COUNT_TOP = SCREEN_PX - EDGE_PX - BTN_H - COUNT_GAP - COUNT_H,
    INK = 0xefe7d6,
    INK_DIM = 0xa39b88,
    BG = 0x14160f,
    FIELD = 0x2a2d24,
    FIELD_EDGE = 0x6d6756,
    ROW = 0x2a2d24,
    ROW_ON = 0x3d4f32,
    ROW_MARK = 0x9bb57a,
    LAMP_AMBER = 0xe2a23a,
    LAMP_RED = 0xc4544a,
    /* One step under the olive face. Top status bar and bottom dock. */
    DOCK = 0x0c0e09
};

static lv_obj_t *s_title;
static lv_obj_t *s_message;
static lv_obj_t *s_count;
static lv_obj_t *s_alert;
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
static net_ap_t s_aps[NET_SCAN_MAX];
static int s_row_count;
static ui_save_fn s_on_save;
static void (*s_on_dismiss)(void);
static ui_scan_fn s_on_scan;
static int s_mic_hold;
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
static int s_sleep_agents = -1;
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
static int s_status_seen_ok;
static char s_phase_text[24];
static char s_status_seen[24];

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

static void draw_mark(lv_event_t *event) {
    lv_obj_t *obj = lv_event_get_target(event);
    intptr_t shape = (intptr_t)lv_obj_get_user_data(obj);
    lv_layer_t *layer;
    lv_area_t area;
    lv_draw_triangle_dsc_t dsc;
    lv_color_t color;
    int cx;
    int cy;
    if (shape != DESK_SHAPE_DIAMOND && shape != DESK_SHAPE_TRIANGLE) {
        return;
    }
    layer = lv_event_get_layer(event);
    if (!layer) {
        return;
    }
    lv_obj_get_coords(obj, &area);
    color = lv_obj_get_style_bg_color(obj, LV_PART_MAIN);
    cx = (area.x1 + area.x2) / 2;
    cy = (area.y1 + area.y2) / 2;
    lv_draw_triangle_dsc_init(&dsc);
#if LVGL_VERSION_MAJOR == 9 && LVGL_VERSION_MINOR < 3
    dsc.bg_color = color;
    dsc.bg_opa = LV_OPA_COVER;
#else
    dsc.color = color;
    dsc.opa = LV_OPA_COVER;
#endif
    if (shape == DESK_SHAPE_TRIANGLE) {
        dsc.p[0].x = cx;
        dsc.p[0].y = area.y1;
        dsc.p[1].x = area.x1;
        dsc.p[1].y = area.y2;
        dsc.p[2].x = area.x2;
        dsc.p[2].y = area.y2;
        lv_draw_triangle(layer, &dsc);
        return;
    }
    dsc.p[0].x = cx;
    dsc.p[0].y = area.y1;
    dsc.p[1].x = area.x2;
    dsc.p[1].y = cy;
    dsc.p[2].x = cx;
    dsc.p[2].y = area.y2;
    lv_draw_triangle(layer, &dsc);
    dsc.p[1].x = area.x1;
    lv_draw_triangle(layer, &dsc);
}

static void apply_mark(lv_obj_t *mark, uint32_t color, int shape) {
    lv_obj_set_style_bg_color(mark, lv_color_hex(color), 0);
    lv_obj_set_user_data(mark, (void *)(intptr_t)shape);
    if (shape == DESK_SHAPE_SQUARE) {
        lv_obj_set_style_radius(mark, 2, 0);
        lv_obj_set_style_bg_opa(mark, LV_OPA_COVER, 0);
    } else if (shape == DESK_SHAPE_CIRCLE) {
        lv_obj_set_style_radius(mark, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_opa(mark, LV_OPA_COVER, 0);
    } else {
        lv_obj_set_style_radius(mark, 0, 0);
        lv_obj_set_style_bg_opa(mark, LV_OPA_TRANSP, 0);
    }
    lv_obj_invalidate(mark);
}

static void build_agent_rows(lv_obj_t *screen) {
    int i;
    s_agent_box = lv_obj_create(screen);
    lv_obj_set_size(s_agent_box, SCREEN_PX - (EDGE_PX * 2), AGENT_STRIDE * DESK_AGENT_MAX);
    lv_obj_align(s_agent_box, LV_ALIGN_TOP_MID, 0, AGENT_Y);
    lv_obj_set_flex_flow(s_agent_box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(s_agent_box, 0, 0);
    lv_obj_set_style_pad_row(s_agent_box, AGENT_GAP, 0);
    lv_obj_set_style_bg_opa(s_agent_box, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(s_agent_box, 0, 0);
    lv_obj_set_style_radius(s_agent_box, 0, 0);
    lv_obj_set_scrollbar_mode(s_agent_box, LV_SCROLLBAR_MODE_OFF);
    for (i = 0; i < DESK_AGENT_MAX; i++) {
        lv_obj_t *row = lv_obj_create(s_agent_box);
        lv_obj_t *mark = lv_obj_create(row);
        lv_obj_t *label = lv_label_create(row);
        s_agent_rows[i] = row;
        s_agent_marks[i] = mark;
        s_agent_labels[i] = label;
        lv_obj_set_width(row, lv_pct(100));
        lv_obj_set_height(row, AGENT_ROW_H);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_all(row, 0, 0);
        lv_obj_set_style_pad_column(row, 12, 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_width(row, 0, 0);
        lv_obj_set_style_radius(row, 0, 0);
        lv_obj_set_size(mark, MARK_PX, MARK_PX);
        lv_obj_set_style_border_width(mark, 0, 0);
        lv_obj_set_style_pad_all(mark, 0, 0);
        lv_obj_set_style_shadow_width(mark, 0, 0);
        lv_obj_add_event_cb(mark, draw_mark, LV_EVENT_DRAW_POST, NULL);
        apply_mark(mark, DESK_MARK_NEUTRAL, DESK_SHAPE_CIRCLE);
        lv_obj_set_flex_grow(label, 1);
        lv_obj_set_width(label, SCREEN_PX - (EDGE_PX * 2) - MARK_PX - 16);
        lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
        style_text(label);
        lv_obj_set_style_text_font(label, &lv_font_montserrat_24, 0);
        lv_label_set_text(label, "");
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

static void on_done(lv_event_t *event) {
    (void)event;
    hide_keyboard(1);
    lv_obj_set_hidden(s_settings, true);
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

static void on_alert(lv_event_t *event) {
    (void)event;
    if (s_on_dismiss) {
        s_on_dismiss();
    }
}

static void on_mic(lv_event_t *event) {
    (void)event;
    s_mic_hold = 3;
    lv_label_set_text(s_message, "Voice not in this PoC");
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
    lv_obj_set_style_translate_y(obj, v, 0);
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
    lv_obj_set_style_translate_y(obj, -rise, 0);
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

/* Large face when the middle of the 480 panel is empty. Shrink to stay under
 * the agent rows and above the running count. 16px bezel stays. */
static int place_sleep(int agents) {
    int below = agents > 0 ? AGENT_Y + agents * AGENT_STRIDE : MESSAGE_Y + 28;
    int limit = COUNT_TOP;
    int head = 96;
    int span = head + 36;
    int y = (below + limit - span) / 2;
    int eye = 22;
    int gap = 16;
    const lv_font_t *font = &lv_font_montserrat_24;
    if (y < below + 4) {
        head = 48;
        span = head + 28;
        y = below + 4;
        eye = 12;
        gap = 8;
        font = &lv_font_montserrat_16;
        if (y + span > limit) {
            return 0;
        }
    }
    lv_obj_set_size(s_sleep, head + 56, span);
    lv_obj_set_size(s_head, head, head);
    lv_obj_set_size(s_eye_l, eye, 4);
    lv_obj_set_size(s_eye_r, eye, 4);
    lv_obj_align(s_eye_l, LV_ALIGN_CENTER, -gap, 3);
    lv_obj_align(s_eye_r, LV_ALIGN_CENTER, gap, 3);
    lv_obj_set_style_text_font(s_zzz, font, 0);
    lv_obj_align(s_head, LV_ALIGN_BOTTOM_LEFT, 0, 0);
    lv_obj_align(s_zzz, LV_ALIGN_TOP_LEFT, head - 4, 4);
    lv_obj_align(s_sleep, LV_ALIGN_TOP_MID, 0, y);
    return 1;
}

static void sleep_stop(void) {
    if (!s_sleep || !s_asleep) {
        return;
    }
    s_asleep = 0;
    s_sleep_agents = -1;
    anim_delete(s_sleep);
    anim_delete(s_zzz);
    lv_obj_set_hidden(s_sleep, true);
}

static void sleep_show(int agents) {
    if (!s_asleep || s_sleep_agents != agents) {
        if (!place_sleep(agents)) {
            sleep_stop();
            return;
        }
        s_sleep_agents = agents;
    }
    lv_obj_set_hidden(s_sleep, false);
    if (s_asleep) {
        return;
    }
    s_asleep = 1;
    lv_obj_set_style_translate_y(s_sleep, 0, 0);
    lv_obj_set_style_translate_y(s_zzz, 0, 0);
    lv_obj_set_style_opa(s_zzz, LV_OPA_TRANSP, 0);
    start_anim(s_sleep, sleep_bob, 0, 10, 2200, 1);
    start_anim(s_zzz, sleep_zzz, 0, 100, 4200, 0);
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
    lv_obj_add_flag(s_sleep, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
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

void ui_init(ui_save_fn on_save, void (*on_dismiss)(void), ui_scan_fn on_scan) {
    lv_obj_t *screen = lv_screen_active();
    lv_obj_t *settings_btn;
    lv_obj_t *mic;
    lv_obj_t *dock;
    lv_obj_t *heading;
    lv_obj_t *manual;
    lv_obj_t *save;
    s_on_save = on_save;
    s_on_dismiss = on_dismiss;
    s_on_scan = on_scan;
    lv_obj_set_style_bg_color(screen, lv_color_hex(BG), 0);
    desk_toast_init(&s_toast_state);
    build_status_bar(screen);
    s_title = lv_label_create(screen);
    lv_obj_set_width(s_title, SCREEN_PX - (EDGE_PX * 2));
    lv_label_set_long_mode(s_title, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(s_title, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_align(s_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(s_title, lv_color_hex(INK), 0);
    lv_obj_align(s_title, LV_ALIGN_TOP_MID, 0, TITLE_Y);
    s_message = lv_label_create(screen);
    lv_obj_set_width(s_message, SCREEN_PX - (EDGE_PX * 2));
    lv_label_set_long_mode(s_message, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(s_message, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_align(s_message, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(s_message, lv_color_hex(INK_DIM), 0);
    lv_obj_align(s_message, LV_ALIGN_TOP_MID, 0, MESSAGE_Y);
    build_agent_rows(screen);
    build_sleep(screen);
    dock = lv_obj_create(screen);
    lv_obj_set_size(dock, SCREEN_PX, COUNT_H + COUNT_GAP + BTN_H + EDGE_PX);
    lv_obj_align(dock, LV_ALIGN_BOTTOM_MID, 0, 0);
    flatten(dock);
    lv_obj_set_style_bg_color(dock, lv_color_hex(DOCK), 0);
    lv_obj_set_style_bg_opa(dock, LV_OPA_COVER, 0);
    lv_obj_clear_flag(dock, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    s_count = lv_label_create(screen);
    lv_obj_set_style_text_font(s_count, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(s_count, lv_color_hex(ROW_MARK), 0);
    lv_obj_align(s_count, LV_ALIGN_BOTTOM_MID, 0, -(EDGE_PX + BTN_H + COUNT_GAP));
    mic = icon_button(screen, &desk_icon_mic, on_mic, 1);
    lv_obj_set_size(mic, BTN_MIC_W, BTN_H);
    lv_obj_align(mic, LV_ALIGN_BOTTOM_LEFT, EDGE_PX, -EDGE_PX);
    settings_btn = icon_button(screen, &desk_icon_settings, on_open_settings, 0);
    lv_obj_set_size(settings_btn, BTN_SET_W, BTN_H);
    lv_obj_align(settings_btn, LV_ALIGN_BOTTOM_RIGHT, -EDGE_PX, -EDGE_PX);

    s_alert = lv_obj_create(screen);
    lv_obj_set_size(s_alert, SCREEN_PX, SCREEN_PX);
    lv_obj_set_style_bg_color(s_alert, lv_color_hex(0xe2a23a), 0);
    lv_obj_set_style_bg_opa(s_alert, LV_OPA_COVER, 0);
    lv_obj_set_hidden(s_alert, true);
    lv_obj_add_event_cb(s_alert, on_alert, LV_EVENT_CLICKED, NULL);
    lv_obj_t *alert_label = lv_label_create(s_alert);
    lv_label_set_text(alert_label, "NEEDS YOU");
    lv_obj_set_style_text_font(alert_label, &lv_font_montserrat_48, 0);
    lv_obj_set_style_text_color(alert_label, lv_color_hex(BG), 0);
    lv_obj_center(alert_label);

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
    ui_apply(&(desk_view_t){0}, 0);
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
    lv_label_set_text(s_message, message ? message : "");
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

void ui_apply(const desk_view_t *view, int failures) {
    char count[32];
    int i;
    const char *headline;
    int lamp = present_status(desk_phase_label(view, failures), failures);
    headline = desk_face_title(view);
    lv_label_set_text(s_title, headline);
    lv_obj_set_hidden(s_title, headline[0] == '\0');
    if (s_mic_hold > 0) {
        s_mic_hold--;
    } else {
        lv_label_set_text(s_message, view->message);
    }
    for (i = 0; i < DESK_AGENT_MAX; i++) {
        const desk_agent_t *agent;
        uint32_t color = DESK_MARK_NEUTRAL;
        uint32_t parsed;
        const char *label;
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
        lv_obj_set_hidden(s_agent_rows[i], false);
    }
    snprintf(count, sizeof(count), "%d running", view->running_count);
    lv_label_set_text(s_count, count);
    if (view->needs_you && failures < 3) {
        lv_obj_set_hidden(s_alert, false);
    } else {
        lv_obj_set_hidden(s_alert, true);
    }
    if (!lv_obj_is_hidden(s_settings) || !desk_quiet_idle(view, failures) || lamp == DESK_LAMP_RED) {
        sleep_stop();
    } else {
        sleep_show(view->agent_count);
    }
}
