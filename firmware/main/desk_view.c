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

/* LVGL Montserrat on this panel: ASCII 0x20-0x7E, degree U+00B0, bullet U+2022.
 * Anything else is an ASCII stand-in or dropped, so the label does not draw a box. */
static int font_has(unsigned int cp) {
    return (cp >= 0x20 && cp <= 0x7E) || cp == 0x00B0 || cp == 0x2022;
}

static int utf8_cont(unsigned char c) {
    return (c & 0xC0) == 0x80;
}

static int utf8_cp(const char *s, unsigned int *cp) {
    const unsigned char *u = (const unsigned char *)s;
    unsigned int v;
    if (u[0] < 0x80) {
        *cp = u[0];
        return u[0] ? 1 : 0;
    }
    if ((u[0] & 0xE0) == 0xC0 && utf8_cont(u[1])) {
        v = ((unsigned int)(u[0] & 0x1F) << 6) | (u[1] & 0x3F);
        if (v < 0x80) {
            return 0;
        }
        *cp = v;
        return 2;
    }
    if ((u[0] & 0xF0) == 0xE0 && utf8_cont(u[1]) && utf8_cont(u[2])) {
        v = ((unsigned int)(u[0] & 0x0F) << 12) | ((unsigned int)(u[1] & 0x3F) << 6) | (u[2] & 0x3F);
        if (v < 0x800 || (v >= 0xD800 && v <= 0xDFFF)) {
            return 0;
        }
        *cp = v;
        return 3;
    }
    if ((u[0] & 0xF8) == 0xF0 && utf8_cont(u[1]) && utf8_cont(u[2]) && utf8_cont(u[3])) {
        v = ((unsigned int)(u[0] & 0x07) << 18) | ((unsigned int)(u[1] & 0x3F) << 12) |
            ((unsigned int)(u[2] & 0x3F) << 6) | (u[3] & 0x3F);
        if (v < 0x10000 || v > 0x10FFFF) {
            return 0;
        }
        *cp = v;
        return 4;
    }
    return 0;
}

static const char *fold_latin1(unsigned int cp) {
    static const char *const map[] = {
        "A",  "A",  "A", "A", "A", "A", "AE", "C", "E",  "E", "E", "E", "I", "I", "I", "I",
        "D",  "N",  "O", "O", "O", "O", "O",  "x", "O",  "U", "U", "U", "U", "Y", "Th", "ss",
        "a",  "a",  "a", "a", "a", "a", "ae", "c", "e",  "e", "e", "e", "i", "i", "i", "i",
        "d",  "n",  "o", "o", "o", "o", "o",  "/", "o",  "u", "u", "u", "u", "y", "th", "y",
    };
    if (cp < 0xC0 || cp > 0xFF) {
        return NULL;
    }
    return map[cp - 0xC0];
}

