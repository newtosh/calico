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

static int hex_nibble(char c) {
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return -1;
}

static void put_utf8(char *out, size_t out_len, size_t *n, unsigned int cp) {
    unsigned char bytes[4];
    int len;
    int i;
    if (cp == 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
        return;
    }
    if (cp < 0x80) {
        bytes[0] = (unsigned char)cp;
        len = 1;
    } else if (cp < 0x800) {
        bytes[0] = (unsigned char)(0xC0 | (cp >> 6));
        bytes[1] = (unsigned char)(0x80 | (cp & 0x3F));
        len = 2;
    } else if (cp < 0x10000) {
        bytes[0] = (unsigned char)(0xE0 | (cp >> 12));
        bytes[1] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
        bytes[2] = (unsigned char)(0x80 | (cp & 0x3F));
        len = 3;
    } else {
        bytes[0] = (unsigned char)(0xF0 | (cp >> 18));
        bytes[1] = (unsigned char)(0x80 | ((cp >> 12) & 0x3F));
        bytes[2] = (unsigned char)(0x80 | ((cp >> 6) & 0x3F));
        bytes[3] = (unsigned char)(0x80 | (cp & 0x3F));
        len = 4;
    }
    if (*n + (size_t)len >= out_len) {
        return;
    }
    for (i = 0; i < len; i++) {
        out[(*n)++] = (char)bytes[i];
    }
}

/* JSON string. \uXXXX (and a surrogate pair) becomes UTF-8. Newlines become
 * a space so a one-line aside does not grow a second row. */
