#pragma once

typedef struct {
    char phase[16];
    int needs_you;
    char title[96];
    char message[160];
    int running_count;
} desk_view_t;

typedef struct {
    char url[128];
    char token[128];
    int present;
    int token_set;
} desk_panel_t;

int desk_view_from_json(const char *json, desk_view_t *out);
int desk_panel_from_json(const char *json, desk_panel_t *out);
int desk_panel_should_apply(const desk_panel_t *panel, const char *url, const char *token);
const char *desk_phase_label(const desk_view_t *view, int consecutive_failures);
