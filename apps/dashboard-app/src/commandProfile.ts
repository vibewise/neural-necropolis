export type CommandProfile = {
  riskPosture: "reckless" | "aggressive" | "moderate" | "cautious" | "paranoid";
  objectivePriority:
    | "combat"
    | "treasure"
    | "exploration"
    | "escape"
    | "balanced";
  escapeThreshold: number;
  combatTolerance: "always" | "favorable" | "necessary" | "never";
  lootBias: "ignore" | "opportunistic" | "priority" | "obsessive";
  customRules: string[];
};

export const DEFAULT_COMMAND_PROFILE: CommandProfile = {
  riskPosture: "moderate",
  objectivePriority: "balanced",
  escapeThreshold: 30,
  combatTolerance: "favorable",
  lootBias: "opportunistic",
  customRules: [],
};

const RISK_LABELS: Record<CommandProfile["riskPosture"], string> = {
  reckless: "Reckless — ignore danger entirely",
  aggressive: "Aggressive — accept high risk for high reward",
  moderate: "Moderate — balanced risk assessment",
  cautious: "Cautious — avoid uncertain situations",
  paranoid: "Paranoid — flee at the first sign of trouble",
};

const OBJECTIVE_LABELS: Record<CommandProfile["objectivePriority"], string> = {
  combat: "Combat — seek and destroy monsters",
  treasure: "Treasure — gold and items first",
  exploration: "Exploration — discover every tile",
  escape: "Escape — reach the exit ASAP",
  balanced: "Balanced — adapt to circumstances",
};

const COMBAT_LABELS: Record<CommandProfile["combatTolerance"], string> = {
  always: "Always engage",
  favorable: "Engage when favorable",
  necessary: "Only when necessary",
  never: "Never fight willingly",
};

const LOOT_LABELS: Record<CommandProfile["lootBias"], string> = {
  ignore: "Ignore loot",
  opportunistic: "Grab if safe",
  priority: "Go out of the way for loot",
  obsessive: "Loot above all",
};

/**
 * Generate policy and style-notes text from a command profile.
 * These strings are appended to the base prompt draft when launching.
 */
export function buildCommandPolicyOverlay(profile: CommandProfile): {
  policyAppend: string;
  styleAppend: string;
} {
  const rules: string[] = [];

  // Risk posture
  switch (profile.riskPosture) {
    case "reckless":
      rules.push("Ignore HP thresholds; take maximum risk.");
      break;
    case "aggressive":
      rules.push(
        "Accept fights even at moderate disadvantage. Retreat only below 20% HP.",
      );
      break;
    case "cautious":
      rules.push(
        "Avoid any fight where outcome is uncertain. Prefer safe paths.",
      );
      break;
    case "paranoid":
      rules.push(
        "Never voluntarily enter combat. Flee immediately if any threat is detected. Use potions preemptively.",
      );
      break;
    default:
      break;
  }

  // Objective
  switch (profile.objectivePriority) {
    case "combat":
      rules.push("Seek monsters actively. Kills are the primary objective.");
      break;
    case "treasure":
      rules.push(
        "Prioritize chests, gold, and items above all other objectives.",
      );
      break;
    case "exploration":
      rules.push("Always move toward unexplored tiles when possible.");
      break;
    case "escape":
      rules.push("Find and reach the exit as quickly as possible.");
      break;
    default:
      break;
  }

  // Escape threshold
  if (profile.escapeThreshold > 0) {
    rules.push(
      `When HP drops below ${profile.escapeThreshold}%, prioritize finding the exit or using healing items.`,
    );
  }

  // Combat tolerance
  switch (profile.combatTolerance) {
    case "always":
      rules.push("Engage every reachable monster regardless of odds.");
      break;
    case "necessary":
      rules.push("Only fight when a monster blocks the path or attacks first.");
      break;
    case "never":
      rules.push("Never initiate combat. Avoid all monsters completely.");
      break;
    default:
      break;
  }

  // Loot bias
  switch (profile.lootBias) {
    case "ignore":
      rules.push(
        "Do not spend actions picking up items unless directly adjacent.",
      );
      break;
    case "priority":
      rules.push("Detour to pick up items even if it costs extra turns.");
      break;
    case "obsessive":
      rules.push(
        "Loot every item on the map. Change direction if an item is detected.",
      );
      break;
    default:
      break;
  }

  // Custom rules
  for (const rule of profile.customRules) {
    const trimmed = rule.trim();
    if (trimmed) {
      rules.push(trimmed);
    }
  }

  const policyAppend =
    rules.length > 0
      ? "\n\n--- Commander Directives ---\n" +
        rules.map((r) => `- ${r}`).join("\n")
      : "";

  const styleAppend =
    profile.riskPosture !== "moderate"
      ? `\nRisk posture: ${profile.riskPosture}. Mention risk assessment in reasoning.`
      : "";

  return { policyAppend, styleAppend };
}

export { RISK_LABELS, OBJECTIVE_LABELS, COMBAT_LABELS, LOOT_LABELS };
