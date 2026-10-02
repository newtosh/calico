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
