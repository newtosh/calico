# Sync to the Panel and the Address Banner (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calico pushes the saved Wi-Fi networks to the panel after the person confirms a plan of adds, updates and removals, and offers a one-click Bluetooth fix when this computer's address changes and the panel goes quiet.

**Architecture:** The push runs in the renderer, because Web Bluetooth lives there: it reads the panel's `status` and `nets`, builds a pure plan (`src/renderer/src/device/push-plan.ts`), shows it in a Base UI dialog, and only after the person confirms asks main to unlock each password once (`NetworkVault.confirmPush` / `release` in `src/main/networks.ts`) and hands it straight to the existing `wifi` and `forget` writes. The address banner is decided in main: the companion server reports the local address each panel poll arrived on (`panelSeen` in `src/server/http.ts`), a pure `AddressWatch` (`src/main/panel-address.ts`) decides when that address is gone and the panel has been silent for 60 seconds, and `CalicoInfo.addressChange` carries the URL to offer; the banner's click connects, writes `url`, reboots and waits for the first poll. No firmware changes.

**Tech Stack:** Electron 44 (`safeStorage.decryptString`, `powerMonitor`), Node `os.networkInterfaces` and `net.isIPv4`, React 19, `@base-ui/react` 1.8 Dialog, TypeScript 6, Vitest 5, Testing Library with happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-13-wifi-networks-design.md`, section "Phase 3: sync and the address banner". Read its "Superseded in part" box: pairing is OS-level numeric comparison, the app only guides, so "asks for the pairing PIN the first time only" means `connectBle` on an existing bond, which shows no code. Phase 2 plan for the shipped interfaces: `docs/superpowers/plans/2026-10-13-networks-vault.md`.

## Global Constraints

- **No firmware changes.** Internal RAM is at its floor (largest internal DMA after NimBLE 53248, internal free at got-ip about 20080, no spare `.data`). Phase 3 uses only the shipped `status`, `url`, `token`, `wifi`, `nets`, `forget` and `reboot` characteristics. Nothing under `firmware/` changes, `firmware/README.md` included.
- **Ruling (owner): one-shot password release.** The stored password reaches the window only through `networks:release`: main decrypts exactly one network's password (with that network's token, which the same `wifi` write needs) only after the person confirmed the push plan, for an SSID in that confirmed plan, once, within `PUSH_WINDOW_MS` (120000 ms) of the confirmation. Main keeps the confirmed SSIDs and refuses any SSID not in them, any repeat, and any release after expiry or `networks:end-push`. Decrypt is wrapped so a locked or changed keyring returns a clear refusal and never throws or echoes. The window passes the value straight into `link.send({ op: "wifi", ... })` and blanks its references right after; it is never put in React state, the network list, logs, errors, `aria-*` or `data-*` attributes, or any IPC event (`webContents.send`). The spec's "the renderer never receives a password or token" is relaxed for this one path only. `networks:list`, `networks:save`, `networks:remove` and every other IPC still carry only `password_set` and `token_set`.
- **Writes only start from a user click.** The push writes only after "Push N changes" in the plan dialog; the banner writes only after "Update over Bluetooth". Nothing a panel sends (status, nets) can start a write. A panel that cannot read `nets` (old firmware, or a stale BlueZ GATT cache: both show the existing `OLD_FIRMWARE` message) stops the push before any password is released.
- **Field limits, in UTF-8 bytes** (`src/shared/panel-fields.ts`): SSID 1 to 32, password empty or 8 to 64, URL up to 127 starting `http://` or `https://`, token up to 127, no CR, LF or NUL in any field, refused before anything is sent. 8 networks on the panel. A `wifi` write is at most `WIFI_WRITE_MAX` = 354 bytes and never 355 (Task 5 adds the guard).
- **Address logic is pure and unit tested** (`src/main/panel-address.ts`): IPv6, loopback and link-local (`169.254.0.0/16`) are ignored; VPN and tunnel interfaces, carrier-grade NAT (`100.64.0.0/10`, Tailscale) and container or VM bridges are never offered over a LAN address; the clock is injected.
- **Secrets:** no password or token in logs, test snapshots, DOM, error messages, or any IPC reply other than `networks:release`. Test files use only `placeholder-pass` and `placeholder-token`. The banner flow writes no password and no token.
- **UI follows `DESIGN.md`:** Tailwind tokens and `.btn`, `.btn-primary`, `.field`, `.label`, `.section-title`; dense rows with hairlines (`border-b border-stroke/40`). The plan dialog is a destructive confirmation (it can remove networks), which DESIGN.md allows as a modal; it uses `@base-ui/react/dialog` like `SetupDialog.tsx`, focuses Cancel on open, returns focus to its opener on close, cannot be dismissed while writing, and always ends on a result. The banner is a strip like `src/renderer/src/shell/DriftBanner.tsx`, not a modal. Every wait has a label. One component per file. No `any`. No flex layout directly on a `<button>` (iOS 12 rule): put layout on a wrapping element.
- **Copy:** plain words, no em-dashes, no emojis. The banner's first words are exactly "The panel's address may have changed".
- **Commands:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` (fix with `pnpm exec prettier --write <files>`). A single file: `pnpm test <path>`.
- **Commits:** one per task, made with `git commit --no-gpg-sign -m "<subject>"` (the repo sets `commit.gpgsign`; the controller signs the batch later). No trailers.
- happy-dom ignores `[hidden]`: tests that look inside Settings select `[role="tabpanel"]:not([hidden])`.

## Review Focus

- **The keyring is locked or changed at push time.** The person confirms a plan and expects a clear message naming the network and nothing half-sent with an empty password, never a crash or a leaked secret. Pinned by Task 3 `refuses, without throwing or echoing, when the keyring is locked or changed` and `refuses when the keyring became the plaintext fallback`, Task 5 `stops before writing when main refuses the password`, Task 6 `a keyring refusal stops the push with its message`.
- **The plan removes the network the panel is on now.** Removing it can leave the panel unreachable after the reboot. Expected: a loud warning, the current network kept unless the person ticks "Also remove", and a ninth network refused rather than silently dropped. Pinned by Task 5 `keeps the network the panel is on unless the person says to remove it` and `refuses a plan that would leave the panel more than 8 networks`, Task 6 `keeps the panel's current network unless the person ticks it` and `refuses a ninth network until the current one may go`. If `status` cannot be read the push refuses (current network unknown): Task 6 `stops on old firmware or an unreadable status before anything secret`.
- **A Bluetooth drop halfway through a push.** Expected: the push stops at the first failed write, says how many of how many were sent, does not reboot, and pushing again plans only what is left, because every write is idempotent. Pinned by Task 5 `stops at the first failed write and says how far it got`, `after a push that stopped halfway, plans the rest again`, Task 6 `reports a push that stopped halfway, without restarting`.
- **A laptop with VPN, Tailscale, Docker bridges, or two LAN addresses.** Expected: the banner offers the address on the panel's subnet, or the first private LAN address, never `100.64.0.0/10`, `docker0`, `br-*`, `wg*` or `tailscale*`, and nothing when only those exist; a panel that polled from outside every local subnet gets the first LAN address. Pinned by Task 2 `localAddresses` and `pickAddress` tests, and `ignores VPN and container addresses when choosing`.
- **The banner firing when it should not:** at app start before the first poll, right after waking from sleep, after "Not now", or when the panel is simply off while the address it used is still here. Expected: silence counted from start, last poll or wake, quiet with no LAN address, quiet while the panel's address is present, dismissal held until the addresses change or the panel polls; if the panel is off and the address did change, the click says to check the panel is on. Pinned by Task 2 `AddressWatch` tests and Task 7 `a cancelled picker or a panel that is off says what to check`.

---

## File Structure

- Modify `src/server/http.ts`, `test/server/http.test.ts`: report the poll's source and local address (Task 1).
- Create `src/main/panel-address.ts`, `test/main/panel-address.test.ts`: local addresses, subnet match, the address to offer, the silence and dismissal rule, the saved last poll (Task 2).
- Modify `src/main/networks.ts`, `test/main/networks.test.ts`, `src/shared/ipc.ts` (two types): confirmed plan and one-shot release (Task 3).
- Modify `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/index.ts`, and the `CalicoInfo` fixtures in `src/renderer/src/device/DeviceView.test.tsx`, `src/renderer/src/settings/AgentUpdatesSection.test.tsx`, `src/renderer/src/settings/SettingsView.test.tsx` (Task 4).
- Modify `src/shared/panel-fields.ts`, `src/renderer/src/device/ble.ts`, `ble.test.ts`. Create `src/renderer/src/device/push-plan.ts`, `push-plan.test.ts` (Task 5).
- Create `src/renderer/src/device/PushPlanDialog.tsx`, `PushNetworks.tsx`, `PushNetworks.test.tsx`. Modify `DeviceView.tsx` (Task 6).
- Create `src/renderer/src/device/address-update.ts`, `src/renderer/src/shell/AddressBanner.tsx`, `AddressBanner.test.tsx`. Modify `RebootWait.tsx`, `LinkActions.tsx`, `src/renderer/src/App.tsx` (Task 7).
- Modify `README.md`, `docs/review-rules.md`, `docs/superpowers/specs/2026-10-13-wifi-networks-design.md` (Task 8).

Rulings, one paragraph each:

- **R1, one-shot release (owner).** See Global Constraints. The token rides with the password in the same release: the four-line `wifi` write needs both, and a second channel for the token would double what has to be guarded. An open network with no token still goes through `release` (it returns `""`), so every `wifi` step takes the same path and main sees every SSID once.
- **R2, updates are always sent again.** The panel never returns a password, URL or token (`nets` has two flags), so a network on both sides cannot be compared. The vault is the source of truth: every SSID on both sides is an update, written with the four-line `wifi` form, which also clears a panel-only URL or token when the vault has none. "Reboots only if something changed" means: reboot when the whole plan applied and had at least one step. A push that stopped does not reboot.
- **R3, the network the panel is on now.** It comes from `status` (`ssid=`). If it would be removed, the dialog warns in amber and keeps it unless the person ticks "Also remove <ssid>". If `status` cannot be read, the push refuses, because the current network is unknown.
- **R4, order and the 8 limit.** Updates first (no slot moves), then removals (make room), then additions. A plan that would leave more than 8 networks (only possible when the current network is kept) is refused with a message that says how to fix it; the confirm button is disabled.
- **R5, what "the addresses differ" means.** Comparing whole address sets would fire whenever a Docker network or VPN comes up while the panel is off. Main instead records the local address each panel poll arrived on (`via`, from `req.socket.localAddress`) and the panel's own address (`from`), saves them in `panel-seen.json` so a restart on a new DHCP lease still counts, and shows the banner when `via` is no longer one of this computer's addresses and the panel has been silent for 60 seconds counted from the later of app start, the last poll, and the last wake from sleep. With no saved poll at all there is nothing to compare, so no banner (a first setup goes through Device). "With no history, the first LAN address" is `pickAddress(addresses, null)`, which is also what a panel that polled from outside every local subnet gets.
- **R6, a network's own URL wins.** The `url` characteristic sets the panel's default URL; a network with its own URL ignores it (`wifi_endpoint` in `firmware/main/wifi_store.c:139`). Changing that per-network URL needs the `wifi` write and so the password, which the banner never sends. So the banner reads `status` and `nets`, and when the network the panel is on has its own URL it writes nothing and says to edit that network in Settings and push. When the panel already has the offered URL it writes nothing and points at "Panel not connecting".
- **R7, banner with a link already open.** The panel has one Bluetooth slot and DeviceView owns the open link and its drop handling. With a link open the banner's button reads "Update on the Device page" and switches to Device, where the "Companion URL for the desk" field starts with the offered URL.
- **R8, hardware check of the banner.** Pointing the panel at a wrong URL alone does not change this computer's address, so no rule from the spec would fire. Task 8 adds a temporary second address to this computer, points the panel at it, then deletes it: the panel's stored URL becomes wrong and the address it used is gone, which is the real-world case.

---

### Task 1: The server reports where each panel poll came from

**Files:**

- Modify: `src/server/http.ts:1-2` (imports), `:35-45` (`ServerDeps`), `:197-202` (`/api/status` non-loopback block)
- Test: `test/server/http.test.ts:4-8` (import), `:16-41` (`start`)

**Interfaces:**

- Produces in `src/server/http.ts`:
  - `export interface PanelSeen { from: string; via: string }` (IPv4 dotted quads, no `::ffff:` prefix)
  - `export function panelSeen(remoteAddress: string | undefined, localAddress: string | undefined): PanelSeen | null`
  - `ServerDeps.onPanelPoll?(seen: PanelSeen): void`, called on each non-loopback `GET /api/status` whose two addresses are IPv4.

- [ ] **Step 1: Write the failing tests**

In `test/server/http.test.ts`, change the import from `../../src/server/http` to:

```ts
import {
  asciiJson,
  createCompanionServer,
  isLoopback,
  type PanelSeen,
  panelSeen,
} from "../../src/server/http";
```

Change `start` to take the callback (replace lines 16-41):

