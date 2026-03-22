import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  type AdminGameSettings,
  fetchAdminSettings,
  resetBoard,
  startBoard,
  stopBoard,
  updateAdminSettings,
  type DashboardResponse,
} from "../api";
import { useDashboardStore } from "../dashboardStore";

type UseOperatorControlsOptions = {
  apiBase: string;
  onSnapshotUpdate?: (snapshot: DashboardResponse) => void;
  snapshot: DashboardResponse | null;
};

const DEFAULT_SETTINGS: AdminGameSettings = {
  paused: true,
  submitWindowMs: 12000,
  resolveWindowMs: 500,
};

export function useOperatorControls(options: UseOperatorControlsOptions) {
  const { apiBase, onSnapshotUpdate, snapshot } = options;
  const adminToken = useDashboardStore((state) => state.adminToken);
  const setAdminToken = useDashboardStore((state) => state.setAdminToken);
  const queryClient = useQueryClient();

  const [draftToken, setDraftToken] = useState(adminToken);
  const [settings, setSettings] = useState<AdminGameSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...snapshot?.gameSettings,
  }));
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"" | "ok" | "warn" | "error">(
    "",
  );

  useEffect(() => {
    setDraftToken(adminToken);
  }, [adminToken]);

  useEffect(() => {
    if (snapshot?.gameSettings) {
      setSettings((current) => ({ ...current, ...snapshot.gameSettings }));
    }
  }, [snapshot?.gameSettings]);

  const auth = useMemo(
    () => ({ apiBase, token: adminToken }),
    [apiBase, adminToken],
  );

  const settingsQuery = useQuery({
    queryKey: ["adminSettings", apiBase, adminToken],
    queryFn: () => fetchAdminSettings(auth),
    enabled: Boolean(adminToken),
    retry: false,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  async function refreshDashboardState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["health", apiBase] }),
      queryClient.invalidateQueries({ queryKey: ["boards", apiBase] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard", apiBase] }),
      queryClient.invalidateQueries({ queryKey: ["leaderboard", apiBase] }),
      queryClient.invalidateQueries({ queryKey: ["seed", apiBase] }),
      queryClient.invalidateQueries({ queryKey: ["completedBoards", apiBase] }),
    ]);
  }

  const saveSettingsMutation = useMutation({
    mutationFn: () => updateAdminSettings(auth, settings),
    onSuccess: async (payload) => {
      setStatusTone("ok");
      setStatusMessage(
        payload.ok
          ? "Operator settings saved."
          : "Settings update did not succeed.",
      );
      setSettings(payload.settings);
      await refreshDashboardState();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage((error as Error).message);
    },
  });

  const toggleTurnsMutation = useMutation({
    mutationFn: (wantRunning: boolean) =>
      updateAdminSettings(auth, { ...settings, paused: !wantRunning }),
    onSuccess: async (payload) => {
      setStatusTone("ok");
      setStatusMessage(
        payload.settings.paused ? "Turns paused." : "Turns resumed.",
      );
      setSettings(payload.settings);
      await refreshDashboardState();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage((error as Error).message);
    },
  });

  const startBoardMutation = useMutation({
    mutationFn: () => startBoard(auth),
    onSuccess: async (payload) => {
      setStatusTone(payload.ok ? "ok" : "warn");
      setStatusMessage(
        payload.message ||
          (payload.alreadyStarted
            ? "Board already running."
            : payload.ok
              ? "Board started."
              : payload.error || "Start failed."),
      );
      if (payload.snapshot && onSnapshotUpdate) {
        onSnapshotUpdate({
          ...payload.snapshot,
          gameSettings: settings,
        } as DashboardResponse);
      }
      await refreshDashboardState();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage((error as Error).message);
    },
  });

  const stopBoardMutation = useMutation({
    mutationFn: () => stopBoard(auth),
    onSuccess: async (payload) => {
      setStatusTone(payload.ok ? "ok" : "warn");
      setStatusMessage(
        payload.alreadyStopped
          ? "Board already stopped."
          : payload.ok
            ? "Board stopped."
            : payload.error || "Stop failed.",
      );
      if (payload.snapshot && onSnapshotUpdate) {
        onSnapshotUpdate({
          ...payload.snapshot,
          gameSettings: settings,
        } as DashboardResponse);
      }
      await refreshDashboardState();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage((error as Error).message);
    },
  });

  const resetBoardMutation = useMutation({
    mutationFn: () => resetBoard(auth),
    onSuccess: async (payload) => {
      setStatusTone(payload.ok ? "ok" : "warn");
      setStatusMessage(
        payload.ok ? "Fresh board created." : payload.error || "Reset failed.",
      );
      if (payload.snapshot && onSnapshotUpdate) {
        onSnapshotUpdate({
          ...payload.snapshot,
          gameSettings: settings,
        } as DashboardResponse);
      }
      await refreshDashboardState();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage((error as Error).message);
    },
  });

  function saveAdminToken() {
    setAdminToken(draftToken);
    setStatusTone(draftToken.trim() ? "ok" : "warn");
    setStatusMessage(
      draftToken.trim()
        ? "Admin token saved in this browser."
        : "Admin token cleared. Controls are read-only until you save one again.",
    );
  }

  function updateSettings(patch: Partial<AdminGameSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  return {
    adminToken,
    draftToken,
    resetBoardMutation,
    saveSettingsMutation,
    settings,
    settingsQuery,
    startBoardMutation,
    statusMessage,
    statusTone,
    stopBoardMutation,
    toggleTurnsMutation,
    saveAdminToken,
    setDraftToken,
    updateSettings,
  };
}
