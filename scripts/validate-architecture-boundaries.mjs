import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walkFiles(rootPath, predicate, acc = []) {
  if (!existsSync(rootPath)) return acc;
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, acc);
      continue;
    }
    if (predicate(fullPath)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

const root = process.cwd();
const packageJson = readJson(resolve(root, "package.json"));
const scripts = packageJson.scripts ?? {};

const expectedScripts = {
  "run:aibots:bot": "npm run run:bot -w @neural-necropolis/ai-bots",
  "run:openclaw:bot": "npm run run:bot -w @neural-necropolis/openclaw-runner",
  "run:openclaw:register":
    "npm run register -w @neural-necropolis/openclaw-runner",
  "run:openclaw:bootstrap":
    "npm run bootstrap -w @neural-necropolis/openclaw-runner",
  "run:openclaw:step": "npm run step -w @neural-necropolis/openclaw-runner",
  "run:openclaw:act": "npm run act -w @neural-necropolis/openclaw-runner",
  "run:openclaw:reset": "npm run reset -w @neural-necropolis/openclaw-runner",
  "build:ai-bots": "npm run build -w @neural-necropolis/ai-bots",
  "build:openclaw-runner":
    "npm run build -w @neural-necropolis/openclaw-runner",
};

for (const [name, value] of Object.entries(expectedScripts)) {
  assert(
    scripts[name] === value,
    `Root script ${name} drifted from workspace package entrypoints.`,
  );
}

const requiredPackageDeps = {
  "packages/ai-bots/package.json": [
    "@neural-necropolis/agent-sdk",
    "@neural-necropolis/protocol-ts",
  ],
  "packages/openclaw-runner/package.json": [
    "@neural-necropolis/agent-sdk",
    "@neural-necropolis/protocol-ts",
  ],
  "packages/scripted-bots/package.json": [
    "@neural-necropolis/agent-sdk",
    "@neural-necropolis/protocol-ts",
  ],
};

for (const [relativePath, deps] of Object.entries(requiredPackageDeps)) {
  const manifest = readJson(resolve(root, relativePath));
  const manifestDeps = manifest.dependencies ?? {};
  for (const dep of deps) {
    assert(
      manifestDeps[dep] === "*",
      `${relativePath} must depend on ${dep} via npm workspace-compatible * syntax.`,
    );
  }
}

const removedPaths = [
  "src/agents/bots/aibot.ts",
  "src/agents/openclaw/autoplay.ts",
  "src/agents/openclaw/game-cli.ts",
  "src/server/index.ts",
  "src/server/store.ts",
  "src/server/dashboard.ts",
  "src/world/data.ts",
  "src/world/generate.ts",
  "src/world/simulate.ts",
  "src/rng.ts",
];

for (const relativePath of removedPaths) {
  assert(
    !existsSync(resolve(root, relativePath)),
    `${relativePath} should be removed after the refactor.`,
  );
}

const forbiddenPatterns = [
  "src/agents/openclaw/",
  "src/agents/bots/aibot",
  "src/server/",
  "../world/",
  "src/world/",
  "src/rng",
];

const codeFiles = [
  ...walkFiles(resolve(root, "packages"), (filePath) =>
    /\.(ts|mts|cts|js|mjs)$/.test(filePath),
  ),
  ...walkFiles(resolve(root, "scripts"), (filePath) =>
    /\.(ts|mts|cts|js|mjs)$/.test(filePath),
  ),
];

const selfValidatorPath = resolve(
  root,
  "scripts",
  "validate-architecture-boundaries.mjs",
);

for (const filePath of codeFiles) {
  if (filePath === selfValidatorPath) {
    continue;
  }
  const text = readFileSync(filePath, "utf8");
  for (const pattern of forbiddenPatterns) {
    assert(
      !text.includes(pattern),
      `${filePath} still references legacy runtime path fragment: ${pattern}`,
    );
  }
}

process.stdout.write("Architecture boundary validation passed.\n");
