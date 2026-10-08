import type http from "node:http";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

export const PORT_SPAN = 12;

export class PortsBusyError extends Error {
  constructor(
    readonly first: number,
    readonly last: number,
  ) {
    super(`Ports ${first} to ${last} are all in use.`);
  }
}

function listenOnce(
  server: http.Server,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export async function listenWithFallback(
  server: http.Server,
  host: string,
  preferred: number,
  span = PORT_SPAN,
): Promise<number> {
  const last = Math.min(preferred + span, 65535);
  for (let port = preferred; port <= last; port++) {
    try {
      await listenOnce(server, host, port);
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new PortsBusyError(preferred, last);
}

/**
 * First run keeps whatever port bound. After that the saved port is what the
 * panel was told, so a fallback is drift to report, never something to save.
 */
export function resolvePort(
  existed: boolean,
  configured: number,
  bound: number,
): { persist: boolean; drift: boolean } {
  if (!existed) return { persist: true, drift: false };
  return { persist: false, drift: bound !== configured };
}

export function lanUrls(
  port: number,
  ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  return Object.values(ifaces)
    .flatMap((list) => list ?? [])
    .filter((info) => info.family === "IPv4" && !info.internal)
    .map((info) => `http://${info.address}:${port}`);
}

/**
 * The port the panel has been told to poll. It starts as the saved port and
 * only changes when calico re-points the panel. A port typed into Settings
 * takes effect on restart, so it must not count as drift.
 */
export class PanelPort {
  constructor(private port: number) {}

  get expected(): number {
    return this.port;
  }

  adopt(bound: number): void {
    this.port = bound;
  }

  /** The port the panel expects when calico is listening elsewhere, else null. */
  driftFrom(bound: number | null): number | null {
    return bound !== null && bound !== this.port ? this.port : null;
  }
}
