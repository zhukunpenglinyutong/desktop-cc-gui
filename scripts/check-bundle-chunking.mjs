import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const VITE_CONFIG_PATH = path.join(ROOT, "vite.config.ts");

function fail(message) {
  console.error(`[bundle-chunking] ${message}`);
  process.exitCode = 1;
}

const source = fs.readFileSync(VITE_CONFIG_PATH, "utf8");
for (const chunkName of [
  "vendor-react",
  "vendor-codemirror",
  "vendor-markdown",
  "vendor-mermaid",
  "vendor-docs",
  "vendor-ui-heavy",
]) {
  if (!source.includes(chunkName)) {
    fail(`vite manualChunks missing ${chunkName}`);
  }
}

if (!source.includes("manualChunks(id)")) {
  fail("vite config must keep manualChunks boundary explicit");
}

if (process.exitCode) {
  process.exit();
}

console.log("[bundle-chunking] ok");
