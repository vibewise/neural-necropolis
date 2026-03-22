import { describe, expect, it } from "vitest";

import { buildPromptManifest } from "./api";

describe("prompt manifest builder", () => {
  it("normalizes the hosted-agent draft into the prompt-runner contract", () => {
    const manifest = buildPromptManifest({
      manifestId: "treasure-mind-test",
      ownerId: "owner-a",
      requestedBy: "dashboard-user",
      heroName: "Treasure Mind",
      displayName: " Treasure Mind ",
      strategy: " stay alive first ",
      preferredTrait: "greedy",
      system: " system ",
      policy: " policy ",
      persona: " persona ",
      styleNotes: " style ",
      profile: " balanced ",
      temperature: "0.4",
      maxOutputTokens: "240",
      reasoningEffort: "high",
      decisionTimeoutMs: "12000",
      maxDecisionRetries: "2",
      maxConsecutiveFallbacks: "4",
      cooldownMs: "250",
    });

    expect(manifest.agent.displayName).toBe("Treasure Mind");
    expect(manifest.model.selection).toEqual({
      mode: "profile",
      profile: "balanced",
    });
    expect(manifest.runner.decisionTimeoutMs).toBe(12000);
    expect(manifest.metadata?.ownerId).toBe("owner-a");
    expect(manifest.tools.mode).toBe("none");
  });
});
