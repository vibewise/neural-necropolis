import type { PromptManifest } from "../api";
import type { HeroBuild } from "../heroBuildStore";

/**
 * Generate a shareable URL that encodes connection settings and seed.
 */
export function buildShareUrl(params: {
  apiBase?: string;
  seed?: string;
  boardId?: string;
}): string {
  const url = new URL(window.location.href);
  url.search = "";
  if (params.apiBase) url.searchParams.set("server", params.apiBase);
  if (params.seed) url.searchParams.set("seed", params.seed);
  if (params.boardId) url.searchParams.set("boardId", params.boardId);
  return url.toString();
}

/**
 * Export a prompt manifest as a pretty-printed JSON string.
 */
export function exportManifestJson(manifest: PromptManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Validate and parse manifest JSON. Returns null on failure.
 */
export function importManifestJson(json: string): PromptManifest | null {
  try {
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.manifestVersion === "1.0" &&
      parsed.kind === "neural-necropolis.prompt-manifest" &&
      parsed.agent &&
      parsed.prompts &&
      parsed.model
    ) {
      return parsed as PromptManifest;
    }
  } catch {
    // invalid JSON
  }
  return null;
}

/**
 * Copy text to clipboard with fallback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers or restricted contexts
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

/**
 * Export multiple hero builds as a JSON array.
 */
export function exportRosterJson(builds: HeroBuild[]): string {
  return JSON.stringify(builds, null, 2);
}
