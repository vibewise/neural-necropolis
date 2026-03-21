import { readFileSync } from "node:fs";
import type { JsonObject, JsonValue, PromptManifest } from "./types.js";

const TRAITS = new Set([
  "aggressive",
  "cautious",
  "greedy",
  "curious",
  "resilient",
]);
const FALLBACKS = new Set(["wait", "rest", "first_legal", "reject_turn"]);
const DIRECT_PROVIDERS = new Set([
  "openai",
  "groq",
  "together",
  "fireworks",
  "perplexity",
  "ollama",
  "openai-compatible",
]);

export function parsePromptManifestText(text: string): PromptManifest {
  const manifest = JSON.parse(text) as JsonValue;
  assert(isObject(manifest), "Prompt manifest must be a JSON object");
  validatePromptManifest(manifest);
  assertNoSecrets(manifest);
  return manifest;
}

export function readPromptManifestFile(filePath: string): PromptManifest {
  return parsePromptManifestText(readFileSync(filePath, "utf8"));
}

export function validatePromptManifest(
  manifest: JsonObject,
): asserts manifest is PromptManifest {
  expectExactKeys(manifest, [
    "manifestVersion",
    "kind",
    "agent",
    "prompts",
    "model",
    "runner",
    "io",
    "tools",
    "fallback",
    "metadata",
  ]);
  expectString(manifest, "manifestVersion", { exact: "1.0" });
  expectString(manifest, "kind", {
    exact: "neural-necropolis.prompt-manifest",
  });

  const agent = expectObject(manifest, "agent");
  expectExactKeys(agent, ["displayName", "strategy", "preferredTrait"]);
  expectString(agent, "displayName", { min: 1, max: 80 });
  expectString(agent, "strategy", { min: 1, max: 240 });
  expectEnum(agent, "preferredTrait", TRAITS);

  const prompts = expectObject(manifest, "prompts");
  expectExactKeys(prompts, ["system", "policy", "persona", "styleNotes"]);
  expectString(prompts, "system", { min: 1, max: 12000 });
  expectString(prompts, "policy", { min: 1, max: 8000 });
  expectOptionalString(prompts, "persona", { min: 1, max: 4000 });
  expectOptionalString(prompts, "styleNotes", { min: 1, max: 2000 });

  const model = expectObject(manifest, "model");
  expectExactKeys(model, [
    "selection",
    "temperature",
    "maxOutputTokens",
    "reasoningEffort",
  ]);
  const selection = expectObject(model, "selection");
  validateModelSelection(selection);
  expectNumber(model, "temperature", { min: 0, max: 1 });
  expectInteger(model, "maxOutputTokens", { min: 32, max: 512 });
  if (hasKey(model, "reasoningEffort")) {
    expectEnum(model, "reasoningEffort", new Set(["low", "medium", "high"]));
  }

  const runner = expectObject(manifest, "runner");
  expectExactKeys(runner, [
    "decisionTimeoutMs",
    "maxDecisionRetries",
    "maxConsecutiveFallbacks",
    "cooldownMs",
  ]);
  expectInteger(runner, "decisionTimeoutMs", { min: 1000, max: 60000 });
  expectInteger(runner, "maxDecisionRetries", { min: 0, max: 2 });
  if (hasKey(runner, "maxConsecutiveFallbacks")) {
    expectInteger(runner, "maxConsecutiveFallbacks", { min: 1, max: 5 });
  }
  if (hasKey(runner, "cooldownMs")) {
    expectInteger(runner, "cooldownMs", { min: 0, max: 5000 });
  }

  const io = expectObject(manifest, "io");
  expectExactKeys(io, ["inputMode", "outputMode", "requireReason"]);
  expectString(io, "inputMode", { exact: "observation-v1" });
  expectString(io, "outputMode", { exact: "action-index-v1" });
  expectBoolean(io, "requireReason");

  const tools = expectObject(manifest, "tools");
  expectExactKeys(tools, ["mode", "allowed"]);
  const mode = expectString(tools, "mode", {
    enumSet: new Set(["none", "allowlist"]),
  });
  const allowed = expectStringArray(tools, "allowed", {
    maxItems: 8,
    maxLength: 64,
  });
  if (mode === "none") {
    assert(
      allowed.length === 0,
      "tools.allowed must be empty when tools.mode is none",
    );
  }
  if (mode === "allowlist") {
    assert(
      allowed.length > 0,
      "tools.allowed must contain at least one tool when tools.mode is allowlist",
    );
  }

  const fallback = expectObject(manifest, "fallback");
  expectExactKeys(fallback, [
    "onTimeout",
    "onMalformedOutput",
    "onUnsafeOutput",
  ]);
  expectEnum(fallback, "onTimeout", FALLBACKS);
  expectEnum(fallback, "onMalformedOutput", FALLBACKS);
  expectEnum(fallback, "onUnsafeOutput", FALLBACKS);

  if (hasKey(manifest, "metadata")) {
    const metadata = expectObject(manifest, "metadata");
    expectExactKeys(metadata, [
      "ownerId",
      "createdBy",
      "revision",
      "labels",
      "notes",
    ]);
    if (hasKey(metadata, "ownerId")) {
      expectString(metadata, "ownerId", {
        min: 1,
        max: 64,
        pattern: /^[A-Za-z0-9._-]+$/,
      });
    }
    if (hasKey(metadata, "createdBy")) {
      expectString(metadata, "createdBy", {
        min: 1,
        max: 64,
        pattern: /^[A-Za-z0-9._@-]+$/,
      });
    }
    if (hasKey(metadata, "revision")) {
      expectInteger(metadata, "revision", { min: 1, max: 1000000 });
    }
    if (hasKey(metadata, "labels")) {
      expectStringArray(metadata, "labels", { maxItems: 12, maxLength: 32 });
    }
    if (hasKey(metadata, "notes")) {
      expectString(metadata, "notes", { min: 1, max: 1000 });
    }
  }
}

