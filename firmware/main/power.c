#include "power.h"

#include <stdio.h>

/* A typical rested 4.2 V lithium cell. Between points the estimate is a straight line. */
static const struct {
    int mv;
    int pct;
} k_curve[] = {
    {3270, 0},  {3610, 5},  {3690, 10}, {3710, 15}, {3730, 20},  {3750, 25},  {3770, 30},
    {3790, 35}, {3800, 40}, {3820, 45}, {3840, 50}, {3850, 55},  {3870, 60},  {3910, 65},
    {3950, 70}, {3980, 75}, {4020, 80}, {4080, 85}, {4110, 90},  {4150, 95},  {4200, 100},
};
#define CURVE_N ((int)(sizeof k_curve / sizeof k_curve[0]))

int power_estimate_percent(int millivolts) {
    if (millivolts <= k_curve[0].mv) {
        return 0;
    }
    for (int i = 1; i < CURVE_N; i++) {
        if (millivolts <= k_curve[i].mv) {
            int span = k_curve[i].mv - k_curve[i - 1].mv;
            return k_curve[i - 1].pct + (k_curve[i].pct - k_curve[i - 1].pct) *
                                            (millivolts - k_curve[i - 1].mv) / span;
        }
    }
    return 100;
}

void power_decode(const uint8_t regs[5], power_reading_t *out) {
    int percent = regs[2];
    out->millivolts = ((regs[3] & 0x3F) << 8) | regs[4];
    /* Status 1 bit 3 is the chip's "battery present" flag. It is clear with the connector
     * pulled, when the voltage reading pegs near 16 V, so the flag has to decide. The
     * voltage floor still drops a cell that is connected but dead. */
    out->present = ((regs[0] >> 3) & 1) && out->millivolts >= POWER_NO_BATTERY_MV;
    out->percent = percent > 100 ? 100 : percent;
    out->external = (regs[0] >> 5) & 1;
    out->charging = ((regs[1] >> 5) & 3) == 1;
    out->estimated = 0;
    /* A gauge that truly reads 0 above 3.5 V is indistinguishable from a stuck one, and
     * the curve gives 3 to 5 percent there, which still draws red, so the low-battery
     * warning is not lost. */
    if (out->present && out->percent == 0 && out->millivolts >= POWER_GAUGE_STUCK_MV) {
        out->percent = power_estimate_percent(out->millivolts);
        out->estimated = 1;
    }
}

int power_query(const power_reading_t *r, char *out, size_t cap) {
    int n;
    if (cap > 0) {
        out[0] = '\0';
    }
    if (!r || !r->present || cap == 0) {
        return 0;
    }
    n = snprintf(out, cap, "?bat=%d&chg=%d&ext=%d", r->percent, r->charging ? 1 : 0,
                 r->external ? 1 : 0);
    if (n < 0 || (size_t)n >= cap) {
        out[0] = '\0';
        return 0;
    }
    return n;
}

power_fill_t power_fill(const power_reading_t *r) {
    if (r->charging) {
        return POWER_FILL_SAGE;
    }
    if (r->percent <= 10) {
        return POWER_FILL_RED;
    }
    if (r->percent <= 20) {
        return POWER_FILL_AMBER;
    }
    return POWER_FILL_INK;
}

void power_hold(power_hold_t *h, const power_reading_t *fresh, power_reading_t *out) {
    if (fresh) {
        h->last = *fresh;
        h->misses = 0;
        *out = *fresh;
        return;
    }
    if (h->misses < POWER_MISS_LIMIT) {
        h->misses++;
    }
    if (h->misses >= POWER_MISS_LIMIT) {
        out->present = 0;
        out->percent = 0;
        out->millivolts = 0;
        out->charging = 0;
        out->external = 0;
        out->estimated = 0;
        return;
    }
    *out = h->last;
}

int power_same(const power_reading_t *a, const power_reading_t *b) {
    return a->present == b->present && a->percent == b->percent && a->charging == b->charging &&
           a->external == b->external;
}
