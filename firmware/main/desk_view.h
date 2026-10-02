#pragma once

typedef struct {
    char phase[16];
    int needs_you;
    char title[96];
    char message[160];
    int running_count;
} desk_view_t;

int desk_view_from_json(const char *json, desk_view_t *out);
const char *desk_phase_label(const desk_view_t *view, int consecutive_failures);
