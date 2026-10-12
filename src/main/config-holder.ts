import type { CalicoConfig } from "../server/config";

/** Holds the live config. A failed write leaves the old one in place, so memory never runs ahead of disk. */
export class ConfigHolder {
  constructor(
    private current: CalicoConfig,
    private readonly write: (next: CalicoConfig) => void,
  ) {}

  get(): CalicoConfig {
    return this.current;
  }

  set(next: CalicoConfig): void {
    this.write(next);
    this.current = next;
  }
}