```ts
async function start(
  config: Partial<CalicoConfig> = {},
  allowedOrigins: string[] = [],
  cursorStatus?: () => CursorStatus,
  relayStatus?: () => RelayStatus,
  onPanelPoll?: (seen: PanelSeen) => void,
) {
  let current: CalicoConfig = { ...defaultConfig(), ...config };
  const store = new DeskStore();
  const { server, stats } = createCompanionServer({
    store,
    allowedOrigins,
    ...(cursorStatus ? { cursorStatus } : {}),
    ...(relayStatus ? { relayStatus } : {}),
    ...(onPanelPoll ? { onPanelPoll } : {}),
    getConfig: () => current,
    setConfig: (next) => {
      current = next;
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  close = () => server.close();
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    store,
    stats,
  };
}
```

After the test `does not count loopback polls as the panel`, add:

```ts
it("does not report a loopback poll as the panel's", async () => {
  const seen: PanelSeen[] = [];
  const { base } = await start({}, [], undefined, undefined, (s) =>
    seen.push(s),
  );
  await fetch(`${base}/api/status`);
  expect(seen).toEqual([]);
});

it("reads where a panel poll came from, IPv4 only", () => {
  expect(panelSeen("::ffff:192.168.4.31", "::ffff:192.168.4.30")).toEqual({
    from: "192.168.4.31",
    via: "192.168.4.30",
  });
  expect(panelSeen("192.168.4.31", "192.168.4.30")).toEqual({
    from: "192.168.4.31",
    via: "192.168.4.30",
  });
  expect(panelSeen("fe80::1", "fe80::2")).toBeNull();
  expect(panelSeen("192.168.4.31", "fe80::2")).toBeNull();
  expect(panelSeen("192.168.4.31", undefined)).toBeNull();
  expect(panelSeen(undefined, "192.168.4.30")).toBeNull();
});
```

A real non-loopback poll cannot be made in CI (the test server listens on 127.0.0.1), so the pure `panelSeen` carries the address rules and the wiring is one line.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test test/server/http.test.ts`
Expected: FAIL, `panelSeen` is not exported.

- [ ] **Step 3: Implement**

In `src/server/http.ts`, after `import http from "node:http";` add:

```ts
import { isIPv4 } from "node:net";
```

After the `ServerStats` interface add:

```ts
/** Where a panel poll came from, and the local address it arrived on. */
export interface PanelSeen {
  from: string;
  via: string;
}

const v4 = (address: string | undefined): string | null => {
  const plain = address?.startsWith("::ffff:")
    ? address.slice(7)
    : (address ?? "");
  return isIPv4(plain) ? plain : null;
};

/** The panel polls over IPv4. Anything else gives nothing to compare, so it is null. */
export function panelSeen(
  remoteAddress: string | undefined,
  localAddress: string | undefined,
): PanelSeen | null {
  const from = v4(remoteAddress);
  const via = v4(localAddress);
  return from && via ? { from, via } : null;
}
```

In `ServerDeps`, after `allowedOrigins?: string[];` add:

```ts
  /** Each non-loopback status poll, with where it came from. Must not throw. */
  onPanelPoll?(seen: PanelSeen): void;
```

Replace the non-loopback block in `/api/status` (lines 199-202) with:

```ts
if (!isLoopback(req.socket.remoteAddress)) {
  stats.lastPanelPoll = Date.now();
  recordPanelBattery(stats, params, Date.now());
  const seen = panelSeen(req.socket.remoteAddress, req.socket.localAddress);
  if (seen) deps.onPanelPoll?.(seen);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test test/server && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/server/http.ts test/server/http.test.ts
git add src/server/http.ts test/server/http.test.ts
git commit --no-gpg-sign -m "Report the address each panel poll arrived on"
```

---

### Task 2: Decide when the panel's address may have changed

**Files:**

- Create: `src/main/panel-address.ts`
- Test: `test/main/panel-address.test.ts`

**Interfaces:**

- Consumes: `PanelSeen` (Task 1), `writeAtomic(path: string, text: string): void` (`src/server/state-file.ts:14`).
- Produces in `src/main/panel-address.ts`:
  - `export interface LocalAddress { iface: string; address: string; cidr: string | null; virtual: boolean }`
  - `export const SILENCE_MS = 60_000`
  - `export function inSubnet(ip: string, cidr: string): boolean`
  - `export function localAddresses(ifaces?: NodeJS.Dict<NetworkInterfaceInfo[]>): LocalAddress[]` (default `os.networkInterfaces()`)
  - `export function pickAddress(addrs: LocalAddress[], panelFrom: string | null): string | null`
  - `export class AddressWatch { constructor(last: PanelSeen | null, now: () => number); polled(seen: PanelSeen): boolean; woke(): void; dismiss(addrs: LocalAddress[]): void; check(addrs: LocalAddress[]): string | null }`
  - `export function loadSeen(path: string): PanelSeen | null`, `export function saveSeen(path: string, seen: PanelSeen): void` (never throws)

- [ ] **Step 1: Write the failing tests**

Create `test/main/panel-address.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { type NetworkInterfaceInfo, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AddressWatch,
  inSubnet,
  loadSeen,
  type LocalAddress,
  localAddresses,
  pickAddress,
  saveSeen,
  SILENCE_MS,
} from "../../src/main/panel-address";

const wifi: LocalAddress = {
  iface: "wlp2s0",
  address: "192.168.4.30",
  cidr: "192.168.4.30/24",
  virtual: false,
};
const wired: LocalAddress = {
  iface: "enp3s0",
  address: "10.0.10.110",
  cidr: "10.0.10.110/24",
  virtual: false,
};
const docker: LocalAddress = {
  iface: "docker0",
  address: "172.17.0.1",
  cidr: "172.17.0.1/16",
  virtual: true,
};
const tailscale: LocalAddress = {
  iface: "tailscale0",
  address: "100.101.102.103",
  cidr: "100.101.102.103/32",
  virtual: true,
};

// The panel last polled 192.168.4.20, an address this computer no longer has.
const seen = { from: "192.168.4.31", via: "192.168.4.20" };

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const v4 = (address: string, cidr: string) => ({
  address,
  cidr,
  netmask: "",
  mac: "",
  family: "IPv4",
  internal: false,
});
const ifaces = (map: Record<string, object[]>) =>
  map as unknown as NodeJS.Dict<NetworkInterfaceInfo[]>;

describe("inSubnet", () => {
  it("matches an IPv4 address against a CIDR", () => {
    expect(inSubnet("192.168.4.31", "192.168.4.30/24")).toBe(true);
    expect(inSubnet("192.168.5.31", "192.168.4.30/24")).toBe(false);
    expect(inSubnet("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(inSubnet("100.127.255.255", "100.64.0.0/10")).toBe(true);
    expect(inSubnet("100.128.0.1", "100.64.0.0/10")).toBe(false);
    expect(inSubnet("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(inSubnet("192.168.4.30", "192.168.4.30/32")).toBe(true);
  });

  it("is false for IPv6 or a malformed CIDR", () => {
    expect(inSubnet("fe80::1", "192.168.4.0/24")).toBe(false);
    expect(inSubnet("192.168.4.1", "fe80::/64")).toBe(false);
    expect(inSubnet("192.168.4.1", "192.168.4.0/33")).toBe(false);
    expect(inSubnet("192.168.4.1", "nonsense")).toBe(false);
  });
});

describe("localAddresses", () => {
  it("keeps IPv4 LAN addresses, drops IPv6, loopback and link-local, and marks VPN and container interfaces", () => {
    expect(
      localAddresses(
        ifaces({
          lo: [{ ...v4("127.0.0.1", "127.0.0.1/8"), internal: true }],
          wlp2s0: [
            v4("192.168.4.30", "192.168.4.30/24"),
            { ...v4("fe80::1", "fe80::1/64"), family: "IPv6" },
          ],
          enp3s0: [v4("169.254.10.2", "169.254.10.2/16")],
          docker0: [v4("172.17.0.1", "172.17.0.1/16")],
          "br-1a2b3c": [v4("172.18.0.1", "172.18.0.1/16")],
          tailscale0: [v4("100.101.102.103", "100.101.102.103/32")],
          wg0: [v4("10.8.0.2", "10.8.0.2/24")],
          eth9: [v4("100.70.0.5", "100.70.0.5/10")],
        }),
      ),
    ).toEqual([
      wifi,
      docker,
      {
        iface: "br-1a2b3c",
        address: "172.18.0.1",
        cidr: "172.18.0.1/16",
        virtual: true,
      },
      tailscale,
      { iface: "wg0", address: "10.8.0.2", cidr: "10.8.0.2/24", virtual: true },
      // Carrier-grade NAT is Tailscale's range, whatever the interface is called.
      {
        iface: "eth9",
        address: "100.70.0.5",
        cidr: "100.70.0.5/10",
        virtual: true,
      },
    ]);
  });
});

describe("pickAddress", () => {
  it("uses the address on the subnet the panel polled from", () => {
    expect(pickAddress([wired, wifi], "192.168.4.31")).toBe("192.168.4.30");
  });

  it("with two addresses on the panel's subnet, uses one of those and never docker", () => {
    const wiredSame: LocalAddress = {
      iface: "enp3s0",
      address: "192.168.4.40",
      cidr: "192.168.4.40/24",
      virtual: false,
    };
    expect(pickAddress([docker, wiredSame, wifi], "192.168.4.31")).toBe(
      "192.168.4.40",
    );
  });

  it("with no history, uses the first LAN address", () => {
    expect(pickAddress([docker, tailscale, wired, wifi], null)).toBe(
      "10.0.10.110",
    );
  });

  it("gives a panel outside every local subnet the first LAN address", () => {
    expect(pickAddress([wired, wifi], "192.168.9.50")).toBe("10.0.10.110");
  });

  it("never offers a VPN or container address over a LAN one", () => {
    expect(pickAddress([tailscale, docker, wifi], "100.101.0.9")).toBe(
      "192.168.4.30",
    );
    expect(pickAddress([docker, tailscale], null)).toBeNull();
    expect(pickAddress([], "192.168.4.31")).toBeNull();
  });

  it("prefers a private address over a public one, and a missing netmask never matches", () => {
    const routed: LocalAddress = {
      iface: "eth0",
      address: "203.0.113.5",
      cidr: "203.0.113.5/24",
      virtual: false,
    };
    expect(pickAddress([routed, wifi], null)).toBe("192.168.4.30");
    expect(pickAddress([wired, { ...wifi, cidr: null }], "192.168.4.31")).toBe(
      "10.0.10.110",
    );
  });
});

describe("AddressWatch", () => {
  it("stays quiet with no saved poll", () => {
    const c = clock();
    const watch = new AddressWatch(null, c.now);
    c.advance(SILENCE_MS * 10);
    expect(watch.check([wifi])).toBeNull();
  });

  it("waits 60 s of silence from app start before offering an address", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS - 1);
    expect(watch.check([wifi])).toBeNull();
    c.advance(1);
    expect(watch.check([wifi])).toBe("192.168.4.30");
  });

  it("stays quiet while the address the panel used is still here, so a panel that is simply off shows nothing", () => {
    const c = clock();
    const watch = new AddressWatch({ ...seen, via: "192.168.4.30" }, c.now);
    c.advance(SILENCE_MS * 10);
    expect(watch.check([wifi, docker])).toBeNull();
  });

  it("restarts the silence on each poll and says when the poll came from somewhere new", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    expect(watch.polled(seen)).toBe(false);
    expect(watch.check([wifi])).toBeNull();
    c.advance(SILENCE_MS - 1);
    expect(watch.check([wifi])).toBeNull();
    expect(watch.polled({ ...seen, via: "192.168.4.30" })).toBe(true);
    expect(new AddressWatch(null, c.now).polled(seen)).toBe(true);
  });

  it("restarts the silence after the computer wakes from sleep", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS * 5);
    watch.woke();
    expect(watch.check([wifi])).toBeNull();
    c.advance(SILENCE_MS);
    expect(watch.check([wifi])).toBe("192.168.4.30");
  });

  it("stays quiet with no LAN address, as while the network comes back", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    expect(watch.check([])).toBeNull();
    expect(watch.check([docker, tailscale])).toBeNull();
  });

  it("ignores VPN and container addresses when choosing", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    expect(watch.check([tailscale, docker, wifi])).toBe("192.168.4.30");
  });

  it("holds Not now until this computer's addresses change or the panel polls", () => {
    const c = clock();
    const watch = new AddressWatch(seen, c.now);
    c.advance(SILENCE_MS);
    watch.dismiss([wifi]);
    expect(watch.check([wifi])).toBeNull();
    expect(watch.check([wifi, wired])).toBe("192.168.4.30");
    watch.dismiss([wifi]);
    watch.polled(seen);
    c.advance(SILENCE_MS);
    expect(watch.check([wifi])).toBe("192.168.4.30");
  });
});

