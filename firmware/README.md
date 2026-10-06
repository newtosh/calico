# Firmware

ESP-IDF app for the Waveshare ESP32-S3-Touch-AMOLED-2.16. It polls `GET {companion}/api/status`. Agent rows under the title scroll in that list. The panel keeps 24 rows. The status bar and the dock stay put. IDLE / RUNNING / NEEDS YOU show as the status-bar lamp and a short toast. NEEDS YOU raises a sheet from the bottom, just under the status bar, filled with that agent's mark color. The mark is the roster shape, drawn at 120px on a contrasting plate. The title and the row's aside sit under it. A downward swipe dismisses the sheet. A long aside scrolls instead, and a quick downward flick still dismisses. A tap that did not drag POSTs `/api/dismiss` after the sheet has left. Each row is a 24px mark: `color` (`#RRGGBB`) and `shape` from the status JSON. Shape names and the sampled picker palette are in [docs/grok-bot-integration.md](../docs/grok-bot-integration.md). A missing or unusable value is one neutral circle, `#a39b88`. Agent icons are not drawn on the panel. Settings are stored in NVS namespace `desk`: a list of known networks plus a global companion URL and bearer token. The Mic button is a dimmed icon and only shows `Voice not in this PoC`.

## Flash

Requires ESP-IDF 5.5 and a 16 MB ESP32-S3 board.

```bash
cd firmware
idf.py set-target esp32s3
idf.py build
idf.py -p PORT flash monitor
```

The managed BSP is `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1` with LVGL 9, declared in `main/idf_component.yml`. `sdkconfig.defaults` matches the official LVGL example: 16 MB flash, octal PSRAM, Montserrat 16/20/24, plus 28 and 48 for the desk face. It also reserves 64KB of internal RAM and caps Wi-Fi dynamic RX/TX buffers. One 20-line LVGL stripe is allocated in DMA-capable internal RAM before Wi-Fi starts, so a flush is not a PSRAM copy and the STA still has the internal block two 50-line stripes took.

## Upright

This SKU has a QMI8658 on the shared I2C bus (SDA GPIO15, SCL GPIO14, address `0x6B` on the schematic). BSP 2.0.1 sets `BSP_CAPS_IMU` to 0 and its I2C comment still names a QMA7981, so the firmware reads the chip with `waveshare/qmi8658` on `bsp_i2c_get_handle()`.

Gravity snaps the UI to 0/90/180/270. The panel boots with MADCTL `0xA0`; that picture is quarter 0. Flat (Z wins), a weak reading, or a near-diagonal holds the last quarter. Four matching samples, 100 ms apart, have to agree before the picture turns. Settings open freezes the angle so the keyboard stays put. The status-bar lock does the same and stores the quarter.

Chip +Y is treated as the top edge of that boot picture. The schematic names the part and `0x6B`; it does not mark the chip's X arrow on the glass.

`idf.py` is not on the machine that added this, so it was not flashed here. On the desk, from `firmware/`:

```bash
idf.py -p /dev/ttyACM0 app-flash
```

`app-flash` writes the application only. It does not erase flash and it does not rewrite the NVS partition. Do not erase.

On first boot no network is saved, so the settings screen is up and scans for networks. Tap a row to select an SSID (Scan repeats the scan). Password, a companion URL for that network, and a bearer token for that network are labeled fields under the list. Type SSID is only for a hidden network. Saving adds that network to the known list (up to 8) and restarts. It does not erase the others. The default companion URL is `http://192.168.4.30:8787`. A network with no URL of its own uses the global URL, then that default.

At boot the panel scans and joins whichever saved SSID is actually in range. If more than one is in range, it uses the strongest RSSI. A saved SSID that does not show up in the broadcast scan is probed once, so a hidden network typed by hand can still be joined. If none of the saved networks are in range, the panel shows `NO NETWORK` / `No saved network in range` and does not keep retrying one missing SSID. Association of the network it did pick still stops after 10 disconnects.

## Status bar