/* Multi-byte stand-in, or NULL when this codepoint is not one of those cases. */
static const char *fold_extra(unsigned int cp) {
    const char *latin = fold_latin1(cp);
    if (latin) {
        return latin;
    }
    if (cp == 0x00A0 || cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0x2028 || cp == 0x2029 ||
        (cp >= 0x2000 && cp <= 0x200A)) {
        return " ";
    }
    if ((cp >= 0x2010 && cp <= 0x2015) || cp == 0x2212 || cp == 0xFE58 || cp == 0xFE63 || cp == 0xFF0D ||
        cp == 0x00AD) {
        return "-";
    }
    if (cp == 0x2018 || cp == 0x2019 || cp == 0x201A || cp == 0x201B || cp == 0x2032 || cp == 0x00B4) {
        return "'";
    }
    if (cp == 0x201C || cp == 0x201D || cp == 0x201E || cp == 0x201F || cp == 0x2033 || cp == 0x00AB ||
        cp == 0x00BB) {
        return "\"";
    }
    if (cp == 0x2026) {
        return "...";
    }
    if (cp == 0x00B7 || cp == 0x2023 || cp == 0x2043 || cp == 0x2219 || cp == 0x25E6 || cp == 0x25CF ||
        cp == 0x25CB || cp == 0x25AA || cp == 0x25AB || cp == 0x30FB || cp == 0x2027) {
        return "*";
    }
    if (cp == 0x2190 || cp == 0x2B05 || cp == 0x25C0 || cp == 0x25C4) {
        return "<-";
    }
    if (cp == 0x2192 || cp == 0x2B95 || cp == 0x27A1 || cp == 0x2794 || cp == 0x25B6 || cp == 0x25B8 ||
        cp == 0x25BA || cp == 0x25B9) {
        return "->";
    }
    if (cp == 0x2191 || cp == 0x2B06 || cp == 0x25B2) {
        return "^";
    }
    if (cp == 0x2193 || cp == 0x2B07 || cp == 0x25BC) {
        return "v";
    }
    if (cp == 0x2194 || cp == 0x21D4) {
        return "<->";
    }
    if (cp == 0x21D2) {
        return "=>";
    }
    if (cp == 0x0152) {
        return "OE";
    }
    if (cp == 0x0153) {
        return "oe";
    }
    if (cp == 0x2500 || cp == 0x2501 || cp == 0x2504 || cp == 0x2505 || cp == 0x2508 || cp == 0x2509 ||
        cp == 0x254C || cp == 0x254D) {
        return "-";
    }
    if (cp == 0x2502 || cp == 0x2503 || cp == 0x2506 || cp == 0x2507 || cp == 0x250A || cp == 0x250B ||
        cp == 0x254E || cp == 0x254F) {
        return "|";
    }
    if (cp >= 0x2500 && cp <= 0x257F) {
        return "+";
    }
    return NULL;
}

static int write_all(char *out, size_t out_len, size_t *n, const char *s) {
    size_t len = strlen(s);
    size_t i;
    if (*n + len >= out_len) {
        return 0;
    }
    for (i = 0; i < len; i++) {
        out[(*n)++] = s[i];
    }
    return 1;
}

/* 1 to keep reading. 0 when the buffer is full. */
static int panel_write(char *out, size_t out_len, size_t *n, unsigned int cp) {
    const char *extra;
    char wide[2];
    size_t before;
    if (cp == 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
        return 1;
    }
    if (cp == '\n' || cp == '\r' || cp == '\t') {
        return write_all(out, out_len, n, " ");
    }
    if (cp < 0x20 || cp == 0x7F) {
        return 1;
    }
    /* Private-use, variation selectors, and zero-width marks are not glyphs here. */
    if ((cp >= 0xE000 && cp <= 0xF8FF) || (cp >= 0xF0000 && cp <= 0xFFFFD) ||
        (cp >= 0x100000 && cp <= 0x10FFFD) || (cp >= 0xFE00 && cp <= 0xFE0F) || cp == 0x200B ||
        cp == 0x200C || cp == 0x200D || cp == 0x200E || cp == 0x200F || cp == 0xFEFF) {
        return 1;
    }
    if (cp >= 0xFF01 && cp <= 0xFF5E) {
        wide[0] = (char)(cp - 0xFEE0);
        wide[1] = '\0';
        return write_all(out, out_len, n, wide);
    }
    if (font_has(cp)) {
        before = *n;
        put_utf8(out, out_len, n, cp);
        return *n != before;
    }
    extra = fold_extra(cp);
    if (!extra) {
        return 1;
    }
    return write_all(out, out_len, n, extra);
}

/* JSON string. \uXXXX (and a surrogate pair) is decoded, then folded onto the
 * panel font. Newlines become a space so a one-line aside does not grow a second row. */
