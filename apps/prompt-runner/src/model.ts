import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import type {
  PromptManifest,
  ResolvedModelConfig,
  ModelProfile,
} from "./types.js";

const KNOWN_PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  perplexity: "https://api.perplexity.ai",
  ollama: "http://localhost:11434/v1",
};

export function resolveModelConfig(
  manifest: PromptManifest,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedModelConfig {
  if (manifest.model.selection.mode === "profile") {
    const profiles = loadProfiles(env);
    const profile = profiles[manifest.model.selection.profile];
    if (!profile) {
      throw new Error(
        `Unknown model profile ${manifest.model.selection.profile}. Configure PROMPT_RUNNER_MODEL_PROFILES_FILE or PROMPT_RUNNER_MODEL_PROFILES_JSON.`,
      );
    }
    const provider = profile.provider.trim().toLowerCase();
    return {
      provider,
      model: profile.model,
      baseUrl: resolveBaseUrl(provider, profile.baseUrl, env),
      apiKey: resolveApiKey(provider, profile, env),
      temperature: manifest.model.temperature,
      maxOutputTokens: manifest.model.maxOutputTokens,
      reasoningEffort: manifest.model.reasoningEffort,
      includeReasoning: profile.includeReasoning,
      profile: manifest.model.selection.profile,
    };
  }

  const provider = manifest.model.selection.provider;
  return {
    provider,
    model: manifest.model.selection.model,
    baseUrl: resolveBaseUrl(provider, undefined, env),
    apiKey: resolveApiKey(provider, undefined, env),
    temperature: manifest.model.temperature,
    maxOutputTokens: manifest.model.maxOutputTokens,
    reasoningEffort: manifest.model.reasoningEffort,
  };
}

export async function requestModelCompletion(
  config: ResolvedModelConfig,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey || "local-runner",
    baseURL: config.baseUrl,
  });

  const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
    temperature: config.temperature,
    max_completion_tokens: config.maxOutputTokens,
    ...(config.includeReasoning !== undefined
      ? { include_reasoning: config.includeReasoning }
      : {}),
  };

  const response = await client.chat.completions.create(request, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}

function loadProfiles(env: NodeJS.ProcessEnv): Record<string, ModelProfile> {
  const inline = env.PROMPT_RUNNER_MODEL_PROFILES_JSON?.trim();
  if (inline) {
    return JSON.parse(inline) as Record<string, ModelProfile>;
  }
  const filePath = env.PROMPT_RUNNER_MODEL_PROFILES_FILE?.trim();
  if (filePath) {
    const resolved = resolveProfilesFilePath(filePath, env);
    return JSON.parse(readFileSync(resolved, "utf8")) as Record<
      string,
      ModelProfile
    >;
  }
  return {};
}

function resolveProfilesFilePath(
  filePath: string,
  env: NodeJS.ProcessEnv,
): string {
  const baseDir = env.INIT_CWD || process.cwd();
  const resolved = resolve(baseDir, filePath);
  if (existsSync(resolved)) {
    return resolved;
  }

  const normalized = filePath.replace(/\\/g, "/");
  const legacyRelativePath = "docs/PROMPT_RUNNER_PROFILES.example.json";
  const currentRelativePath = "docs/prompt-runner/PROFILES.example.json";

  if (normalized === legacyRelativePath) {
    const currentResolved = resolve(baseDir, currentRelativePath);
    if (existsSync(currentResolved)) {
      return currentResolved;
    }
  }

  const legacyAbsoluteSuffix = "/docs/PROMPT_RUNNER_PROFILES.example.json";
  if (normalized.endsWith(legacyAbsoluteSuffix)) {
    const remapped = `${normalized.slice(0, -legacyAbsoluteSuffix.length)}/docs/prompt-runner/PROFILES.example.json`;
    if (existsSync(remapped)) {
      return remapped;
    }
  }

  return resolved;
}

function resolveBaseUrl(
  provider: string,
  explicitBaseUrl: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const direct = explicitBaseUrl?.trim();
  if (direct) {
    return direct;
  }
  const envKey = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_BASE_URL`;
  const fromEnv = env[envKey]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const builtin = KNOWN_PROVIDER_URLS[provider];
  if (builtin) {
    return builtin;
  }
  throw new Error(
    `Unknown provider ${provider}. Configure ${envKey} for its base URL.`,
  );
}

function resolveApiKey(
  provider: string,
  profile: ModelProfile | undefined,
  env: NodeJS.ProcessEnv,
): string {
  const inlineKey = profile?.apiKey?.trim();
  if (inlineKey) {
    return inlineKey;
  }
  if (profile?.apiKeyEnv) {
    const value = env[profile.apiKeyEnv]?.trim();
    if (value) {
      return value;
    }
  }

  const providerKey =
    env[
      `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
    ]?.trim();
  if (providerKey) {
    return providerKey;
  }

  if (provider === "openai-compatible") {
    const compatibleKey = env.OPENAI_COMPATIBLE_API_KEY?.trim();
    if (compatibleKey) {
      return compatibleKey;
    }
  }

  if (provider === "ollama") {
    return "";
  }

  const fallbackKey = env.OPENAI_API_KEY?.trim();
  if (fallbackKey) {
    return fallbackKey;
  }

  throw new Error(`No API key configured for provider ${provider}.`);
}
