#pragma once

#include "desk_view.h"
#include "net.h"

typedef void (*ui_save_fn)(const char *ssid, const char *pass, const char *url, const char *token);
typedef void (*ui_scan_fn)(void);
typedef void (*ui_rotlock_fn)(int locked);

void ui_init(ui_save_fn on_save, void (*on_dismiss)(void), ui_scan_fn on_scan);
void ui_bind_rotlock(int locked, ui_rotlock_fn on_toggle);
void ui_set_link(int has_ip, int rssi, int retries, int gave_up);
void ui_open_settings(void);
int ui_settings_is_open(void);
void ui_set_fields(const desk_settings_t *settings);
void ui_set_known(const wifi_store_t *store);
void ui_show_scanning(void);
void ui_show_networks(const net_ap_t *aps, int count);
void ui_set_settings_status(const char *text);
void ui_show_panel_note(const char *phase, const char *message);
void ui_apply(const desk_view_t *view, int failures);