export function assertNoSecrets(
  value: JsonValue,
  path = "$",
  parentKey = "",
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSecrets(entry, `${path}[${index}]`, parentKey),
    );
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (isSecretLikeKey(key)) {
        throw new Error(
          `Prompt manifest must not contain secret-bearing field ${path}.${key}`,
        );
      }
      assertNoSecrets(entry, `${path}.${key}`, key);
    }
    return;
  }
  if (typeof value === "string") {
    if (parentKey && isSecretLikeKey(parentKey)) {
      throw new Error(
        `Prompt manifest must not contain secret-bearing value at ${path}`,
      );
    }
    assert(
      !/gsk_[A-Za-z0-9]+/.test(value),
      `Prompt manifest must not embed provider API keys at ${path}`,
    );
    assert(
      !/Bearer\s+[A-Za-z0-9._-]+/i.test(value),
      `Prompt manifest must not embed bearer tokens at ${path}`,
    );
  }
}

function validateModelSelection(selection: JsonObject): void {
  const mode = expectString(selection, "mode", {
    enumSet: new Set(["profile", "direct"]),
  });
  if (mode === "profile") {
    expectExactKeys(selection, ["mode", "profile"]);
    expectString(selection, "profile", {
      min: 1,
      max: 64,
      pattern: /^[A-Za-z0-9._-]+$/,
    });
    return;
  }
  expectExactKeys(selection, ["mode", "provider", "model"]);
  expectEnum(selection, "provider", DIRECT_PROVIDERS);
  expectString(selection, "model", {
    min: 1,
    max: 128,
    pattern: /^[A-Za-z0-9._:/-]+$/,
  });
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    normalized === "apikey" ||
    normalized === "secret" ||
    normalized === "password" ||
    normalized === "authorizationheader" ||
    normalized === "token" ||
    normalized.endsWith("token")
  );
}

function expectObject(parent: JsonObject, key: string): JsonObject {
  const value = parent[key];
  assert(isObject(value), `${key} must be an object`);
  return value;
}

function expectString(
  parent: JsonObject,
  key: string,
  options: {
    min?: number;
    max?: number;
    exact?: string;
    enumSet?: Set<string>;
    pattern?: RegExp;
  } = {},
): string {
  const value = parent[key];
  assert(typeof value === "string", `${key} must be a string`);
  assert(
    options.min == null || value.length >= options.min,
    `${key} must be at least ${options.min} characters`,
  );
  assert(
    options.max == null || value.length <= options.max,
    `${key} must be at most ${options.max} characters`,
  );
  assert(
    options.exact == null || value === options.exact,
    `${key} must equal ${options.exact}`,
  );
  assert(
    options.enumSet == null || options.enumSet.has(value),
    `${key} must be one of ${Array.from(options.enumSet ?? []).join(", ")}`,
  );
  assert(
    options.pattern == null || options.pattern.test(value),
    `${key} has an invalid format`,
  );
  return value;
}

function expectOptionalString(
  parent: JsonObject,
  key: string,
  options: { min?: number; max?: number } = {},
): string | undefined {
  if (!hasKey(parent, key)) {
    return undefined;
  }
  return expectString(parent, key, options);
}

function expectEnum(
  parent: JsonObject,
  key: string,
  values: Set<string>,
): string {
  return expectString(parent, key, { enumSet: values });
}

function expectInteger(
  parent: JsonObject,
  key: string,
  options: { min?: number; max?: number } = {},
): number {
  const value = parent[key];
  assert(
    typeof value === "number" && Number.isInteger(value),
    `${key} must be an integer`,
  );
  assert(
    options.min == null || value >= options.min,
    `${key} must be at least ${options.min}`,
  );
  assert(
    options.max == null || value <= options.max,
    `${key} must be at most ${options.max}`,
  );
  return value;
}

function expectNumber(
  parent: JsonObject,
  key: string,
  options: { min?: number; max?: number } = {},
): number {
  const value = parent[key];
  assert(
    typeof value === "number" && Number.isFinite(value),
    `${key} must be a number`,
  );
  assert(
    options.min == null || value >= options.min,
    `${key} must be at least ${options.min}`,
  );
  assert(
    options.max == null || value <= options.max,
    `${key} must be at most ${options.max}`,
  );
  return value;
}

function expectBoolean(parent: JsonObject, key: string): boolean {
  const value = parent[key];
  assert(typeof value === "boolean", `${key} must be a boolean`);
  return value;
}

function expectStringArray(
  parent: JsonObject,
  key: string,
  options: { maxItems?: number; maxLength?: number } = {},
): string[] {
  const value = parent[key];
  assert(Array.isArray(value), `${key} must be an array`);
  assert(
    options.maxItems == null || value.length <= options.maxItems,
    `${key} must contain at most ${options.maxItems} items`,
  );
  return value.map((entry, index) => {
    assert(typeof entry === "string", `${key}[${index}] must be a string`);
    assert(
      options.maxLength == null || entry.length <= options.maxLength,
      `${key}[${index}] must be at most ${options.maxLength} characters`,
    );
    return entry;
  });
}

function expectExactKeys(parent: JsonObject, keys: string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(parent)) {
    assert(allowed.has(key), `Unexpected field ${key}`);
  }
}

function hasKey(parent: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(parent, key);
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
