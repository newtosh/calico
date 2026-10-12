#pragma once

#include <stddef.h>
#include <stdint.h>

/* AXP2101 on the shared I2C bus. The five registers, in this order:
 * 0x00 status 1 (bit 5: external power), 0x01 status 2 (bits 6:5: 01 charging),
 * 0xA4 battery percent, 0x34 and 0x35 battery millivolts (14 bit). VBUS
 * millivolts are never read: they float to garbage with nothing plugged in. */
#define POWER_I2C_ADDR 0x34
#define POWER_NO_BATTERY_MV 2500

typedef struct {
    int present;
    int percent;
    int millivolts;
    int charging;
    int external;
} power_reading_t;

void power_decode(const uint8_t regs[5], power_reading_t *out);

/* "?bat=81&chg=1&ext=1", or "" when there is no reading. Returns the length. */
int power_query(const power_reading_t *r, char *out, size_t cap);

typedef enum {
    POWER_FILL_INK,
    POWER_FILL_AMBER,
    POWER_FILL_RED,
    POWER_FILL_SAGE,
} power_fill_t;

power_fill_t power_fill(const power_reading_t *r);

/* ESP-IDF only (power_task.c). The listener runs on the power task. */
typedef void (*power_listener_t)(const power_reading_t *r);
void power_start(power_listener_t on_change);
void power_get(power_reading_t *out);
