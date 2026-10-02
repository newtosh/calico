# Firmware

ESP-IDF app for the Waveshare ESP32-S3-Touch-AMOLED-2.16. It polls `GET {companion}/api/status` and draws IDLE / RUNNING / NEEDS YOU. A tap on the alert POSTs `/api/dismiss`. Settings are stored in NVS namespace `desk`: a list of known networks plus a global companion URL and bearer token. The Mic button only shows `Voice not in this PoC`.

## Flash

Requires ESP-IDF 5.5 and a 16 MB ESP32-S3 board.

```bash
cd firmware
idf.py set-target esp32s3
idf.py build
idf.py -p PORT flash monitor
```

The managed BSP is `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1` with LVGL 9, declared in `main/idf_component.yml`. `sdkconfig.defaults` matches the official LVGL example: 16 MB flash, octal PSRAM, Montserrat 16/20/24.

On first boot no network is saved, so the settings screen is up and scans for networks. Tap a row to select an SSID (Scan repeats the scan). Password, a companion URL for that network, and a bearer token for that network are labeled fields under the list. Type SSID is only for a hidden network. Saving adds that network to the known list (up to 8) and restarts. It does not erase the others. The default companion URL is `http://192.168.4.30:8787`. A network with no URL of its own uses the global URL, then that default.

At boot the panel scans and joins whichever saved SSID is actually in range. If more than one is in range, it uses the strongest RSSI. A saved SSID that does not show up in the broadcast scan is probed once, so a hidden network typed by hand can still be joined. If none of the saved networks are in range, the panel shows `NO NETWORK` / `No saved network in range` and does not keep retrying one missing SSID. Association of the network it did pick still stops after 10 disconnects.

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

Dismiss the keyboard with Done, the keyboard checkmark, the keyboard hide key, or a tap outside the field. The form above the keyboard scrolls.

## Host checks without a board

`desk_view.c` has no IDF types. From the repo root:

```bash
gcc -Wall -Werror -I firmware/main firmware/host/test_desk_view.c firmware/main/desk_view.c -o /tmp/test_desk_view
/tmp/test_desk_view
gcc -Wall -Werror -I firmware/main firmware/host/test_wifi_store.c firmware/main/wifi_store.c -o /tmp/test_wifi_store
/tmp/test_wifi_store
```

Open `firmware/simulator/index.html` in a browser. It polls `http://127.0.0.1:8787` unless you pass `?base=http://192.168.1.20:8787`.

## If `idf.py` is missing

`idf.py` was not on the machine that produced this PoC, so `idf.py build` has not been run here. That blocks a board image only. The project is still the Waveshare target: `esp32s3`, BSP `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1`, LVGL 9, and the `02_lvgl_demo_v9` partition layout. Install ESP-IDF 5.5 and run the flash commands above. Until then, use the host test and the simulator.
