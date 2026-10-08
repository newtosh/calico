#include "wifi_store.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static void add_net(wifi_store_t *store, const char *ssid, const char *pass) {
    check(wifi_upsert(store, ssid, pass, "", "") == 0, ssid);
}

int main(void) {
    wifi_store_t store;
    wifi_heard_t heard[4];
    char url[128];
    char token[128];
    int i;

    wifi_store_init(&store);
    add_net(&store, "alpha", "alpha-pass");
    add_net(&store, "beta", "beta-pass");
    heard[0].ssid = "beta";
    heard[0].rssi = -70;
    heard[1].ssid = "other";
    heard[1].rssi = -20;
    check(wifi_pick(&store, heard, 2) == 1, "one saved ssid in range");

    heard[0].ssid = "alpha";
    heard[0].rssi = -80;
    heard[1].ssid = "beta";
    heard[1].rssi = -40;
    heard[2].ssid = "alpha";
    heard[2].rssi = -90;
    check(wifi_pick(&store, heard, 3) == 1, "strongest of several");

    heard[0].ssid = "alpha";
    heard[0].rssi = -30;
    heard[1].ssid = "alpha";
    heard[1].rssi = -90;
    heard[2].ssid = "beta";
    heard[2].rssi = -40;
    check(wifi_pick(&store, heard, 3) == 0, "strongest bssid of a saved ssid");

    heard[0].ssid = "alpha";
    heard[0].rssi = -50;
    heard[1].ssid = "beta";
    heard[1].rssi = -50;
    check(wifi_pick(&store, heard, 2) == 0, "equal rssi keeps earlier saved network");

    heard[0].ssid = "gamma";
    heard[0].rssi = -30;
    check(wifi_pick(&store, heard, 1) == -1, "none in range");
    check(wifi_pick(&store, heard, 0) == -1, "empty scan");
    check(wifi_pick(&store, NULL, 1) == -1, "null scan");

    wifi_store_init(&store);
    check(strcmp(store.url, WIFI_DEFAULT_URL) == 0, "default url");
    wifi_migrate_legacy(&store, "home", "home-pass-1");
    check(store.count == 1, "legacy count");
    check(strcmp(store.nets[0].ssid, "home") == 0, "legacy ssid");
    check(strcmp(store.nets[0].pass, "home-pass-1") == 0, "legacy pass");
    check(store.nets[0].url[0] == '\0', "legacy has no private url");
    check(store.nets[0].token[0] == '\0', "legacy has no private token");
    check(wifi_upsert(&store, "away", "away-pass-2", "", "") == 0, "add second");
    check(store.count == 2, "count after add");
    check(strcmp(store.nets[0].ssid, "home") == 0, "first ssid kept");
    check(strcmp(store.nets[0].pass, "home-pass-1") == 0, "first pass kept");
    check(strcmp(store.nets[1].ssid, "away") == 0, "second ssid");
    check(strcmp(store.nets[1].pass, "away-pass-2") == 0, "second pass");
    wifi_migrate_legacy(&store, "stale", "nope");
    check(store.count == 2, "legacy ignored once indexed");
    check(strcmp(store.nets[0].ssid, "home") == 0, "stale legacy did not replace");

    check(wifi_upsert(&store, "home", "home-pass-3", "http://10.0.0.8:8787", "net-token") == 0,
          "update first");
    check(store.count == 2, "update does not append");
    check(strcmp(store.nets[0].pass, "home-pass-3") == 0, "updated pass");
    check(strcmp(store.nets[0].url, "http://10.0.0.8:8787") == 0, "per-network url");
    check(strcmp(store.nets[1].ssid, "away") == 0, "second still present");
    check(strcmp(store.nets[1].pass, "away-pass-2") == 0, "second pass untouched");

    wifi_endpoint(&store, 0, url, sizeof(url), token, sizeof(token));
    check(strcmp(url, "http://10.0.0.8:8787") == 0, "endpoint uses network url");
    check(strcmp(token, "net-token") == 0, "endpoint uses network token");
    wifi_endpoint(&store, 1, url, sizeof(url), token, sizeof(token));
    check(strcmp(url, WIFI_DEFAULT_URL) == 0, "endpoint falls back to global url");
    check(token[0] == '\0', "endpoint falls back to empty global token");
    memcpy(store.token, "global-token", sizeof("global-token"));
    wifi_endpoint(&store, 1, url, sizeof(url), token, sizeof(token));
    check(strcmp(token, "global-token") == 0, "endpoint uses global token");
    check(strcmp(url, WIFI_DEFAULT_URL) == 0, "url still global");

    wifi_store_init(&store);
    store.url[0] = '\0';
    store.token[0] = '\0';
    add_net(&store, "only", "only-pass");
    wifi_endpoint(&store, 0, url, sizeof(url), token, sizeof(token));
    check(strcmp(url, WIFI_DEFAULT_URL) == 0, "compiled default when nothing stored");
    check(token[0] == '\0', "no token by default");

    wifi_store_init(&store);
    for (i = 0; i < WIFI_NET_MAX; i++) {
        char ssid[8];
        snprintf(ssid, sizeof(ssid), "n%d", i);
        check(wifi_upsert(&store, ssid, "eightchar", "", "") == 0, "fill");
    }
    check(wifi_upsert(&store, "overflow", "eightchar", "", "") == -1, "full rejects new");
    check(store.count == WIFI_NET_MAX, "full count");
    check(strcmp(store.nets[0].ssid, "n0") == 0, "full did not drop the first");
    check(wifi_remove(&store, "n0") == 0, "remove first");
    check(store.count == WIFI_NET_MAX - 1, "count after remove");
    check(strcmp(store.nets[0].ssid, "n1") == 0, "packed after remove");
    check(wifi_remove(&store, "missing") == -1, "remove absent");
    check(store.count == WIFI_NET_MAX - 1, "absent remove keeps the rest");

    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
