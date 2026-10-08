#include "wifi_store.h"

#include <string.h>

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

static int fits(const char *src, size_t dest_len) {
    size_t n = 0;
    if (!src) {
        return 1;
    }
    while (src[n]) {
        n++;
        if (n >= dest_len) {
            return 0;
        }
    }
    return 1;
}

void wifi_store_init(wifi_store_t *store) {
    if (!store) {
        return;
    }
    memset(store, 0, sizeof(*store));
    copy_field(store->url, sizeof(store->url), WIFI_DEFAULT_URL);
}

void wifi_migrate_legacy(wifi_store_t *store, const char *ssid, const char *pass) {
    if (!store || store->count > 0 || !ssid || !ssid[0]) {
        return;
    }
    if (!fits(ssid, sizeof(store->nets[0].ssid)) || !fits(pass, sizeof(store->nets[0].pass))) {
        return;
    }
    copy_field(store->nets[0].ssid, sizeof(store->nets[0].ssid), ssid);
    copy_field(store->nets[0].pass, sizeof(store->nets[0].pass), pass);
    store->count = 1;
}

int wifi_upsert(wifi_store_t *store, const char *ssid, const char *pass, const char *url,
                const char *token) {
    int i;
    if (!store || !ssid || !ssid[0]) {
        return -1;
    }
    if (!fits(ssid, sizeof(store->nets[0].ssid)) || !fits(pass, sizeof(store->nets[0].pass)) ||
        !fits(url, sizeof(store->nets[0].url)) || !fits(token, sizeof(store->nets[0].token))) {
        return -1;
    }
    for (i = 0; i < store->count; i++) {
        if (strcmp(store->nets[i].ssid, ssid) == 0) {
            copy_field(store->nets[i].pass, sizeof(store->nets[i].pass), pass);
            copy_field(store->nets[i].url, sizeof(store->nets[i].url), url);
            copy_field(store->nets[i].token, sizeof(store->nets[i].token), token);
            return 0;
        }
    }
    if (store->count >= WIFI_NET_MAX) {
        return -1;
    }
    i = store->count;
    memset(&store->nets[i], 0, sizeof(store->nets[i]));
    copy_field(store->nets[i].ssid, sizeof(store->nets[i].ssid), ssid);
    copy_field(store->nets[i].pass, sizeof(store->nets[i].pass), pass);
    copy_field(store->nets[i].url, sizeof(store->nets[i].url), url);
    copy_field(store->nets[i].token, sizeof(store->nets[i].token), token);
    store->count++;
    return 0;
}

int wifi_remove(wifi_store_t *store, const char *ssid) {
    int i;
    int j;
    if (!store || !ssid || !ssid[0]) {
        return -1;
    }
    for (i = 0; i < store->count; i++) {
        if (strcmp(store->nets[i].ssid, ssid) != 0) {
            continue;
        }
        for (j = i; j + 1 < store->count; j++) {
            store->nets[j] = store->nets[j + 1];
        }
        store->count--;
        memset(&store->nets[store->count], 0, sizeof(store->nets[0]));
        return 0;
    }
    return -1;
}

int wifi_pick(const wifi_store_t *store, const wifi_heard_t *heard, int heard_count) {
    int best = -1;
    int best_rssi = 0;
    int i;
    int j;
    if (!store || store->count <= 0 || !heard || heard_count <= 0) {
        return -1;
    }
    for (i = 0; i < store->count; i++) {
        int found = 0;
        int rssi = 0;
        if (!store->nets[i].ssid[0]) {
            continue;
        }
        for (j = 0; j < heard_count; j++) {
            if (!heard[j].ssid || strcmp(heard[j].ssid, store->nets[i].ssid) != 0) {
                continue;
            }
            if (!found || heard[j].rssi > rssi) {
                rssi = heard[j].rssi;
                found = 1;
            }
        }
        if (!found) {
            continue;
        }
        if (best < 0 || rssi > best_rssi) {
            best = i;
            best_rssi = rssi;
        }
    }
    return best;
}

void wifi_endpoint(const wifi_store_t *store, int index, char *url, size_t url_len, char *token,
                   size_t token_len) {
    const char *use_url = WIFI_DEFAULT_URL;
    const char *use_token = "";
    if (!url || url_len == 0) {
        return;
    }
    if (store) {
        if (store->url[0]) {
            use_url = store->url;
        }
        if (store->token[0]) {
            use_token = store->token;
        }
        if (index >= 0 && index < store->count) {
            if (store->nets[index].url[0]) {
                use_url = store->nets[index].url;
            }
            if (store->nets[index].token[0]) {
                use_token = store->nets[index].token;
            }
        }
    }
    copy_field(url, url_len, use_url);
    if (token && token_len > 0) {
        copy_field(token, token_len, use_token);
    }
}
