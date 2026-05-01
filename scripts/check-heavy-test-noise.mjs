#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ENVIRONMENT_WARNING_PATTERNS = [
  /Unknown user config "electron_mirror"/i,
  /Unknown env config "electron-mirror"/i,
];
const ENVIRONMENT_WARNING_HINTS = [
  {
    keys: ["npm_config_electron_mirror"],
    warning: 'npm warn Unknown user config "electron_mirror". This will stop working in the next major version of npm.',
  },
  {
    keys: ["npm_config_electron-mirror"],
    warning: 'npm warn Unknown env config "electron-mirror". This will stop working in the next major version of npm.',
  },
];

const ACT_WARNING_PATTERNS = [/not wrapped in act/, /The current testing environment is not configured to support act/];
const RUNNER_PREFIXES = [
  " ✓ ",
  " ❯ ",
  " Test Files ",
  "      Tests ",
  "   Start at ",
  "   Duration ",
  " PASS ",
  " RUN ",
  "[vitest-batch]",
];
const ACT_BOILERPLATE_PREFIXES = [
  "An update to ",
  "When testing, code that causes React state updates should be wrapped into act(...):",
  "act(() => {",
  "  /* fire events that update state */",
  "});",
  "/* assert on the output */",
  "This ensures that you're testing the behavior the user would see in the browser.",
];
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, "g");

function parseArgs(argv) {
  const config = {
    run: false,
    input: null,
    mode: "fail",
    logOutput: path.join(".artifacts", "heavy-test-noise.log"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--run") {
      config.run = true;
      continue;
    }
    if (token === "--input") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --input");
      }
      config.input = value;
      index += 1;
      continue;
    }
    if (token === "--log-output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --log-output");
      }
      config.logOutput = value;
      index += 1;
      continue;
    }
    if (token === "--mode") {
      const value = argv[index + 1];
      if (!["report", "fail"].includes(value)) {
        throw new Error(`Invalid --mode value: ${value ?? "<missing>"}`);
      }
      config.mode = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!config.run && !config.input) {
    throw new Error("Provide --run or --input <path>.");
  }
  return config;
}

function matchesAnyPattern(line, patterns) {
  return patterns.some((pattern) => pattern.test(line));
}

