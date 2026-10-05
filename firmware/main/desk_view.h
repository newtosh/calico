#pragma once

#include <stddef.h>
#include <stdint.h>

#define DESK_AGENT_MAX 24
#define DESK_MARK_NEUTRAL 0xa39b88u

enum {
    DESK_SHAPE_CIRCLE = 0,
    DESK_SHAPE_SQUARE = 1,
    DESK_SHAPE_ROUNDED = 2
};

typedef struct {
    char id[40];
    char title[64];
    char color[32];
    char shape[16];
    char status[16];
} desk_agent_t;

typedef struct {
    char phase[16];
    int needs_you;
    char title[96];
    char message[160];
    int running_count;
    int known_count;
    desk_agent_t agents[DESK_AGENT_MAX];
    int agent_count;
} desk_view_t;

typedef struct {
    char url[128];
    char token[128];
    int present;
    int token_set;
} desk_panel_t;

int desk_view_from_json(const char *json, desk_view_t *out);
int desk_view_same(const desk_view_t *a, const desk_view_t *b);
/* 1 when the parsed view and the failure count both match the last apply. */
int desk_status_same(const desk_view_t *a, int failures_a, const desk_view_t *b, int failures_b);
/* Face headline. Empty when last_event has no useful title. A dismiss
 * acknowledgement is not one. Notes, launches, and needs-you questions keep theirs. */
const char *desk_face_title(const desk_view_t *view);
void desk_count_text(const desk_view_t *view, char *out, size_t out_len);
int desk_panel_from_json(const char *json, desk_panel_t *out);
int desk_panel_should_apply(const desk_panel_t *panel, const char *url, const char *token);
/* 1 when the push should be stored. A different URL is stored only if that
 * host answered (probed_ok). A token change on the same URL does not need a probe. */
int desk_panel_adopt(const desk_panel_t *panel, const char *url, const char *token, int probed_ok);
const char *desk_phase_label(const desk_view_t *view, int consecutive_failures);
int desk_quiet_idle(const desk_view_t *view, int consecutive_failures);
/* 10000 while idle on a good link with no misses. 2000 otherwise. */
int desk_poll_ms(const desk_view_t *view, int consecutive_failures, int link_ok);
int desk_mark_color(const char *color, uint32_t *out);
/* Style widget for a webhook shape name: circle, square, or rounded. */
int desk_mark_shape(const char *shape);
