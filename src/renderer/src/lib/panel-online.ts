export function panelOnlineSince(
  lastPanelPoll: number | null,
  since: number,
): boolean {
  return lastPanelPoll !== null && lastPanelPoll > since;
}
