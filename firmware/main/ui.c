#include "ui.h"

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
    INK = 0xefe7d6,
    INK_DIM = 0xa39b88,
    BG = 0x14160f,
    FIELD = 0x2a2d24,
    FIELD_EDGE = 0x6d6756,
    ROW = 0x2a2d24,
    ROW_ON = 0x3d4f32,
    ROW_MARK = 0x9bb57a
};

static lv_obj_t *s_phase;
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
    lv_obj_set_size(s_agent_box, SCREEN_PX - (EDGE_PX * 2), 34 * DESK_AGENT_MAX);
    lv_obj_align(s_agent_box, LV_ALIGN_TOP_MID, 0, EDGE_PX + 100);
    lv_obj_set_flex_flow(s_agent_box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(s_agent_box, 0, 0);
    lv_obj_set_style_pad_row(s_agent_box, 4, 0);
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
        lv_obj_set_height(row, 30);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_all(row, 0, 0);
        lv_obj_set_style_pad_column(row, 8, 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_width(row, 0, 0);
        lv_obj_set_style_radius(row, 0, 0);
        lv_obj_set_size(mark, 16, 16);
        lv_obj_set_style_border_width(mark, 0, 0);
        lv_obj_set_style_pad_all(mark, 0, 0);
        lv_obj_set_style_shadow_width(mark, 0, 0);
        lv_obj_add_event_cb(mark, draw_mark, LV_EVENT_DRAW_POST, NULL);
        apply_mark(mark, DESK_MARK_NEUTRAL, DESK_SHAPE_CIRCLE);
        lv_obj_set_flex_grow(label, 1);
        lv_obj_set_width(label, SCREEN_PX - (EDGE_PX * 2) - 32);
        lv_label_set_long_mode(label, LV_LABEL_LONG_DOT);
        style_text(label);
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

void ui_init(ui_save_fn on_save, void (*on_dismiss)(void), ui_scan_fn on_scan) {
    lv_obj_t *screen = lv_screen_active();
    lv_obj_t *settings_btn;
    lv_obj_t *mic;
    lv_obj_t *heading;
    lv_obj_t *manual;
    lv_obj_t *save;
    s_on_save = on_save;
    s_on_dismiss = on_dismiss;
    s_on_scan = on_scan;
    lv_obj_set_style_bg_color(screen, lv_color_hex(BG), 0);
    s_phase = lv_label_create(screen);
    lv_obj_set_style_text_font(s_phase, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(s_phase, lv_color_hex(INK), 0);
    lv_obj_align(s_phase, LV_ALIGN_TOP_MID, 0, EDGE_PX + 4);
    s_title = lv_label_create(screen);
    lv_obj_set_width(s_title, SCREEN_PX - (EDGE_PX * 2));
    lv_label_set_long_mode(s_title, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_align(s_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(s_title, lv_color_hex(INK), 0);
    lv_obj_align(s_title, LV_ALIGN_TOP_MID, 0, EDGE_PX + 40);
    s_message = lv_label_create(screen);
    lv_obj_set_width(s_message, SCREEN_PX - (EDGE_PX * 2));
    lv_label_set_long_mode(s_message, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_align(s_message, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(s_message, lv_color_hex(INK_DIM), 0);
    lv_obj_align(s_message, LV_ALIGN_TOP_MID, 0, EDGE_PX + 68);
    build_agent_rows(screen);
    s_count = lv_label_create(screen);
    lv_obj_set_style_text_color(s_count, lv_color_hex(ROW_MARK), 0);
    lv_obj_align(s_count, LV_ALIGN_BOTTOM_MID, 0, -(EDGE_PX + 32));
    mic = action_button(screen, "Mic", on_mic);
    lv_obj_align(mic, LV_ALIGN_BOTTOM_LEFT, EDGE_PX + 8, -(EDGE_PX + 8));
    settings_btn = action_button(screen, "Settings", on_open_settings);
    lv_obj_align(settings_btn, LV_ALIGN_BOTTOM_RIGHT, -(EDGE_PX + 8), -(EDGE_PX + 8));

    s_alert = lv_obj_create(screen);
    lv_obj_set_size(s_alert, SCREEN_PX, SCREEN_PX);
    lv_obj_set_style_bg_color(s_alert, lv_color_hex(0xe2a23a), 0);
    lv_obj_set_style_bg_opa(s_alert, LV_OPA_COVER, 0);
    lv_obj_set_hidden(s_alert, true);
    lv_obj_add_event_cb(s_alert, on_alert, LV_EVENT_CLICKED, NULL);
    lv_obj_t *alert_label = lv_label_create(s_alert);
    lv_label_set_text(alert_label, "NEEDS YOU");
    lv_obj_set_style_text_font(alert_label, &lv_font_montserrat_24, 0);
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

void ui_open_settings(void) {
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
    if (!s_phase || !s_message) {
        return;
    }
    lv_label_set_text(s_phase, phase && phase[0] ? phase : "IDLE");
    lv_label_set_text(s_message, message ? message : "");
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
    uint32_t phase = INK_DIM;
    lv_label_set_text(s_phase, desk_phase_label(view, failures));
    if (failures < 3) {
        if (view->needs_you || strcmp(view->phase, "needs_you") == 0) {
            phase = 0xe2a23a;
        } else if (strcmp(view->phase, "running") == 0) {
            phase = ROW_MARK;
        }
    }
    lv_obj_set_style_text_color(s_phase, lv_color_hex(phase), 0);
    lv_label_set_text(s_title, view->title[0] ? view->title : "Waiting");
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
}
