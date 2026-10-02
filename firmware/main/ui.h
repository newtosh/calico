#pragma once

#include "desk_view.h"

typedef void (*ui_save_fn)(const char *ssid, const char *pass, const char *url, const char *token);

void ui_init(ui_save_fn on_save, void (*on_dismiss)(void));
void ui_open_settings(void);
void ui_apply(const desk_view_t *view, int failures);
