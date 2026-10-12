# Panel battery, design

Status: draft for review. Date: 2026-10-12.

## Goal

Show the panel's battery in the top-right corner of its status bar, styled like the macOS menu bar, and report it to Calico so the app shows it too. Charge limiting is a separate, later change (see Out of scope).

## What was verified

A throwaway probe on the real board (Waveshare ESP32-S3-Touch-AMOLED-2.16, battery attached) confirmed that the AXP2101 power chip answers at I2C `0x34` on the bus the firmware already owns (`bsp_i2c_get_handle()`, shared with the QMI8658 IMU). Readings, plugged in and then unplugged:

| Register    | Plugged in | Unplugged          | Meaning                                                                                      |
| ----------- | ---------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `0x00`      | `0x38`     | `0x18`             | bit 5 set: external power (VBUS) present                                                     |
| `0x01`      | `0x32`     | `0x55`             | bits 6:5 `01` charging (low bits `010`, constant current); `10` discharging (low bits `101`) |
| `0xA4`      | `0x51`     | `0x51`             | battery percent (81)                                                                         |
| `0x34/0x35` | `0x0F88`   | `0x0F62`           | battery millivolts, 14 bit (3976, 3938)                                                      |
| `0x38/0x39` | `0x13C1`   | garbage (`0x3FF3`) | VBUS millivolts. Only valid while `0x00` bit 5 is set.                                       |

Unverified: the "battery present" bit, and the percentage curve under load. The design avoids both: no battery is inferred from millivolts below 2500 or an unanswered chip, and the percentage is shown as the chip reports it.

## Scope

In: firmware reads the chip; the status bar shows it; the panel reports it on its existing poll; the companion stores it; the Dashboard and Device screen show it.

Out of scope, each its own change:

- Charge limiting, slowing the charge, protection thresholds (hardware cap and a percentage policy).
- Low-battery alerts, history graphs, notifications.
- Reporting while the panel reaches Calico only through the relay. The panel polls the LAN companion, so there is nothing to report to when it cannot.

## Firmware

New `power.c` and `power.h`, split so the decision logic has no hardware in it:

- `power_decode(const uint8_t regs[...], power_reading_t *out)` is pure. Input: the bytes of `0x00`, `0x01`, `0xA4`, `0x34`, `0x35`. Output: `{ present, percent, millivolts, charging, external }`.
  - `external` is `0x00` bit 5. VBUS millivolts are never read, so the garbage unplugged value cannot leak.
  - `charging` is `0x01` bits 6:5 equal `01`.
  - `percent` is `0xA4` clamped to 0..100. `present` is false when millivolts is under 2500.
- `power_start()` creates one small task. Every 10 s it reads the five registers (one transaction each, 100 kHz, 100 ms timeout) and, if the reading changed, stores it behind a mutex and calls the UI setter. If the chip does not answer, the reading is marked absent.
- `power_get(power_reading_t *out)` returns the last reading for the poll code.

The task shares the existing I2C bus handle with the IMU task. The bus driver serializes transactions, so no extra lock is needed.

## Status bar widget

A new rightmost item in the existing right-hand cluster in `ui.c`, after the rotation glyph, so the other glyphs shift left. The bar is 32 px high under the 16 px bezel.

- Percent text, `lv_font_montserrat_14`, cream ink, immediately left of the body (macOS puts the number beside the icon).
- Body: 25 x 12 px outline, radius 3, 1 px cream stroke at 60% opacity, a 2 x 5 px nub on the right, a fill inside that grows left to right with the percent (2 px inset).
- Fill color: cream by default. Amber `#e2a23a` at 20% or less. Red `#c4544a` at 10% or less. Sage `#9bb57a` while charging.
- While charging, a small bolt over the fill (`LV_SYMBOL_CHARGE`, ink dark on the fill).
- External power with no charging (battery full or held): a plug mark where the bolt would be.
- Hidden entirely when the chip is absent or no battery is present. No placeholder.

No new colors: the palette is the firmware's existing one. The widget updates only when the reading changes, under the LVGL lock, to avoid redraw churn.

## Reporting

The panel appends three query parameters to the poll it already makes:

`GET /api/status?bat=81&chg=1&ext=1`

- `bat` 0..100, `chg` 0 or 1, `ext` 0 or 1.
- All three are omitted when the reading is absent, so an older companion simply ignores them, and a newer companion treats a missing set as "no battery data".
- No new endpoint, no extra request, no auth change.

## Companion (server)

In the `GET /api/status` handler in `src/server/http.ts`, next to `stats.lastPanelPoll`:

- Parse the three parameters. Accept only integers in range, all three present. Anything else is ignored and the previous value kept.
- Record only for non-loopback callers, exactly as `lastPanelPoll` is.
- Store `stats.panelBattery = { pct, charging, external, at }` where `at` is the receipt time.
- The endpoint stays unauthenticated, as it is today. A forged value can only change a number shown on screen. This is accepted as display-only.

## App

- `CalicoInfo` (`src/shared/ipc.ts`) gains `panelBattery: { pct: number; charging: boolean; external: boolean; at: number } | null`, filled from `stats` in `src/main/index.ts` beside `lastPanelPoll`.
- A reading older than 60 s, or no reading, shows nothing (the panel is off or unreachable), not a stale number.
- Device screen: a "Battery" row with the percent, and "Charging" or "On external power" or "On battery" as plain text, using Lucide battery icons that match `DESIGN.md` (no new colors, no inline styles).
- Dashboard: the same figure beside the panel status, only while a fresh reading exists.

## Testing

Test first, per the project workflow.

- Firmware host tests (`firmware/host`): `power_decode` against the real captured bytes. Plugged in (`38 32 51 0F 88`) gives charging, external, 81%, 3976 mV. Unplugged (`18 55 51 0F 62`) gives discharging, not external, 81%, 3938 mV. Plus: percent over 100 clamps, millivolts under 2500 means not present, and VBUS garbage never appears in the output.
- Server (`vitest`): valid query stored; out-of-range, non-numeric, partial sets ignored with the previous value kept; loopback caller not recorded; reading older than 60 s reported as `null`.
- Renderer: Device screen and Dashboard render the figure, the charging and on-battery wording, and nothing for `null`.
- Hardware, by hand: flash, see the widget, unplug and replug USB, confirm the bolt and color change, and confirm the app shows the same figure within one poll.

## Risks

- The percentage is the chip's estimate and may drift between charge cycles. It is shown as reported.
- I2C contention with the IMU is not expected to matter at 10 s intervals but is checked on the board.
- The battery-present rule (under 2500 mV) is a heuristic until the board is tested without a battery.