describe("saved poll", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "calico-seen-"));

  it("keeps the last poll across a restart", () => {
    const path = join(dir(), "panel-seen.json");
    saveSeen(path, seen);
    expect(loadSeen(path)).toEqual(seen);
  });

  it("reads nothing from a missing, damaged or wrong file", () => {
    const d = dir();
    expect(loadSeen(join(d, "none.json"))).toBeNull();
    for (const [name, text] of [
      ["bad.json", "{bad"],
      ["null.json", "null"],
      ["v6.json", JSON.stringify({ from: "fe80::1", via: "192.168.4.20" })],
      ["type.json", JSON.stringify({ from: 1, via: "192.168.4.20" })],
    ] as const) {
      writeFileSync(join(d, name), text);
      expect(loadSeen(join(d, name))).toBeNull();
    }
  });

  it("does not throw when it cannot save", () => {
    const d = dir();
    const file = join(d, "a-file");
    writeFileSync(file, "x");
    expect(() => saveSeen(join(file, "panel-seen.json"), seen)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test test/main/panel-address.test.ts`
Expected: FAIL, cannot resolve `../../src/main/panel-address`.

- [ ] **Step 3: Implement**

Create `src/main/panel-address.ts`:

```ts
import { readFileSync } from "node:fs";
import { isIPv4 } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import type { PanelSeen } from "../server/http";
import { writeAtomic } from "../server/state-file";

/** One IPv4 address on this computer. */
export interface LocalAddress {
  iface: string;
  address: string;
  /** "192.168.4.30/24", or null when the OS gave no netmask. */
  cidr: string | null;
  /** A VPN, tunnel, container or VM network: never offered over a LAN address. */
  virtual: boolean;
}

/** How long the panel must be silent before the banner may show. */
export const SILENCE_MS = 60_000;

// Not this computer's own LAN: Docker and Podman bridges, VM and container networks, and VPN
// tunnels (Tailscale, WireGuard, ZeroTier, OpenVPN).
const VIRTUAL =
  /^(docker|br-|veth|virbr|vnet|vmnet|vboxnet|podman|cni|flannel|lxc|lxd|tailscale|tun|tap|wg|zt|utun)/i;

const toInt = (ip: string): number =>
  ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);

export function inSubnet(ip: string, cidr: string): boolean {
  const [net, size] = cidr.split("/");
  const bits = Number(size);
  if (!net || !isIPv4(ip) || !isIPv4(net)) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const span = 2 ** (32 - bits);
  return Math.floor(toInt(ip) / span) === Math.floor(toInt(net) / span);
}

const linkLocal = (ip: string) => inSubnet(ip, "169.254.0.0/16");
// Carrier-grade NAT: Tailscale gives its addresses from here.
const cgnat = (ip: string) => inSubnet(ip, "100.64.0.0/10");
const privateLan = (ip: string) =>
  inSubnet(ip, "10.0.0.0/8") ||
  inSubnet(ip, "172.16.0.0/12") ||
  inSubnet(ip, "192.168.0.0/16");

export function localAddresses(
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): LocalAddress[] {
  return Object.entries(ifaces).flatMap(([iface, list]) =>
    (list ?? [])
      .filter(
        (i) => i.family === "IPv4" && !i.internal && !linkLocal(i.address),
      )
      .map((i) => ({
        iface,
        address: i.address,
        cidr: i.cidr ?? null,
        virtual: VIRTUAL.test(iface) || cgnat(i.address),
      })),
  );
}

/**
 * The address to give the panel: one on the subnet the panel polled from, else the first private
 * LAN address, else the first LAN one. Never a VPN, tunnel or container address. Null when there
 * is no LAN address.
 */
export function pickAddress(
  addrs: LocalAddress[],
  panelFrom: string | null,
): string | null {
  const lan = addrs.filter((a) => !a.virtual);
  const near = panelFrom
    ? lan.find((a) => a.cidr !== null && inSubnet(panelFrom, a.cidr))
    : undefined;
  return (
    (near ?? lan.find((a) => privateLan(a.address)) ?? lan[0])?.address ?? null
  );
}

const key = (addrs: LocalAddress[]) =>
  addrs
    .map((a) => a.address)
    .sort()
    .join(",");

/**
 * When to show "The panel's address may have changed". The panel's last poll arrived on `via`.
 * Once that address is gone from this computer and the panel has been silent for SILENCE_MS, it
 * offers an address the panel can reach. A panel that is simply off, with the address still here,
 * shows nothing.
 */
export class AddressWatch {
  /** Silence counts from the latest of app start, the last poll, and the last wake. */
  private since: number;
  private dismissed = "";

  constructor(
    private last: PanelSeen | null,
    private readonly now: () => number,
  ) {
    this.since = now();
  }

  /** A poll arrived. True when it came from somewhere new, so the caller saves it. */
  polled(seen: PanelSeen): boolean {
    const changed =
      this.last?.from !== seen.from || this.last?.via !== seen.via;
    this.last = seen;
    this.since = this.now();
    this.dismissed = "";
    return changed;
  }

  /** The computer woke from sleep: the panel has had no chance to poll yet. */
  woke(): void {
    this.since = this.now();
  }

  /** "Not now": quiet until this computer's addresses change or the panel polls. */
  dismiss(addrs: LocalAddress[]): void {
    this.dismissed = key(addrs);
  }

  /** The address to offer, or null when there is no reason to show the banner. */
  check(addrs: LocalAddress[]): string | null {
    const last = this.last;
    if (!last || this.now() - this.since < SILENCE_MS) return null;
    if (addrs.some((a) => a.address === last.via)) return null;
    if (this.dismissed && this.dismissed === key(addrs)) return null;
    return pickAddress(addrs, last.from);
  }
}

/** The last poll's addresses, kept so a restart on a new address still shows the banner. */
export function loadSeen(path: string): PanelSeen | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { from, via } = value as Record<string, unknown>;
    return typeof from === "string" &&
      typeof via === "string" &&
      isIPv4(from) &&
      isIPv4(via)
      ? { from, via }
      : null;
  } catch {
    return null;
  }
}

