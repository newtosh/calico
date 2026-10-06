#include "desk_view.h"

#include <stdio.h>
#include <string.h>
#include <strings.h>

static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t') {
        p++;
    }
    return p;
}

static const char *find_key(const char *start, const char *end, const char *key) {
    size_t key_len = strlen(key);
    const char *p = start;
    while (p < end) {
        if (*p == '"' && (size_t)(end - p) >= key_len + 2 && strncmp(p + 1, key, key_len) == 0 &&
            p[1 + key_len] == '"') {
            const char *after = skip_ws(p + key_len + 2);
            if (after < end && *after == ':') {
                return p;
            }
        }
        p++;
    }
    return NULL;
}

static void copy_string(const char *value, char *out, size_t out_len) {
    size_t n = 0;
    if (out_len == 0) {
        return;
    }
    while (*value && *value != '"' && n + 1 < out_len) {
        out[n++] = *value++;
    }
    out[n] = '\0';
}

static int read_string_field(const char *start, const char *end, const char *key, char *out,
                             size_t out_len) {
    const char *key_at = find_key(start, end, key);
    const char *p;
    if (!key_at) {
        return -1;
    }
    p = skip_ws(key_at + strlen(key) + 2);
    if (*p != ':') {
        return -1;
    }
    p = skip_ws(p + 1);
    if (*p != '"') {
        return -1;
    }
    copy_string(p + 1, out, out_len);
    return 0;
}

static const char *object_end(const char *open) {
    int depth = 0;
    const char *p = open;
    int in_string = 0;
    for (; *p; p++) {
        if (*p == '"' && (p == open || p[-1] != '\\')) {
            in_string = !in_string;
        }
        if (in_string) {
            continue;
        }
        if (*p == '{') {
            depth++;
        } else if (*p == '}') {
            depth--;
            if (depth == 0) {
                return p + 1;
            }
        }
    }
    return p;
}

static void read_agents(const char *json, desk_view_t *out);

int desk_view_from_json(const char *json, desk_view_t *out) {
    const char *last;
    const char *value;
    const char *end;
    if (!json || !out) {
        return -1;
    }
    memset(out, 0, sizeof(*out));
    read_string_field(json, json + strlen(json), "phase", out->phase, sizeof(out->phase));
    last = find_key(json, json + strlen(json), "needs_you");
    if (last) {
        value = skip_ws(last + strlen("\"needs_you\""));
        if (*value == ':') {
            value = skip_ws(value + 1);
            out->needs_you = strncmp(value, "true", 4) == 0;
        }
    }
    last = find_key(json, json + strlen(json), "last_event");
    if (last) {
        value = skip_ws(last + strlen("\"last_event\""));
        if (*value == ':') {
            value = skip_ws(value + 1);
            if (*value == '{') {
                end = object_end(value);
                read_string_field(value, end, "title", out->title, sizeof(out->title));
                read_string_field(value, end, "message", out->message, sizeof(out->message));
            }
        }
    }
    read_agents(json, out);
    return 0;
}

int desk_view_same(const desk_view_t *a, const desk_view_t *b) {
    return a && b && memcmp(a, b, sizeof(*a)) == 0;
}

int desk_status_same(const desk_view_t *a, int failures_a, const desk_view_t *b, int failures_b) {
    return failures_a == failures_b && desk_view_same(a, b);
}

void desk_count_text(const desk_view_t *view, char *out, size_t out_len) {
    if (!out || out_len == 0) {
        return;
    }
    if (!view || view->running_count <= 0) {
        snprintf(out, out_len, "idle");
        return;
    }
    snprintf(out, out_len, "%d/%d running", view->running_count, view->known_count);
}

/* Top-level only. A status event can quote the word panel; that must not
 * look like a pushed URL. */
static const char *find_top_key(const char *json, const char *key) {
    const char *p = json;
    int depth = 0;
    int in_string = 0;
    size_t key_len = strlen(key);
    for (; *p; p++) {
        if (in_string) {
            if (*p == '\\' && p[1]) {
                p++;
                continue;
            }
            if (*p == '"') {
                in_string = 0;
            }
            continue;
        }
        if (*p == '"') {
            if (depth == 1 && strncmp(p + 1, key, key_len) == 0 && p[1 + key_len] == '"') {
                const char *after = skip_ws(p + key_len + 2);
                if (*after == ':') {
                    return p;
                }
            }
            in_string = 1;
            continue;
        }
        if (*p == '{' || *p == '[') {
            depth++;
        } else if ((*p == '}' || *p == ']') && depth > 0) {
            depth--;
        }
    }
    return NULL;
}

int desk_panel_from_json(const char *json, desk_panel_t *out) {
    const char *key;
    const char *value;
    const char *end;
    if (!json || !out) {
        return -1;
    }
    memset(out, 0, sizeof(*out));
    key = find_top_key(json, "panel");
    if (!key) {
        return 0;
    }
    value = skip_ws(key + strlen("\"panel\""));
    if (value >= json + strlen(json) || *value != ':') {
        return 0;
    }
    value = skip_ws(value + 1);
    if (*value != '{') {
        return 0;
    }
    end = object_end(value);
    if (read_string_field(value, end, "url", out->url, sizeof(out->url)) != 0 ||
        out->url[0] == '\0') {
        return 0;
    }
    out->present = 1;
    if (read_string_field(value, end, "token", out->token, sizeof(out->token)) == 0) {
        out->token_set = 1;
    }
    return 0;
}

int desk_panel_should_apply(const desk_panel_t *panel, const char *url, const char *token) {
    if (!panel || !panel->present || !url || !token) {
        return 0;
    }
    if (strcmp(panel->url, url) != 0) {
        return 1;
    }
    if (panel->token_set && strcmp(panel->token, token) != 0) {
        return 1;
    }
    return 0;
}

