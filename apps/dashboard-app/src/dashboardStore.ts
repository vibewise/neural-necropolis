import { create } from "zustand";

const STORAGE_KEY = "neural-necropolis.dashboard-app.api-base";
const DEFAULT_API_BASE = "http://127.0.0.1:3000";
const PROMPT_RUNNER_BASE_KEY =
  "neural-necropolis.dashboard-app.prompt-runner-base";
const PROMPT_RUNNER_TOKEN_KEY =
  "neural-necropolis.dashboard-app.prompt-runner-token";
const ADMIN_TOKEN_KEY = "neural-necropolis.dashboard-app.admin-token";

export type StreamConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "retrying"
  | "error";

export type StreamLogEntry = {
  id: string;
  message: string;
  createdAt: number;
  boardId: string | null;
};

type DashboardStore = {
  apiBase: string;
  selectedBoardId: string | null;
  streamState: StreamConnectionState;
  streamLogs: StreamLogEntry[];
  promptRunnerBase: string;
  promptRunnerToken: string;
  adminToken: string;
  selectedHostedJobId: string | null;
  setApiBase: (value: string) => void;
  setSelectedBoardId: (value: string | null) => void;
  setStreamState: (value: StreamConnectionState) => void;
  pushStreamLog: (message: string, boardId?: string | null) => void;
  clearStreamLogs: () => void;
  setPromptRunnerConnection: (base: string, token: string) => void;
  setAdminToken: (value: string) => void;
  setSelectedHostedJobId: (value: string | null) => void;
};

export const useDashboardStore = create<DashboardStore>((set) => ({
  apiBase: resolveInitialApiBase(),
  selectedBoardId: null,
  streamState: "idle",
  streamLogs: [],
  promptRunnerBase: resolveInitialPromptRunnerBase(),
  promptRunnerToken: resolveInitialPromptRunnerToken(),
  adminToken: resolveInitialAdminToken(),
  selectedHostedJobId: null,
  setApiBase: (value) => {
    const normalized = normalizeApiBase(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_error) {
      // Ignore storage failures and keep the in-memory value.
    }
    set({ apiBase: normalized });
  },
  setSelectedBoardId: (value) => set({ selectedBoardId: value }),
  setStreamState: (value) => set({ streamState: value }),
  pushStreamLog: (message, boardId = null) =>
    set((state) => ({
      streamLogs: [
        {
          id: `${Date.now()}-${state.streamLogs.length}`,
          message,
          createdAt: Date.now(),
          boardId,
        },
        ...state.streamLogs,
      ].slice(0, 40),
    })),
  clearStreamLogs: () => set({ streamLogs: [] }),
  setPromptRunnerConnection: (base, token) => {
    const normalizedBase = normalizePromptRunnerBase(base);
    const normalizedToken = String(token || "").trim();
    try {
      window.localStorage.setItem(PROMPT_RUNNER_BASE_KEY, normalizedBase);
      if (normalizedToken) {
        window.localStorage.setItem(PROMPT_RUNNER_TOKEN_KEY, normalizedToken);
      } else {
        window.localStorage.removeItem(PROMPT_RUNNER_TOKEN_KEY);
      }
    } catch (_error) {
      // Ignore storage failures and keep the in-memory value.
    }
    set({
      promptRunnerBase: normalizedBase,
      promptRunnerToken: normalizedToken,
    });
  },
  setAdminToken: (value) => {
    const normalized = String(value || "").trim();
    try {
      if (normalized) {
        window.localStorage.setItem(ADMIN_TOKEN_KEY, normalized);
      } else {
        window.localStorage.removeItem(ADMIN_TOKEN_KEY);
      }
    } catch (_error) {
      // Ignore storage failures and keep the in-memory value.
    }
    set({ adminToken: normalized });
  },
  setSelectedHostedJobId: (value) => set({ selectedHostedJobId: value }),
}));

export function normalizeApiBase(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return DEFAULT_API_BASE;
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveInitialApiBase(): string {
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get("server") ?? params.get("apiBase") ?? "";
  if (queryValue.trim()) {
    return normalizeApiBase(queryValue);
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    if (stored.trim()) {
      return normalizeApiBase(stored);
    }
  } catch (_error) {
    // Ignore storage failures and fall back to the default local server.
  }

  return DEFAULT_API_BASE;
}

export function normalizePromptRunnerBase(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return resolveDefaultPromptRunnerBase();
  }
  return trimmed.replace(/\/+$/, "");
}

function resolveDefaultPromptRunnerBase(): string {
  try {
    if (
      window.location &&
      /^https?:$/.test(window.location.protocol) &&
      window.location.hostname
    ) {
      return `${window.location.protocol}//${window.location.hostname}:4010`;
    }
  } catch (_error) {
    // Ignore and fall back to the local default.
  }
  return "http://127.0.0.1:4010";
}

function resolveInitialPromptRunnerBase(): string {
  const params = new URLSearchParams(window.location.search);
  const queryValue =
    params.get("promptRunner") ?? params.get("promptRunnerBase") ?? "";
  if (queryValue.trim()) {
    return normalizePromptRunnerBase(queryValue);
  }

  try {
    const stored = window.localStorage.getItem(PROMPT_RUNNER_BASE_KEY) ?? "";
    if (stored.trim()) {
      return normalizePromptRunnerBase(stored);
    }
  } catch (_error) {
    // Ignore storage failures and fall back to the default local prompt runner.
  }

  return resolveDefaultPromptRunnerBase();
}

function resolveInitialPromptRunnerToken(): string {
  try {
    return window.localStorage.getItem(PROMPT_RUNNER_TOKEN_KEY) ?? "";
  } catch (_error) {
    return "";
  }
}

function resolveInitialAdminToken(): string {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  } catch (_error) {
    return "";
  }
}