The top strip and the bottom strip are `#0c0e09` and run to the 480px edges of the glass. Lamp, toast, the resting `grokbot-buddy` label, Wi-Fi, struck-through BT, Auto, and the running count stay inside the 16px bezel. The center of the bar reads `grokbot-buddy` until a status toast replaces that label, then the name comes back. Title and agent rows start just below the bar. A swipe on the agent list scrolls that list. The bar and the dock stay fixed. The row under the bar is an unread badge, not an agent name. It shows the companion's `unread` count, as `3 unread`, when that count is above zero. That count is agents waiting on you. If none are, a note that still has text shows 1. It is not Grok Bot's own chat unread. A tap POSTs `/api/unread/dismiss`. The next poll clears a note, and leaves the badge up while a row is still NEEDS YOU. `POST /api/dismiss` clears the waiting rows and the badge together. With nothing unread the row is empty. Mic and Settings are icon buttons, Lucide `mic` and `settings` as 40px alpha bitmaps. Both are 72×58, about ten percent under 80×64. The dock pads them 24px from the glass on the sides and bottom (the 16px bezel plus 8px) so the case corner does not clip the button, and 16px above them so the list band does not sit on the button tops. Mic is dimmed and still only shows `Voice not in this PoC`. Settings opens settings. The running count stays Montserrat 28: `n/X running` while any stored agent is running, and a dimmed `idle` when none are. X is every agent in the companion store, not a fixed roster. Agent titles and marks stay 24px. A row's own `message` sits beside the name. If that is empty, the last event's message does, matched by `agent_id`, then by title or id. It is Montserrat 20. The name is only as wide as its title. A 12px gap stays between the name and the status, and the status takes the rest of the row. It stays one line. When that agent jumps to the top with the row filled in, the line scrolls for 20 seconds so the whole message can be read, then it clips at the start. It does not wrap. Status strings decode JSON `\uXXXX` escapes, including a surrogate pair. Montserrat here is ASCII plus degree and bullet. Other codepoints fold to an ASCII stand-in (accents, dashes, arrows, box drawing) or are dropped (emoji, private-use), so a missing glyph is not drawn as a box. Other rows clip. A `needs_you` row is filled `#527044` with a `#9bb57a` left edge, and so is a row that is showing that message. Aside text on that fill is `#d4ccba`. A quiet running or idle row stays plain. If the list is scrolled down and a poll adds an agent or changes a row's status, attention, or aside, a `3 new` pill sits on the top edge of the list. A tap scrolls to the top and clears it. Scrolling back to the top clears it too. It stays hidden while the list is already at the top, and it does not cover the dock. Each row is 30px, down from 32. The list starts at y=86 instead of y=98 unless a note is still centered under the title, so a long roster shows another name before it scrolls.

The left lamp uses the phase label plus the poll-failure count and the Wi-Fi facts the STA path already tracks:

| State | Lamp |
| --- | --- |
| IP is up, zero missed polls, phase `IDLE`, `RUNNING`, or `NEEDS YOU` | Green `#9bb57a` |
| Still joining, STA reconnecting before the cap, or 1–2 missed polls | Amber `#e2a23a` |
| `NO NETWORK`, `SCAN FAILED`, 3 missed polls, or Wi-Fi gave up with no address | Red `#c4544a` |

A stale STA give-up does not override a poll that just succeeded while the station still has an address. Misses before a DHCP lease are not counted. A pushed panel URL is stored only when that URL answers, so a stale address does not replace the host the panel just reached.

`NEEDS YOU` is green. The companion answered. The sheet covers the list and the dock and leaves the bar visible, so the lamp, toast, and Wi-Fi stay readable. A short toast slides into the center of the bar when that status text changes (`IDLE` → `RUNNING`, `reconnecting`, `link down`, and the panel notes). One line is on screen and one can wait. A newer one replaces the waiter.

Wi-Fi is three bars from the associated AP's RSSI (`esp_wifi_sta_get_ap_info`): 3 at -60 dBm and up, 2 at -75 dBm and up, 1 if associated but weaker, none if there is no IP. Bluetooth is a dim struck-through `BT`. The ESP32-S3 and this board's 2.4 GHz antenna can do Bluetooth 5 LE, and the BSP does not start it. `sdkconfig.defaults` does not enable a controller, and the app never opens one. The mark means off.

`Auto` / `Lock` toggles the QMI8658 snap. Locked writes NVS namespace `desk` key `rotlock` as `0`, `1`, `2`, or `3` (the quarter on screen) and ignores the IMU until unlock, including across reboot. Unlock erases that key. It does not use `ssid`, `pass`, `url`, `token`, or `n{i}*`.

## Screen capture

The CO5300 is written over QSPI. The BSP flush is write-only, and the extracted datasheet has no GRAM-read opcode, so the panel cannot be read back. LVGL is in partial mode: the only DMA buffer is the 20-line stripe (`DESK_DMA_LINES` 20, `DESK_DMA_BUFS` 1, 19200 bytes). A full framebuffer, or a second internal DMA buffer, is what left the STA unable to join. Do not switch the display to full-frame mode.

A frame is still available on demand. `CONFIG_LV_USE_SNAPSHOT` renders the active screen into a caller-owned PSRAM buffer (480×480 RGB565 is 460800 bytes, plus stride slack). The LVGL lock is held only for that render. The poll task then POSTs a top-down BMP (`BI_BITFIELDS`, RGB565 masks) to the companion and frees the buffer. If the PSRAM alloc fails, the poll logs nothing extra and skips the frame. It does not fall back to internal RAM. Settings open skips the snapshot so the bearer field is not uploaded, and the request stays pending for a later poll.

The DMA stripe is unchanged. If `sdkconfig` was generated before `CONFIG_LV_USE_SNAPSHOT=y` landed in `sdkconfig.defaults`, delete `sdkconfig` and reconfigure. Do not add another stripe.

From the companion host, with the panel's bearer:

```bash
curl -s -X POST "$DESK_URL/api/frame/request" -H "Authorization: Bearer $GROK_DESK_WEBHOOK_TOKEN"
curl -s -D - "$DESK_URL/api/frame" -o /tmp/desk.bmp
```

