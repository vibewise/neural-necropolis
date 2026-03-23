import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const engineDir = path.join(rootDir, "engine");
const isBuild = process.argv.includes("--build");
const dashboardAppDir = path.join(rootDir, "apps", "dashboard-app");
const embeddedDashboardDir = path.join(
  rootDir,
  "engine",
  "server",
  "dashboard_app",
);

function executableNames() {
  return process.platform === "win32" ? ["go.exe", "go.cmd", "go.bat"] : ["go"];
}

async function canExecute(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function splitPathEntries(value) {
  return value.split(path.delimiter).filter(Boolean);
}

async function findGoExecutable() {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (filePath) => {
    const normalized = path.normalize(filePath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };

  for (const entry of splitPathEntries(process.env.PATH ?? "")) {
    for (const name of executableNames()) {
      addCandidate(path.join(entry, name));
    }
  }

  if (process.env.GOROOT) {
    for (const name of executableNames()) {
      addCandidate(path.join(process.env.GOROOT, "bin", name));
    }
  }

  if (process.platform === "win32") {
    const programFiles = [
      process.env.ProgramFiles,
      process.env["ProgramW6432"],
      process.env["ProgramFiles(x86)"],
    ].filter(Boolean);
    for (const base of programFiles) {
      for (const name of executableNames()) {
        addCandidate(path.join(base, "Go", "bin", name));
      }
    }
  }

  for (const candidate of candidates) {
    if (await canExecute(candidate)) return candidate;
  }

  return null;
}

async function latestModifiedTime(targetPath) {
  const entry = await stat(targetPath);
  if (!entry.isDirectory()) {
    return entry.mtimeMs;
  }

  let latest = entry.mtimeMs;
  const children = await readdir(targetPath, { withFileTypes: true });
  for (const child of children) {
    latest = Math.max(
      latest,
      await latestModifiedTime(path.join(targetPath, child.name)),
    );
  }
  return latest;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureEmbeddedDashboard() {
  const dashboardInputs = [
    path.join(dashboardAppDir, "src"),
    path.join(dashboardAppDir, "index.html"),
    path.join(dashboardAppDir, "package.json"),
    path.join(dashboardAppDir, "tsconfig.json"),
    path.join(dashboardAppDir, "vite.config.ts"),
  ];

  const embeddedIndex = path.join(embeddedDashboardDir, "index.html");
  const embeddedExists = await pathExists(embeddedIndex);
  const sourceLatest = Math.max(
    ...(await Promise.all(
      dashboardInputs.map((targetPath) => latestModifiedTime(targetPath)),
    )),
  );
  const embeddedLatest = embeddedExists
    ? await latestModifiedTime(embeddedDashboardDir)
    : -1;

  if (embeddedExists && embeddedLatest >= sourceLatest) {
    return;
  }

  console.log(
    "[dashboard-build] source changed, rebuilding embedded dashboard...",
  );

  await new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", "npm run build:dashboard-app"], {
            cwd: rootDir,
            env: process.env,
            stdio: "inherit",
            shell: false,
          })
        : spawn("npm", ["run", "build:dashboard-app"], {
            cwd: rootDir,
            env: process.env,
            stdio: "inherit",
            shell: false,
          });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`dashboard build terminated by signal ${signal}`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`dashboard build failed with exit code ${code ?? 1}`));
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}

const goExecutable = await findGoExecutable();

if (!goExecutable) {
  console.error(
    "Unable to find the Go toolchain. Install Go or add it to PATH. Expected a go executable in PATH, GOROOT/bin, or the standard Windows Go install directory.",
  );
  process.exit(1);
}

await ensureEmbeddedDashboard();

const args = isBuild
  ? ["build", "-o", "neural-necropolis-engine", "."]
  : ["run", "."];
const child = spawn(goExecutable, args, {
  cwd: engineDir,
  env: {
    ...process.env,
    BEAT_PLANNING_MS: process.env.BEAT_PLANNING_MS ?? "2000",
    BEAT_ACTION_MS: process.env.BEAT_ACTION_MS ?? "250",
  },
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(
    `Failed to launch Go engine via ${goExecutable}: ${error.message}`,
  );
  process.exit(1);
});
