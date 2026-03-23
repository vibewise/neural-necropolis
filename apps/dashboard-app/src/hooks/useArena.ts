import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchArenas,
  fetchArena,
  createArena,
  addArenaMatch,
  startArena,
} from "../api";
import type {
  ArenaSnapshot,
  ArenaSummary,
  ArenaBotConfig,
  CreateArenaRequest,
  AddMatchRequest,
} from "../api";
import { useDashboardStore } from "../dashboardStore";

type UseArenaOptions = {
  apiBase: string;
};

export function useArena({ apiBase }: UseArenaOptions) {
  const adminToken = useDashboardStore((state) => state.adminToken);
  const queryClient = useQueryClient();

  const [selectedArenaId, setSelectedArenaId] = useState<string | null>(null);

  const arenasQuery = useQuery({
    queryKey: ["arenas", apiBase],
    queryFn: () => fetchArenas(apiBase),
    refetchInterval: 5_000,
  });

  const arenaDetailQuery = useQuery({
    queryKey: ["arena", apiBase, selectedArenaId],
    queryFn: () => fetchArena(apiBase, selectedArenaId!),
    enabled: !!selectedArenaId,
    refetchInterval: 2_000,
  });

  useEffect(() => {
    if (selectedArenaId) {
      return;
    }
    const arenas = arenasQuery.data?.arenas ?? [];
    const preferredArena = arenas[0] ?? null;
    if (preferredArena?.id) {
      setSelectedArenaId(preferredArena.id);
    }
  }, [arenasQuery.data?.arenas, selectedArenaId]);

  const createArenaMutation = useMutation({
    mutationFn: (req: CreateArenaRequest) =>
      createArena({ apiBase, token: adminToken }, req),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["arenas"] });
      setSelectedArenaId(data.id);
    },
  });

  const addMatchMutation = useMutation({
    mutationFn: (req: AddMatchRequest) =>
      addArenaMatch({ apiBase, token: adminToken }, selectedArenaId!, req),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["arena", apiBase, selectedArenaId],
      });
    },
  });

  const startArenaMutation = useMutation({
    mutationFn: () =>
      startArena({ apiBase, token: adminToken }, selectedArenaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["arena", apiBase, selectedArenaId],
      });
    },
  });

  return {
    adminToken,
    arenas: (arenasQuery.data?.arenas ?? []) as ArenaSummary[],
    arenasLoading: arenasQuery.isLoading,
    selectedArenaId,
    setSelectedArenaId,
    arenaDetail: arenaDetailQuery.data as ArenaSnapshot | undefined,
    arenaDetailLoading: arenaDetailQuery.isLoading,
    createArenaMutation,
    addMatchMutation,
    startArenaMutation,
  };
}
