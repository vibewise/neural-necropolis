import { useQuery } from "@tanstack/react-query";

import {
  fetchBoards,
  fetchCompletedBoards,
  fetchDashboard,
  fetchHealth,
  fetchLeaderboard,
  fetchSeed,
} from "../api";

type UseDashboardQueriesOptions = {
  apiBase: string;
  boardId: string | null;
};

export function useDashboardQueries(options: UseDashboardQueriesOptions) {
  const { apiBase, boardId } = options;

  const healthQuery = useQuery({
    queryKey: ["health", apiBase],
    queryFn: () => fetchHealth(apiBase),
    retry: false,
    refetchInterval: 10_000,
  });

  const boardsQuery = useQuery({
    queryKey: ["boards", apiBase],
    queryFn: () => fetchBoards(apiBase),
    retry: false,
    refetchInterval: 2_000,
  });

  const snapshotQuery = useQuery({
    queryKey: ["dashboard", apiBase, boardId ?? "active"],
    queryFn: () => fetchDashboard(apiBase, boardId),
    retry: false,
    refetchInterval: 1_000,
  });

  const completedBoardsQuery = useQuery({
    queryKey: ["completedBoards", apiBase, 0, 6],
    queryFn: () => fetchCompletedBoards(apiBase),
    retry: false,
    refetchInterval: 15_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ["leaderboard", apiBase],
    queryFn: () => fetchLeaderboard(apiBase),
    retry: false,
    refetchInterval: 2_000,
  });

  const seedQuery = useQuery({
    queryKey: ["seed", apiBase],
    queryFn: () => fetchSeed(apiBase),
    retry: false,
    refetchInterval: 10_000,
  });

  return {
    healthQuery,
    boardsQuery,
    snapshotQuery,
    completedBoardsQuery,
    leaderboardQuery,
    seedQuery,
  };
}
