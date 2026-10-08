# Firmware

ESP-IDF app for the Waveshare ESP32-S3-Touch-AMOLED-2.16. It polls `GET {companion}/api/status`. Agent rows under the title scroll in that list. The panel keeps 24 rows. The status bar and the dock stay put. IDLE / RUNNING / NEEDS YOU show as the status-bar lamp and a short toast. NEEDS YOU raises a dark glass sheet from the bottom, just under the status bar. The card is `#0c0e09` at 250/255 (98%) so roster type does not read through the glass. The stroke is a 3px border at full opacity, the same on every side, in the agent's mark color. Outside it, three 2px rings sit 2px, 4px, and 6px away from the card on every side, at 72/255, 32/255, and 12/255. They do not overlap, so that is the fringe: strongest beside the stroke, faintest at the outside. The outer edge is the 24px case line the dock already uses (16px bezel plus 8px lip). The card border stays 30px from the left, right, and bottom, so the rounded bottom and `Dismiss all` stay on the glass. Inside the stroke, a 3px band at 36/255 and a 7px band at 14/255 are a light inner highlight. The mark is the row shape at 120px, the same silhouette as the 24px list mark, including the two static eyes. Nothing circular sits behind it: a same-color disc reads as a flat badge and hides the cloud. The name is Montserrat 48 and the aside is Montserrat 28. A long aside still scrolls, and a quick downward flick still dismisses. A tap, or a downward swipe, dismisses that one card and posts `/api/dismiss` with its `agent_id`. A later `needs_you` while a card is still up covers it: one or two peeks show above the front card, and `N new` is how many cards are still under the one on screen. Swipe left for the older card and right to come back. `Dismiss all` posts `/api/dismiss` with no agent. The glass is one translucent object plus the three outer rings and the inner highlight. It does not add a DMA stripe. Each row is a 24px mark: `color` (`#RRGGBB`) and `shape` from the status JSON, plus two static pixel eyes. Shape names and the sampled picker palette are in [docs/grok-bot-integration.md](../kits/ginger/docs/grok-bot-integration.md). A missing or unusable value is one neutral circle, `#a39b88`. Agent icons are not drawn on the panel. Settings are stored in NVS namespace `desk`: a list of known networks plus a global companion URL and bearer token. The Mic button is a dimmed icon and only shows `Voice not in this PoC`.

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

Gravity snaps the UI to 0/90/180/270. The panel boots with MADCTL `0xA0`; that picture is quarter 0. Flat (Z wins), a weak reading, or a near-diagonal holds the last quarter. Four matching samples, 100 ms apart, have to agree before the picture turns. Settings open freezes the angle so the keyboard stays put. Control Center's rotation tile does the same and stores the quarter.

Chip +Y is treated as the top edge of that boot picture. The schematic names the part and `0x6B`; it does not mark the chip's X arrow on the glass.

`idf.py` is not on the machine that added this, so it was not flashed here. On the desk, from `firmware/`:

```bash
idf.py -p /dev/ttyACM0 app-flash
```

`app-flash` writes the application only. It does not erase flash and it does not rewrite the NVS partition. Do not erase.

On first boot no network is saved, so the settings screen is up and scans for networks. Tap a row to select an SSID (Scan repeats the scan). Password sits under that list. The companion URL and bearer token for that network are in the Companion card. Type SSID is only for a hidden network. Saving adds that network to the known list (up to 8) and restarts. It does not erase the others. The default companion URL is `http://192.168.4.30:8787`. A network with no URL of its own uses the global URL, then that default.

