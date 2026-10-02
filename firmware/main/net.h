#pragma once

#include <stddef.h>

typedef struct {
    char ssid[33];
    char pass[65];
    char url[128];
    char token[128];
} desk_settings_t;

void net_load(desk_settings_t *out);
void net_save(const desk_settings_t *in);
void net_wifi_start(const desk_settings_t *in);
int net_fetch_status(const desk_settings_t *in, char *body, size_t body_len);
void net_dismiss(const desk_settings_t *in);
