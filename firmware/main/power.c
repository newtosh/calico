#include "power.h"

#include <stdio.h>

void power_decode(const uint8_t regs[5], power_reading_t *out) {
    int percent = regs[2];
    out->millivolts = ((regs[3] & 0x3F) << 8) | regs[4];
    out->present = out->millivolts >= POWER_NO_BATTERY_MV;
    out->percent = percent > 100 ? 100 : percent;
    out->external = (regs[0] >> 5) & 1;
    out->charging = ((regs[1] >> 5) & 3) == 1;
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
        return;
    }
    *out = h->last;
}

int power_same(const power_reading_t *a, const power_reading_t *b) {
    return a->present == b->present && a->percent == b->percent && a->charging == b->charging &&
           a->external == b->external;
}