The settings page is the dock glass, `#0c0e09`. Copy sits 24px in from the panel, the same case line as the dock (16px bezel plus 8px), with another 3px so the card outline lands on that line. Wi-Fi and Companion are separate cards on `#14160f`. Each card has a 3px `#6d6756` stroke on every side and a 2px outline at 40/255. There is no bottom rim. The title is Montserrat 28. Fields, network rows, and buttons are 48px tall with Montserrat 20. Section labels, the scan status, and field labels are Montserrat 16. The status sits on the Wi-Fi row. Done stays in the header. Scan sits beside Type SSID under the list. A selected network is `#3d4f32` with a 2px `#9bb57a` stroke on every side. The scan list is two rows until the keyboard is up, then one row, so the password and the field being edited stay in reach. More networks scroll inside the list. The keyboard is inset 24px. The settings glass stays full-screen behind it.

At boot the panel scans and joins whichever saved SSID is actually in range. If more than one is in range, it uses the strongest RSSI. A saved SSID that does not show up in the broadcast scan is probed once, so a hidden network typed by hand can still be joined. If none of the saved networks are in range, the panel shows `NO NETWORK` / `No saved network in range` and does not keep retrying one missing SSID. Association of the network it did pick still stops after 10 disconnects. That join runs on a PSRAM stack. After the NimBLE host the largest internal block is about 7680 bytes, so an internal 12288 never starts and the glass shows `SCAN FAILED` with no scan log.

## Status bar

The top strip and the bottom strip are `#0c0e09` and run to the 480px edges of the glass. Lamp, toast, the resting `grokbot-buddy` label, Wi-Fi, BT, the rotation glyph, and the running count stay inside the 16px bezel. The center of the bar reads `grokbot-buddy` until a status toast replaces that label, then the name comes back. Title and agent rows start just below the bar. A swipe on the agent list scrolls that list. The bar and the dock stay fixed. The row under the bar is an unread badge, not an agent name. It shows the companion's `unread` count, as `3 unread`, when that count is above zero. That count is agents waiting on you. If none are, a note that still has text shows 1. It is not Grok Bot's own chat unread. A tap POSTs `/api/unread/dismiss`. The next poll clears a note, and leaves the badge up while a row is still NEEDS YOU. `POST /api/dismiss` clears the waiting rows and the badge together. With nothing unread the row is empty. Mic and Settings are icon buttons, Lucide `mic` and `settings` as 40px alpha bitmaps. Both are 72×58, about ten percent under 80×64. The dock pads them 24px from the glass on the sides and bottom (the 16px bezel plus 8px) so the case corner does not clip the button, and 16px above them so the list band does not sit on the button tops. Mic is dimmed and still only shows `Voice not in this PoC`. Settings opens settings. The running count stays Montserrat 28: `n/X running` while any stored agent is running, and a dimmed `idle` when none are. X is every agent in the companion store, not a fixed roster. Agent titles and marks stay 24px. A row's own `message` sits beside the name. If that is empty, the last event's message does, matched by `agent_id`, then by title or id. It is Montserrat 20. The name is only as wide as its title. A 12px gap stays between the name and the status, and the status takes the rest of the row. It stays one line. When that agent jumps to the top with the row filled in, the line scrolls for 20 seconds so the whole message can be read, then it clips at the start. It does not wrap. Status strings decode JSON `\uXXXX` escapes, including a surrogate pair. Montserrat here is ASCII plus degree and bullet. Other codepoints fold to an ASCII stand-in (accents, dashes, arrows, box drawing) or are dropped (emoji, private-use), so a missing glyph is not drawn as a box. Other rows clip. A `needs_you` row is filled `#527044` with a `#9bb57a` left edge, and so is a row that is showing that message. Aside text on that fill is `#d4ccba`. A quiet running or idle row stays plain. If the list is scrolled down and a poll adds an agent or changes a row's status, attention, or aside, a `3 new` pill sits on the top edge of the list. A tap scrolls to the top and clears it. Scrolling back to the top clears it too. It stays hidden while the list is already at the top, and it does not cover the dock. Each row is 30px, down from 32. The list starts at y=86 instead of y=98 unless a note is still centered under the title, so a long roster shows another name before it scrolls.

The left lamp uses the phase label plus the poll-failure count and the Wi-Fi facts the STA path already tracks:

