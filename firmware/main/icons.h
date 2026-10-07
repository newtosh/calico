#pragma once

#include "lvgl.h"

/* Lucide mic and settings, 40px alpha. */
#define DESK_ICON_PX 40
/* Status-bar Bluetooth rune. Same height as the Wi-Fi bars. */
#define DESK_BT_W 20
#define DESK_BT_H 14

extern const lv_image_dsc_t desk_icon_mic;
extern const lv_image_dsc_t desk_icon_settings;
/* Rune only. The live mark is the same rune with a dot on each side. */
extern const lv_image_dsc_t desk_icon_bt;
extern const lv_image_dsc_t desk_icon_bt_on;