int desk_panel_adopt(const desk_panel_t *panel, const char *url, const char *token, int probed_ok) {
    if (!desk_panel_should_apply(panel, url, token)) {
        return 0;
    }
    if (strcmp(panel->url, url) == 0) {
        return 1;
    }
    return probed_ok ? 1 : 0;
}

static void read_agents(const char *json, desk_view_t *out) {
    const char *p = find_key(json, json + strlen(json), "agents");
    if (!p) {
        return;
    }
    p = skip_ws(p + strlen("agents") + 2);
    if (*p != ':') {
        return;
    }
    p = skip_ws(p + 1);
    if (*p != '[') {
        return;
    }
    p++;
    while (*p) {
        const char *end;
        desk_agent_t *agent;
        char status[16];
        p = skip_ws(p);
        if (*p == ']') {
            break;
        }
        if (*p == ',') {
            p++;
            continue;
        }
        if (*p != '{') {
            break;
        }
        end = object_end(p);
        status[0] = '\0';
        read_string_field(p, end, "status", status, sizeof(status));
        if (strcmp(status, "running") == 0) {
            out->running_count++;
        }
        out->known_count++;
        if (out->agent_count < DESK_AGENT_MAX) {
            agent = &out->agents[out->agent_count];
            read_string_field(p, end, "id", agent->id, sizeof(agent->id));
            read_string_field(p, end, "title", agent->title, sizeof(agent->title));
            read_string_field(p, end, "color", agent->color, sizeof(agent->color));
            read_string_field(p, end, "shape", agent->shape, sizeof(agent->shape));
            copy_string(status, agent->status, sizeof(agent->status));
            out->agent_count++;
        }
        p = end;
    }
}

int desk_mark_color(const char *color, uint32_t *out) {
    const char *p;
    uint32_t value = 0;
    int i;
    if (!color || !out) {
        return -1;
    }
    p = color;
    if (*p == '#') {
        p++;
    }
    for (i = 0; i < 6; i++) {
        char c = p[i];
        int nibble;
        if (c >= '0' && c <= '9') {
            nibble = c - '0';
        } else if (c >= 'a' && c <= 'f') {
            nibble = c - 'a' + 10;
        } else if (c >= 'A' && c <= 'F') {
            nibble = c - 'A' + 10;
        } else {
            return -1;
        }
        value = (value << 4) | (uint32_t)nibble;
    }
    if (p[6] != '\0') {
        return -1;
    }
    *out = value;
    return 0;
}

int desk_mark_shape(const char *shape) {
    static const struct {
        const char *name;
        int kind;
    } names[] = {
        {"blob", DESK_SHAPE_CIRCLE},
        {"capsule", DESK_SHAPE_ROUNDED},
        {"cloud", DESK_SHAPE_CIRCLE},
        {"clover", DESK_SHAPE_CIRCLE},
        {"diamond", DESK_SHAPE_SQUARE},
        {"drop", DESK_SHAPE_CIRCLE},
        {"flower", DESK_SHAPE_CIRCLE},
        {"gear", DESK_SHAPE_CIRCLE},
        {"heart", DESK_SHAPE_CIRCLE},
        {"hex", DESK_SHAPE_SQUARE},
        {"hexagon", DESK_SHAPE_SQUARE},
        {"pentagon", DESK_SHAPE_SQUARE},
        {"pill", DESK_SHAPE_ROUNDED},
        {"rounded", DESK_SHAPE_ROUNDED},
        {"rounded_square", DESK_SHAPE_ROUNDED},
        {"shield", DESK_SHAPE_SQUARE},
        {"splatter", DESK_SHAPE_CIRCLE},
        {"square", DESK_SHAPE_SQUARE},
        {"star", DESK_SHAPE_SQUARE},
        {"sun", DESK_SHAPE_CIRCLE},
        {"teardrop", DESK_SHAPE_CIRCLE},
        {"triangle", DESK_SHAPE_SQUARE},
    };
    size_t i;
    if (!shape) {
        return DESK_SHAPE_CIRCLE;
    }
    for (i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        if (strcasecmp(shape, names[i].name) == 0) {
            return names[i].kind;
        }
    }
    return DESK_SHAPE_CIRCLE;
}

const char *desk_face_title(const desk_view_t *view) {
    if (!view || view->title[0] == '\0' ||
        (strcmp(view->title, "Dismissed") == 0 && view->message[0] == '\0')) {
        return "";
    }
    return view->title;
}

const char *desk_phase_label(const desk_view_t *view, int consecutive_failures) {
    if (!view) {
        return "IDLE";
    }
    if (consecutive_failures >= 3) {
        return "link down";
    }
    if (strcmp(view->phase, "needs_you") == 0 || view->needs_you) {
        return "NEEDS YOU";
    }
    if (strcmp(view->phase, "running") == 0) {
        return "RUNNING";
    }
    return "IDLE";
}

int desk_quiet_idle(const desk_view_t *view, int consecutive_failures) {
    if (!view || view->running_count > 0) {
        return 0;
    }
    return strcmp(desk_phase_label(view, consecutive_failures), "IDLE") == 0;
}

int desk_show_sleep(const desk_view_t *view, int consecutive_failures) {
    return desk_quiet_idle(view, consecutive_failures) && view->known_count == 0;
}

int desk_poll_ms(const desk_view_t *view, int consecutive_failures, int link_ok) {
    if (link_ok && consecutive_failures == 0 && desk_quiet_idle(view, consecutive_failures)) {
        return 10000;
    }
    return 2000;
}
