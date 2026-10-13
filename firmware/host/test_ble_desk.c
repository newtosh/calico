#include "ble_desk.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

static int parse_url(const char *text, char *out, size_t cap) {
    return ble_desk_parse_url((const uint8_t *)text, strlen(text), out, cap);
}

static int parse_token(const char *text, char *out, size_t cap) {
    return ble_desk_parse_token((const uint8_t *)text, strlen(text), out, cap);
}

static int parse_wifi(const char *text, char *ssid, char *pass) {
    return ble_desk_parse_wifi((const uint8_t *)text, strlen(text), ssid, 33, pass, 65);
}

static int parse_cfg(const char *text, ble_desk_wifi_t *req) {
    return ble_desk_parse_wifi_cfg((const uint8_t *)text, strlen(text), req);
}

int main(void) {
    char body[256];
    char field[128];
    char ssid[33];
    char pass[65];
    wifi_store_t store;
    int n;
    const char *secret = "desk-bearer-secret";

    n = ble_desk_format_status(body, sizeof(body), "886dd11", "", "http://192.168.4.30:8787", 0);
    check(n > 0, "status length");
    check(strcmp(body,
                 "name=ginger\n"
                 "fw=886dd11\n"
                 "ssid=none\n"
                 "url=http://192.168.4.30:8787\n"
                 "token=none\n"
                 "pair=1\n"
                 "paired=1\n") == 0,
          "status with no join and no token");
    {
        char locked[128];
        int ln = ble_desk_format_status_locked(locked, sizeof locked, "abc1234");
        check(ln > 0 && strcmp(locked, "name=ginger\nfw=abc1234\npair=1\npaired=0\n") == 0,
              "locked status shows only name, fw and the pairing flags");
        check(strstr(locked, "ssid=") == NULL && strstr(locked, "url=") == NULL &&
                  strstr(locked, "token=") == NULL,
              "locked status leaks no network detail");
        check(ble_desk_format_status_locked(locked, 8, "abc1234") < 0,
              "locked status refuses a small buffer");
    }
    check(strstr(body, secret) == NULL, "status has no bearer");

    n = ble_desk_format_status(body, sizeof(body), "", "Cafe WiFi", "https://desk.local:8787", 1);
    check(n > 0, "joined status length");
    check(strstr(body, "fw=unknown\n") != NULL, "missing sha");
    check(strstr(body, "ssid=Cafe WiFi\n") != NULL, "joined ssid");
    check(strstr(body, "token=set\n") != NULL, "token flag");
    check(strstr(body, secret) == NULL, "set flag is not the secret");

    check(ble_desk_format_status(body, sizeof(body), "abc\ndef", "a\nb", "http://x\ny", 0) > 0,
          "breaks become question marks");
    check(strchr(body, '\n') != NULL, "record still has newlines");
    check(strstr(body, "fw=abc?def\n") != NULL, "sha break");
    check(strstr(body, "ssid=a?b\n") != NULL, "ssid break");

    check(ble_desk_format_status(body, 8, "886dd11", "n", "http://x", 0) < 0, "short buffer");

    check(parse_url("http://192.168.4.30:8787", field, sizeof(field)) == 0, "url");
    check(strcmp(field, "http://192.168.4.30:8787") == 0, "url copied");
    check(parse_url("https://desk.example/hook\n", field, sizeof(field)) == 0, "url trailing nl");
    check(strcmp(field, "https://desk.example/hook") == 0, "url stripped");
    check(parse_url("http://", field, sizeof(field)) != 0, "bare http");
    check(parse_url("https://", field, sizeof(field)) != 0, "bare https");
    check(parse_url("ftp://192.168.4.30", field, sizeof(field)) != 0, "ftp");
    check(parse_url("http://bad\nhost", field, sizeof(field)) != 0, "url break");
    {
        char long_url[160];
        memset(long_url, 'a', sizeof(long_url) - 1);
        long_url[sizeof(long_url) - 1] = '\0';
        memcpy(long_url, "http://", 7);
        check(parse_url(long_url, field, sizeof(field)) != 0, "url too long");
    }

    check(parse_token("", field, sizeof(field)) == 0, "empty token clears");
    check(field[0] == '\0', "cleared token");
    check(parse_token("desk-secret\n", field, sizeof(field)) == 0, "token nl");
    check(strcmp(field, "desk-secret") == 0, "token value");
    check(parse_token("has\nbreak", field, sizeof(field)) != 0, "token break");

    check(parse_wifi("home\npassword1", ssid, pass) == 0, "wifi");
    check(strcmp(ssid, "home") == 0 && strcmp(pass, "password1") == 0, "wifi fields");
    check(parse_wifi("open\n", ssid, pass) == 0, "open network");
    check(strcmp(ssid, "open") == 0 && pass[0] == '\0', "empty password");
    check(parse_wifi("home\npassword1\n", ssid, pass) == 0, "wifi trailing nl");
    check(strcmp(ssid, "home") == 0 && strcmp(pass, "password1") == 0, "trailing nl stripped");
    check(parse_wifi("home\nshort", ssid, pass) != 0, "short wpa");
    check(parse_wifi("home", ssid, pass) != 0, "missing newline");
    check(parse_wifi("home\npassword1\nextra", ssid, pass) != 0, "two newlines");
    check(parse_wifi("\npassword1", ssid, pass) != 0, "empty ssid");

    check(ble_desk_parse_reboot((const uint8_t *)"reboot", 6) == 0, "reboot");
    check(ble_desk_parse_reboot((const uint8_t *)"reboot\n", 7) == 0, "reboot nl");
    check(ble_desk_parse_reboot((const uint8_t *)"reboot\r\n", 8) == 0, "reboot crlf");
    check(ble_desk_parse_reboot((const uint8_t *)"reboot-now", 10) != 0, "reboot extra");
    check(ble_desk_parse_reboot((const uint8_t *)"boot", 4) != 0, "reboot short");

    wifi_store_init(&store);
    check(ble_desk_set_url(&store, "http://10.0.0.8:8787") == 0, "set url");
    check(strcmp(store.url, "http://10.0.0.8:8787") == 0, "url stored");
    check(ble_desk_set_token(&store, secret) == 0, "set token");
    check(strcmp(store.token, secret) == 0, "token stored");
    check(ble_desk_set_token(&store, "") == 0, "clear token");
    check(store.token[0] == '\0', "token cleared");
    check(strcmp(store.url, "http://10.0.0.8:8787") == 0, "url kept");

    check(wifi_upsert(&store, "home", "password1", "http://per-net/", "per-token") == 0, "seed");
    check(ble_desk_upsert_wifi(&store, "home", "password2") == 0, "update pass");
    check(strcmp(store.nets[0].pass, "password2") == 0, "pass replaced");
    check(strcmp(store.nets[0].url, "http://per-net/") == 0, "per-net url kept");
    check(strcmp(store.nets[0].token, "per-token") == 0, "per-net token kept");
    check(ble_desk_upsert_wifi(&store, "cafe", "password3") == 0, "append");
    check(store.count == 2, "count");
    check(store.nets[1].url[0] == '\0' && store.nets[1].token[0] == '\0', "new slot follows global");
    check(strcmp(store.url, "http://10.0.0.8:8787") == 0, "global url kept");

    check(ble_desk_parse_scan((const uint8_t *)"scan", 4) == 0, "scan");
    check(ble_desk_parse_scan((const uint8_t *)"scan\n", 5) == 0, "scan nl");
    check(ble_desk_parse_scan((const uint8_t *)"scan\r\n", 6) == 0, "scan crlf");
    check(ble_desk_parse_scan((const uint8_t *)"scan\0", 5) == 0, "scan nul");
    check(ble_desk_parse_scan((const uint8_t *)"scan-now", 8) != 0, "scan extra");
    check(ble_desk_parse_scan((const uint8_t *)"sca", 3) != 0, "scan short");

    n = ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_IDLE, NULL, 0);
    check(n > 0 && strcmp(body, "state=idle\n") == 0, "scan idle");
    n = ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_BUSY, NULL, 1);
    check(n > 0 && strcmp(body, "state=busy\n") == 0, "scan busy ignores rows");
    n = ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_FAIL, NULL, 0);
    check(n > 0 && strcmp(body, "state=fail\n") == 0, "scan fail");
    {
        ble_desk_ap_t aps[3];
        memset(aps, 0, sizeof(aps));
        memcpy(aps[0].ssid, "Cafe WiFi", 10);
        aps[0].rssi = -45;
        memcpy(aps[1].ssid, "a\tb", 4);
        aps[1].rssi = -50;
        memcpy(aps[2].ssid, "home", 5);
        aps[2].rssi = -70;
        n = ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_READY, aps, 3);
        check(n > 0, "scan ready length");
        check(strcmp(body, "state=ready\n-45\tCafe WiFi\n-70\thome\n") == 0, "scan skips tab ssid");
        check(strstr(body, "a\tb") == NULL, "tab ssid not written back");
    }
    n = ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_READY, NULL, 0);
    check(n > 0 && strcmp(body, "state=ready\n") == 0, "scan ready empty");
    {
        ble_desk_ap_t many[BLE_DESK_SCAN_MAX + 2];
        int i;
        memset(many, 0, sizeof(many));
        for (i = 0; i < BLE_DESK_SCAN_MAX + 2; i++) {
            snprintf(many[i].ssid, sizeof(many[i].ssid), "net-%02d", i);
            many[i].rssi = (int8_t)(-10 - i);
        }
        n = ble_desk_format_scan(body, sizeof(body), BLE_DESK_SCAN_READY, many, BLE_DESK_SCAN_MAX + 2);
        check(n > 0, "scan cap length");
        check(strstr(body, "net-00") != NULL, "first ap kept");
        check(strstr(body, "net-15") != NULL, "sixteenth ap kept");
        check(strstr(body, "net-16") == NULL, "past cap dropped");
    }
    {
        ble_desk_ap_t one;
        memset(&one, 0, sizeof(one));
        memcpy(one.ssid, "home", 5);
        one.rssi = -40;
        check(ble_desk_format_scan(body, 8, BLE_DESK_SCAN_READY, &one, 1) < 0, "scan short buffer");
    }

    n = ble_desk_format_probe(body, sizeof(body), BLE_DESK_PROBE_IDLE, "home", "auth");
    check(n > 0 && strcmp(body, "state=idle\n") == 0, "probe idle");
    n = ble_desk_format_probe(body, sizeof(body), BLE_DESK_PROBE_BUSY, "home", NULL);
    check(n > 0 && strcmp(body, "state=busy\nssid=home\n") == 0, "probe busy");
    n = ble_desk_format_probe(body, sizeof(body), BLE_DESK_PROBE_OK, "Cafe WiFi", "auth");
    check(n > 0 && strcmp(body, "state=ok\nssid=Cafe WiFi\n") == 0, "probe ok drops reason");
    check(strstr(body, "reason=") == NULL, "ok has no reason");
    n = ble_desk_format_probe(body, sizeof(body), BLE_DESK_PROBE_FAIL, "home", "auth");
    check(n > 0 && strcmp(body, "state=fail\nssid=home\nreason=auth\n") == 0, "probe auth");
    n = ble_desk_format_probe(body, sizeof(body), BLE_DESK_PROBE_FAIL, "a\nb", NULL);
    check(n > 0 && strstr(body, "ssid=a?b\n") != NULL, "probe ssid break");
    check(strstr(body, "reason=other\n") != NULL, "missing reason");
    check(ble_desk_format_probe(body, 8, BLE_DESK_PROBE_FAIL, "home", "auth") < 0, "probe short");

    check(strcmp(ble_desk_probe_reason(15), "auth") == 0, "4way is auth");
    check(strcmp(ble_desk_probe_reason(202), "auth") == 0, "auth fail");
    check(strcmp(ble_desk_probe_reason(204), "auth") == 0, "handshake timeout");
    check(strcmp(ble_desk_probe_reason(2), "auth") == 0, "auth expire");
    check(strcmp(ble_desk_probe_reason(201), "missing") == 0, "no ap");
    check(strcmp(ble_desk_probe_reason(200), "timeout") == 0, "beacon timeout");
    check(strcmp(ble_desk_probe_reason(0), "other") == 0, "unset reason");
    check(strcmp(ble_desk_probe_reason(8), "other") == 0, "assoc leave");

    check(ble_desk_sta_authmode(0) == 0, "open threshold");
    check(ble_desk_sta_authmode(1) == 3, "wpa2 threshold");

    {
        char nets[BLE_DESK_NETS_TEXT];
        int i;

        wifi_store_init(&store);
        n = ble_desk_format_nets(nets, sizeof(nets), &store);
        check(n > 0 && strcmp(nets, "count=0\n") == 0, "nets empty");
        check(wifi_upsert(&store, "home", "placeholder-pass", "http://10.0.0.8:8787",
                          "placeholder-token") == 0,
              "nets seed home");
        check(wifi_upsert(&store, "cafe", "", "", "") == 0, "nets seed cafe");
        n = ble_desk_format_nets(nets, sizeof(nets), &store);
        check(n > 0 && strcmp(nets, "count=2\n11\thome\n00\tcafe\n") == 0, "nets rows");
        check(strstr(nets, "placeholder-pass") == NULL && strstr(nets, "placeholder-token") == NULL &&
                  strstr(nets, "10.0.0.8") == NULL,
              "nets carries no password, token or url");

        wifi_store_init(&store);
        for (i = 0; i < WIFI_NET_MAX; i++) {
            char ssid[BLE_DESK_SSID_MAX + 1];
            memset(ssid, 'a' + i, BLE_DESK_SSID_MAX);
            ssid[BLE_DESK_SSID_MAX] = '\0';
            check(wifi_upsert(&store, ssid, "placeholder-pass", "http://10.0.0.8:8787",
                              "placeholder-token") == 0,
                  "nets fill");
        }
        n = ble_desk_format_nets(nets, sizeof(nets), &store);
        check(n > 0 && n < BLE_DESK_NETS_TEXT, "eight 32-byte ssids fit the nets text");
        check(strncmp(nets, "count=8\n", 8) == 0, "nets full count");
        check(ble_desk_format_nets(nets, 16, &store) < 0 && nets[0] == '\0',
              "nets refuses a small buffer");
        n = ble_desk_format_nets(nets, sizeof(nets), NULL);
        check(n > 0 && strcmp(nets, "count=0\n") == 0, "nets without a store");
        memcpy(store.nets[0].ssid, "a\nb", 4);
        check(ble_desk_format_nets(nets, sizeof(nets), &store) > 0 && strstr(nets, "\ta?b\n") != NULL,
              "a newline in a saved ssid cannot add a row");
    }
    {
        char name[BLE_DESK_SSID_MAX + 1];
        /* U+1F4F6 is four UTF-8 bytes: eight fill an SSID, nine do not fit. */
        const char *eight = "\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6"
                            "\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6\xf0\x9f\x93\xb6";
        char nine[40];
        snprintf(nine, sizeof(nine), "%s\xf0\x9f\x93\xb6", eight);
        check(ble_desk_parse_forget((const uint8_t *)"home", 4, name, sizeof(name)) == 0 &&
                  strcmp(name, "home") == 0,
              "forget");
        check(ble_desk_parse_forget((const uint8_t *)"home\r\n", 6, name, sizeof(name)) == 0 &&
                  strcmp(name, "home") == 0,
              "forget crlf");
        check(ble_desk_parse_forget((const uint8_t *)"", 0, name, sizeof(name)) != 0, "forget empty");
        check(ble_desk_parse_forget((const uint8_t *)"\n", 1, name, sizeof(name)) != 0,
              "forget only a newline");
        check(ble_desk_parse_forget((const uint8_t *)"ho\nme", 5, name, sizeof(name)) != 0,
              "forget break");
        check(ble_desk_parse_forget((const uint8_t *)"ho\0me", 5, name, sizeof(name)) != 0,
              "forget nul");
        check(ble_desk_parse_forget((const uint8_t *)eight, strlen(eight), name, sizeof(name)) == 0,
              "forget a 32-byte emoji ssid");
        check(ble_desk_parse_forget((const uint8_t *)nine, strlen(nine), name, sizeof(name)) != 0,
              "forget refuses a 36-byte ssid");
    }
    {
        ble_desk_wifi_t req;
        char big[BLE_DESK_WIFI_CFG_MAX + 1];
        int i;

        check(parse_cfg("home\nplaceholder-pass", &req) == 0 && !req.has_cfg &&
                  strcmp(req.ssid, "home") == 0 && strcmp(req.pass, "placeholder-pass") == 0,
              "two-line wifi");
        check(parse_cfg("open\n", &req) == 0 && !req.has_cfg && req.pass[0] == '\0', "open network");
        check(parse_cfg("open\n\n", &req) == 0 && !req.has_cfg && req.pass[0] == '\0',
              "open network and a trailing newline");
        check(parse_cfg("home\nplaceholder-pass\n", &req) == 0 && !req.has_cfg,
              "two lines and a trailing newline");
        check(parse_cfg("home\nplaceholder-pass\nhttp://10.0.0.8:8787\nplaceholder-token", &req) == 0 &&
                  req.has_cfg && strcmp(req.url, "http://10.0.0.8:8787") == 0 &&
                  strcmp(req.token, "placeholder-token") == 0,
              "four lines");
        check(parse_cfg("home\nplaceholder-pass\nhttp://10.0.0.8:8787\nplaceholder-token\n", &req) == 0 &&
                  req.has_cfg && strcmp(req.token, "placeholder-token") == 0,
              "four lines and a trailing newline");
        check(parse_cfg("home\nplaceholder-pass\n\n", &req) == 0 && req.has_cfg && req.url[0] == '\0' &&
                  req.token[0] == '\0',
              "empty url and token clear the slot's own");
        check(parse_cfg("open\n\n\n", &req) == 0 && req.has_cfg && req.pass[0] == '\0',
              "open network with cleared url and token");
        check(parse_cfg("home\nplaceholder-pass\nhttp://x", &req) != 0, "three lines");
        check(parse_cfg("home\nplaceholder-pass\nftp://x\nt", &req) != 0, "bad url");
        check(req.pass[0] == '\0' && req.ssid[0] == '\0', "a refused write leaves no password behind");
        check(parse_cfg("home\nplaceholder-pass\nhttp://x\nt\nextra", &req) != 0, "five lines");
        check(parse_cfg("home\nplaceholder-pass\nhttp://x\nto\rken", &req) != 0, "cr in token");
        check(parse_cfg("home\nshort\nhttp://x\nt", &req) != 0, "short wpa in four lines");

        /* The longest legal write: 32 + 1 + 64 + 1 + 127 + 1 + 127 bytes and a trailing newline. */
        i = 0;
        memset(big + i, 's', 32);
        i += 32;
        big[i++] = '\n';
        memset(big + i, 'p', 64);
        i += 64;
        big[i++] = '\n';
        memcpy(big + i, "http://", 7);
        memset(big + i + 7, 'u', 120);
        i += 127;
        big[i++] = '\n';
        memset(big + i, 't', 127);
        i += 127;
        big[i++] = '\n';
        big[i] = '\0';
        check(i == BLE_DESK_WIFI_CFG_MAX, "the longest write is BLE_DESK_WIFI_CFG_MAX");
        check(parse_cfg(big, &req) == 0 && req.has_cfg, "the longest write parses");

        wifi_store_init(&store);
        check(wifi_upsert(&store, "home", "placeholder-pass", "http://per-net/", "per-token") == 0,
              "apply seed");
        check(parse_cfg("home\nplaceholder-pass-2", &req) == 0 && ble_desk_apply_wifi(&store, &req) == 0,
              "apply two-line");
        check(strcmp(store.nets[0].url, "http://per-net/") == 0 &&
                  strcmp(store.nets[0].token, "per-token") == 0,
              "two-line keeps the slot's url and token");
        check(parse_cfg("home\nplaceholder-pass-2\nhttp://10.0.0.9:8787\nnew-token", &req) == 0 &&
                  ble_desk_apply_wifi(&store, &req) == 0,
              "apply four-line");
        check(store.count == 1 && strcmp(store.nets[0].url, "http://10.0.0.9:8787") == 0 &&
                  strcmp(store.nets[0].token, "new-token") == 0,
              "four-line replaces them in place");
        for (i = 1; i < WIFI_NET_MAX; i++) {
            char ssid[8];
            snprintf(ssid, sizeof(ssid), "n%d", i);
            check(wifi_upsert(&store, ssid, "placeholder-pass", "", "") == 0, "apply fill");
        }
        check(parse_cfg("ninth\nplaceholder-pass\nhttp://x\nt", &req) == 0 &&
                  ble_desk_apply_wifi(&store, &req) != 0,
              "apply refuses a ninth network");
        check(store.count == WIFI_NET_MAX && strcmp(store.nets[0].ssid, "home") == 0,
              "apply refuses a ninth network and keeps the eight");
        check(ble_desk_apply_wifi(NULL, &req) != 0 && ble_desk_apply_wifi(&store, NULL) != 0,
              "apply refuses null");
        check(wifi_remove(&store, "home") == 0 && store.count == WIFI_NET_MAX - 1, "forget frees a slot");
    }

    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
