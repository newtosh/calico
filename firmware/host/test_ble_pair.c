#include "ble_pair.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void check(int cond, const char *msg) {
    if (!cond) {
        fprintf(stderr, "FAIL %s\n", msg);
        g_failed = 1;
    }
}

int main(void) {
    char text[BLE_PAIR_TEXT_MAX];
    check(ble_pair_format(123456, text, sizeof text) == 7 && strcmp(text, "123 456") == 0,
          "formats with a space");
    check(ble_pair_format(7, text, sizeof text) == 7 && strcmp(text, "000 007") == 0,
          "pads with zeros");
    check(ble_pair_format(0, text, sizeof text) == 7 && strcmp(text, "000 000") == 0, "zero");
    check(ble_pair_format(999999, text, sizeof text) == 7 && strcmp(text, "999 999") == 0, "max");
    check(ble_pair_format(123456, text, 7) == 0 && text[0] == '\0', "a buffer that is too small gives empty");

    ble_pair_ask_t ask;
    uint16_t conn = 0;
    memset(&ask, 0, sizeof ask);
    check(ble_pair_ask_answer(&ask, 1, 0, &conn) == -1, "nothing open: no answer");

    ble_pair_ask_open(&ask, 3, 1000);
    check(ble_pair_ask_answer(&ask, 1, 2000, &conn) == 1 && conn == 3, "yes in time accepts that link");
    check(ble_pair_ask_answer(&ask, 1, 2000, &conn) == -1, "a second tap answers nothing");

    ble_pair_ask_open(&ask, 4, 1000);
    check(ble_pair_ask_answer(&ask, 0, 2000, &conn) == 0 && conn == 4, "no rejects");

    ble_pair_ask_open(&ask, 9, 1000);
    check(ble_pair_ask_answer(&ask, 1, 1100, &conn) == -1, "a yes right after the code shows is ignored");
    check(ble_pair_ask_answer(&ask, 1, 1000 + BLE_PAIR_ASK_MIN_MS, &conn) == 1 && conn == 9,
          "the ignored yes left the ask open for a later yes");
    ble_pair_ask_open(&ask, 10, 1000);
    check(ble_pair_ask_answer(&ask, 0, 1001, &conn) == 0 && conn == 10, "no is live at once");

    ble_pair_ask_open(&ask, 5, 1000);
    check(ble_pair_ask_answer(&ask, 1, 1000 + BLE_PAIR_ASK_MS, &conn) == 0 && conn == 5,
          "a yes after the timeout rejects");

    ble_pair_ask_open(&ask, 6, 4294967000u);
    check(ble_pair_ask_answer(&ask, 1, 1000, &conn) == 1, "the clock wrapping is not a timeout");

    ble_pair_ask_open(&ask, 7, 0);
    ble_pair_ask_drop(&ask, 8);
    check(ble_pair_ask_answer(&ask, 1, 1000, &conn) == 1 && conn == 7, "another link dropping keeps the ask");
    ble_pair_ask_open(&ask, 7, 0);
    ble_pair_ask_drop(&ask, 7);
    check(ble_pair_ask_answer(&ask, 1, 1000, &conn) == -1, "its link dropping closes the ask");

    char name[BLE_PAIR_PEER_MAX + 1];
    char msg[BLE_PAIR_DONE_MAX];
    check(ble_pair_peer_name((const uint8_t *)"jonn-desk", 9, name, sizeof name) == 9 &&
              strcmp(name, "jonn-desk") == 0,
          "a plain hostname stays");
    check(ble_pair_peer_name((const uint8_t *)"box\r\n", 5, name, sizeof name) == 3 && strcmp(name, "box") == 0,
          "trailing newline and space go");
    check(ble_pair_peer_name((const uint8_t *)"a\tb\x01" "c", 5, name, sizeof name) == 3 && strcmp(name, "abc") == 0,
          "control bytes go");
    check(ble_pair_peer_name((const uint8_t *)"caf\xc3\xa9", 5, name, sizeof name) == 4 &&
              strcmp(name, "caf?") == 0,
          "one UTF-8 character outside ASCII becomes one ?");
    check(ble_pair_peer_name((const uint8_t *)"0123456789012345678901234567890123456789", 40, name, sizeof name) ==
                  BLE_PAIR_PEER_MAX &&
              strlen(name) == BLE_PAIR_PEER_MAX,
          "truncated to the cap");
    check(ble_pair_peer_name((const uint8_t *)"  \n", 3, name, sizeof name) == 0 && name[0] == '\0',
          "blank is empty");
    check(ble_pair_peer_name((const uint8_t *)"\x00" "abc", 4, name, sizeof name) == 3 && strcmp(name, "abc") == 0,
          "NUL is dropped");
    check(ble_pair_peer_name(NULL, 0, name, sizeof name) == 0 && name[0] == '\0', "nothing is empty");
    check(ble_pair_peer_name((const uint8_t *)"abc", 3, name, 2) == 1 && strcmp(name, "a") == 0,
          "a small buffer still terminates");

    check(ble_pair_done_text("jonn-desk", msg, sizeof msg) > 0 && strcmp(msg, "Paired with jonn-desk") == 0,
          "names the computer");
    check(ble_pair_done_text("", msg, sizeof msg) > 0 && strcmp(msg, "Paired") == 0, "no name says Paired");
    check(ble_pair_done_text(NULL, msg, sizeof msg) > 0 && strcmp(msg, "Paired") == 0, "NULL says Paired");

    check(ble_pair_link_trusted(1, 1, 16) == 1, "numeric comparison keys stay");
    check(ble_pair_link_trusted(1, 0, 16) == 0, "Just Works keys go: nobody confirmed a code");
    check(ble_pair_link_trusted(0, 1, 16) == 0, "an unencrypted link is not trusted");
    check(ble_pair_link_trusted(1, 1, 7) == 0, "a short key is not trusted");

    check(ble_pair_store_refuse(BLE_PAIR_STORE_FULL, 1, 0) == 1,
          "a full store refuses a new computer at the request, before any code or card");
    check(ble_pair_store_refuse(BLE_PAIR_STORE_FULL, 1, 1) == 0,
          "a full store still lets a bonded computer re-pair: its bond is replaced");
    check(ble_pair_store_refuse(BLE_PAIR_STORE_OVERFLOW, 1, 1) == 1, "an overflowing bond write never evicts");
    check(ble_pair_store_refuse(BLE_PAIR_STORE_FULL, 0, 0) == 0, "other records keep NimBLE's handling");
    check(ble_pair_store_refuse(BLE_PAIR_STORE_OVERFLOW, 0, 0) == 0, "other records keep NimBLE's handling");

    if (g_failed) {
        return 1;
    }
    puts("test_ble_pair ok");
    return 0;
}
