import { useEffect, useState } from "react";
import type { CalicoInfo } from "../../../shared/ipc";
import { configureApi } from "./api";

export function useInfo(): CalicoInfo | null {
  const [info, setInfo] = useState<CalicoInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await window.calico.info();
      if (!alive) return;
      configureApi(next.serverUrl ?? "", next.webhookToken);
      setInfo(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return info;
}
