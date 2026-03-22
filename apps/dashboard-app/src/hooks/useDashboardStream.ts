import { useEffect, useEffectEvent } from "react";

import type { DashboardResponse } from "../api";
import type { StreamConnectionState } from "../dashboardStore";
import { createStreamUrl } from "../api";

type UseDashboardStreamOptions = {
  apiBase: string;
  onSnapshot: (snapshot: DashboardResponse) => void;
  onLog: (message: string) => void;
  setStreamState: (state: StreamConnectionState) => void;
};

export function useDashboardStream(options: UseDashboardStreamOptions) {
  const { apiBase, onSnapshot, onLog, setStreamState } = options;
  const handleSnapshot = useEffectEvent(onSnapshot);
  const handleLog = useEffectEvent(onLog);
  const handleStreamState = useEffectEvent(setStreamState);

  useEffect(() => {
    const streamUrl = createStreamUrl(apiBase);
    const eventSource = new EventSource(streamUrl);

    handleStreamState("connecting");

    eventSource.addEventListener("open", () => {
      handleStreamState("live");
    });

    eventSource.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as DashboardResponse;
        handleSnapshot(payload);
        handleStreamState("live");
      } catch (_error) {
        handleStreamState("error");
      }
    });

    eventSource.addEventListener("log", (event) => {
      handleLog((event as MessageEvent<string>).data);
    });

    eventSource.onerror = () => {
      handleStreamState("retrying");
    };

    return () => {
      eventSource.close();
      handleStreamState("idle");
    };
  }, [apiBase, handleLog, handleSnapshot, handleStreamState]);
}