/** Best effort: a failed write only means a restart forgets where the panel last polled. */
export function saveSeen(path: string, seen: PanelSeen): void {
  try {
    writeAtomic(path, `${JSON.stringify(seen)}\n`);
  } catch {
    // Not worth failing the panel's poll over.
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test test/main/panel-address.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/main/panel-address.ts test/main/panel-address.test.ts
git add src/main/panel-address.ts test/main/panel-address.test.ts
git commit --no-gpg-sign -m "Decide when the panel's address may have changed"
```

---

### Task 3: A confirmed push plan and the one-shot password release

**Files:**

- Modify: `src/shared/ipc.ts:114` (two types after `NetworksState`)
- Modify: `src/main/networks.ts:1-12` (imports), `:14-20` (`SecretBox`), `:30-36` (messages), `:117-128` (class fields and constructor), new methods after `remove` (line 183)
- Test: `test/main/networks.test.ts:13-35` (import, `box`), `:305-317`, `:319-335` (inline boxes), new describe at the end

**Interfaces:**

- Produces in `src/shared/ipc.ts`:
  - `export type PushConfirm = { ok: true } | { ok: false; error: string };`
  - `export type PushRelease = { ok: true; password: string; token: string } | { ok: false; error: string };`
- Produces in `src/main/networks.ts`:
  - `SecretBox.decrypt(sealed: Buffer): string`
  - `new NetworkVault(path: string, box: SecretBox, now?: () => number)` (default `Date.now`)
  - `export const PUSH_WINDOW_MS = 120_000`, `export const PLAN_EXPIRED`, `export const NOT_IN_PLAN`, `export function keyringChanged(ssid: string): string`
  - `NetworkVault.confirmPush(raw: unknown): PushConfirm`, `NetworkVault.release(raw: unknown): PushRelease`, `NetworkVault.endPush(): void`

- [ ] **Step 1: Write the failing tests**

In `test/main/networks.test.ts`, change the import from `../../src/main/networks` to:

```ts
import {
  keyringChanged,
  NetworkVault,
  NO_KEYRING,
  NOT_IN_PLAN,
  PLAINTEXT_KEYRING,
  PLAN_EXPIRED,
  PUSH_WINDOW_MS,
  type SecretBox,
} from "../../src/main/networks";
```

Replace `box` (lines 24-35) with a fake that can also open what it sealed:

```ts
function box(backend = "gnome_libsecret", available = true) {
  const seen: string[] = [];
  const fake: SecretBox = {
    backend: () => backend,
    available: () => available,
    encrypt: (text) => {
      seen.push(text);
      return Buffer.from(`sealed-${seen.length}`);
    },
    decrypt: (sealed) => {
      const text = seen[Number(sealed.toString().replace("sealed-", "")) - 1];
      if (text === undefined) throw new Error("not sealed by this keyring");
      return text;
    },
  };
  return { fake, seen };
}
```

In `refuses when encrypt throws, writing nothing and echoing nothing`, add `decrypt: () => "",` after the `encrypt` property of the inline box. In `refuses rather than throws when the keyring query throws`, change `encrypt: () => Buffer.from("sealed"),` to:

```ts
        encrypt: () => Buffer.from("sealed"),
        decrypt: () => "",
```

At the end of the file add:

```ts
describe("push release", () => {
  function vaultWith(now: () => number, fake: SecretBox = box().fake) {
    const vault = new NetworkVault(file(), fake, now);
    vault.save({ ...home, password: PASS, token: TOKEN });
    vault.save({ ssid: "cafe", url: "", edit: false });
    return vault;
  }

  it("releases a password once, only for an SSID in the confirmed plan", () => {
    const vault = vaultWith(() => 0);
    expect(vault.release("home")).toEqual({ ok: false, error: PLAN_EXPIRED });
    expect(vault.confirmPush(["home", "cafe"])).toEqual({ ok: true });
    expect(vault.release("home")).toEqual({
      ok: true,
      password: PASS,
      token: TOKEN,
    });
    expect(vault.release("home")).toEqual({ ok: false, error: NOT_IN_PLAN });
    expect(vault.release("cafe")).toEqual({
      ok: true,
      password: "",
      token: "",
    });
    expect(JSON.stringify(vault.list())).not.toContain(PASS);
    expect(JSON.stringify(vault.list())).not.toContain(TOKEN);
  });

  it("refuses an SSID outside the plan, and a plan that names an unsaved or repeated network", () => {
    const vault = vaultWith(() => 0);
    expect(vault.confirmPush(["cafe"])).toEqual({ ok: true });
    expect(vault.release("home")).toEqual({ ok: false, error: NOT_IN_PLAN });
    expect(vault.release(42)).toEqual({ ok: false, error: NOT_IN_PLAN });
    for (const bad of [["home", "home"], ["nope"], "home", [1], null]) {
      expect(vault.confirmPush(bad).ok).toBe(false);
    }
    // A refused confirmation also drops the plan before it.
    expect(vault.release("cafe")).toEqual({ ok: false, error: PLAN_EXPIRED });
  });

  it("stops releasing when the plan expires or the push ends", () => {
    let t = 0;
    const vault = vaultWith(() => t);
    vault.confirmPush(["home", "cafe"]);
    t = PUSH_WINDOW_MS + 1;
    expect(vault.release("home")).toEqual({ ok: false, error: PLAN_EXPIRED });
    vault.confirmPush(["home"]);
    vault.endPush();
    expect(vault.release("home")).toEqual({ ok: false, error: PLAN_EXPIRED });
  });

  it("refuses, without throwing or echoing, when the keyring is locked or changed", () => {
    const { fake } = box();
    const vault = vaultWith(() => 0, {
      ...fake,
      decrypt: () => {
        throw new Error(`keyring locked ${PASS}`);
      },
    });
    vault.confirmPush(["home"]);
    const reply = vault.release("home");
    expect(reply).toEqual({ ok: false, error: keyringChanged("home") });
    expect(JSON.stringify(reply)).not.toContain(PASS);
  });

  it("refuses when the keyring became the plaintext fallback", () => {
    let backend = "gnome_libsecret";
    const { fake } = box();
    const vault = vaultWith(() => 0, { ...fake, backend: () => backend });
    backend = "basic_text";
    vault.confirmPush(["home"]);
    expect(vault.release("home")).toEqual({
      ok: false,
      error: keyringChanged("home"),
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test test/main/networks.test.ts`
Expected: FAIL, `keyringChanged`, `PLAN_EXPIRED` and `confirmPush` do not exist.

- [ ] **Step 3: Add the shared types**

In `src/shared/ipc.ts`, after the `NetworksState` interface add:

```ts
/** The reply to confirming a push plan. */
export type PushConfirm = { ok: true } | { ok: false; error: string };

/**
 * One saved network's password and token, released once for a confirmed push. The only IPC reply
 * that carries a secret: the window passes it straight to the panel write and drops it.
 */
export type PushRelease =
  { ok: true; password: string; token: string } | { ok: false; error: string };
```

- [ ] **Step 4: Implement in the vault**

In `src/main/networks.ts`, change the type import to:

```ts
import type {
  NetworkInput,
  NetworksState,
  PushConfirm,
  PushRelease,
  SavedNetwork,
} from "../shared/ipc";
```

In `SecretBox`, after `encrypt(text: string): Buffer;` add:

```ts
  /** safeStorage.decryptString. Throws when the keyring is locked or did not seal it. */
  decrypt(sealed: Buffer): string;
```

After `const BAD_REMOVE = ...` add:

```ts
/** How long a confirmed plan may release passwords. Pushing 8 networks takes well under this. */
export const PUSH_WINDOW_MS = 120_000;
export const PLAN_EXPIRED =
  "The confirmed plan has expired. Push to the panel again.";
export const NOT_IN_PLAN =
  "That network is not in the plan you confirmed, or it was already sent. Push to the panel again.";
const BAD_PLAN =
  "That plan names a network that is not saved on this computer. Push to the panel again.";

export function keyringChanged(ssid: string): string {
  return `Calico could not unlock the saved password for ${ssid}. The system keyring is locked or has changed. Unlock it, or edit ${ssid} in Settings and type its password again.`;
}
```

In the class, after `private blocked = "";` add:

```ts
  /** The SSIDs the person confirmed for one push, each released at most once, until `until`. */
  private plan: { ssids: Set<string>; until: number } | null = null;
```

Replace the constructor with:

```ts
  constructor(
    private readonly path: string,
    private readonly box: SecretBox,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }
```

After `remove` add:

```ts
  /** The person confirmed a push. Only these SSIDs may release a password, once each. */
  confirmPush(raw: unknown): PushConfirm {
    this.plan = null;
    if (!Array.isArray(raw)) return { ok: false, error: BAD_PLAN };
    const list: unknown[] = raw;
    if (
      list.length > NETWORKS_MAX ||
      !list.every((s): s is string => typeof s === "string")
    )
      return { ok: false, error: BAD_PLAN };
    const ssids = new Set(list);
    if (
      ssids.size !== list.length ||
      !list.every((s) => this.nets.some((n) => n.ssid === s))
    )
      return { ok: false, error: BAD_PLAN };
    this.plan = { ssids, until: this.now() + PUSH_WINDOW_MS };
    return { ok: true };
  }

  /**
   * The one place a saved password leaves main: once, for an SSID in the confirmed plan, while
   * the plan is fresh. Never throws and never puts the password in an error.
   */
  release(raw: unknown): PushRelease {
    const plan = this.plan;
    if (!plan || this.now() > plan.until) {
      this.plan = null;
      return { ok: false, error: PLAN_EXPIRED };
    }
    // Deleted before decrypting, so a refused or failed release is still used up.
    if (typeof raw !== "string" || !plan.ssids.delete(raw))
      return { ok: false, error: NOT_IN_PLAN };
    const net = this.nets.find((n) => n.ssid === raw);
    if (!net) return { ok: false, error: NOT_IN_PLAN };
    if (net.password === "")
      return { ok: true, password: "", token: net.token };
    try {
      if (keyringRefusal(this.box))
        return { ok: false, error: keyringChanged(net.ssid) };
      return {
        ok: true,
        password: this.box.decrypt(Buffer.from(net.password, "base64")),
        token: net.token,
      };
    } catch {
      return { ok: false, error: keyringChanged(net.ssid) };
    }
  }

  /** The push finished or was cancelled: nothing more may be released. */
  endPush(): void {
    this.plan = null;
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test test/main/networks.test.ts`
Expected: PASS. `pnpm typecheck` fails only in `src/main/index.ts` (the vault's box has no `decrypt`); Task 4 wires it. Do not commit a red typecheck: go on to Step 6.

- [ ] **Step 6: Wire decrypt so typecheck is green**

In `src/main/index.ts`, in the `NetworkVault` box (line 198), after `encrypt: (text) => safeStorage.encryptString(text),` add:

```ts
    decrypt: (sealed) => safeStorage.decryptString(sealed),
```

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/shared/ipc.ts src/main/networks.ts src/main/index.ts test/main/networks.test.ts
git add src/shared/ipc.ts src/main/networks.ts src/main/index.ts test/main/networks.test.ts
git commit --no-gpg-sign -m "Release a saved password once for a confirmed push"
```

---

### Task 4: Wire the release and the address watch through IPC and main

**Files:**

- Modify: `src/shared/ipc.ts:33-53` (`CalicoInfo`), `:140-143` (`CalicoApi`)
- Modify: `src/preload/index.ts:36-38`
- Modify: `src/main/ipc.ts:28-36` (`IpcDeps`), `:58-65` (handlers)
- Modify: `src/main/index.ts:3` (electron import), `:11` (imports), `:88-92` (paths), `:119-130` (server deps), `:161-175` (`info`), `:201-216` (`registerIpc`)
- Modify fixtures: `src/renderer/src/device/DeviceView.test.tsx:54`, `src/renderer/src/settings/AgentUpdatesSection.test.tsx:25`, `src/renderer/src/settings/SettingsView.test.tsx:39`

**Interfaces:**

- Consumes: `PanelSeen` (Task 1); `AddressWatch`, `localAddresses`, `loadSeen`, `saveSeen` (Task 2); `PushConfirm`, `PushRelease`, `NetworkVault.confirmPush/release/endPush` (Task 3).
- Produces:
  - `CalicoInfo.addressChange: { url: string } | null` (`http://<address>:<bound port>`)
  - `CalicoApi.networksConfirmPush(ssids: string[]): Promise<PushConfirm>`, `networksRelease(ssid: string): Promise<PushRelease>`, `networksEndPush(): Promise<void>`, `dismissAddress(): Promise<void>`
  - IPC channels `networks:confirm-push`, `networks:release`, `networks:end-push`, `calico:dismiss-address`
  - `panel-seen.json` in the profile directory, mode 0600.

- [ ] **Step 1: Change the shared types first**

In `src/shared/ipc.ts`, in `CalicoInfo` after `hostname: string;` add:

```ts
  /**
   * Set when the panel has been silent for 60 s and the address of this computer it last polled
   * is gone: the companion URL to give the panel. Null otherwise.
   */
  addressChange: { url: string } | null;
```

In `CalicoApi`, after `networksRemove(ssid: string): Promise<NetworksState>;` add:

```ts
  /** The person confirmed the push plan: main may release these SSIDs' passwords, once each. */
  networksConfirmPush(ssids: string[]): Promise<PushConfirm>;
  /** One saved password and token, once, for a confirmed SSID. Pass it to the write, then drop it. */
  networksRelease(ssid: string): Promise<PushRelease>;
  /** The push ended: main releases nothing more. */
  networksEndPush(): Promise<void>;
  /** "Not now" on the address banner. */
  dismissAddress(): Promise<void>;
```

- [ ] **Step 2: Run typecheck to see what must change**

Run: `pnpm typecheck`
Expected: FAIL in `src/preload/index.ts` (the api object lacks the four methods), `src/main/index.ts` (`info` lacks `addressChange`), and the three test fixtures (`addressChange` missing).

- [ ] **Step 3: Preload**

In `src/preload/index.ts`, after the `networksRemove` line add:

```ts
  networksConfirmPush: (ssids) =>
    ipcRenderer.invoke("networks:confirm-push", ssids),
  networksRelease: (ssid) => ipcRenderer.invoke("networks:release", ssid),
  networksEndPush: () => ipcRenderer.invoke("networks:end-push"),
  dismissAddress: () => ipcRenderer.invoke("calico:dismiss-address"),
```

- [ ] **Step 4: Main IPC**

In `src/main/ipc.ts`, replace the `networks` line of `IpcDeps` with:

```ts
  networks: Pick<
    NetworkVault,
    "list" | "save" | "remove" | "confirmPush" | "release" | "endPush"
  >;
  /** "Not now" on the address banner. */
  dismissAddress(): void;
```

After the `networks:remove` handler add:

```ts
// The one path a saved password takes to the window: once, for an SSID in the plan the person
// confirmed (NetworkVault.release). An invoke reply, never an event, and never logged.
ipcMain.handle("networks:confirm-push", (_e, ssids: unknown) =>
  deps.networks.confirmPush(ssids),
);
ipcMain.handle("networks:release", (_e, ssid: unknown) =>
  deps.networks.release(ssid),
);
ipcMain.handle("networks:end-push", () => deps.networks.endPush());
ipcMain.handle("calico:dismiss-address", () => deps.dismissAddress());
```

- [ ] **Step 5: Main process wiring**

In `src/main/index.ts`, change line 3 to:

```ts
import {
  app,
  BrowserWindow,
  dialog,
  powerMonitor,
  safeStorage,
  shell,
} from "electron";
```

After `import { NetworkVault } from "./networks";` add:

```ts
import {
  AddressWatch,
  loadSeen,
  localAddresses,
  saveSeen,
} from "./panel-address";
```

After `const statePath = join(userData, "state.json");` add:

```ts
const seenPath = join(userData, "panel-seen.json");
const addressWatch = new AddressWatch(loadSeen(seenPath), Date.now);
```

In the `createCompanionServer({...})` call, after `relayStatus: ...,` add:

```ts
    // Saved only when the poll came from somewhere new, not on every poll.
    onPanelPoll: (seen) => {
      if (addressWatch.polled(seen)) saveSeen(seenPath, seen);
    },
```

Replace the `info` arrow (lines 161-175) with:

```ts
const info = (): CalicoInfo => {
  const offer = bound ? addressWatch.check(localAddresses()) : null;
  return {
    serverUrl: bound ? `http://127.0.0.1:${bound}` : null,
    port: bound,
    expectedPort: panelPort.expected,
    lanUrls: bound ? lanUrls(bound) : [],
    lastPanelPoll: stats.lastPanelPoll,
    panelBattery: stats.panelBattery,
    webhookToken: config.webhook_token,
    webhook: stats.webhook,
    serverError,
    autostart: autostartState(),
    // app.getVersion() returns Electron's version when launched from the entry file.
    version,
    hostname: hostname(),
    addressChange: offer && bound ? { url: `http://${offer}:${bound}` } : null,
  };
};
// After sleep the panel has had no chance to poll: count its silence from the wake.
powerMonitor.on("resume", () => addressWatch.woke());
```

In `registerIpc({...})`, after `networks,` add:

```ts
    dismissAddress: () => addressWatch.dismiss(localAddresses()),
```

- [ ] **Step 6: Fixtures**

In each of `src/renderer/src/device/DeviceView.test.tsx` (after line 54), `src/renderer/src/settings/AgentUpdatesSection.test.tsx` (after line 25) and `src/renderer/src/settings/SettingsView.test.tsx` (after line 39), after `hostname: "test-host",` add:

```ts
  addressChange: null,
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Format, commit**

```bash
pnpm exec prettier --write src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts src/renderer/src/device/DeviceView.test.tsx src/renderer/src/settings/AgentUpdatesSection.test.tsx src/renderer/src/settings/SettingsView.test.tsx
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/index.ts src/renderer/src/device/DeviceView.test.tsx src/renderer/src/settings/AgentUpdatesSection.test.tsx src/renderer/src/settings/SettingsView.test.tsx
git commit --no-gpg-sign -m "Expose the push release and the panel address change to the window"
```

---

### Task 5: The push plan, its runner, and the 354-byte wifi cap

**Files:**

- Modify: `src/shared/panel-fields.ts` (one constant after `NETWORKS_MAX`, line 7)
- Modify: `src/renderer/src/device/ble.ts:1-15` (imports), `:111-117` (`wifi` case)
- Create: `src/renderer/src/device/push-plan.ts`
- Test: `src/renderer/src/device/ble.test.ts`, `src/renderer/src/device/push-plan.test.ts`

**Interfaces:**

- Consumes: `SavedNetwork`, `PushRelease` (`src/shared/ipc.ts`); `Cmd`, `DeviceLink`, `PanelNet`, `Reply` (`commands.ts`); `NETWORKS_MAX`.
- Produces:
  - `export const WIFI_WRITE_MAX = 354` in `src/shared/panel-fields.ts` (computed from the four limits)
  - in `push-plan.ts`: `interface PushPlan { add: SavedNetwork[]; update: SavedNetwork[]; remove: string[]; current: string }`, `type PushStep = { op: "wifi"; net: SavedNetwork } | { op: "forget"; ssid: string }`, `interface PushResult { done: number; total: number; error: string }`, `buildPlan(vault: SavedNetwork[], panel: PanelNet[], current: string): PushPlan`, `planSize(plan: PushPlan): number`, `planSteps(plan: PushPlan, removeCurrent: boolean): { steps: PushStep[]; error: string }`, `runPush(link: DeviceLink, steps: PushStep[], release: (ssid: string) => Promise<PushRelease>, onStep: (index: number, step: PushStep) => void): Promise<PushResult>`.

- [ ] **Step 1: Write the failing cap test**

In `src/renderer/src/device/ble.test.ts`, add to the import block:

```ts
import { PASS_MAX, SSID_MAX, TOKEN_MAX, URL_MAX } from "./commands";
import { WIFI_WRITE_MAX } from "../../../shared/panel-fields";
```

and inside `describe("BleLink", ...)`:

```ts
it("writes the longest legal network in at most 354 bytes", async () => {
  const { gatt, writes } = fakeGatt({ [UUID.nets]: ["count=0\n"] });
  const reply = await new BleLink(gatt, instant).send({
    op: "wifi",
    ssid: "s".repeat(SSID_MAX),
    pass: "p".repeat(PASS_MAX),
    url: `http://${"u".repeat(URL_MAX - 7)}`,
    token: "t".repeat(TOKEN_MAX),
  });
  expect(reply).toEqual({ ok: true });
  expect(WIFI_WRITE_MAX).toBe(354);
  expect(new TextEncoder().encode(writes[0]?.[1] ?? "").length).toBe(
    WIFI_WRITE_MAX - 1,
  );
  expect(header).toContain("#define BLE_DESK_WIFI_CFG_MAX");
});
```

- [ ] **Step 2: Write the failing plan tests**

Create `src/renderer/src/device/push-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PushRelease, SavedNetwork } from "../../../shared/ipc";
import { BleLink, type Gatt } from "./ble";
import type { Cmd, DeviceLink, PanelNet } from "./commands";
import { buildPlan, planSteps, type PushStep, runPush } from "./push-plan";

const PASS = "placeholder-pass";
const TOKEN = "placeholder-token";
const net = (ssid: string, url = ""): SavedNetwork => ({
  ssid,
  url,
  password_set: true,
  token_set: true,
});
const onPanel = (ssid: string): PanelNet => ({
  ssid,
  has_url: false,
  has_token: false,
});

function fakeLink(fail?: Cmd["op"]) {
  const sent: Cmd[] = [];
  const live: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push({ ...cmd });
      live.push(cmd);
      return cmd.op === fail
        ? { ok: false, error: "Bluetooth: GATT Server is disconnected." }
        : { ok: true };
    },
    close() {},
  };
  return { link, sent, live };
}

