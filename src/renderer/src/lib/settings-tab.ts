export type SettingsTab = "agents" | "connectivity" | "app";

const KEY = "calico.settingsTab";
const TABS: readonly SettingsTab[] = ["agents", "connectivity", "app"];

export function loadTab(): SettingsTab {
  try {
    const value = localStorage.getItem(KEY);
    return TABS.find((tab) => tab === value) ?? "agents";
  } catch {
    return "agents";
  }
}

export function saveTab(tab: SettingsTab): void {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    // Blocked storage only costs the remembered tab.
  }
}
