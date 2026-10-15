# Terminology

Two things talk to each other in this project. Words for one must never be used for the other.

| Say                  | It means                                                                         | Never say                                              |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Calico**           | The desktop app (Electron), including the local server it runs.                  | "the companion", "the desk app"                        |
| **the panel**        | The ESP32-S3 AMOLED hardware on your desk.                                       | "the desk", "the device", "the desk panel" (as a name) |
| **panel firmware**   | The software running on the panel. It has a firmware version.                    | "the desk firmware"                                    |
| **ginger**           | The panel's codename. Only in dev docs, the Bluetooth name, repo paths and logs. | In app UI text                                         |
| **Calico's server**  | The HTTP server inside Calico that the panel polls and agents post to.           | "the companion server"                                 |
| **Calico's address** | The URL where Calico's server listens. It is what the panel polls.               | "companion URL", "Calico address for the panel"        |
| **the Panel page**   | The sidebar page for connecting to and setting up the panel.                     | "the Device page", "Device"                            |

"Desk panel" is fine as a plain description in a tagline ("an ESP32-S3 desk panel that shows what your coding agents are doing"). It is not a name.

## Label rules

1. **A possessive names the owner.** "Calico's address" is where Calico listens. "The panel's address" would be the panel's own IP, which the app never needs. Do not write an address label that could belong to either side.
2. **Anything that crosses between the two says which way.** The panel polls Calico. Calico writes to the panel. Write the direction ("Calico's address (the panel polls this)"), not just the noun.
3. **Use the pair Calico and panel, nothing else.** If a sentence needs a third word for either side, rewrite the sentence.
4. **"Device" and "desk" never name the hardware.** "Device" is allowed only inside a technical compound: "Bluetooth device", "USB device", "serial device".
5. **Do not rename protocol keys or code identifiers just for words.** The USB and Bluetooth protocols, HTTP fields, IPC channel names, the `device/` folder and the `tools/python-companion` folder keep their names. Renaming them breaks the contracts for no reader's benefit. The user never sees them.

## Examples

| Before                                            | After                                                           |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Companion URL for the desk                        | Calico's address (the panel polls this)                         |
| Companion URL for this network                    | Calico's address on this network                                |
| The companion server is not running.              | Calico's server is not running.                                 |
| URL saved on the desk. It applies after a reboot. | Calico's address saved on the panel. It applies after a reboot. |
| Reading the desk.                                 | Reading the panel.                                              |
| Connect to the desk                               | Connect to the panel                                            |
| Clear desk token                                  | Clear the panel's token                                         |
| on the Device page                                | on the Panel page                                               |

A test (`test/terminology.test.ts`) fails the build when the old words come back in source text or in the docs it covers.