static void copy_string(const char *value, char *out, size_t out_len) {
    size_t n = 0;
    if (out_len == 0) {
        return;
    }
    while (*value && *value != '"' && n + 1 < out_len) {
        unsigned int cp;
        int i;
        if (*value != '\\') {
            out[n++] = *value++;
            continue;
        }
        if (!value[1]) {
            break;
        }
        value++;
        if (*value == 'u') {
            cp = 0;
            value++;
            for (i = 0; i < 4; i++) {
                int h = hex_nibble(value[i]);
                if (h < 0) {
                    cp = 0;
                    break;
                }
                cp = (cp << 4) | (unsigned int)h;
            }
            if (i == 4) {
                value += 4;
                if (cp >= 0xD800 && cp <= 0xDBFF && value[0] == '\\' && value[1] == 'u') {
                    unsigned int low = 0;
                    int ok = 1;
                    for (i = 0; i < 4; i++) {
                        int h = hex_nibble(value[2 + i]);
                        if (h < 0) {
                            ok = 0;
                            break;
                        }
                        low = (low << 4) | (unsigned int)h;
                    }
                    if (ok && low >= 0xDC00 && low <= 0xDFFF) {
                        cp = 0x10000u + ((cp - 0xD800u) << 10) + (low - 0xDC00u);
                        value += 6;
                    }
                }
                put_utf8(out, out_len, &n, cp);
            }
            continue;
        }
        if (*value == 'n' || *value == 'r' || *value == 't') {
            out[n++] = ' ';
        } else if (*value != 'b' && *value != 'f') {
            out[n++] = *value;
        }
        value++;
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
static const char *find_top_key(const char *json, const char *key);
static int read_top_int(const char *json, const char *key, int *out);

int desk_view_from_json(const char *json, desk_view_t *out) {
    const char *last;
    const char *value;
    const char *end;
    if (!json || !out) {
        return -1;
    }
    memset(out, 0, sizeof(*out));
    read_string_field(json, json + strlen(json), "phase", out->phase, sizeof(out->phase));
    if (read_top_int(json, "unread", &out->unread) != 0 || out->unread < 0) {
        out->unread = 0;
    }
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

static int read_top_int(const char *json, const char *key, int *out) {
    const char *at = find_top_key(json, key);
    const char *p;
    int value = 0;
    int digits = 0;
    if (!json || !at || !out) {
        return -1;
    }
    p = skip_ws(at + strlen(key) + 2);
    if (*p != ':') {
        return -1;
    }
    p = skip_ws(p + 1);
    if (*p == '-') {
        *out = 0;
        return 0;
    }
    while (*p >= '0' && *p <= '9') {
        digits = 1;
        if (value > 100000) {
            value = 100000;
        } else {
            value = value * 10 + (*p - '0');
        }
        p++;
    }
    if (!digits) {
        return -1;
    }
    *out = value;
    return 0;
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
        {"blob", DESK_SHAPE_BLOB},
        {"capsule", DESK_SHAPE_PILL},
        {"cloud", DESK_SHAPE_CLOUD},
        {"clover", DESK_SHAPE_FLOWER},
        {"diamond", DESK_SHAPE_DIAMOND},
        {"drop", DESK_SHAPE_DROP},
        {"flower", DESK_SHAPE_FLOWER},
        {"gear", DESK_SHAPE_SUN},
        {"heart", DESK_SHAPE_HEART},
        {"hex", DESK_SHAPE_HEXAGON},
        {"hexagon", DESK_SHAPE_HEXAGON},
        {"pentagon", DESK_SHAPE_PENTAGON},
        {"pill", DESK_SHAPE_PILL},
        {"rounded", DESK_SHAPE_ROUNDED},
        {"rounded_square", DESK_SHAPE_ROUNDED},
        {"shield", DESK_SHAPE_PENTAGON},
        {"splatter", DESK_SHAPE_BLOB},
        {"square", DESK_SHAPE_SQUARE},
        {"star", DESK_SHAPE_STAR},
        {"sun", DESK_SHAPE_SUN},
        {"teardrop", DESK_SHAPE_DROP},
        {"triangle", DESK_SHAPE_TRIANGLE},
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

int desk_unread_count(const desk_view_t *view) {
    if (!view || view->unread < 1) {
        return 0;
    }
    return view->unread;
}

void desk_row_spans(int avail, int name_px, int gap, int min_aside, int show_aside, int *name_w,
                    int *aside_w) {
    int name = 0;
    int aside = 0;
    int room;
    if (avail < 0) {
        avail = 0;
    }
    if (name_px < 0) {
        name_px = 0;
    }
    if (gap < 0) {
        gap = 0;
    }
    if (min_aside < 0) {
        min_aside = 0;
    }
    if (!show_aside) {
        name = avail;
    } else {
        room = avail - gap;
        if (room < 0) {
            room = 0;
        }
        if (min_aside > room) {
            min_aside = room;
        }
        name = name_px;
        if (name > room - min_aside) {
            name = room - min_aside;
        }
        aside = room - name;
    }
    if (name_w) {
        *name_w = name;
    }
    if (aside_w) {
        *aside_w = aside;
    }
}

const char *desk_face_title(const desk_view_t *view) {
    if (!view || view->title[0] == '\0' ||
        (strcmp(view->title, "Dismissed") == 0 && view->message[0] == '\0')) {
        return "";
    }
    return view->title;
}

int desk_agent_hot(const desk_view_t *view, int index, const char **aside) {
    const desk_agent_t *agent;
    const char *title;
    int needs;
    int owns = 0;
    if (aside) {
        *aside = "";
    }
    if (!view || index < 0 || index >= view->agent_count) {
        return 0;
    }
    agent = &view->agents[index];
    needs = strcmp(agent->status, "needs_you") == 0;
    title = desk_face_title(view);
    if (view->message[0]) {
        if (title[0]) {
            owns = strcmp(agent->title, title) == 0 || strcmp(agent->id, title) == 0;
        } else {
            owns = needs;
        }
    }
    if (owns && aside) {
        *aside = view->message;
    }
    return needs || owns;
}

int desk_aside_scroll(const desk_view_t *prev, const desk_view_t *view) {
    const char *aside = "";
    const char *was = "";
    if (!view || view->agent_count < 1 || !desk_agent_hot(view, 0, &aside) || aside[0] == '\0') {
        return 0;
    }
    if (!prev || prev->agent_count < 1 || strcmp(prev->agents[0].id, view->agents[0].id) != 0) {
        return 1;
    }
    desk_agent_hot(prev, 0, &was);
    return strcmp(was, aside) != 0;
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