function normalizeLogLine(line) {
  return line.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

function shouldIgnorePayloadLine(line) {
  if (!line.trim()) {
    return true;
  }
  if (line.startsWith("stdout | ") || line.startsWith("stderr | ")) {
    return true;
  }
  if (RUNNER_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return true;
  }
  if (ACT_BOILERPLATE_PREFIXES.some((prefix) => line.startsWith(prefix))) {
    return true;
  }
  if (matchesAnyPattern(line, ENVIRONMENT_WARNING_PATTERNS)) {
    return true;
  }
  return false;
}

function detectEnvironmentOwnedWarningsFromEnv(env = process.env) {
  const warnings = [];

  for (const hint of ENVIRONMENT_WARNING_HINTS) {
    if (
      hint.keys.some((key) => {
        const value = env[key];
        return typeof value === "string" && value.trim().length > 0;
      })
    ) {
      warnings.push(hint.warning);
    }
  }

  return warnings;
}

export function analyzeHeavyTestNoise(logText, options = {}) {
  const environmentWarnings = new Set(detectEnvironmentOwnedWarningsFromEnv(options.env));
  const report = {
    environmentWarnings: [],
    actWarnings: [],
    stdoutPayloads: [],
    stderrPayloads: [],
  };

  const lines = logText.split(/\r?\n/);
  let currentContext = null;
  let currentStream = null;

  for (const line of lines) {
    const normalizedLine = normalizeLogLine(line);

    if (matchesAnyPattern(normalizedLine, ENVIRONMENT_WARNING_PATTERNS)) {
      environmentWarnings.add(normalizedLine);
      continue;
    }

    if (normalizedLine.startsWith("stdout | ")) {
      currentContext = normalizedLine.slice("stdout | ".length).trim();
      currentStream = "stdout";
      continue;
    }
    if (normalizedLine.startsWith("stderr | ")) {
      currentContext = normalizedLine.slice("stderr | ".length).trim();
      currentStream = "stderr";
      continue;
    }

    if (matchesAnyPattern(normalizedLine, ACT_WARNING_PATTERNS)) {
      report.actWarnings.push({
        context: currentContext ?? "<unknown>",
        line: normalizedLine,
      });
      continue;
    }

    if (!currentContext || !currentStream) {
      continue;
    }

    if (shouldIgnorePayloadLine(normalizedLine)) {
      continue;
    }

    const payload = {
      context: currentContext,
      line: normalizedLine,
    };
    if (currentStream === "stdout") {
      report.stdoutPayloads.push(payload);
    } else {
      report.stderrPayloads.push(payload);
    }
  }

  report.environmentWarnings = [...environmentWarnings];
  return report;
}

function printSummary(report) {
  console.log("[heavy-test-noise] summary");
  console.log(`  environment warnings: ${report.environmentWarnings.length}`);
  console.log(`  act warnings: ${report.actWarnings.length}`);
  console.log(`  stdout payload lines: ${report.stdoutPayloads.length}`);
  console.log(`  stderr payload lines: ${report.stderrPayloads.length}`);
}

function printViolations(report) {
  const grouped = new Map();

  for (const entry of report.actWarnings) {
    const key = `act::${entry.context}`;
    grouped.set(key, {
      kind: "act",
      context: entry.context,
      lines: [...(grouped.get(key)?.lines ?? []), entry.line],
    });
  }
  for (const entry of report.stdoutPayloads) {
    const key = `stdout::${entry.context}`;
    grouped.set(key, {
      kind: "stdout",
      context: entry.context,
      lines: [...(grouped.get(key)?.lines ?? []), entry.line],
    });
  }
  for (const entry of report.stderrPayloads) {
    const key = `stderr::${entry.context}`;
    grouped.set(key, {
      kind: "stderr",
      context: entry.context,
      lines: [...(grouped.get(key)?.lines ?? []), entry.line],
    });
  }

  console.error("[heavy-test-noise] violations detected:");
  for (const violation of grouped.values()) {
    console.error(`- ${violation.kind} :: ${violation.context}`);
    for (const line of violation.lines.slice(0, 5)) {
      console.error(`    ${line}`);
    }
    if (violation.lines.length > 5) {
      console.error(`    ... +${violation.lines.length - 5} more lines`);
    }
  }
}

export async function runHeavySuiteAndCapture({ logOutput }) {
  const absoluteLogOutput = path.resolve(logOutput);
  await mkdir(path.dirname(absoluteLogOutput), { recursive: true });

  const command = process.execPath;
  const args = ["scripts/test-batched.mjs"];
  const child = spawn(command, args, {
    env: {
      ...process.env,
      VITEST_INCLUDE_HEAVY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let combined = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    combined += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    combined += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  await writeFile(absoluteLogOutput, combined, "utf8");

  return {
    exitCode,
    logPath: absoluteLogOutput,
    logText: combined,
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));

  const logSource = config.run
    ? await runHeavySuiteAndCapture({ logOutput: config.logOutput })
    : {
        exitCode: 0,
        logPath: path.resolve(config.input),
        logText: await readFile(path.resolve(config.input), "utf8"),
      };

  const report = analyzeHeavyTestNoise(logSource.logText, { env: process.env });
  printSummary(report);
  console.log(`  log path: ${logSource.logPath}`);

  const hasViolations =
    report.actWarnings.length > 0 ||
    report.stdoutPayloads.length > 0 ||
    report.stderrPayloads.length > 0;

  if (hasViolations) {
    printViolations(report);
  }

  if (logSource.exitCode !== 0) {
    process.exit(logSource.exitCode);
  }
  if (hasViolations && config.mode === "fail") {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[heavy-test-noise] gate failed to run", error);
    process.exit(1);
  });
}