| State | Lamp |
| --- | --- |
| IP is up, zero missed polls, phase `IDLE`, `RUNNING`, or `NEEDS YOU` | Green `#9bb57a` |
| Still joining, STA reconnecting before the cap, or 1–2 missed polls | Amber `#e2a23a` |
| `NO NETWORK`, `SCAN FAILED`, 3 missed polls, or Wi-Fi gave up with no address | Red `#c4544a` |

A stale STA give-up does not override a poll that just succeeded while the station still has an address. Misses before a DHCP lease are not counted. A pushed panel URL is stored only when that URL answers, so a stale address does not replace the host the panel just reached.

`NEEDS YOU` is green. The companion answered. The sheet covers the list and the dock and leaves the bar visible, so the lamp, toast, and Wi-Fi stay readable. A short toast slides into the center of the bar when that status text changes (`IDLE` → `RUNNING`, `reconnecting`, `link down`, and the panel notes). One line is on screen and one can wait. A newer one replaces the waiter.

Wi-Fi is three bars from the associated AP's RSSI (`esp_wifi_sta_get_ap_info`): 3 at -60 dBm and up, 2 at -75 dBm and up, 1 if associated but weaker, none if there is no IP. Bluetooth is a 20×14 rune beside those bars, the same alpha-bitmap treatment as the dock icons. Dim, with no side dots, means it is not advertising. That is Control Center off, or the controller never came up. Cream `#efe7d6` with a dot on each side means it is advertising. Sage `#9bb57a` with the same dots means a central is connected. The mark is not a button.

The rotation glyph is not a button. A cream Heroicons arrow-path (24×24, stroke 1.5) means the QMI8658 may still snap the picture. A sage padlock means that snap is held. The control lives in Control Center.

## Control Center

A downward swipe that starts on the status strip (the top 48px, bezel included) pulls a glass sheet down from under the bar. The sheet is the settings glass: `#0c0e09` at 250/255, a 3px `#6d6756` stroke, and a 2px outline at 40/255. It is inset 24px on the sides, the same case line as the dock. The top stays under the status strip and the sheet grows down to the bottom edge of the glass, over the dock. The tiles stay at the top. The side margins stay dimmed, so a tap there still closes it. Releasing after 64px, or a faster flick of 28px within 320ms, leaves it open. A shorter pull snaps shut. Swipe up on the sheet, or tap the dimmed face outside it, closes it. Settings covers the strip, so the swipe does not open there. The DMA stripe is unchanged. The sheet and the status-bar rotation glyph are built with the malloc cut at 0, then `CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL` (512) is restored before `layout_settings`, NimBLE, and `esp_wifi_init`. Allocations at or under 512 bytes otherwise stay internal, and that is the block the STA uses for 10 static RX buffers. On `04536e1` the sheet was on that cut. The board logged `Expected to init 10 rx buffer, actual is 7` and `ESP_ERR_NO_MEM` in `wifi_bringup`, then rebooted. Leave the cut at 512 outside that build. Do not shrink the RX count.

Tiles, left to right, then the next row: Wi-Fi, Bluetooth, Rotation, Mic, Speaker. An on tile is `#3d4f32` with a `#9bb57a` stroke, the same pair as a selected network. Off is `#2a2d24` with `#6d6756`.

Wi-Fi on associates. Off disconnects and does not reconnect. The driver stays started: this does not call `esp_wifi_stop`, so the RX buffers allocated before the NimBLE host stay put. NVS `desk` key `staoff` is `1` while off and absent while on. Bars in the status strip still follow the lease, so on with no address is an on tile and empty bars. A scan from Settings still runs. A successful BLE `verify` clears `staoff`, because that probe leaves the association up. Turning Wi-Fi back on connects the STA config already in RAM, or scans the saved list if this boot has not joined yet. That scan is the same PSRAM `wifi-join` task. It waits between passes. It is not a second internal stack, and it is not deleted.

