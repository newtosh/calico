#include "ui.h"

#include "lvgl.h"

#include <stdio.h>
#include <string.h>

static lv_obj_t *s_phase;
static lv_obj_t *s_title;
static lv_obj_t *s_message;
static lv_obj_t *s_count;
static lv_obj_t *s_alert;
static lv_obj_t *s_settings;
static lv_obj_t *s_ssid;
static lv_obj_t *s_pass;
static lv_obj_t *s_url;
static lv_obj_t *s_token;
static lv_obj_t *s_keyboard;
static ui_save_fn s_on_save;
static void (*s_on_dismiss)(void);
static int s_mic_hold;

static lv_obj_t *labeled_area(lv_obj_t *parent, const char *name) {
    lv_obj_t *label = lv_label_create(parent);
    lv_label_set_text(label, name);
    return lv_textarea_create(parent);
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
    lv_obj_remove_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
}

static void on_focus(lv_event_t *event) {
    lv_keyboard_set_textarea(s_keyboard, lv_event_get_target(event));
    lv_obj_remove_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN);
}

static void on_save(lv_event_t *event) {
    (void)event;
    if (s_on_save) {
        s_on_save(lv_textarea_get_text(s_ssid), lv_textarea_get_text(s_pass),
                  lv_textarea_get_text(s_url), lv_textarea_get_text(s_token));
    }
}

void ui_init(ui_save_fn on_save, void (*on_dismiss)(void)) {
    lv_obj_t *screen = lv_screen_active();
    lv_obj_t *settings_btn;
    lv_obj_t *mic;
    lv_obj_t *save;
    s_on_save = on_save;
    s_on_dismiss = on_dismiss;
    lv_obj_set_style_bg_color(screen, lv_color_hex(0x14160f), 0);
    s_phase = lv_label_create(screen);
    lv_obj_set_style_text_font(s_phase, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(s_phase, lv_color_hex(0xefe7d6), 0);
    lv_obj_align(s_phase, LV_ALIGN_TOP_MID, 0, 36);
    s_title = lv_label_create(screen);
    lv_obj_set_width(s_title, 400);
    lv_obj_set_style_text_color(s_title, lv_color_hex(0xefe7d6), 0);
    lv_obj_align(s_title, LV_ALIGN_CENTER, 0, -20);
    s_message = lv_label_create(screen);
    lv_obj_set_width(s_message, 400);
    lv_label_set_long_mode(s_message, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(s_message, lv_color_hex(0xa39b88), 0);
    lv_obj_align(s_message, LV_ALIGN_CENTER, 0, 40);
    s_count = lv_label_create(screen);
    lv_obj_set_style_text_color(s_count, lv_color_hex(0x9bb57a), 0);
    lv_obj_align(s_count, LV_ALIGN_BOTTOM_MID, 0, -48);
    mic = lv_button_create(screen);
    lv_obj_align(mic, LV_ALIGN_BOTTOM_LEFT, 24, -16);
    lv_obj_add_event_cb(mic, on_mic, LV_EVENT_CLICKED, NULL);
    lv_label_set_text(lv_label_create(mic), "Mic");
    settings_btn = lv_button_create(screen);
    lv_obj_align(settings_btn, LV_ALIGN_BOTTOM_RIGHT, -24, -16);
    lv_obj_add_event_cb(settings_btn, on_open_settings, LV_EVENT_CLICKED, NULL);
    lv_label_set_text(lv_label_create(settings_btn), "Settings");

    s_alert = lv_obj_create(screen);
    lv_obj_set_size(s_alert, 480, 480);
    lv_obj_set_style_bg_color(s_alert, lv_color_hex(0xe2a23a), 0);
    lv_obj_set_style_bg_opa(s_alert, LV_OPA_COVER, 0);
    lv_obj_add_flag(s_alert, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_event_cb(s_alert, on_alert, LV_EVENT_CLICKED, NULL);
    lv_obj_t *alert_label = lv_label_create(s_alert);
    lv_label_set_text(alert_label, "NEEDS YOU");
    lv_obj_set_style_text_font(alert_label, &lv_font_montserrat_24, 0);
    lv_obj_center(alert_label);

    s_settings = lv_obj_create(screen);
    lv_obj_set_size(s_settings, 480, 480);
    lv_obj_set_flex_flow(s_settings, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_bg_color(s_settings, lv_color_hex(0x14160f), 0);
    lv_obj_add_flag(s_settings, LV_OBJ_FLAG_HIDDEN);
    s_ssid = labeled_area(s_settings, "SSID");
    s_pass = labeled_area(s_settings, "Password");
    lv_textarea_set_password_mode(s_pass, true);
    s_url = labeled_area(s_settings, "Companion URL");
    s_token = labeled_area(s_settings, "Bearer token");
    lv_obj_add_event_cb(s_ssid, on_focus, LV_EVENT_FOCUSED, NULL);
    lv_obj_add_event_cb(s_pass, on_focus, LV_EVENT_FOCUSED, NULL);
    lv_obj_add_event_cb(s_url, on_focus, LV_EVENT_FOCUSED, NULL);
    lv_obj_add_event_cb(s_token, on_focus, LV_EVENT_FOCUSED, NULL);
    save = lv_button_create(s_settings);
    lv_obj_add_event_cb(save, on_save, LV_EVENT_CLICKED, NULL);
    lv_label_set_text(lv_label_create(save), "Save");
    s_keyboard = lv_keyboard_create(screen);
    lv_keyboard_set_textarea(s_keyboard, s_ssid);
    lv_obj_add_flag(s_keyboard, LV_OBJ_FLAG_HIDDEN);
    ui_apply(&(desk_view_t){0}, 0);
}

void ui_open_settings(void) { lv_obj_remove_flag(s_settings, LV_OBJ_FLAG_HIDDEN); }

void ui_apply(const desk_view_t *view, int failures) {
    char count[32];
    lv_label_set_text(s_phase, desk_phase_label(view, failures));
    lv_label_set_text(s_title, view->title[0] ? view->title : "Waiting");
    if (s_mic_hold > 0) {
        s_mic_hold--;
    } else {
        lv_label_set_text(s_message, view->message);
    }
    snprintf(count, sizeof(count), "%d running", view->running_count);
    lv_label_set_text(s_count, count);
    if (view->needs_you && failures < 3) {
        lv_obj_remove_flag(s_alert, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(s_alert, LV_OBJ_FLAG_HIDDEN);
    }
}
