import { create } from "zustand";

import type { PromptDraft } from "./api";
import type { CommandProfile } from "./commandProfile";
import { DEFAULT_COMMAND_PROFILE } from "./commandProfile";

const BUILDS_STORAGE_KEY = "neural-necropolis.dashboard-app.hero-builds";
const SEED_HISTORY_KEY = "neural-necropolis.dashboard-app.seed-history";

export type HeroBuild = {
  id: string;
  name: string;
  archetypeId: string | null;
  draft: PromptDraft;
  commandProfile: CommandProfile;
  createdAt: number;
  updatedAt: number;
  notes: string;
};

export type SeedHistoryEntry = {
  seed: string;
  boardId: string;
  boardName: string;
  savedAt: number;
  notes: string;
};

type HeroBuildStore = {
  builds: HeroBuild[];
  seedHistory: SeedHistoryEntry[];
  addBuild: (build: HeroBuild) => void;
  updateBuild: (id: string, patch: Partial<HeroBuild>) => void;
  removeBuild: (id: string) => void;
  addSeedEntry: (entry: SeedHistoryEntry) => void;
  removeSeedEntry: (seed: string) => void;
};

function loadBuilds(): HeroBuild[] {
  try {
    const raw = window.localStorage.getItem(BUILDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveBuilds(builds: HeroBuild[]) {
  try {
    window.localStorage.setItem(BUILDS_STORAGE_KEY, JSON.stringify(builds));
  } catch {
    // ignore
  }
}

function loadSeedHistory(): SeedHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(SEED_HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveSeedHistory(seeds: SeedHistoryEntry[]) {
  try {
    window.localStorage.setItem(SEED_HISTORY_KEY, JSON.stringify(seeds));
  } catch {
    // ignore
  }
}

export const useHeroBuildStore = create<HeroBuildStore>((set) => ({
  builds: loadBuilds(),
  seedHistory: loadSeedHistory(),

  addBuild: (build) =>
    set((state) => {
      const next = [build, ...state.builds];
      saveBuilds(next);
      return { builds: next };
    }),

  updateBuild: (id, patch) =>
    set((state) => {
      const next = state.builds.map((b) =>
        b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b,
      );
      saveBuilds(next);
      return { builds: next };
    }),

  removeBuild: (id) =>
    set((state) => {
      const next = state.builds.filter((b) => b.id !== id);
      saveBuilds(next);
      return { builds: next };
    }),

  addSeedEntry: (entry) =>
    set((state) => {
      const next = [
        entry,
        ...state.seedHistory.filter((s) => s.seed !== entry.seed),
      ].slice(0, 20);
      saveSeedHistory(next);
      return { seedHistory: next };
    }),

  removeSeedEntry: (seed) =>
    set((state) => {
      const next = state.seedHistory.filter((s) => s.seed !== seed);
      saveSeedHistory(next);
      return { seedHistory: next };
    }),
}));

export function createHeroBuild(
  name: string,
  draft: PromptDraft,
  commandProfile: CommandProfile,
  archetypeId: string | null,
): HeroBuild {
  return {
    id: `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    archetypeId,
    draft: { ...draft },
    commandProfile: { ...commandProfile },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    notes: "",
  };
}

export function exportBuild(build: HeroBuild): string {
  return JSON.stringify(build, null, 2);
}

export function importBuild(json: string): HeroBuild | null {
  try {
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      parsed.draft &&
      typeof parsed.draft === "object"
    ) {
      // Re-generate id to avoid collisions
      return {
        ...parsed,
        id: `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        commandProfile: parsed.commandProfile ?? DEFAULT_COMMAND_PROFILE,
      };
    }
  } catch {
    // invalid JSON
  }
  return null;
}
