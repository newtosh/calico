#pragma once

#include "idle_cat_geom.h"
#include "lvgl.h"

/* The sleeping cat for the idle screen. See firmware/scripts/gen_idle_cat.py.
 * The base is the still cat with a hole where the ear and the tail move. Each
 * moving part has IDLE_CAT_POSES patches that fill its hole. */
extern const lv_image_dsc_t idle_cat_base_img;
extern const lv_image_dsc_t idle_cat_ear_img[IDLE_CAT_POSES];
extern const lv_image_dsc_t idle_cat_tail_img[IDLE_CAT_POSES];