Bluetooth on advertises `grokbot-buddy`. Off stops advertising and drops a connection. The controller stays up. NVS key `btoff` is `1` while off. The status rune follows that: dim with no dots while off, cream dots while advertising, sage dots while a central is connected.

Rotation is the old Auto/Lock control. Locked writes `rotlock` as `0`, `1`, `2`, or `3` (the quarter on screen) and ignores the IMU until unlock, including across reboot. Unlock erases that key. It does not use `ssid`, `pass`, `url`, `token`, `n{i}*`, `staoff`, or `btoff`.

Mic and Speaker flip the tile only. There is no codec on this board. The dock Mic still shows `Voice not in this PoC`.

## Screen capture

The CO5300 is written over QSPI. The BSP flush is write-only, and the extracted datasheet has no GRAM-read opcode, so the panel cannot be read back. LVGL is in partial mode: the only DMA buffer is the 20-line stripe (`DESK_DMA_LINES` 20, `DESK_DMA_BUFS` 1, 19200 bytes). A full framebuffer, or a second internal DMA buffer, is what left the STA unable to join. Do not switch the display to full-frame mode.

A frame is still available on demand. `CONFIG_LV_USE_SNAPSHOT` renders the active screen into a caller-owned PSRAM buffer (480×480 RGB565 is 460800 bytes, plus stride slack). The LVGL lock is held only for that render. The poll task then POSTs a top-down BMP (`BI_BITFIELDS`, RGB565 masks) to the companion and frees the buffer. If the PSRAM alloc fails, the poll logs nothing extra and skips the frame. It does not fall back to internal RAM. Settings open skips the snapshot so the bearer field is not uploaded, and the request stays pending for a later poll.

The DMA stripe is unchanged. A stale `firmware/sdkconfig` with snapshot off must be deleted and reconfigured before capture compiles in. Do not add another stripe.

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

## Provision over BLE

A phone or laptop can write the same NVS `desk` keys without USB and without a joined network. The firmware starts NimBLE after the DMA stripe is pinned and before Wi-Fi. It advertises the complete local name `grokbot-buddy`. Control Center can stop that advertisement and drop a connection. Off does not shut the controller down. One connection. The link is open: no pairing, no bonding, no encryption. Anyone in radio range can write the companion URL, replace the bearer, or add a Wi-Fi network. The bearer is write-only. Wi-Fi passwords are write-only. This is a desk PoC. A PIN on the glass is the upgrade when that stops being acceptable.

Preferred ATT MTU is 256 (the NimBLE default). A URL or token is at most 127 bytes, so the central needs an MTU of at least 130. BlueZ does the exchange. A status read that is longer than one packet still completes: NimBLE serves the rest on Read Blob.

Service `8d7c4b10-6e2a-4f91-a3c5-67726f6b6465`:

| Characteristic | UUID | Access | Write body |
| --- | --- | --- | --- |
| status | `8d7c4b11-6e2a-4f91-a3c5-67726f6b6465` | read | |
| url | `8d7c4b12-6e2a-4f91-a3c5-67726f6b6465` | read, write | `http://` or `https://` URL, optional trailing newline |
| token | `8d7c4b13-6e2a-4f91-a3c5-67726f6b6465` | write | bearer, or empty to clear. Optional trailing newline |
| wifi | `8d7c4b14-6e2a-4f91-a3c5-67726f6b6465` | write | `SSID\npassword`. Empty password is an open network. One separator, optional trailing newline |
| reboot | `8d7c4b15-6e2a-4f91-a3c5-67726f6b6465` | write | `reboot` |
| scan | `8d7c4b16-6e2a-4f91-a3c5-67726f6b6465` | read, write | write `scan`. Read the result |
| verify | `8d7c4b17-6e2a-4f91-a3c5-67726f6b6465` | read, write | same body as `wifi`. Read the result |

