#pragma once

#include <stddef.h>
#include <stdint.h>

#define DESK_AGENT_MAX 24
#define DESK_MARK_NEUTRAL 0xa39b88u

enum {
    DESK_SHAPE_CIRCLE = 0,
    DESK_SHAPE_SQUARE = 1,
    DESK_SHAPE_DIAMOND = 2,
    DESK_SHAPE_TRIANGLE = 3,
    DESK_SHAPE_CLOUD,
    DESK_SHAPE_ROUNDED,
    DESK_SHAPE_STAR,
    DESK_SHAPE_FLOWER,
    DESK_SHAPE_HEART,
    DESK_SHAPE_BLOB,
    DESK_SHAPE_DROP,
    DESK_SHAPE_PILL,
    DESK_SHAPE_PENTAGON,
    DESK_SHAPE_SUN,
    DESK_SHAPE_HEXAGON
};

typedef struct {
    char id[40];
    char title[64];
    char color[32];
    char shape[16];
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
int desk_mark_color(const char *color, uint32_t *out);
int desk_mark_shape(const char *shape);
