import { isSemver } from "../../../shared/semver";

/** What to call the panel's firmware in a sentence. A git hash is not shown as a version. */
export function panelLabel(fw: string | null): string {
  if (fw === null || fw === "") return "an unknown version";
  return isSemver(fw) ? `firmware ${fw}` : "an unversioned build";
}
