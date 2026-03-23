import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  buildPromptManifest,
  cancelPromptRunnerJob,
  createDefaultPromptDraft,
  createPromptRunnerJob,
  fetchPromptRunnerLogs,
  fetchPromptRunnerState,
  purgePromptRunnerData,
  storePromptRunnerManifest,
  type PromptDraft,
} from "../api";
import type { CommandProfile } from "../commandProfile";
import {
  normalizePromptRunnerBase,
  useDashboardStore,
} from "../dashboardStore";
import { createHeroBuild, useHeroBuildStore } from "../heroBuildStore";

export type HostedStatusTone = "" | "ok" | "warn" | "error";

type SaveBuildRequest = {
  commandProfile: CommandProfile;
  archetypeId: string | null;
  name?: string;
};

type UseHostedAgentsOptions = {
  apiBase: string;
};

export function useHostedAgents(options: UseHostedAgentsOptions) {
  const { apiBase } = options;
  const promptRunnerBase = useDashboardStore((state) => state.promptRunnerBase);
  const promptRunnerToken = useDashboardStore(
    (state) => state.promptRunnerToken,
  );
  const setPromptRunnerConnection = useDashboardStore(
    (state) => state.setPromptRunnerConnection,
  );
  const selectedHostedJobId = useDashboardStore(
    (state) => state.selectedHostedJobId,
  );
  const setSelectedHostedJobId = useDashboardStore(
    (state) => state.setSelectedHostedJobId,
  );
  const addBuild = useHeroBuildStore((state) => state.addBuild);

  const [draftBase, setDraftBase] = useState(promptRunnerBase);
  const [draftToken, setDraftToken] = useState(promptRunnerToken);
  const [draft, setDraft] = useState<PromptDraft>(() =>
    createDefaultPromptDraft(),
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<HostedStatusTone>("");

  const connection = useMemo(
    () => ({ base: promptRunnerBase, token: promptRunnerToken }),
    [promptRunnerBase, promptRunnerToken],
  );

  const stateQuery = useQuery({
    queryKey: ["promptRunnerState", promptRunnerBase, promptRunnerToken],
    queryFn: () => fetchPromptRunnerState(connection),
    retry: false,
    staleTime: 5_000,
  });

  const logsQuery = useQuery({
    queryKey: [
      "promptRunnerLogs",
      promptRunnerBase,
      promptRunnerToken,
      selectedHostedJobId,
    ],
    queryFn: () => fetchPromptRunnerLogs(connection, selectedHostedJobId ?? ""),
    enabled: Boolean(selectedHostedJobId),
    retry: false,
    staleTime: 2_000,
  });

  const ownerActiveJobs = useMemo(() => {
    const jobs = stateQuery.data?.jobs ?? [];
    return jobs.filter(
      (job) =>
        job.ownerId === draft.ownerId &&
        (job.status === "queued" || job.status === "running"),
    ).length;
  }, [draft.ownerId, stateQuery.data?.jobs]);

  const ownerJobLimit = stateQuery.data?.health.maxActiveJobsPerOwner ?? 0;

  const saveBuildMutation = useMutation({
    mutationFn: async (request: SaveBuildRequest) => {
      const buildName =
        request.name?.trim() ||
        draft.displayName.trim() ||
        draft.heroName.trim();
      const build = createHeroBuild(
        buildName || draft.manifestId,
        draft,
        request.commandProfile,
        request.archetypeId,
      );
      addBuild(build);
      return build;
    },
    onSuccess: (build) => {
      setStatusTone("ok");
      setStatusMessage(`Saved bot ${build.name}.`);
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage(error instanceof Error ? error.message : String(error));
    },
  });

  const storeManifestMutation = useMutation({
    mutationFn: () =>
      storePromptRunnerManifest(connection, {
        manifestId: draft.manifestId,
        ownerId: draft.ownerId,
        manifest: buildPromptManifest(draft),
      }),
    onSuccess: () => {
      setStatusTone("ok");
      setStatusMessage(
        `Saved agent ${draft.displayName || draft.heroName || draft.manifestId}.`,
      );
      void stateQuery.refetch();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage(
        formatHostedErrorMessage(
          error,
          draft.ownerId,
          ownerActiveJobs,
          ownerJobLimit,
        ),
      );
    },
  });

  const launchJobMutation = useMutation({
    mutationFn: async (draftOverride?: PromptDraft) => {
      const launchDraft = draftOverride ?? draft;
      const launchSeed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await storePromptRunnerManifest(connection, {
        manifestId: launchDraft.manifestId,
        ownerId: launchDraft.ownerId,
        manifest: buildPromptManifest(launchDraft),
      });

      return createPromptRunnerJob(connection, {
        manifestId: launchDraft.manifestId,
        connection: { baseUrl: apiBase },
        hero: {
          id: `${launchDraft.manifestId}-${launchSeed}`,
          name: launchDraft.heroName,
        },
        requestedBy: launchDraft.requestedBy,
      });
    },
    onSuccess: (job, launchDraft) => {
      const launchedDraft = launchDraft ?? draft;
      setSelectedHostedJobId(job.id);
      setStatusTone("ok");
      setStatusMessage(
        `Hosted job ${job.id} created for ${launchedDraft.heroName}.`,
      );
      void stateQuery.refetch();
      void logsQuery.refetch();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage(
        formatHostedErrorMessage(
          error,
          draft.ownerId,
          ownerActiveJobs,
          ownerJobLimit,
        ),
      );
    },
  });

  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => cancelPromptRunnerJob(connection, jobId),
    onSuccess: (job) => {
      setStatusTone("ok");
      setStatusMessage(`Cancelled job ${job.id}.`);
      void stateQuery.refetch();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage(
        formatHostedErrorMessage(
          error,
          draft.ownerId,
          ownerActiveJobs,
          ownerJobLimit,
        ),
      );
    },
  });

  const purgeDataMutation = useMutation({
    mutationFn: () => purgePromptRunnerData(connection),
    onSuccess: (result) => {
      setSelectedHostedJobId(null);
      setStatusTone("ok");
      setStatusMessage(
        `Cleared ${result.cleared.manifests} manifests and ${result.cleared.jobs} jobs from ${result.dataDir}.`,
      );
      void stateQuery.refetch();
      void logsQuery.refetch();
    },
    onError: (error) => {
      setStatusTone("error");
      setStatusMessage(
        formatHostedErrorMessage(
          error,
          draft.ownerId,
          ownerActiveJobs,
          ownerJobLimit,
        ),
      );
    },
  });

  const manifestPreview = useMemo(
    () => JSON.stringify(buildPromptManifest(draft), null, 2),
    [draft],
  );

  function replaceDraft(nextDraft: PromptDraft) {
    setDraft({ ...nextDraft });
  }

  function updateDraft<K extends keyof PromptDraft>(
    key: K,
    value: PromptDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveConnection() {
    setPromptRunnerConnection(draftBase, draftToken);
    setStatusTone("ok");
    setStatusMessage(
      `Saved prompt runner URL ${normalizePromptRunnerBase(draftBase)}.`,
    );
  }

  function resetDraft() {
    setDraft(createDefaultPromptDraft());
  }

  function selectJob(jobId: string) {
    setSelectedHostedJobId(jobId);
  }

  return {
    cancelJobMutation,
    draft,
    draftBase,
    draftToken,
    launchJobMutation,
    logsQuery,
    manifestPreview,
    ownerActiveJobs,
    ownerJobLimit,
    purgeDataMutation,
    replaceDraft,
    resetDraft,
    saveBuild: saveBuildMutation.mutate,
    saveBuildMutation,
    saveConnection,
    selectJob,
    selectedHostedJobId,
    setDraftBase,
    setDraftToken,
    stateQuery,
    statusMessage,
    statusTone,
    storeManifestMutation,
    updateDraft,
  };
}

function formatHostedErrorMessage(
  error: unknown,
  ownerId: string,
  ownerActiveJobs: number,
  ownerJobLimit: number,
): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/owner\s+.+active job quota reached/i.test(message)) {
    const slotText = ownerJobLimit
      ? `${ownerActiveJobs}/${ownerJobLimit}`
      : String(ownerActiveJobs);
    return `Hosted slots full for owner ${ownerId}: ${slotText} jobs are already queued or running. Cancel one in Review Agents or wait for one to finish, then launch another.`;
  }
  if (/global active job quota reached/i.test(message)) {
    return "The prompt runner is already at its global hosted-job limit. Cancel a queued or running job, or wait for one to finish before launching another.";
  }
  return message;
}
