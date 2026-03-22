import { resolve } from "node:path";
import { readPromptManifestFile } from "../apps/prompt-runner/src/index.js";

function main(): void {
  const filePath = resolveInputPath(process.argv.slice(2));
  readPromptManifestFile(filePath);
  console.log(`[prompt-manifest] validated ${filePath}`);
}

function resolveInputPath(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--file") {
      return resolve(args[index + 1] ?? "");
    }
    if (token.startsWith("--file=")) {
      return resolve(token.slice("--file=".length));
    }
  }
  return resolve("docs", "prompt-runner", "MANIFEST.example.json");
}

function parseJson(text: string): JsonValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
