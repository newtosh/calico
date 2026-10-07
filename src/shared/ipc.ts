// Filled in Task 12.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CalicoApi {}

declare global {
  interface Window {
    calico: CalicoApi;
  }
}
