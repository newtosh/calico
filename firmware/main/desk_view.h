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
    char status[16];
} desk_agent_t;

typedef struct {
    char phase[16];
    int needs_you;
    /* Events since the face badge was cleared. 0 leaves that row empty. */
    int unread;
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
/* Event title used to match a row's aside. Empty when last_event has no
 * useful title. A dismiss acknowledgement is not one. This is not the face
 * row: that row is the unread badge. */
const char *desk_face_title(const desk_view_t *view);
/* Unread badge count. 0 when there is nothing to show. */
int desk_unread_count(const desk_view_t *view);
/* Split `avail` (pixels after the mark and its gap). The name keeps
 * `name_px`. With an aside, `gap` stays between them and the aside takes
 * the rest, at least `min_aside` when the row has room. Without an aside
 * the name takes `avail`. Out pointers may be NULL. */
void desk_row_spans(int avail, int name_px, int gap, int min_aside, int show_aside, int *name_w,
                    int *aside_w);
/* 1 when this agent row should be filled. *aside (optional) is the face
 * message beside the name, or "". needs_you fills the row even with no
 * message. A running or idle row fills only when it shows one. */
int desk_agent_hot(const desk_view_t *view, int index, const char **aside);
void desk_count_text(const desk_view_t *view, char *out, size_t out_len);
int desk_panel_from_json(const char *json, desk_panel_t *out);
int desk_panel_should_apply(const desk_panel_t *panel, const char *url, const char *token);
/* 1 when the push should be stored. A different URL is stored only if that
 * host answered (probed_ok). A token change on the same URL does not need a probe. */
int desk_panel_adopt(const desk_panel_t *panel, const char *url, const char *token, int probed_ok);
const char *desk_phase_label(const desk_view_t *view, int consecutive_failures);
int desk_quiet_idle(const desk_view_t *view, int consecutive_failures);
/* 1 when the sleep face plays: quiet idle and no stored agents. */
int desk_show_sleep(const desk_view_t *view, int consecutive_failures);
/* 10000 while idle on a good link with no misses. 2000 otherwise. */
int desk_poll_ms(const desk_view_t *view, int consecutive_failures, int link_ok);
int desk_mark_color(const char *color, uint32_t *out);
int desk_mark_shape(const char *shape);
/* 1 when the top row should start scrolling its aside. That row is
 * highlighted, the aside is non-empty, and this agent was not already on
 * top with the same text. prev may be NULL. Any other row stays truncated. */
int desk_aside_scroll(const desk_view_t *prev, const desk_view_t *view);
