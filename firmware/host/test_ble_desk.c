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
                 "name=grokbot-buddy\n"
                 "fw=886dd11\n"
                 "ssid=none\n"
                 "url=http://192.168.4.30:8787\n"
                 "token=none\n") == 0,
          "status with no join and no token");
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

    if (g_failed) {
        return 1;
    }
    printf("ok\n");
    return 0;
}