static void copy_string(const char *value, char *out, size_t out_len) {
    size_t n = 0;
    if (out_len == 0) {
        return;
    }
    while (*value && *value != '"') {
        unsigned int cp;
        int i;
        int used;
        if (*value == '\\') {
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
                    if (!panel_write(out, out_len, &n, cp)) {
                        break;
                    }
                }
                continue;
            }
            if (*value == 'n' || *value == 'r' || *value == 't') {
                cp = ' ';
            } else if (*value == 'b' || *value == 'f') {
                value++;
                continue;
            } else {
                cp = (unsigned char)*value;
            }
            value++;
            if (!panel_write(out, out_len, &n, cp)) {
                break;
            }
            continue;
        }
        used = utf8_cp(value, &cp);
        if (used <= 0) {
            value++;
            continue;
        }
        value += used;
        if (!panel_write(out, out_len, &n, cp)) {
            break;
        }
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
static int read_bool_field(const char *start, const char *end, const char *key);
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
    {
        const char *cap = find_top_key(json, "capture");
        const char *bit;
        if (cap) {
            bit = skip_ws(cap + strlen("\"capture\""));
            if (*bit == ':') {
                bit = skip_ws(bit + 1);
                out->capture = strncmp(bit, "true", 4) == 0;
            }
        }
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
                read_string_field(value, end, "agent_id", out->event_agent, sizeof(out->event_agent));
            }
        }
    }
    read_agents(json, out);
    return 0;
}

int desk_view_same(const desk_view_t *a, const desk_view_t *b) {
    /* capture is a one-shot side channel. A request must not look like a new desk. */
    return a && b && memcmp(a, b, offsetof(desk_view_t, capture)) == 0;
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
            read_string_field(p, end, "message", agent->message, sizeof(agent->message));
            copy_string(status, agent->status, sizeof(agent->status));
            agent->attention = read_bool_field(p, end, "attention") ||
                               strcmp(agent->status, "needs_you") == 0;
            if (agent->attention) {
                out->needs_you = 1;
            }
            out->agent_count++;
        }
        p = end;
    }
}