Status is UTF-8, one `key=value` per line, in this order: `name`, `fw` (git short SHA, or `unknown`), `ssid` (associated AP, or `none`), `url` (global companion URL), `token` (`set` or `none`). A rejected write is an ATT error and does not touch NVS. URL and token commits happen before the response. They do not restart the station. `ssid=none` means the STA is not associated. It does not mean NVS is empty.

`verify` associates in RAM and does not call `net_save`. The write returns while `state=busy`. Read until `state=ok` or `state=fail`. `ok` is state and ssid: the AP completed association, so the password was accepted. `fail` adds `reason=auth` (wrong password or handshake), `missing` (AP not found), `timeout`, `radio` (the attempt did not start), or `other`. A failure leaves NVS as it was and puts the previous STA config back. The utility writes `wifi` and then `reboot` only after `ok`.

`reboot` wakes a PSRAM task that calls `esp_restart` after the response. Calling `esp_restart` on the NimBLE host waits for the controller, and the controller waits for that host task, so the desk used to stay up after y. The link may still drop once the reset starts.

A scan write wakes a task that is already running and returns while `state=busy`. The NimBLE host is not blocked on the air time, so the link stays up. Read the same characteristic until `state=ready` or `state=fail`. Ready is `rssi`, a tab, and the SSID, strongest first, at most 16. That body can be longer than one packet. BlueZ returns the rest, the same as status. An SSID with a tab or a newline is omitted. A second write while busy does not start another scan. Verify uses that same task, so a join probe does not allocate either. The glass scan, the hidden-SSID probe, and this one share a lock. Wi-Fi is started before the NimBLE host task even when no network is saved, because a scan is `esp_wifi_init` if that step was skipped. The scan task is created in that same window, after `esp_wifi_init` and after the host task's 6144-byte stack. Its 12288-byte stack is PSRAM. The reboot task is a 3072-byte PSRAM stack created there too. A write does not allocate either. This is a Wi-Fi scan. The controller still does not scan, and `BT_CTRL_BLE_MAX_ACT` stays 2. The 20-line DMA stripe is unchanged.

On `3b2db6d` the board logged `E desk-ble: ble-scan not started, largest internal 7680`. DMA before Wi-Fi was still 45056. Advertising worked. Both `xTaskCreate` sizes, 12288 and 8192, are larger than 7680, so the TUI scan write returns Insufficient Resources and does not scan. The stack now comes from PSRAM (`CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM`). A `firmware/sdkconfig` from before that default ignores the flag until the file is deleted and the project is reconfigured. Do not erase NVS. The 20-line stripe stays. Creating this stack from internal RAM before Wi-Fi init would shrink the 45056 block the STA just used.

On `5151902`, the same menu failed immediately with `GATT Protocol Error: Unlikely Error` (ATT `0x0E`, bleak code 14) because the write callback itself called `xTaskCreate`. The bleak line about `_acquire_mtu` / the default MTU of 23 is separate: `_check_mtu` was reading `mtu_size`, which warns until a private acquire that this desk cannot satisfy (no write-without-response, no notify). The scan payload is 4 bytes. BlueZ still uses the MTU the controller negotiated. The desk asks for 256.

On `aeeb737` the glass showed `SCAN FAILED` / `Could not scan for Wi-Fi` after a verify that saved the network and rebooted. Serial had DMA 45056 after NimBLE, STA init, and advertising, then `app_main` returned with no `desk-net` scan, joining, or got-ip line. `ssid=none` means the STA is not associated. NVS can still hold the network. `xTaskCreate` of `wifi-join` (12288) failed on that same internal ceiling, and that failure path paints SCAN FAILED without calling `net_wifi_select`. The join stack is PSRAM (`xTaskCreateStatic`), same as ble-scan. The glass Settings `wifi-scan` task was still an internal 12288 and is PSRAM too, so Scan does not die at 7680. The status poll is 16384 and would miss the same way once join runs, so that stack is PSRAM as well. A failed create logs the task name, the largest internal block, and `CONFIG_FREERTOS_TASK_CREATE_ALLOW_EXT_MEM`. That flag is already in `sdkconfig.defaults` from the ble-scan fix. A board flashed after the #55 reconfigure already has it in `firmware/sdkconfig`. A tree that never picked the flag up still needs that file deleted and a reconfigure. Do not erase NVS. Wi-Fi init stays before the NimBLE host task. The 20-line DMA stripe stays. Do not move these stacks back to internal RAM, and do not allocate them before `esp_wifi_init`: an internal 12288 there is what left the STA short of RX buffers.