`GET /api/status` includes `"capture": true` while a request is waiting, immediately after `unread`, so a truncated 16KB body still sees it. The panel posts `image/bmp` to `POST /api/frame` on a later poll. `GET /api/frame` returns that BMP, or 404. The companion keeps one frame in memory. A restart drops it. A 401 does not store or clear the request. A body over 480×480×2+256 bytes is 413 and does not replace a stored frame.

Ship this UI with app-flash only:

```bash
idf.py -p PORT app-flash
```

## Provision Wi-Fi over USB

`scripts/provision-wifi.py` reads and writes the same NVS namespace the firmware reads (`desk`). It does not flash the application. It does not pick an SSID or a password for you.

ESP-IDF 5.5.x has to be on the machine. This checkout does not include it. Source the IDF export so `IDF_PATH` is set, then run the script from the repo root. The script calls that install's `nvs_partition_gen.py` and `esptool.py`. It does not vendor a second NVS format.

```bash
. "$IDF_PATH/export.sh"
scripts/provision-wifi.py add
scripts/provision-wifi.py remove
```

The serial port defaults to `/dev/ttyACM0`. Override it with `PORT`:

```bash
PORT=/dev/ttyACM1 scripts/provision-wifi.py add
```

`add` prompts for the SSID and reads the Wi-Fi password from a hidden prompt (twice). It does not take the password as an argument, and it ignores `SSID`, `PASSWORD`, `WIFI_PASSWORD`, `TOKEN`, and similar variables if they are set in the environment. Companion URL and bearer token are optional prompts for this network only. Leave either blank to inherit the global default. The token is not echoed. Nothing from the prompt is written into the repo or into your shell history as a command. `remove` prompts for an SSID and does not ask for a password.

The script reads the current `nvs` partition (`0x9000`, size `0x6000` in `firmware/partitions.csv`) before it writes. `add` inserts or updates that one SSID and writes the other saved networks back. `remove` drops that one SSID and writes the rest back. This firmware does not enable NVS encryption, so the image is the plaintext format `nvs_partition_gen.py` writes. Global `url` and `token` already on the board are left as they are. A board that only has the old `ssid` and `pass` keys is treated as one saved network, so adding a second does not drop the first.

After a successful write the script soft-resets the board with `esptool.py --chip esp32s3 run`. If that reset fails, the script prints the one command to run. The panel should then join with the new NVS.

Host checks (no board, no IDF):

```bash
python3 -m pytest scripts/test_provision_wifi.py
```

After Wi-Fi is up, a successful `GET /api/status` may include `panel` with `url` and `token`. When those differ from the global NVS url and token, the firmware writes just those two keys and restarts. Saved networks, SSIDs, and passwords are not on that path. The object is absent until the dashboard stores a push, and a failed poll does not apply it. That is separate from the `link down` label, which is three missed polls, and from `NO NETWORK`, which means a scan found none of the saved SSIDs.

Done closes settings and dismisses the keyboard. The keyboard checkmark, the keyboard hide key, or a tap outside the field dismisses the keyboard only. The form above the keyboard scrolls.

## Host checks without a board

`desk_view.c` has no IDF types. From the repo root:

```bash
gcc -Wall -Werror -I firmware/main firmware/host/test_desk_view.c firmware/main/desk_view.c -o /tmp/test_desk_view
/tmp/test_desk_view
gcc -Wall -Werror -I firmware/main firmware/host/test_wifi_store.c firmware/main/wifi_store.c -o /tmp/test_wifi_store
/tmp/test_wifi_store
gcc -Wall -Werror -I firmware/main firmware/host/test_orient.c firmware/main/orient.c -o /tmp/test_orient
/tmp/test_orient
gcc -Wall -Werror -I firmware/main firmware/host/test_desk_status.c firmware/main/desk_status.c -o /tmp/test_desk_status
/tmp/test_desk_status
gcc -Wall -Werror -I firmware/main firmware/host/test_face_cover.c firmware/main/face_cover.c -o /tmp/test_face_cover
/tmp/test_face_cover
gcc -Wall -Werror -I firmware/main firmware/host/test_dma_stripe.c -o /tmp/test_dma_stripe
/tmp/test_dma_stripe
```

Open `firmware/simulator/index.html` in a browser. It polls `http://127.0.0.1:8787` unless you pass `?base=http://192.168.1.20:8787`. Wheel or drag scrolls the agent list inside the face. The bar and the dock stay fixed. A needs-you status raises the sheet over the list and the dock. The bar stays. A downward swipe, or a tap, dismisses it.

## If `idf.py` is missing

`idf.py` was not on the machine that produced this PoC, so `idf.py build` has not been run here. That blocks a board image only. The project is still the Waveshare target: `esp32s3`, BSP `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1`, LVGL 9, and the `02_lvgl_demo_v9` partition layout. Install ESP-IDF 5.5 and run the flash commands above. Until then, use the host test and the simulator.
