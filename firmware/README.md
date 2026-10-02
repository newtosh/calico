# Firmware

ESP-IDF app for the Waveshare ESP32-S3-Touch-AMOLED-2.16. It polls `GET {companion}/api/status` and draws IDLE / RUNNING / NEEDS YOU. A tap on the alert POSTs `/api/dismiss`. Settings (SSID, password, companion URL, bearer token) are stored in NVS namespace `desk`. The Mic button only shows `Voice not in this PoC`.

## Flash

Requires ESP-IDF 5.4 and a 16 MB ESP32-S3 board.

```bash
cd firmware
idf.py set-target esp32s3
idf.py build
idf.py -p PORT flash monitor
```

The managed BSP is `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1` with LVGL 9, declared in `main/idf_component.yml`. `sdkconfig.defaults` matches the official LVGL example: 16 MB flash, octal PSRAM, Montserrat 16/20/24.

On first boot the SSID is empty, so the settings screen is up and scans for networks. Tap a row to select an SSID (Scan repeats the scan). Password, companion URL, and bearer token are labeled fields under the list. Type SSID is only for a hidden network. The default companion URL is `http://192.168.4.30:8787`. Saving restarts the chip and joins Wi-Fi.

## Provision Wi-Fi over USB

`scripts/provision-wifi.py` writes the same NVS namespace the firmware reads (`desk`) and the same keys (`ssid`, `pass`, and optionally `url` and `token`). It does not flash the application. It does not pick an SSID or a password for you.

ESP-IDF 5.5.x has to be on the machine. This checkout does not include it. Source the IDF export so `IDF_PATH` is set, then run the script from the repo root. The script calls that install's `nvs_partition_gen.py` and `esptool.py`. It does not vendor a second NVS format.

```bash
. "$IDF_PATH/export.sh"
scripts/provision-wifi.py
```

The serial port defaults to `/dev/ttyACM0`. Override it with `PORT`:

```bash
PORT=/dev/ttyACM1 scripts/provision-wifi.py
```

The script prompts for the SSID and reads the Wi-Fi password from a hidden prompt (twice). It does not take the password as an argument, and it ignores `SSID`, `PASSWORD`, `WIFI_PASSWORD`, `TOKEN`, and similar variables if they are set in the environment. Companion URL and bearer token are optional prompts. Leave either blank to omit that key. The token is not echoed. Nothing from the prompt is written into the repo or into your shell history as a command.

The write replaces the whole `nvs` partition (`0x9000`, size `0x6000` in `firmware/partitions.csv`). This firmware does not enable NVS encryption, so the image is the plaintext format `nvs_partition_gen.py` writes. Keys you omit are not on the board afterwards. With `url` omitted, the next boot uses the compiled default `http://192.168.4.30:8787`. With `token` omitted, the token is empty. If the dashboard already pushed a URL or token, type them again at the prompts or push them again after the panel joins.

After a successful write the script soft-resets the board with `esptool.py --chip esp32s3 run`. If that reset fails, the script prints the one command to run. The panel should then join with the new NVS.

Host checks (no board, no IDF):

```bash
python3 -m pytest scripts/test_provision_wifi.py
```

After Wi-Fi is up, a successful `GET /api/status` may include `panel` with `url` and `token`. When those differ from NVS, the firmware writes just those two keys and restarts. SSID and password are left as saved. The object is absent until the dashboard stores a push, and a failed poll does not apply it. That is separate from the `link down` label, which is three missed polls.

Dismiss the keyboard with Done, the keyboard checkmark, the keyboard hide key, or a tap outside the field. The form above the keyboard scrolls.

## Host checks without a board

`desk_view.c` has no IDF types. From the repo root:

```bash
gcc -Wall -Werror -I firmware/main firmware/host/test_desk_view.c firmware/main/desk_view.c -o /tmp/test_desk_view
/tmp/test_desk_view
```

Open `firmware/simulator/index.html` in a browser. It polls `http://127.0.0.1:8787` unless you pass `?base=http://192.168.1.20:8787`.

## If `idf.py` is missing

`idf.py` was not on the machine that produced this PoC, so `idf.py build` has not been run here. That blocks a board image only. The project is still the Waveshare target: `esp32s3`, BSP `waveshare/esp32_s3_touch_amoled_2_16` `^2.0.1`, LVGL 9, and the `02_lvgl_demo_v9` partition layout. Install ESP-IDF 5.4 and run the flash commands above. Until then, use the host test and the simulator.
