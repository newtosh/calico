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

    {
        power_hold_t h;
        power_reading_t good;
        power_reading_t same;
        memset(&h, 0, sizeof h);
        power_decode(plugged, &good);
        power_hold(&h, &good, &r);
        check(r.present == 1 && r.percent == 81, "a good read passes through");
        power_hold(&h, NULL, &r);
        check(r.present == 1 && r.percent == 81, "one failed read keeps the last good");
        power_hold(&h, NULL, &r);
        check(r.present == 1, "two failed reads keep it");
        power_hold(&h, NULL, &r);
        check(r.present == 0, "the third failed read reports absent");
        power_hold(&h, &good, &r);
        check(r.present == 1, "a good read recovers");
        power_hold(&h, NULL, &r);
        check(r.present == 1, "the miss count restarted");

        same = good;
        same.millivolts += 7;
        check(power_same(&good, &same) == 1, "millivolt jitter is not a change");
        same.percent -= 1;
        check(power_same(&good, &same) == 0, "a percent change is");
        same = good;
        same.charging = 0;
        check(power_same(&good, &same) == 0, "a charging change is");
        same = good;
        same.external = 0;
        check(power_same(&good, &same) == 0, "an external power change is");
        same = good;
        same.present = 0;
        check(power_same(&good, &same) == 0, "losing the battery is");
    }

    {
        /* Captured on the real board with the battery connector pulled and USB in. */
        const uint8_t no_battery[5] = {0x20, 0x15, 0x00, 0x3F, 0xF3};
        power_reading_t gone;
        uint8_t flagless[5];
        power_decode(no_battery, &gone);
        check(gone.present == 0, "no battery: the present flag is clear, so absent");
        check(gone.external == 1, "no battery: USB power is still seen");
        check(power_query(&gone, q, sizeof q) == 0 && q[0] == '\0', "no battery: nothing is reported");

        /* The flag decides, not the voltage: a clear flag with a believable reading is still absent. */
        memcpy(flagless, plugged, sizeof flagless);
        flagless[0] = 0x20;
        power_decode(flagless, &gone);
        check(gone.present == 0, "a clear present flag means no battery whatever the voltage");

        /* And a set flag with a dead-low voltage is still absent. */
        memcpy(flagless, plugged, sizeof flagless);
        flagless[3] = 0x00;
        flagless[4] = 0x10;
        power_decode(flagless, &gone);
        check(gone.present == 0, "a set flag with under 2500 mV is absent");
    }

    if (g_failed) {
        return 1;
    }
    puts("test_power ok");
    return 0;
}
