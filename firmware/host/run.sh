#!/usr/bin/env bash
# Build and run the firmware's host-side C tests with the system gcc.
# These cover the panel logic that does not touch ESP-IDF. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

run() { # test name, then the firmware sources it links
  local name=$1
  shift
  gcc -Wall -Werror -I firmware/main "firmware/host/$name.c" "$@" -o "$out/$name"
  "$out/$name" >"$out/$name.log" 2>&1 || {
    echo "FAIL $name"
    cat "$out/$name.log"
    exit 1
  }
  echo "ok   $name"
}

run test_ble_desk firmware/main/ble_desk.c firmware/main/wifi_store.c
run test_control_center firmware/main/control_center.c
run test_desk_status firmware/main/desk_status.c
run test_desk_view firmware/main/desk_view.c
run test_dma_stripe
run test_face_cover firmware/main/face_cover.c
run test_orient firmware/main/orient.c
run test_settings_layout
run test_wifi_store firmware/main/wifi_store.c
