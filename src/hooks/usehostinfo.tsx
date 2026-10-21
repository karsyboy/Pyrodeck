import { useContext, useEffect, useState } from "react";
import { GameStreamHost } from "../lib";
import { MoonDeckContext } from "../contexts";

/** The selected host's last serverinfo while it is online (see ServerProxy.hostInfo). */
export function useHostInfo(): GameStreamHost | null {
  const { connectivityManager } = useContext(MoonDeckContext);
  const [hostInfo, setHostInfo] = useState(connectivityManager.serverProxy.hostInfo.value);

  useEffect(() => {
    const sub = connectivityManager.serverProxy.hostInfo.asObservable().subscribe((value) => setHostInfo(value));
    return () => {
      sub.unsubscribe();
    };
  }, []);

  return hostInfo;
}
