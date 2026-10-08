import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import type { Candidate } from "../../../shared/ipc";

type Kind = "ble" | "serial";

export function Picker() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [list, setList] = useState<Candidate[]>([]);

  useEffect(() => {
    const offBle = window.calico.onBleCandidates((next) => {
      setKind("ble");
      setList(next);
    });
    const offSerial = window.calico.onSerialCandidates((next) => {
      setKind("serial");
      setList(next);
    });
    return () => {
      offBle();
      offSerial();
    };
  }, []);

  function choose(id: string) {
    if (kind === "ble") window.calico.chooseBle(id);
    if (kind === "serial") window.calico.chooseSerial(id);
    setKind(null);
    setList([]);
  }

  return (
    <Dialog.Root
      open={kind !== null}
      onOpenChange={(open) => !open && choose("")}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-glass/80" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 w-96 -translate-x-1/2 -translate-y-1/2 border border-stroke bg-surface">
          <Dialog.Title className="section-title">
            {kind === "ble" ? "Bluetooth desks nearby" : "USB serial ports"}
          </Dialog.Title>
          {list.length === 0 ? (
            <p className="px-4 pb-3 text-muted">
              {kind === "ble"
                ? "Scanning. Make sure Bluetooth is on in the panel's Control Center."
                : "No Espressif ports found. Plug the panel in with a data cable."}
            </p>
          ) : (
            <ul>
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="row w-full text-left hover:bg-selected"
                    onClick={() => choose(c.id)}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end px-4 py-3">
            <Dialog.Close className="btn">Cancel</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
