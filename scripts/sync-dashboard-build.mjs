import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, "apps", "dashboard-app", "dist");
const targets = [path.join(rootDir, "engine", "server", "dashboard_app")];

await stat(sourceDir);

for (const targetDir of targets) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  console.log(
    `[dashboard-build] synced ${path.relative(rootDir, sourceDir)} -> ${path.relative(rootDir, targetDir)}`,
  );
}
