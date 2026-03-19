import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const engineDir = path.join(rootDir, "engine");
const isBuild = process.argv.includes("--build");

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

const goExecutable = await findGoExecutable();

if (!goExecutable) {
  console.error(
    "Unable to find the Go toolchain. Install Go or add it to PATH. Expected a go executable in PATH, GOROOT/bin, or the standard Windows Go install directory.",
  );
  process.exit(1);
}

const args = isBuild
  ? ["build", "-o", "neural-necropolis-engine", "."]
  : ["run", "."];
const child = spawn(goExecutable, args, {
  cwd: engineDir,
  env: process.env,
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