static int read_bool_field(const char *start, const char *end, const char *key) {
    const char *key_at = find_key(start, end, key);
    const char *p;
    if (!key_at) {
        return 0;
    }
    p = skip_ws(key_at + strlen(key) + 2);
    if (p >= end || *p != ':') {
        return 0;
    }
    p = skip_ws(p + 1);
    return p < end && strncmp(p, "true", 4) == 0;
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

static int agent_needs(const desk_agent_t *agent) {
    return agent->attention || strcmp(agent->status, "needs_you") == 0;
}

int desk_sheet_agent(const desk_view_t *view) {
    int i;
    if (!view || view->agent_count < 1) {
        return -1;
    }
    if (agent_needs(&view->agents[0])) {
        return 0;
    }
    for (i = 1; i < view->agent_count; i++) {
        if (agent_needs(&view->agents[i])) {
            return i;
        }
    }
    return -1;
}

uint32_t desk_sheet_ink(uint32_t color) {
    int r = (int)((color >> 16) & 255u);
    int g = (int)((color >> 8) & 255u);
    int b = (int)(color & 255u);
    int y = (299 * r + 587 * g + 114 * b) / 1000;
    return y < 140 ? 0xefe7d6u : 0x14160fu;
}

int desk_sheet_dismiss(int overflow, int dy, int dt_ms) {
    if (dy < 40) {
        return 0;
    }
    if (!overflow) {
        return 1;
    }
    if (dy < 48 || dt_ms > 280) {
        return 0;
    }
    return 1;
}

static void bmp_u16(uint8_t *p, unsigned v) {
    p[0] = (uint8_t)(v & 255u);
    p[1] = (uint8_t)((v >> 8) & 255u);
}

static void bmp_u32(uint8_t *p, unsigned v) {
    p[0] = (uint8_t)(v & 255u);
    p[1] = (uint8_t)((v >> 8) & 255u);
    p[2] = (uint8_t)((v >> 16) & 255u);
    p[3] = (uint8_t)((v >> 24) & 255u);
}

int desk_bmp565_header(uint8_t *dst, size_t cap, int w, int h) {
    unsigned pixels;
    if (!dst || w < 1 || h < 1 || cap < 66) {
        return -1;
    }
    pixels = (unsigned)w * (unsigned)h * 2u;
    memset(dst, 0, 66);
    dst[0] = 'B';
    dst[1] = 'M';
    bmp_u32(dst + 2, 66u + pixels);
    bmp_u32(dst + 10, 66u);
    bmp_u32(dst + 14, 40u);
    bmp_u32(dst + 18, (unsigned)w);
    bmp_u32(dst + 22, (unsigned)(-h));
    bmp_u16(dst + 26, 1u);
    bmp_u16(dst + 28, 16u);
    bmp_u32(dst + 30, 3u);
    bmp_u32(dst + 34, pixels);
    bmp_u32(dst + 54, 0x0000f800u);
    bmp_u32(dst + 58, 0x000007e0u);
    bmp_u32(dst + 62, 0x0000001fu);
    return 66;
}

static int title_hits(const desk_view_t *view, const char *title) {
    int i;
    if (!title || !title[0]) {
        return 0;
    }
    for (i = 0; i < view->agent_count; i++) {
        if (strcmp(view->agents[i].title, title) == 0 || strcmp(view->agents[i].id, title) == 0) {
            return 1;
        }
    }
    return 0;
}

static int needs_rows(const desk_view_t *view) {
    int i;
    int n = 0;
    for (i = 0; i < view->agent_count; i++) {
        n += agent_needs(&view->agents[i]);
    }
    return n;
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
    needs = agent_needs(agent);
    if (agent->message[0]) {
        if (aside) {
            *aside = agent->message;
        }
        return 1;
    }
    title = desk_face_title(view);
    if (view->message[0]) {
        if (view->event_agent[0] && strcmp(agent->id, view->event_agent) == 0) {
            owns = 1;
        } else if (title[0] &&
                   (strcmp(agent->title, title) == 0 || strcmp(agent->id, title) == 0)) {
            owns = 1;
        } else if (!title[0] && needs) {
            owns = 1;
        } else if (needs && needs_rows(view) == 1 && !title_hits(view, title)) {
            owns = 1;
        }
    }
    if (owns && aside) {
        *aside = view->message;
    }
    return needs || owns;
}

static int agent_match(const desk_agent_t *agent, const desk_agent_t *other) {
    if (agent->id[0] && other->id[0]) {
        return strcmp(agent->id, other->id) == 0;
    }
    if (!agent->id[0] && !other->id[0] && agent->title[0] && other->title[0]) {
        return strcmp(agent->title, other->title) == 0;
    }
    return 0;
}

static int find_agent(const desk_view_t *view, const desk_agent_t *agent, int prefer) {
    int i;
    for (i = 0; i < view->agent_count; i++) {
        if (agent_match(agent, &view->agents[i])) {
            return i;
        }
    }
    if (!agent->id[0] && !agent->title[0] && prefer >= 0 && prefer < view->agent_count &&
        !view->agents[prefer].id[0] && !view->agents[prefer].title[0]) {
        return prefer;
    }
    return -1;
}

int desk_unseen_updates(const desk_view_t *prev, const desk_view_t *view) {
    int i;
    int n = 0;
    if (!prev || !view) {
        return 0;
    }
    for (i = 0; i < view->agent_count; i++) {
        const desk_agent_t *agent = &view->agents[i];
        int old = find_agent(prev, agent, i);
        const char *aside = "";
        const char *was = "";
        if (old < 0) {
            n++;
            continue;
        }
        desk_agent_hot(view, i, &aside);
        desk_agent_hot(prev, old, &was);
        if (strcmp(agent->status, prev->agents[old].status) != 0 ||
            agent->attention != prev->agents[old].attention || strcmp(aside, was) != 0) {
            n++;
        }
    }
    return n;
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
