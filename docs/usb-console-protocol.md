# USB console protocol

The contract between calico and the panel firmware (`firmware/`) over USB. This file is the source of truth both sides follow. The firmware side is not implemented yet.

## Transport

- USB-Serial-JTAG (CDC). Calico opens it at 115200 baud; the baud rate does not matter on CDC.
- UTF-8 text, one message per line, `\n` terminated. A trailing `\r` is ignored.
- Lines longer than 512 bytes are dropped by the firmware with an error reply if the line had an id.

## Requests

One JSON object per line:

```json
{ "id": 7, "op": "verify", "ssid": "home", "pass": "hunter22" }
```

| op       | fields                                  | behavior                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` | none                                    | Reply with `name`, `fw`, `ssid`, `url`, `token` (`"set"` or `"none"`). Empty ssid or url is `""`.                                                                                                                                                                                     |
| `scan`   | none                                    | Block until the scan finishes (up to 25 s). Reply with `aps`: up to 16 `{"rssi": -40, "ssid": "home"}`, strongest first.                                                                                                                                                              |
| `verify` | `ssid`, `pass`                          | Associate in RAM without touching NVS. Block up to 20 s. `ok: true` if it joined, else `ok: false` with `reason`.                                                                                                                                                                     |
| `wifi`   | `ssid`, `pass`, optional `url`, `token` | Same as the BLE `wifi` write. Without `url` and `token`: update the password of an existing SSID and keep its url and token, or append a new one. With either: write both to that network's slot, a missing one as `""` (the global value). A full panel (8 networks) is `ok: false`. |
| `url`    | `value`                                 | Set the global companion URL.                                                                                                                                                                                                                                                         |
| `token`  | `value`                                 | Set the global bearer token. `""` clears it.                                                                                                                                                                                                                                          |
| `reboot` | none                                    | Reply first, then restart.                                                                                                                                                                                                                                                            |
| `nets`   | none                                    | Reply with `nets`: up to 8 `{"ssid": "home", "has_url": true, "has_token": false}`, in slot order. Never a password, token, or URL.                                                                                                                                                   |
| `forget` | `ssid`                                  | Remove that saved network. An SSID that is not saved is still `ok: true`. The panel stays on its current network until it restarts.                                                                                                                                                   |

Field limits match `ble_desk.h`: ssid 1 to 32 bytes, pass empty or 8 to 64 bytes, url up to 127 bytes and starting with `http://` or `https://`, token up to 127 bytes. No CR, LF, or NUL in any field. A violation is `ok: false`.

## Replies

```json
{"id": 7, "ok": true}
{"id": 7, "ok": false, "error": "auth failed", "reason": "auth"}
```

- `id` echoes the request. Requests are handled one at a time, in order.
- `reason` (verify only): `auth`, `missing`, `timeout`, `radio`, `other`.
- `error`: short human text.

## Logs

Any line that does not start with `{` is ordinary ESP log output. Calico shows it in the Console pane. The firmware must never log a password or token value. Calico also redacts any secret it sent during the session from log lines, as a second guard.
