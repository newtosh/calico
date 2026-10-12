#include "power.h"

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
    /* Bytes captured on the real board. Order: 0x00 0x01 0xA4 0x34 0x35. */
    const uint8_t plugged[5] = {0x38, 0x32, 0x51, 0x0F, 0x88};
    const uint8_t unplugged[5] = {0x18, 0x55, 0x51, 0x0F, 0x62};
    uint8_t regs[5];
    power_reading_t r;
    char q[48];

    power_decode(plugged, &r);
    check(r.present == 1, "plugged present");
    check(r.percent == 81, "plugged percent");
    check(r.millivolts == 3976, "plugged mv");
    check(r.charging == 1, "plugged charging");
    check(r.external == 1, "plugged external");
    check(power_fill(&r) == POWER_FILL_SAGE, "charging is sage");

    power_decode(unplugged, &r);
    check(r.charging == 0, "unplugged not charging");
    check(r.external == 0, "unplugged not external");
    check(r.millivolts == 3938, "unplugged mv");
    check(power_fill(&r) == POWER_FILL_INK, "81 percent on battery is ink");

    memcpy(regs, unplugged, sizeof regs);
    regs[2] = 0xFF;
    power_decode(regs, &r);
    check(r.percent == 100, "percent over 100 clamps");

    memcpy(regs, unplugged, sizeof regs);
    regs[3] = 0x00;
    regs[4] = 0x10;
    power_decode(regs, &r);
    check(r.present == 0, "under 2500 mV is no battery");

    regs[3] = 0xFF;
    power_decode(regs, &r);
    check(r.millivolts == (0x3F << 8 | 0x10), "top two bits of the high byte are masked");

    memcpy(regs, unplugged, sizeof regs);
    regs[2] = 20;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_AMBER, "20 is amber");
    regs[2] = 21;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_INK, "21 is ink");
    regs[2] = 10;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_RED, "10 is red");
    regs[1] = 0x32;
    power_decode(regs, &r);
    check(power_fill(&r) == POWER_FILL_SAGE, "charging at 10 is sage");

    power_decode(plugged, &r);
    check(power_query(&r, q, sizeof q) > 0 && strcmp(q, "?bat=81&chg=1&ext=1") == 0, "query");
    power_decode(unplugged, &r);
    power_query(&r, q, sizeof q);
    check(strcmp(q, "?bat=81&chg=0&ext=0") == 0, "query on battery");
    memset(&r, 0, sizeof r);
    check(power_query(&r, q, sizeof q) == 0 && q[0] == '\0', "absent sends no query");
    check(power_query(&r, q, 4) == 0, "absent with a tiny buffer is safe");
    power_decode(plugged, &r);
    check(power_query(&r, q, 6) == 0 && q[0] == '\0', "too small a buffer yields empty");

    if (g_failed) {
        return 1;
    }
    puts("test_power ok");
    return 0;
}