function releaser(reply?: PushRelease) {
  const asked: string[] = [];
  const release = async (ssid: string): Promise<PushRelease> => {
    asked.push(ssid);
    return reply ? { ...reply } : { ok: true, password: PASS, token: TOKEN };
  };
  return { asked, release };
}

const quiet = () => undefined;

describe("buildPlan", () => {
  it("adds what only this computer has, resends what both have, removes what only the panel has", () => {
    expect(
      buildPlan(
        [net("home"), net("lab")],
        [onPanel("home"), onPanel("old")],
        "home",
      ),
    ).toEqual({
      add: [net("lab")],
      update: [net("home")],
      remove: ["old"],
      current: "home",
    });
  });

  it("compares SSIDs exactly, so Home and home are different networks", () => {
    const plan = buildPlan([net("Home")], [onPanel("home")], "");
    expect(plan.add.map((n) => n.ssid)).toEqual(["Home"]);
    expect(plan.remove).toEqual(["home"]);
  });

  it("after a push that stopped halfway, plans the rest again", () => {
    // The first run resent home and removed old, then the link dropped before lab.
    expect(
      buildPlan([net("home"), net("lab")], [onPanel("home")], "home"),
    ).toEqual({
      add: [net("lab")],
      update: [net("home")],
      remove: [],
      current: "home",
    });
  });
});

describe("planSteps", () => {
  it("updates first, then removes, then adds", () => {
    const plan = buildPlan(
      [net("home"), net("lab")],
      [onPanel("home"), onPanel("old")],
      "",
    );
    expect(planSteps(plan, false)).toEqual({
      steps: [
        { op: "wifi", net: net("home") },
        { op: "forget", ssid: "old" },
        { op: "wifi", net: net("lab") },
      ],
      error: "",
    });
  });

  it("keeps the network the panel is on unless the person says to remove it", () => {
    const plan = buildPlan([net("lab")], [onPanel("cafe")], "cafe");
    expect(planSteps(plan, false).steps).toEqual([
      { op: "wifi", net: net("lab") },
    ]);
    expect(planSteps(plan, true).steps).toEqual([
      { op: "forget", ssid: "cafe" },
      { op: "wifi", net: net("lab") },
    ]);
  });

  it("refuses a plan that would leave the panel more than 8 networks", () => {
    const eight = Array.from({ length: 8 }, (_, i) => net(`n${i}`));
    const plan = buildPlan(eight, [onPanel("cafe")], "cafe");
    expect(planSteps(plan, false)).toEqual({
      steps: [],
      error:
        "The panel would need 9 networks and holds 8. Remove one in Settings, or let the push remove cafe.",
    });
    expect(planSteps(plan, true).steps).toHaveLength(9);
  });
});