Wi-Fi upsert uses the same eight slots as settings. Updating an SSID replaces the password and keeps that slot's own URL and token. A new SSID follows the global URL. The controller may add its own NVS keys on first boot. That is not an erase, and it does not rewrite `desk`. The boot join and the verify probe use the same STA settings: WPA2 as the minimum when a password is set, PMF capable but not required, and SAE in both modes. An open network keeps the open threshold, so a typed password cannot succeed against an open AP. The give-up latch is cleared when that join starts.

With no command the script opens a menu. It scans for `grokbot-buddy`, shows status, and steps through the URL, the token, Wi-Fi, and reboot. Add Wi-Fi can take an SSID from the desk's scan or from the keyboard. y tries the join first. A miss prints the reason and does not save. A join saves and reboots. The OS Bluetooth pairing dialog does not connect. The link is GATT, and the client is bleak.

```bash
.venv-ble/bin/pip install bleak prompt_toolkit
.venv-ble/bin/python firmware/scripts/ble-provision.py
firmware/scripts/ble-provision.py scan
firmware/scripts/ble-provision.py status
firmware/scripts/ble-provision.py url
firmware/scripts/ble-provision.py token
firmware/scripts/ble-provision.py wifi-scan
firmware/scripts/ble-provision.py wifi
firmware/scripts/ble-provision.py reboot
```

`url`, `token`, and `wifi` prompt. The password and the bearer are not arguments and not environment variables. `--address AA:BB:CC:DD:EE:FF` picks one desk when more than one is advertising. `wifi-scan` prints `rssi`, a tab, and the SSID. The named commands stay for scripts.

Host mbufs are allocated from PSRAM (`CONFIG_BT_NIMBLE_MEM_ALLOC_MODE_EXTERNAL`). The controller itself stays internal. Shrinking MSYS or ACL counts does not return DMA to the STA. `esp_wifi_init` runs after `nimble_port_init` and before the NimBLE host task, whether or not a network is saved, so `largest internal DMA ... after NimBLE` is the block the static RX buffers (10 × ~1.6KB) are taken from. A second line, `largest internal DMA ... before Wi-Fi`, is that same moment. On `04536e1` init failed there: 7 of 10 static RX buffers, then `ESP_ERR_NO_MEM`. The Control Center sheet had been allocated on the 512-byte internal cut. That sheet is PSRAM for the build only. The RX count stays 10. The 20-line stripe is unchanged. The STA joined when that block was 48000 bytes and died at 29696. `BT_CTRL_BLE_MAX_ACT` is 2 (one advertiser, one connection). The extended duplicate-scan filter is 1 because the controller does not scan. Do not grow the stripe and do not turn on `BT_CTRL_RUN_IN_FLASH_ONLY`: a GATT write commits NVS while the link is up, and controller code in flash glitches across that erase.

An existing `firmware/sdkconfig` does not pick up `sdkconfig.defaults`. Delete that file and reconfigure. Do not erase the device. `idf.py` was not on the machine that added this, so the image has not been built here.

```bash
python3 -m pytest firmware/scripts/test_ble_provision.py
gcc -Wall -Werror -I firmware/main firmware/host/test_ble_desk.c firmware/main/ble_desk.c firmware/main/wifi_store.c -o /tmp/test_ble_desk
/tmp/test_ble_desk
```

