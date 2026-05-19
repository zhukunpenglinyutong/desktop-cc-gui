import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const BATCHER_PATH = path.join(ROOT, "src/features/threads/contracts/realtimeEventBatcher.ts");
const TEST_PATH = path.join(ROOT, "src/features/threads/contracts/realtimeEventBatcher.test.ts");

function fail(message) {
  console.error(`[realtime-event-batching] ${message}`);
  process.exitCode = 1;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

for (const filePath of [BATCHER_PATH, TEST_PATH]) {
  if (!fs.existsSync(filePath)) {
    fail(`missing required file: ${path.relative(ROOT, filePath)}`);
  }
}

const source = readText(BATCHER_PATH);
for (const token of [
  "first-token",
  "terminal",
  "appendAgentMessageDelta",
  "appendToolOutputDelta",
  "NormalizedThreadEvent",
]) {
  if (!source.includes(token)) {
    fail(`batcher missing invariant token "${token}"`);
  }
}

if (source.includes("EventBus") || source.includes("useSyncExternalStore")) {
  fail("batching capability must not introduce a domain EventBus or subscription store");
}

if (process.exitCode) {
  process.exit();
}

console.log("[realtime-event-batching] ok");
