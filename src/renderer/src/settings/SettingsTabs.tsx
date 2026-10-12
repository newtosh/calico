import type { KeyboardEvent } from "react";

export interface TabSpec<Id extends string> {
  id: Id;
  label: string;
}

export const tabId = (id: string) => `settings-tab-${id}`;
export const panelId = (id: string) => `settings-panel-${id}`;

/** The category strip at the top of Settings. The panels are the caller's. */
export function SettingsTabs<Id extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly TabSpec<Id>[];
  value: Id;
  onChange: (next: Id) => void;
}) {
  function onKeyDown(event: KeyboardEvent) {
    const at = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? at === last
          ? 0
          : at + 1
        : event.key === "ArrowLeft"
          ? at === 0
            ? last
            : at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const next = target === null ? undefined : tabs[target];
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    // Focus follows the selection, so the arrow keys keep working.
    document.getElementById(tabId(next.id))?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Settings categories"
      onKeyDown={onKeyDown}
      className="sticky top-0 z-10 flex gap-1 border-b border-stroke/40 bg-glass px-4"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(tab.id)}
            tabIndex={active ? 0 : -1}
            className={`-mb-px border-b-2 px-3 py-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-sage ${
              active
                ? "border-sage text-cream"
                : "border-transparent text-muted hover:text-cream"
            }`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