describe("runPush", () => {
  it("asks main for each password once, writes it, and blanks the command after", async () => {
    const { link, sent, live } = fakeLink();
    const { asked, release } = releaser();
    const steps: PushStep[] = [
      { op: "wifi", net: net("home", "http://10.0.0.8:8787") },
      { op: "forget", ssid: "old" },
    ];
    expect(await runPush(link, steps, release, quiet)).toEqual({
      done: 2,
      total: 2,
      error: "",
    });
    expect(asked).toEqual(["home"]);
    expect(sent).toEqual([
      {
        op: "wifi",
        ssid: "home",
        pass: PASS,
        url: "http://10.0.0.8:8787",
        token: TOKEN,
      },
      { op: "forget", ssid: "old" },
    ]);
    expect(live[0]).toMatchObject({ pass: "", token: "" });
  });

  it("stops before writing when main refuses the password", async () => {
    const { link, sent } = fakeLink();
    const { release } = releaser({
      ok: false,
      error: "The keyring is locked.",
    });
    expect(
      await runPush(
        link,
        [
          { op: "wifi", net: net("home") },
          { op: "wifi", net: net("lab") },
        ],
        release,
        quiet,
      ),
    ).toEqual({ done: 0, total: 2, error: "The keyring is locked." });
    expect(sent).toEqual([]);
  });

  it("stops at the first failed write and says how far it got", async () => {
    const { link } = fakeLink("forget");
    const { asked, release } = releaser();
    expect(
      await runPush(
        link,
        [
          { op: "wifi", net: net("home") },
          { op: "forget", ssid: "old" },
          { op: "wifi", net: net("lab") },
        ],
        release,
        quiet,
      ),
    ).toEqual({
      done: 1,
      total: 3,
      error: "Bluetooth: GATT Server is disconnected.",
    });
    expect(asked).toEqual(["home"]);
  });

  it("refuses a password with a newline before anything reaches the panel", async () => {
    const writes: string[] = [];
    const gatt: Gatt = {
      async read() {
        return "count=0\n";
      },
      async write(uuid) {
        writes.push(uuid);
      },
      disconnect() {},
    };
    const { release } = releaser({
      ok: true,
      password: "placeholder\npass",
      token: "",
    });
    const result = await runPush(
      new BleLink(gatt, async () => undefined),
      [{ op: "wifi", net: net("home") }],
      release,
      quiet,
    );
    expect(result.done).toBe(0);
    expect(result.error).toMatch(/newline/);
    expect(result.error).not.toContain("placeholder");
    expect(writes).toEqual([]);
  });

  it("reports each step before it starts", async () => {
    const { link } = fakeLink();
    const { release } = releaser();
    const seen: number[] = [];
    await runPush(
      link,
      [
        { op: "forget", ssid: "old" },
        { op: "wifi", net: net("lab") },
      ],
      release,
      (i) => seen.push(i),
    );
    expect(seen).toEqual([0, 1]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm test src/renderer/src/device/ble.test.ts src/renderer/src/device/push-plan.test.ts`
Expected: FAIL, `WIFI_WRITE_MAX` is not exported and `./push-plan` does not exist.

- [ ] **Step 4: Add the cap**

In `src/shared/panel-fields.ts`, after `export const NETWORKS_MAX = 8;` add:

```ts
/** The longest wifi write the panel takes: ssid\npass\nurl\ntoken\n at full size (BLE_DESK_WIFI_CFG_MAX). */
export const WIFI_WRITE_MAX =
  SSID_MAX + 1 + PASS_MAX + 1 + URL_MAX + 1 + TOKEN_MAX + 1;
```

In `src/renderer/src/device/ble.ts`, after the import from `./commands` add:

```ts
import { WIFI_WRITE_MAX } from "../../../shared/panel-fields";
```

Replace the `wifi` case (lines 111-117) with:

```ts
      case "wifi": {
        const body = encode(wifiBody(cmd));
        // The field limits keep this at 353 bytes and the panel's buffer is 354. Never send more.
        if (body.length > WIFI_WRITE_MAX)
          throw new FieldError(
            `That network is longer than the panel's ${WIFI_WRITE_MAX}-byte Wi-Fi write.`,
          );
        // Firmware without nets also rejects the four-line form with a raw ATT error.
        // Reading nets first turns that into NotFoundError, before any secret is written.
        if (cmd.url !== undefined || cmd.token !== undefined)
          await this.gatt.read(UUID.nets);
        await this.gatt.write(UUID.wifi, body);
        return { ok: true };
      }
```

- [ ] **Step 5: Implement the plan**

Create `src/renderer/src/device/push-plan.ts`:

```ts
import type { PushRelease, SavedNetwork } from "../../../shared/ipc";
import { NETWORKS_MAX } from "../../../shared/panel-fields";
import type { Cmd, DeviceLink, PanelNet, Reply } from "./commands";

/** What a push would change on the panel. The networks saved on this computer are the truth. */
export interface PushPlan {
  /** Saved here, not on the panel. */
  add: SavedNetwork[];
  /** On both. The panel never sends a password back, so these are always sent again. */
  update: SavedNetwork[];
  /** On the panel, not saved here. */
  remove: string[];
  /** The network the panel is on now, or "". */
  current: string;
}

export type PushStep =
  { op: "wifi"; net: SavedNetwork } | { op: "forget"; ssid: string };

export interface PushResult {
  done: number;
  total: number;
  error: string;
}

export function buildPlan(
  vault: SavedNetwork[],
  panel: PanelNet[],
  current: string,
): PushPlan {
  const onPanel = new Set(panel.map((n) => n.ssid));
  const saved = new Set(vault.map((n) => n.ssid));
  return {
    add: vault.filter((n) => !onPanel.has(n.ssid)),
    update: vault.filter((n) => onPanel.has(n.ssid)),
    remove: panel.map((n) => n.ssid).filter((ssid) => !saved.has(ssid)),
    current,
  };
}

export const planSize = (plan: PushPlan): number =>
  plan.add.length + plan.update.length + plan.remove.length;

/**
 * The writes in a safe order: updates (no slot moves), removals (make room), additions. The
 * network the panel is on now is removed only when the person said so. Refuses a plan that would
 * leave the panel more than NETWORKS_MAX networks.
 */
export function planSteps(
  plan: PushPlan,
  removeCurrent: boolean,
): { steps: PushStep[]; error: string } {
  const remove = plan.remove.filter(
    (ssid) => removeCurrent || ssid !== plan.current,
  );
  const after =
    plan.update.length + (plan.remove.length - remove.length) + plan.add.length;
  if (after > NETWORKS_MAX)
    return {
      steps: [],
      error: `The panel would need ${after} networks and holds ${NETWORKS_MAX}. Remove one in Settings, or let the push remove ${plan.current}.`,
    };
  return {
    steps: [
      ...plan.update.map((net): PushStep => ({ op: "wifi", net })),
      ...remove.map((ssid): PushStep => ({ op: "forget", ssid })),
      ...plan.add.map((net): PushStep => ({ op: "wifi", net })),
    ],
    error: "",
  };
}

/**
 * Applies the steps in order and stops at the first failure. Each password comes from main once
 * and goes straight into the write. Every write is idempotent, so pushing again after a stop
 * finishes the job.
 */
export async function runPush(
  link: DeviceLink,
  steps: PushStep[],
  release: (ssid: string) => Promise<PushRelease>,
  onStep: (index: number, step: PushStep) => void,
): Promise<PushResult> {
  const total = steps.length;
  for (const [i, step] of steps.entries()) {
    onStep(i, step);
    let reply: Reply;
    if (step.op === "forget") {
      reply = await link.send({ op: "forget", ssid: step.ssid });
    } else {
      const secret = await release(step.net.ssid);
      if (!secret.ok) return { done: i, total, error: secret.error };
      const cmd: Extract<Cmd, { op: "wifi" }> = {
        op: "wifi",
        ssid: step.net.ssid,
        pass: secret.password,
        url: step.net.url,
        token: secret.token,
      };
      // ponytail: JS strings cannot be wiped. Blanking the only references lets the collector
      // take them; a native buffer would need the password to stay out of JS, which Web
      // Bluetooth cannot do.
      secret.password = "";
      secret.token = "";
      try {
        reply = await link.send(cmd);
      } finally {
        cmd.pass = "";
        cmd.token = "";
      }
    }
    if (!reply.ok) return { done: i, total, error: reply.error };
  }
  return { done: total, total, error: "" };
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm test src/renderer/src/device && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/shared/panel-fields.ts src/renderer/src/device/ble.ts src/renderer/src/device/ble.test.ts src/renderer/src/device/push-plan.ts src/renderer/src/device/push-plan.test.ts
git add src/shared/panel-fields.ts src/renderer/src/device/ble.ts src/renderer/src/device/ble.test.ts src/renderer/src/device/push-plan.ts src/renderer/src/device/push-plan.test.ts
git commit --no-gpg-sign -m "Plan and run a push of the saved networks to the panel"
```

---

### Task 6: Push to panel in the Device view, with the plan dialog

**Files:**

- Create: `src/renderer/src/device/PushPlanDialog.tsx`, `src/renderer/src/device/PushNetworks.tsx`
- Modify: `src/renderer/src/device/DeviceView.tsx:7` (import), `:21-28` (state), `:49-51` (`open`), `:112` (after `PanelNetworks`), `:159-161` (above `RebootWait`)
- Test: `src/renderer/src/device/PushNetworks.test.tsx`

**Interfaces:**

- Consumes: `buildPlan`, `planSize`, `planSteps`, `runPush`, `PushPlan`, `PushStep` (Task 5); `window.calico.networksList`, `networksConfirmPush`, `networksRelease`, `networksEndPush` (Task 4); `OLD_FIRMWARE` (`ble.ts`, in tests).
- Produces:
  - `PushPlanDialog(props: { plan: PushPlan; removeCurrent: boolean; onRemoveCurrent: (on: boolean) => void; progress: string; error: string; count: number; opener: RefObject<HTMLButtonElement | null>; onConfirm: () => void; onCancel: () => void })`
  - `PushNetworks(props: { link: DeviceLink; onFinished: (message: string, reboot: boolean) => void })`, and exported copy `NOTHING_TO_PUSH: string`, `pushedAll(n: number): string`, `pushStopped(done: number, total: number, error: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/device/PushNetworks.test.tsx`:

```tsx
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushRelease, SavedNetwork } from "../../../shared/ipc";
import { OLD_FIRMWARE } from "./ble";
import type { Cmd, DeviceLink, Reply } from "./commands";
import { pushedAll, PushNetworks, pushStopped } from "./PushNetworks";

const PASS = "placeholder-pass";
const TOKEN = "placeholder-token";
const DROP = "Bluetooth: GATT Server is disconnected.";

afterEach(cleanup);

const saved = (ssid: string): SavedNetwork => ({
  ssid,
  url: "",
  password_set: true,
  token_set: true,
});

function setup(
  vault: string[],
  panel: string[],
  current: string,
  opts: {
    nets?: Reply;
    status?: Reply;
    fail?: Cmd["op"];
    release?: PushRelease;
  } = {},
) {
  const sent: Cmd[] = [];
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push({ ...cmd });
      if (cmd.op === "status")
        return (
          opts.status ?? {
            ok: true,
            info: {
              name: "ginger",
              fw: "1",
              ssid: current,
              url: "",
              token: "none",
            },
          }
        );
      if (cmd.op === "nets")
        return (
          opts.nets ?? {
            ok: true,
            nets: panel.map((ssid) => ({
              ssid,
              has_url: false,
              has_token: false,
            })),
          }
        );
      if (cmd.op === opts.fail) return { ok: false, error: DROP };
      return { ok: true };
    },
    close() {},
  };
  const api = {
    networksList: vi.fn(async () => ({
      networks: vault.map(saved),
      error: "",
      notice: "",
    })),
    networksConfirmPush: vi.fn(async () => ({ ok: true as const })),
    networksRelease: vi.fn(async (): Promise<PushRelease> =>
      opts.release
        ? { ...opts.release }
        : { ok: true, password: PASS, token: TOKEN },
    ),
    networksEndPush: vi.fn(async () => undefined),
  };
  Object.assign(window, { calico: api });
  const onFinished = vi.fn();
  render(<PushNetworks link={link} onFinished={onFinished} />);
  return { sent, api, onFinished };
}

describe("PushNetworks", () => {
  it("shows the plan and writes nothing until it is confirmed", async () => {
    const { sent, api, onFinished } = setup(
      ["home", "lab"],
      ["home", "old"],
      "home",
    );
    fireEvent.click(screen.getByText("Push to panel"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Add" }).textContent).toBe("lab");
    expect(
      screen.getByRole("list", { name: "Update, sent again" }).textContent,
    ).toBe("home");
    expect(
      screen.getByRole("list", { name: "Remove from the panel" }).textContent,
    ).toBe("old");
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    expect(api.networksRelease).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Cancel"),
    );

    fireEvent.click(screen.getByText("Push 3 changes"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushedAll(3), true),
    );
    expect(api.networksConfirmPush).toHaveBeenCalledWith(["home", "lab"]);
    expect(sent.slice(2)).toEqual([
      { op: "wifi", ssid: "home", pass: PASS, url: "", token: TOKEN },
      { op: "forget", ssid: "old" },
      { op: "wifi", ssid: "lab", pass: PASS, url: "", token: TOKEN },
    ]);
    expect(api.networksEndPush).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.innerHTML).not.toContain(PASS);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("keeps the panel's current network unless the person ticks it", async () => {
    const { sent, onFinished } = setup(["lab"], ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    expect(await screen.findByText(/The panel is on cafe now/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Remove from the panel" })).toBe(
      null,
    );
    fireEvent.click(screen.getByLabelText("Also remove cafe"));
    fireEvent.click(screen.getByLabelText("Also remove cafe"));
    fireEvent.click(screen.getByText("Push 1 change"));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(sent.some((c) => c.op === "forget")).toBe(false);
  });

  it("removes the current network only when ticked", async () => {
    const { sent, onFinished } = setup(["lab"], ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByLabelText("Also remove cafe"));
    fireEvent.click(screen.getByText("Push 2 changes"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushedAll(2), true),
    );
    expect(sent).toContainEqual({ op: "forget", ssid: "cafe" });
  });

  it("refuses a ninth network until the current one may go", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => `n${i}`);
    setup(eight, ["cafe"], "cafe");
    fireEvent.click(screen.getByText("Push to panel"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The panel would need 9 networks and holds 8.",
    );
    expect(
      (screen.getByText("Nothing to push") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Also remove cafe"));
    expect(
      (screen.getByText("Push 9 changes") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("stops on old firmware or an unreadable status before anything secret", async () => {
    for (const opts of [
      { nets: { ok: false as const, error: OLD_FIRMWARE } },
      { status: { ok: false as const, error: DROP } },
    ]) {
      const { sent, api } = setup(["home"], [], "", opts);
      fireEvent.click(screen.getByText("Push to panel"));
      expect((await screen.findByRole("alert")).textContent).toContain(
        "nets" in opts ? OLD_FIRMWARE : DROP,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(api.networksConfirmPush).not.toHaveBeenCalled();
      expect(api.networksRelease).not.toHaveBeenCalled();
      expect(sent.every((c) => c.op === "status" || c.op === "nets")).toBe(
        true,
      );
      cleanup();
    }
  });

  it("reports a push that stopped halfway, without restarting", async () => {
    const { onFinished } = setup(["home", "lab"], ["home", "old"], "home", {
      fail: "forget",
    });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 3 changes"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushStopped(1, 3, DROP), false),
    );
  });

  it("a keyring refusal stops the push with its message", async () => {
    const locked = "Calico could not unlock the saved password for home.";
    const { sent, onFinished } = setup(["home"], [], "", {
      release: { ok: false, error: locked },
    });
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Push 1 change"));
    await waitFor(() =>
      expect(onFinished).toHaveBeenCalledWith(pushStopped(0, 1, locked), false),
    );
    expect(sent.some((c) => c.op === "wifi")).toBe(false);
  });

  it("Cancel closes the plan, ends the push and returns focus to its opener", async () => {
    const { api, sent } = setup(["home"], [], "");
    fireEvent.click(screen.getByText("Push to panel"));
    fireEvent.click(await screen.findByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.networksEndPush).toHaveBeenCalled();
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Push to panel"),
    );
  });

  it("says when there is nothing to push", async () => {
    setup([], [], "");
    fireEvent.click(screen.getByText("Push to panel"));
    expect(
      await screen.findByText(
        "Nothing to push: no networks are saved on this computer or on the panel.",
      ),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/renderer/src/device/PushNetworks.test.tsx`
Expected: FAIL, cannot resolve `./PushNetworks`.

- [ ] **Step 3: The dialog**

Create `src/renderer/src/device/PushPlanDialog.tsx`:

```tsx
import { Dialog } from "@base-ui/react/dialog";
import { type RefObject, useRef } from "react";
import { ErrorNote } from "../shell/ErrorNote";
import type { PushPlan } from "./push-plan";

interface Props {
  plan: PushPlan;
  removeCurrent: boolean;
  onRemoveCurrent: (on: boolean) => void;
  /** Non-empty while the push runs: what is being sent now. */
  progress: string;
  error: string;
  /** The writes Push will make, 0 when the plan is refused. */
  count: number;
  opener: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The push plan. A destructive confirmation: nothing is written until Push is pressed. */
export function PushPlanDialog({
  plan,
  removeCurrent,
  onRemoveCurrent,
  progress,
  error,
  count,
  opener,
  onConfirm,
  onCancel,
}: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const running = progress !== "";
  const removesCurrent =
    plan.current !== "" && plan.remove.includes(plan.current);
  const sections: [string, string[]][] = [
    ["Add", plan.add.map((n) => n.ssid)],
    ["Update, sent again", plan.update.map((n) => n.ssid)],
    ["Remove from the panel", plan.remove.filter((s) => s !== plan.current)],
  ];
  return (
    <Dialog.Root
      open
      // A stray click or Escape must not stop a push halfway.
      disablePointerDismissal={running}
      onOpenChange={(next) => {
        if (!next && !running) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-glass/80" />
        <Dialog.Popup
          initialFocus={cancel}
          finalFocus={opener}
          className="fixed top-1/2 left-1/2 max-h-[calc(100vh-2rem)] w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-stroke bg-surface p-4"
        >
          <Dialog.Title className="mb-2 text-base font-medium">
            Push networks to the panel
          </Dialog.Title>
          <p className="mb-3 text-muted">
            Calico sends each saved network's password, URL and token from this
            computer, then restarts the panel. The panel cannot send its
            passwords back, so a network only on the panel cannot be copied
            here.
          </p>
          {sections
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => (
              <div key={title} className="mb-3">
                <h3 className="text-muted">{title}</h3>
                <ul aria-label={title}>
                  {list.map((ssid) => (
                    <li
                      key={ssid}
                      title={ssid}
                      className="truncate border-b border-stroke/40 py-1"
                    >
                      {ssid}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {removesCurrent ? (
            <div className="mb-3 border border-amber/60 p-3">
              <p className="text-amber">
                The panel is on {plan.current} now, and it is not saved on this
                computer. If it is removed and no saved network is in reach, the
                panel cannot reach Calico after it restarts, and only Bluetooth
                or USB can fix that.
              </p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={removeCurrent}
                  disabled={running}
                  onChange={(e) => onRemoveCurrent(e.target.checked)}
                />
                <span>Also remove {plan.current}</span>
              </label>
            </div>
          ) : null}
          {progress ? (
            <p role="status" className="mb-3 text-amber">
              {progress}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mb-3">
              <ErrorNote>{error}</ErrorNote>
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={running || count === 0}
              onClick={onConfirm}
            >
              {running
                ? "Pushing"
                : count === 0
                  ? "Nothing to push"
                  : `Push ${count} ${count === 1 ? "change" : "changes"}`}
            </button>
            <button
              ref={cancel}
              type="button"
              className="btn"
              disabled={running}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: The section**

Create `src/renderer/src/device/PushNetworks.tsx`:

```tsx
import { useRef, useState } from "react";
import { ErrorNote } from "../shell/ErrorNote";
import type { DeviceLink } from "./commands";
import {
  buildPlan,
  planSize,
  planSteps,
  type PushPlan,
  type PushStep,
  runPush,
} from "./push-plan";
import { PushPlanDialog } from "./PushPlanDialog";

export const NOTHING_TO_PUSH =
  "Nothing to push: no networks are saved on this computer or on the panel.";

export function pushedAll(n: number): string {
  return `Sent ${n} ${n === 1 ? "change" : "changes"} to the panel. It restarts to use them.`;
}

export function pushStopped(
  done: number,
  total: number,
  error: string,
): string {
  return `Stopped after ${done} of ${total} changes. ${error} The panel keeps what was already sent and was not restarted. Connect again and push again to finish.`;
}

const stepText = (step: PushStep) =>
  step.op === "forget" ? `removing ${step.ssid}` : `sending ${step.net.ssid}`;

/**
 * Push to panel: reads the panel's list, shows the plan, and writes only after the person
 * confirms it. The outcome goes to `onFinished`, which outlives this section: a dropped link
 * unmounts it mid-push.
 */
export function PushNetworks({
  link,
  onFinished,
}: {
  link: DeviceLink;
  onFinished: (message: string, reboot: boolean) => void;
}) {
  const [reading, setReading] = useState(false);
  const [plan, setPlan] = useState<PushPlan | null>(null);
  const [removeCurrent, setRemoveCurrent] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const opener = useRef<HTMLButtonElement>(null);

  async function open() {
    setReading(true);
    setError("");
    setNotice("");
    try {
      const vault = await window.calico.networksList();
      if (vault.error) return setError(vault.error);
      // Without the current network a removal could cut the panel off, so status must read.
      const status = await link.send({ op: "status" });
      if (!status.ok) return setError(status.error);
      // The nets read is the old-firmware and stale-cache check: no password is released before it.
      const nets = await link.send({ op: "nets" });
      if (!nets.ok) return setError(nets.error);
      const next = buildPlan(
        vault.networks,
        nets.nets ?? [],
        status.info?.ssid ?? "",
      );
      if (planSize(next) === 0) return setNotice(NOTHING_TO_PUSH);
      setRemoveCurrent(false);
      setPlan(next);
    } finally {
      setReading(false);
    }
  }

  function cancel() {
    void window.calico.networksEndPush();
    setPlan(null);
    setError("");
  }

  async function confirm() {
    if (!plan) return;
    const { steps, error: refused } = planSteps(plan, removeCurrent);
    if (refused) return setError(refused);
    setError("");
    const ssids = steps.flatMap((s) => (s.op === "wifi" ? [s.net.ssid] : []));
    const confirmed = await window.calico.networksConfirmPush(ssids);
    if (!confirmed.ok) return setError(confirmed.error);
    setProgress("Starting the push.");
    const result = await runPush(
      link,
      steps,
      (ssid) => window.calico.networksRelease(ssid),
      (i, step) =>
        setProgress(`Step ${i + 1} of ${steps.length}: ${stepText(step)}`),
    );
    await window.calico.networksEndPush();
    setProgress("");
    setPlan(null);
    if (result.error)
      onFinished(pushStopped(result.done, result.total, result.error), false);
    else onFinished(pushedAll(result.total), result.total > 0);
  }

  const shown = plan
    ? planSteps(plan, removeCurrent)
    : { steps: [], error: "" };
  return (
    <section>
      <h2 className="section-title">Push saved networks</h2>
      <p className="max-w-2xl px-4 text-muted">
        Makes the panel's networks match Settings: adds and updates the saved
        ones and removes the rest. You see the plan first, and nothing changes
        until you confirm it.
      </p>
      <div className="flex gap-3 px-4 pt-3">
        <button
          ref={opener}
          type="button"
          className="btn"
          disabled={reading}
          onClick={() => void open()}
        >
          {reading ? "Reading the panel" : "Push to panel"}
        </button>
      </div>
      {notice ? (
        <p role="status" className="px-4 pt-2 text-muted">
          {notice}
        </p>
      ) : null}
      {error && !plan ? (
        <p role="alert" className="px-4 pt-2">
          <ErrorNote>{error}</ErrorNote>
        </p>
      ) : null}
      {plan ? (
        <PushPlanDialog
          plan={plan}
          removeCurrent={removeCurrent}
          onRemoveCurrent={setRemoveCurrent}
          progress={progress}
          error={error || shown.error}
          count={shown.steps.length}
          opener={opener}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Mount it in DeviceView**

In `src/renderer/src/device/DeviceView.tsx`, after `import { PanelNetworks } from "./PanelNetworks";` add:

```ts
import { PushNetworks } from "./PushNetworks";
```

After `const [rebootAt, setRebootAt] = useState<number | null>(null);` add:

```ts
// The push's outcome. Here, not in PushNetworks: a dropped link unmounts that section.
const [pushNote, setPushNote] = useState("");
```

In `open`, after `setRebootAt(null);` add `setPushNote("");`.

After `<PanelNetworks link={link} />` add:

```tsx
<PushNetworks
  link={link}
  onFinished={(message, restart) => {
    setPushNote(message);
    if (restart) void reboot(link);
  }}
/>
```

Before `{rebootAt !== null ? (` add:

```tsx
{
  pushNote ? (
    <p role="status" className="max-w-2xl px-4 pt-2">
      {pushNote}
    </p>
  ) : null;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm test src/renderer/src/device && pnpm typecheck`
Expected: PASS, the existing `DeviceView.test.tsx` included. If the two focus assertions fail only because happy-dom does not run Base UI's focus move, keep them, and confirm focus by hand in Task 8 Step 3 before deleting either; do not weaken the other assertions.

- [ ] **Step 7: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/renderer/src/device/PushPlanDialog.tsx src/renderer/src/device/PushNetworks.tsx src/renderer/src/device/PushNetworks.test.tsx src/renderer/src/device/DeviceView.tsx
git add src/renderer/src/device/PushPlanDialog.tsx src/renderer/src/device/PushNetworks.tsx src/renderer/src/device/PushNetworks.test.tsx src/renderer/src/device/DeviceView.tsx
git commit --no-gpg-sign -m "Push saved networks to the panel after a confirmed plan"
```

---

### Task 7: The address banner and its one-click Bluetooth update

**Files:**

- Create: `src/renderer/src/device/address-update.ts`, `src/renderer/src/shell/AddressBanner.tsx`
- Modify: `src/renderer/src/device/RebootWait.tsx:6-12` (props), `:48-52` (silent text)
- Modify: `src/renderer/src/device/LinkActions.tsx:15`
- Modify: `src/renderer/src/App.tsx:10` (import), `:35-37` (after `DriftBanner`)
- Test: `src/renderer/src/shell/AddressBanner.test.tsx`

**Interfaces:**

- Consumes: `CalicoInfo.addressChange`, `window.calico.dismissAddress`, `window.calico.adoptPort`, `window.calico.info` (Task 4); `connectBle(onClosed, onPairing, peerName)` (`ble.ts:200`); `RebootWait`.
- Produces:
  - `updatePanelAddress(link: DeviceLink, url: string): Promise<{ ok: true } | { ok: false; error: string }>`, `ownUrl(ssid: string): string`, `sameUrl(url: string): string` in `address-update.ts`
  - `AddressBanner(props: { info: CalicoInfo; link: DeviceLink | null; onOpenDevice: () => void })`, `NO_PANEL: string`
  - `RebootWait` gains optional `silentText?: string`.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/shell/AddressBanner.test.tsx`:

```tsx
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalicoInfo } from "../../../shared/ipc";
import { ownUrl, sameUrl } from "../device/address-update";
import type { Cmd, DeviceLink, PanelNet } from "../device/commands";
import { AddressBanner, NO_PANEL } from "./AddressBanner";

const TARGET = "http://192.168.4.30:8787";

const connect = vi.fn<() => Promise<DeviceLink>>();
vi.mock("../device/ble", () => ({ connectBle: () => connect() }));

const info = {
  port: 8787,
  hostname: "test-host",
  addressChange: { url: TARGET },
} as unknown as CalicoInfo;

let api: {
  info: ReturnType<typeof vi.fn>;
  adoptPort: ReturnType<typeof vi.fn>;
  dismissAddress: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  api = {
    info: vi.fn(async () => ({ ...info, lastPanelPoll: Date.now() + 60_000 })),
    adoptPort: vi.fn(async () => undefined),
    dismissAddress: vi.fn(async () => undefined),
  };
  Object.assign(window, { calico: api });
  connect.mockReset();
});
afterEach(cleanup);

function panel(opts: { ssid?: string; url?: string; nets?: PanelNet[] } = {}) {
  const sent: Cmd[] = [];
  const close = vi.fn();
  const link: DeviceLink = {
    kind: "ble",
    async send(cmd) {
      sent.push(cmd);
      if (cmd.op === "status")
        return {
          ok: true,
          info: {
            name: "ginger",
            fw: "1",
            ssid: opts.ssid ?? "home",
            url: opts.url ?? "http://192.168.4.20:8787",
            token: "set",
          },
        };
      if (cmd.op === "nets") return { ok: true, nets: opts.nets ?? [] };
      return { ok: true };
    },
    close,
  };
  connect.mockResolvedValue(link);
  return { sent, close };
}

describe("AddressBanner", () => {
  it("shows nothing without an address change", () => {
    const { container } = render(
      <AddressBanner
        info={{ ...info, addressChange: null }}
        link={null}
        onOpenDevice={() => undefined}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("connects inside the click, writes only the URL, reboots, and waits for the first poll", async () => {
    const { sent } = panel();
    render(
      <AddressBanner info={info} link={null} onOpenDevice={() => undefined} />,
    );
    expect(
      screen.getByText(/The panel's address may have changed/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    // Web Bluetooth only opens its picker inside the click: no await may come first.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Panel online.", undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(sent).toEqual([
      { op: "status" },
      { op: "nets" },
      { op: "url", value: TARGET },
      { op: "reboot" },
    ]);
    expect(api.adoptPort).toHaveBeenCalled();
  });

  it("writes nothing when the panel's network has its own URL", async () => {
    const { sent, close } = panel({
      nets: [{ ssid: "home", has_url: true, has_token: false }],
    });
    render(
      <AddressBanner info={info} link={null} onOpenDevice={() => undefined} />,
    );
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(ownUrl("home"));
    expect(sent.map((c) => c.op)).toEqual(["status", "nets"]);
    expect(close).toHaveBeenCalled();
  });

  it("writes nothing when the panel already has that URL", async () => {
    const { sent } = panel({ url: TARGET });
    render(
      <AddressBanner info={info} link={null} onOpenDevice={() => undefined} />,
    );
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      sameUrl(TARGET),
    );
    expect(sent.some((c) => c.op === "url" || c.op === "reboot")).toBe(false);
  });

  it("a cancelled picker or a panel that is off says what to check", async () => {
    connect.mockRejectedValue(
      Object.assign(new Error("User cancelled"), { name: "NotFoundError" }),
    );
    render(
      <AddressBanner info={info} link={null} onOpenDevice={() => undefined} />,
    );
    fireEvent.click(screen.getByText("Update over Bluetooth"));
    expect((await screen.findByRole("alert")).textContent).toBe(NO_PANEL);
    expect(screen.getByText("Update over Bluetooth")).toBeTruthy();
  });

  it("Not now hides it and tells main", async () => {
    const { container } = render(
      <AddressBanner info={info} link={null} onOpenDevice={() => undefined} />,
    );
    fireEvent.click(screen.getByText("Not now"));
    expect(api.dismissAddress).toHaveBeenCalled();
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("with a link already open, sends the person to the Device page", () => {
    const onOpenDevice = vi.fn();
    const open: DeviceLink = {
      kind: "ble",
      send: async () => ({ ok: true }),
      close() {},
    };
    render(
      <AddressBanner info={info} link={open} onOpenDevice={onOpenDevice} />,
    );
    fireEvent.click(screen.getByText("Update on the Device page"));
    expect(onOpenDevice).toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/renderer/src/shell/AddressBanner.test.tsx`
Expected: FAIL, cannot resolve `../device/address-update` and `./AddressBanner`.

- [ ] **Step 3: The update flow**

Create `src/renderer/src/device/address-update.ts`:

```ts
import type { DeviceLink } from "./commands";

export function ownUrl(ssid: string): string {
  return `The panel is on ${ssid}, which has its own companion URL saved on the panel, so a new default address would not change where it polls. Edit ${ssid} in Settings, then push networks from the Device page.`;
}

export function sameUrl(url: string): string {
  return `The panel already polls ${url}. It may be off its network, or a firewall may block it. See Panel not connecting on the Device page.`;
}

/**
 * The banner's one-click fix: writes the panel's default companion URL and reboots it. Writes no
 * password and no token. A network with its own URL on the panel wins for that network, so then
 * it writes nothing.
 */
export async function updatePanelAddress(
  link: DeviceLink,
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const status = await link.send({ op: "status" });
  if (!status.ok) return status;
  const ssid = status.info?.ssid ?? "";
  if (ssid) {
    // A panel without nets (old firmware, or a stale Bluetooth cache) gets the default URL:
    // it is not a secret, and this check only saves a pointless reboot.
    const nets = await link.send({ op: "nets" });
    if (nets.ok && nets.nets?.some((n) => n.ssid === ssid && n.has_url))
      return { ok: false, error: ownUrl(ssid) };
  }
  if (status.info?.url === url) return { ok: false, error: sameUrl(url) };
  const wrote = await link.send({ op: "url", value: url });
  if (!wrote.ok) return wrote;
  const reboot = await link.send({ op: "reboot" });
  if (!reboot.ok) return reboot;
  return { ok: true };
}
```

- [ ] **Step 4: Let RebootWait take its silent text**

In `src/renderer/src/device/RebootWait.tsx`, replace the props (lines 6-12) with:

```tsx
export function RebootWait({
  since,
  onSilent,
  silentText = "The panel has not reached calico since the reboot. See below.",
}: {
  since: number;
  onSilent: () => void;
  silentText?: string;
}) {
```

and replace the silent span's text (lines 49-51) with:

```tsx
<span className="text-amber">{silentText}</span>
```

- [ ] **Step 5: The banner**

Create `src/renderer/src/shell/AddressBanner.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { updatePanelAddress } from "../device/address-update";
import { connectBle } from "../device/ble";
import type { DeviceLink } from "../device/commands";
import { RebootWait } from "../device/RebootWait";
import { ErrorNote } from "./ErrorNote";

export const NO_PANEL =
  "No panel was chosen. If it did not appear, check that it is on and within reach, then try again.";
const SILENT =
  "The panel has not polled Calico since it restarted. Check that it is on its network, then see Panel not connecting on the Device page.";
const quiet = () => undefined;

/**
 * "The panel's address may have changed". Main decides when (CalicoInfo.addressChange). One click
 * connects over the existing pairing, writes the new URL, reboots the panel and waits for its
 * first poll. Sends no password or token.
 */
export function AddressBanner({
  info,
  link,
  onOpenDevice,
}: {
  info: CalicoInfo;
  link: DeviceLink | null;
  onOpenDevice: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [since, setSince] = useState<number | null>(null);
  // The URL being written. Kept so the banner stays up when the panel polls and main clears it.
  const [target, setTarget] = useState("");
  const [dismissed, setDismissed] = useState("");
  const result = useRef<HTMLDivElement>(null);
  const offered = info.addressChange?.url ?? "";
  const url = target || offered;
  const busy = working || since !== null;

  // The button that was pressed is gone: land on the outcome.
  useEffect(() => {
    if (error || since !== null) result.current?.focus();
  }, [error, since]);

  if (!url || (!busy && !error && offered === dismissed)) return null;

  function close() {
    setTarget("");
    setError("");
    setSince(null);
  }

  // connectBle must be the first await: Web Bluetooth opens its picker only inside the click.
  async function update() {
    setTarget(url);
    setError("");
    setWorking(true);
    setProgress("Looking for the panel over Bluetooth.");
    let panel: DeviceLink;
    try {
      panel = await connectBle(
        quiet,
        () =>
          setProgress(
            "Confirm the code on the panel and in the system dialog.",
          ),
        info.hostname,
      );
    } catch (err) {
      const e = err as Error;
      setError(
        e.name === "NotFoundError" || e.name === "AbortError"
          ? NO_PANEL
          : e.message,
      );
      setWorking(false);
      return;
    }
    setProgress("Writing the new address.");
    const at = Date.now();
    const done = await updatePanelAddress(panel, url);
    setWorking(false);
    if (!done.ok) {
      panel.close();
      setError(done.error);
      return;
    }
    if (info.port && url.endsWith(`:${info.port}`))
      await window.calico.adoptPort();
    setSince(at);
  }

  return (
    <div
      role="region"
      aria-label="Panel address"
      className="flex flex-wrap items-center gap-3 border-b border-amber/60 bg-surface px-4 py-2"
    >
      <span className="text-amber">
        The panel's address may have changed. This computer is now at{" "}
        <span className="font-mono">{url}</span>.
      </span>
      {!busy && link ? (
        <button type="button" className="btn" onClick={onOpenDevice}>
          Update on the Device page
        </button>
      ) : null}
      {!busy && !link ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void update()}
        >
          Update over Bluetooth
        </button>
      ) : null}
      {!busy && !error ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setDismissed(offered);
            void window.calico.dismissAddress();
          }}
        >
          Not now
        </button>
      ) : null}
      {working ? <span role="status">{progress}</span> : null}
      <div ref={result} tabIndex={-1} className="outline-none">
        {error ? (
          <p role="alert">
            <ErrorNote>{error}</ErrorNote>
          </p>
        ) : null}
        {since !== null ? (
          <RebootWait since={since} onSilent={quiet} silentText={SILENT} />
        ) : null}
      </div>
      {error || since !== null ? (
        <button type="button" className="btn" onClick={close}>
          Close
        </button>
      ) : null}
    </div>
  );
}
```

`RebootWait` renders `<p className="px-4 pt-2">`; inside the banner strip that padding is harmless and keeps one component unchanged for both callers.

- [ ] **Step 6: Prefill the Device page and mount the banner**

In `src/renderer/src/device/LinkActions.tsx`, replace line 15 with:

```tsx
const [url, setUrl] = useState(
  info.addressChange?.url ?? info.lanUrls[0] ?? "",
);
```

In `src/renderer/src/App.tsx`, after `import { DriftBanner } from "./shell/DriftBanner";` add:

```tsx
import { AddressBanner } from "./shell/AddressBanner";
```

and after the `DriftBanner` block (lines 35-37) add:

```tsx
{
  info ? (
    <AddressBanner
      info={info}
      link={link}
      onOpenDevice={() => setView("device")}
    />
  ) : null;
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm test src/renderer && pnpm typecheck`
Expected: PASS (the banner's online test waits about 2 s for `RebootWait`'s first check).

- [ ] **Step 8: Lint, format, commit**

```bash
pnpm lint && pnpm exec prettier --write src/renderer/src/device/address-update.ts src/renderer/src/shell/AddressBanner.tsx src/renderer/src/shell/AddressBanner.test.tsx src/renderer/src/device/RebootWait.tsx src/renderer/src/device/LinkActions.tsx src/renderer/src/App.tsx
git add src/renderer/src/device/address-update.ts src/renderer/src/shell/AddressBanner.tsx src/renderer/src/shell/AddressBanner.test.tsx src/renderer/src/device/RebootWait.tsx src/renderer/src/device/LinkActions.tsx src/renderer/src/App.tsx
git commit --no-gpg-sign -m "Offer a one-click Bluetooth fix when the panel's address changes"
```

---

### Task 8: Hardware check and docs

**Files:**

- Modify: `README.md:12`, `docs/review-rules.md:7` (rule 3), `docs/superpowers/specs/2026-10-13-wifi-networks-design.md:5` (the "Superseded in part" box)
- `firmware/README.md` stays unchanged: no characteristic or RAM figure changed.

**Interfaces:**

- Consumes: the branch head. No code changes in this task.

- [ ] **Step 1: Full local gate (executor)**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && git diff --stat main -- firmware`
Expected: all pass, and the `firmware` diff is empty.

- [ ] **Step 2: Docs**

In `README.md`, after line 12 add:

```markdown
- Pushes the saved networks to the panel over Bluetooth after showing exactly what it will add, update and remove, and offers a one-click Bluetooth fix when this computer's address changes and the panel goes quiet.
```

In `docs/review-rules.md`, in rule 3, replace the sentence "The window never receives a saved Wi-Fi password or per-network token, only `password_set` and `token_set`." with:

```markdown
The window receives a saved Wi-Fi password and per-network token only through `networks:release`: once per SSID in the push plan the person confirmed, within two minutes of confirming, straight into the Bluetooth write, then blanked. It never goes into React state, the DOM, logs, errors or any IPC event. Every other IPC carries only `password_set` and `token_set`.
```

In `docs/superpowers/specs/2026-10-13-wifi-networks-design.md`, at the end of the "Superseded in part" paragraph (line 5), add:

```markdown
Phase 3 relaxes "the renderer never receives a password or token" for one path only: after the person confirms a push plan, main releases each confirmed network's password and token to the window once, which passes it straight to the Bluetooth write (`docs/superpowers/plans/2026-10-13-sync-and-address-banner.md`, Global Constraints).
```

Run: `pnpm exec prettier --write README.md docs/review-rules.md docs/superpowers/specs/2026-10-13-wifi-networks-design.md`

- [ ] **Step 3: Push plan, owner at the panel**

Start the app with `pnpm dev 2>&1 | tee /tmp/calico-dev.log`. The computer is already paired with the panel.

1. Settings > Connectivity: make sure "home" (the network the panel is on) is saved with its password. Add a test network "calico-test" with the password `placeholder-pass` (the panel stores it and never joins it). If the panel holds no network that Settings lacks, remove one in Settings (for example the Phase 2 hotspot): the panel keeps it.
2. Device > Connect over Bluetooth (no code appears) > Push to panel. Expected: the dialog lists Add calico-test, Update, sent again home, Remove from the panel the hotspot; focus is on Cancel. Press Cancel: focus returns to Push to panel, and Show networks lists the same networks as before.
3. Push to panel again, then Push N changes. Expected: "Step i of N" while it runs; then "Sent N changes to the panel. It restarts to use them.", "Rebooted. Waiting up to 30 s", then "Panel online.". Reconnect and Show networks: it matches Settings exactly.
4. Current network: remove "home" in Settings, Push to panel. Expected: the amber warning "The panel is on home now", "Also remove home" unticked, and the push leaves home on the panel. Cancel, then add home back in Settings with its password.
5. Drop: with at least three changes in the plan (add two test networks in Settings), press Push and, after the first step shows, run `bluetoothctl power off`. Expected: "Stopped after k of n changes. ... was not restarted. Connect again and push again to finish." Run `bluetoothctl power on`, connect, Push to panel: the plan lists only what is left; push it to the end.
6. Keyring: lock the login keyring in Seahorse (Passwords and Keys > right-click Login > Lock), then push a plan that updates home. Expected: "Stopped after 0 of n changes. Calico could not unlock the saved password for home. ..." and nothing written (Show networks unchanged). Unlock the keyring.
7. Clean up the test networks in Settings and push once more so the panel matches.

Expected: every step as written.

- [ ] **Step 4: Address banner, owner at the panel**

Find the Wi-Fi interface and its address with `ip -4 -br addr`; call them `IFACE` and `ADDR` (for example `wlp2s0` and `192.168.4.30/24`). Pick a free address on the same subnet, `SPARE` (for example `192.168.4.250`).

1. `sudo ip addr add SPARE/24 dev IFACE`. In Device > Companion URL for the desk, enter `http://SPARE:8787` (use the port in the header chip), Set URL, Reboot desk. Expected: "Panel online." (the panel now polls SPARE).
2. Disconnect Bluetooth. `sudo ip addr del SPARE/24 dev IFACE`. The panel's stored URL is now wrong and the address it used is gone. Wait 60 seconds. Expected: the banner "The panel's address may have changed. This computer is now at http://ADDR:8787." with Update over Bluetooth and Not now. It must not show before 60 seconds.
3. Not now: the banner goes and stays gone. Restart the app (`pnpm dev`): after 60 seconds it shows again (the last poll was saved in `panel-seen.json`).
4. Update over Bluetooth: the picker opens, choose ginger, no code appears. Expected: "Writing the new address.", then "Rebooted. Waiting up to 30 s", then "Panel online."; Close removes the banner and it does not return. Device > Connect: Companion reads `http://ADDR:8787`.
5. Panel off: turn the panel off with the address unchanged and wait two minutes. Expected: no banner.
6. Sleep: `systemctl suspend`, wake the computer. Expected: no banner in the first 60 seconds after wake while the panel resumes polling.
7. With Docker or Tailscale running (`ip -4 -br addr` shows `docker0` or `tailscale0`), repeat items 1, 2 and 4: the banner offers ADDR, never the `docker0` or `100.x` address.

Expected: every step as written.

- [ ] **Step 5: No secret on screen or in logs, owner at the panel**

Run: `grep -c -e "placeholder-pass" -e "<home password>" -e "<webhook token>" /tmp/calico-dev.log`
Expected: `0`. In DevTools (Ctrl+Shift+I) > Elements, search the DOM for the home password: no match. Console shows no password or token.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/review-rules.md docs/superpowers/specs/2026-10-13-wifi-networks-design.md
git commit --no-gpg-sign -m "Document the network push and the address banner"
```

---

## Self-Review

- **Spec coverage.** Push connects over the paired link or USB (any `DeviceLink`): Task 6. Reads `nets`, plans add, update and remove: Task 5. Nothing removed until confirmed: Task 6 `shows the plan and writes nothing until it is confirmed`. Applies with `wifi` and `forget`, reboots only if something changed: Tasks 5 and 6 (R2). Passwords cannot be imported from the panel: the dialog says so (Task 6). Main compares this computer's addresses with what it saw at the last poll: Tasks 1, 2, 4 (R5). 60 seconds of silence: Task 2. Banner copy and Update over Bluetooth: Task 7. One click connects with no code on an existing bond, writes the URL, reboots, waits for the first poll: Task 7. Two addresses on one subnet, the panel's subnet from its poll address, no history: Task 2. A network's own URL wins: Task 7 (R6). No password or token in the banner flow: Task 7 test asserts the exact writes. Security: secrets only over the paired link (`connectBle` requires `pair=1`), old firmware refused before secrets (Task 6), status poll unchanged, writes only from a click (Tasks 6 and 7). Testing: Vitest for the plan and the address rule, component tests for the plan dialog and the banner, fakes for Bluetooth, a real-board check: Tasks 2, 5, 6, 7, 8.
- **Placeholder scan.** No TBD or "handle edge cases"; every code step has code. Task 8 uses `IFACE`, `ADDR`, `SPARE` and `<home password>` as values the owner reads off the machine, and says how to find each.
- **Type consistency.** `PanelSeen` (Task 1) is used by `AddressWatch`, `loadSeen`, `saveSeen` (Task 2) and `onPanelPoll` (Task 4). `PushConfirm`, `PushRelease` (Task 3) match `CalicoApi` (Task 4), `runPush` (Task 5) and the test fakes (Tasks 5, 6). `confirmPush`, `release`, `endPush` match across Tasks 3 and 4. `PushPlan`, `PushStep`, `buildPlan`, `planSize`, `planSteps`, `runPush` match across Tasks 5 and 6. `addressChange: { url: string } | null` matches Tasks 4 and 7. `WIFI_WRITE_MAX` is defined in Task 5 and used only there.
- **Review Focus.** Each of the five lines names its tests, and each test sits in the task that owns the code.
- **Left out on purpose.** `lanUrls[0]` (the header chip, Set up Wi-Fi) still lists every non-internal IPv4 address in OS order, Docker included; ordering it with `pickAddress` is a small follow-up, not needed for the banner. A push cannot tell whether the saved password for the current network is still right: a wrong one leaves the panel off Wi-Fi after the reboot and recoverable over Bluetooth; verifying each network first would cost 30 s each and drop the panel's link.
