import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(
  moduleDir,
  "../../engine/server/dashboard.html",
);
const targetDir = path.resolve(moduleDir, "./public");
const targetPath = path.join(targetDir, "index.html");

await mkdir(targetDir, { recursive: true });
const html = await readFile(sourcePath, "utf8");
await writeFile(targetPath, html, "utf8");

console.log(
  `[dashboard-static] synced ${path.relative(moduleDir, sourcePath)} -> public/index.html`,
);
