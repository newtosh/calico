#include "ble_desk.h"

#include <stdio.h>
#include <string.h>

_Static_assert(sizeof(((wifi_store_t *)0)->nets[0].ssid) == BLE_DESK_SSID_MAX + 1, "ssid field");
_Static_assert(sizeof(((wifi_store_t *)0)->nets[0].pass) == BLE_DESK_PASS_MAX + 1, "pass field");
_Static_assert(sizeof(((wifi_store_t *)0)->url) == BLE_DESK_URL_MAX + 1, "url field");
_Static_assert(sizeof(((wifi_store_t *)0)->token) == BLE_DESK_TOKEN_MAX + 1, "token field");

static void copy_field(char *dest, size_t dest_len, const char *src) {
    size_t i;
    if (dest_len == 0) {
        return;
    }
    if (!src) {
        dest[0] = '\0';
        return;
    }
    for (i = 0; i + 1 < dest_len && src[i]; i++) {
        dest[i] = src[i];
    }
    dest[i] = '\0';
}

static void clean_field(char *dest, size_t dest_len, const char *src, const char *fallback) {
    size_t i = 0;
    const char *use = (src && src[0]) ? src : fallback;
    if (!use) {
        use = "";
    }
    if (dest_len == 0) {
        return;
    }
    for (; use[i] && i + 1 < dest_len; i++) {
        char c = use[i];
        if (c == '\n' || c == '\r') {
            c = '?';
        }
        dest[i] = c;
    }
    dest[i] = '\0';
}

int ble_desk_format_status(char *out, size_t cap, const char *fw, const char *ssid, const char *url,
                           int token_set) {
    char fw_buf[48];
    char ssid_buf[BLE_DESK_SSID_MAX + 1];
    char url_buf[BLE_DESK_URL_MAX + 1];
    int n;
    if (!out || cap == 0) {
        return -1;
    }
    clean_field(fw_buf, sizeof(fw_buf), fw, "unknown");
    clean_field(ssid_buf, sizeof(ssid_buf), ssid, "none");
    clean_field(url_buf, sizeof(url_buf), url, "none");
    n = snprintf(out, cap, "name=%s\nfw=%s\nssid=%s\nurl=%s\ntoken=%s\n", BLE_DESK_NAME, fw_buf,
                 ssid_buf, url_buf, token_set ? "set" : "none");
    if (n < 0 || (size_t)n >= cap) {
        out[0] = '\0';
        return -1;
    }
    return n;
}

static int strip_tail(const uint8_t *in, size_t len, size_t *out_len) {
    if (len > 0 && !in) {
        return -1;
    }
    while (len > 0 && (in[len - 1] == '\n' || in[len - 1] == '\r')) {
        len--;
    }
    *out_len = len;
    return 0;
}

static int has_break(const uint8_t *in, size_t len) {
    size_t i;
    for (i = 0; i < len; i++) {
        if (in[i] == '\0' || in[i] == '\n' || in[i] == '\r') {
            return 1;
        }
    }
    return 0;
}

static int copy_out(char *out, size_t cap, const uint8_t *in, size_t len) {
    size_t i;
    if (!out || cap == 0 || len >= cap) {
        return -1;
    }
    for (i = 0; i < len; i++) {
        out[i] = (char)in[i];
    }
    out[len] = '\0';
    return 0;
}

int ble_desk_parse_url(const uint8_t *in, size_t len, char *out, size_t cap) {
    size_t n;
    if (strip_tail(in, len, &n) != 0 || has_break(in, n) || n == 0 || n > BLE_DESK_URL_MAX) {
        return -1;
    }
    if (n >= 8 && memcmp(in, "https://", 8) == 0) {
        if (n < 9) {
            return -1;
        }
    } else if (n >= 7 && memcmp(in, "http://", 7) == 0) {
        if (n < 8) {
            return -1;
        }
    } else {
        return -1;
    }
    return copy_out(out, cap, in, n);
}

int ble_desk_parse_token(const uint8_t *in, size_t len, char *out, size_t cap) {
    size_t n;
    if (strip_tail(in, len, &n) != 0 || has_break(in, n) || n > BLE_DESK_TOKEN_MAX) {
        return -1;
    }
    if (!out || cap == 0) {
        return -1;
    }
    if (n == 0) {
        out[0] = '\0';
        return 0;
    }
    return copy_out(out, cap, in, n);
}

int ble_desk_parse_wifi(const uint8_t *in, size_t len, char *ssid, size_t ssid_cap, char *pass,
                        size_t pass_cap) {
    size_t i;
    size_t split = 0;
    size_t pass_n;
    int found = 0;
    const uint8_t *rest;
    size_t rest_len;
    /* The first newline is the separator, so an open network is "ssid\n".
     * A second newline is only legal as a trailing end-of-write. */
    if (len > 0 && !in) {
        return -1;
    }
    for (i = 0; i < len; i++) {
        if (in[i] == '\0' || in[i] == '\r') {
            return -1;
        }
        if (in[i] != '\n') {
            continue;
        }
        if (!found) {
            found = 1;
            split = i;
            continue;
        }
        /* Another newline is the end of the write, not part of the password. */
        if (i + 1 != len) {
            return -1;
        }
    }
    if (!found || split == 0 || split > BLE_DESK_SSID_MAX) {
        return -1;
    }
    rest = in + split + 1;
    rest_len = len - split - 1;
    if (rest_len > 0 && rest[rest_len - 1] == '\n') {
        rest_len--;
    }
    if (rest_len != 0 && (rest_len < 8 || rest_len > BLE_DESK_PASS_MAX)) {
        return -1;
    }
    if (copy_out(ssid, ssid_cap, in, split) != 0) {
        return -1;
    }
    if (rest_len == 0) {
        if (!pass || pass_cap == 0) {
            return -1;
        }
        pass[0] = '\0';
        return 0;
    }
    pass_n = rest_len;
    return copy_out(pass, pass_cap, rest, pass_n);
}

int ble_desk_parse_reboot(const uint8_t *in, size_t len) {
    size_t n;
    if (strip_tail(in, len, &n) != 0 || n != 6 || memcmp(in, "reboot", 6) != 0) {
        return -1;
    }
    return 0;
}

int ble_desk_set_url(wifi_store_t *store, const char *url) {
    if (!store || !url || !url[0] || strlen(url) > BLE_DESK_URL_MAX) {
        return -1;
    }
    copy_field(store->url, sizeof(store->url), url);
    return 0;
}

int ble_desk_set_token(wifi_store_t *store, const char *token) {
    if (!store || !token || strlen(token) > BLE_DESK_TOKEN_MAX) {
        return -1;
    }
    copy_field(store->token, sizeof(store->token), token);
    return 0;
}

int ble_desk_upsert_wifi(wifi_store_t *store, const char *ssid, const char *pass) {
    const char *url = "";
    const char *token = "";
    int i;
    if (!store || !ssid || !ssid[0] || !pass) {
        return -1;
    }
    for (i = 0; i < store->count; i++) {
        if (strcmp(store->nets[i].ssid, ssid) == 0) {
            url = store->nets[i].url;
            token = store->nets[i].token;
            break;
        }
    }
    return wifi_upsert(store, ssid, pass, url, token);
}