## Provision Wi-Fi over USB

`firmware/scripts/provision-wifi.py` reads and writes the same NVS namespace the firmware reads (`desk`). It does not flash the application. It does not pick an SSID or a password for you.

ESP-IDF 5.5.x has to be on the machine. This checkout does not include it. Source the IDF export so `IDF_PATH` is set, then run the script from the repo root. The script calls that install's `nvs_partition_gen.py` and `esptool.py`. It does not vendor a second NVS format.

```bash
. "$IDF_PATH/export.sh"
firmware/scripts/provision-wifi.py add
firmware/scripts/provision-wifi.py remove
```

The serial port defaults to `/dev/ttyACM0`. Override it with `PORT`:

```bash
PORT=/dev/ttyACM1 firmware/scripts/provision-wifi.py add
```

`add` prompts for the SSID and reads the Wi-Fi password from a hidden prompt (twice). It does not take the password as an argument, and it ignores `SSID`, `PASSWORD`, `WIFI_PASSWORD`, `TOKEN`, and similar variables if they are set in the environment. Companion URL and bearer token are optional prompts for this network only. Leave either blank to inherit the global default. The token is not echoed. Nothing from the prompt is written into the repo or into your shell history as a command. `remove` prompts for an SSID and does not ask for a password.

The script reads the current `nvs` partition (`0x9000`, size `0x6000` in `firmware/partitions.csv`) before it writes. `add` inserts or updates that one SSID and writes the other saved networks back. `remove` drops that one SSID and writes the rest back. This firmware does not enable NVS encryption, so the image is the plaintext format `nvs_partition_gen.py` writes. Global `url` and `token` already on the board are left as they are. A board that only has the old `ssid` and `pass` keys is treated as one saved network, so adding a second does not drop the first.

After a successful write the script soft-resets the board with `esptool.py --chip esp32s3 run`. If that reset fails, the script prints the one command to run. The panel should then join with the new NVS.

Host checks (no board, no IDF):

```bash
python3 -m pytest firmware/scripts/test_provision_wifi.py
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
gcc -Wall -Werror -I firmware/main firmware/host/test_settings_layout.c -o /tmp/test_settings_layout
/tmp/test_settings_layout
gcc -Wall -Werror -I firmware/main firmware/host/test_ble_desk.c firmware/main/ble_desk.c firmware/main/wifi_store.c -o /tmp/test_ble_desk
/tmp/test_ble_desk
gcc -Wall -Werror -I firmware/main firmware/host/test_control_center.c firmware/main/control_center.c -o /tmp/test_control_center
/tmp/test_control_center
```

Open `firmware/simulator/index.html` in a browser. It polls `http://127.0.0.1:8787` unless you pass `?base=http://192.168.1.20:8787`. `?settings=1` opens settings. `?bt=off` draws the dim rune. `?bt=conn` draws the sage dotted mark. The default is the cream dotted mark. The settings button does the same, and Done closes it. A swipe down on the status strip opens Control Center. Swipe up on that sheet, or a tap on the dimmed face, closes it. `?cc=1` opens it. Wheel or drag scrolls the agent list inside the face. The bar and the dock stay fixed. A needs-you status raises the sheet over the list and the dock. The bar stays. A downward swipe, or a tap, dismisses the card on screen. A second needs-you while that card is up stacks on top. Swipe left and right to move through the stack. `Dismiss all` clears every waiting card. Two rapid posts that exercise it are in [docs/grok-bot-integration.md](../kits/ginger/docs/grok-bot-integration.md).

## If `idf.py` is missing

`idf.py` was not on the machine that produced this PoC, so `idf.py build` has not been run here. That blocks a board image only. The project is still the Waveshare target: `esp32s3`, BSP `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1`, LVGL 9, and the `02_lvgl_demo_v9` partition layout. Install ESP-IDF 5.5 and run the flash commands above. Until then, use the host test and the simulator.
