#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".rs",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
  ".java",
  ".kt",
  ".go",
  ".py",
  ".yml",
  ".yaml",
]);

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "out",
  ".next",
  ".turbo",
]);

function parseArgs(argv) {
  const config = {
    threshold: 3000,
    mode: "report",
    markdownOutput: null,
    baselineOutput: null,
    baselineFile: null,
    policyFile: null,
    root: process.cwd(),
    scope: "fail",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--threshold") {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --threshold value: ${argv[index + 1] ?? "<missing>"}`);
      }
      config.threshold = value;
      index += 1;
      continue;
    }
    if (token === "--mode") {
      const value = argv[index + 1];
      if (!["report", "warn", "fail"].includes(value)) {
        throw new Error(`Invalid --mode value: ${value ?? "<missing>"}`);
      }
      config.mode = value;
      index += 1;
      continue;
    }
    if (token === "--markdown-output") {
      config.markdownOutput = argv[index + 1];
      if (!config.markdownOutput) {
        throw new Error("Missing value for --markdown-output");
      }
      index += 1;
      continue;
    }
    if (token === "--baseline-output") {
      config.baselineOutput = argv[index + 1];
      if (!config.baselineOutput) {
        throw new Error("Missing value for --baseline-output");
      }
      index += 1;
      continue;
    }
    if (token === "--baseline-file") {
      config.baselineFile = argv[index + 1];
      if (!config.baselineFile) {
        throw new Error("Missing value for --baseline-file");
      }
      index += 1;
      continue;
    }
    if (token === "--policy-file") {
      config.policyFile = argv[index + 1];
      if (!config.policyFile) {
        throw new Error("Missing value for --policy-file");
      }
      index += 1;
      continue;
    }
    if (token === "--root") {
      const root = argv[index + 1];
      if (!root) {
        throw new Error("Missing value for --root");
      }
      config.root = path.resolve(root);
      index += 1;
      continue;
    }
    if (token === "--scope") {
      const value = argv[index + 1];
      if (!["warn", "fail"].includes(value)) {
        throw new Error(`Invalid --scope value: ${value ?? "<missing>"}`);
      }
      config.scope = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return config;
}

async function walkDirectory(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...(await walkDirectory(fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function detectType(relativePath, extension) {
  if (relativePath.startsWith("src/i18n/locales/")) {
    return "i18n";
  }
  if (relativePath.startsWith("src/styles/")) {
    return "css";
  }
  switch (extension) {
    case ".ts":
    case ".tsx":
      return "ts/tsx";
    case ".js":
    case ".jsx":
      return "js/jsx";
    case ".rs":
      return "rust";
    case ".css":
    case ".scss":
      return "css";
    default:
      return extension.slice(1);
  }
}

function detectLegacyPriority(relativePath) {
  const p0Prefixes = [
    "src-tauri/src/backend/",
    "src-tauri/src/engine/",
    "src-tauri/src/git/",
    "src/features/git-history/",
    "src/features/spec/",
    "src/features/settings/",
  ];

  const p0Explicit = new Set(["src/App.tsx"]);
  if (p0Explicit.has(relativePath) || p0Prefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return "P0";
  }
  if (relativePath.startsWith("src/styles/")) {
    return "P1";
  }
  if (relativePath.startsWith("src/i18n/locales/")) {
    return "P2";
  }
  return "P1";
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  let newLineCount = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      newLineCount += 1;
    }
  }
  return newLineCount + (content.endsWith("\n") ? 0 : 1);
}

function matchesPolicy(relativePath, policy) {
  const match = policy.match ?? {};
  if (Array.isArray(match.exactPaths) && match.exactPaths.includes(relativePath)) {
    return true;
  }
  if (Array.isArray(match.prefixes) && match.prefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return true;
  }
  if (Array.isArray(match.suffixes) && match.suffixes.some((suffix) => relativePath.endsWith(suffix))) {
    return true;
  }
  return false;
}

export async function loadPolicyConfig(root, policyFile) {
  if (!policyFile) {
    return null;
  }
  const policyPath = path.resolve(root, policyFile);
  const raw = await fs.readFile(policyPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.policies) || !parsed.defaultPolicy) {
    throw new Error(`Invalid large-file policy config: ${policyFile}`);
  }
  return parsed;
}

async function loadBaseline(root, baselineFile) {
  if (!baselineFile) {
    return null;
  }
  const baselinePath = path.resolve(root, baselineFile);
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Baseline file not found: ${baselineFile}. Run the baseline generation command before using baseline-aware checks.`,
      );
    }
    throw error;
  }
}

export function resolvePolicy(relativePath, policyConfig) {
  if (!policyConfig) {
    return null;
  }
  for (const policy of policyConfig.policies) {
    if (matchesPolicy(relativePath, policy)) {
      return policy;
    }
  }
  return policyConfig.defaultPolicy;
}

function buildBaselineMap(baseline) {
  if (!baseline) {
    return null;
  }
  return new Map(
    baseline.entries.map((entry) => [
      entry.path,
      entry,
    ]),
  );
}

export function determineHardDebtStatus(lineCount, baselineEntry, hasBaseline) {
  if (!hasBaseline) {
    return "captured";
  }
  if (!baselineEntry) {
    return "new";
  }
  if (lineCount > baselineEntry.lines) {
    return "regressed";
  }
  if (lineCount === baselineEntry.lines) {
    return "retained";
  }
  return "reduced";
}

function classifyLegacyFile(relativePath, extension, lineCount, threshold) {
  if (lineCount <= threshold) {
    return null;
  }
  return {
    path: relativePath,
    lines: lineCount,
    type: detectType(relativePath, extension),
    priority: detectLegacyPriority(relativePath),
    policyId: "legacy-threshold",
    warnThreshold: threshold,
    failThreshold: threshold,
    severity: "fail",
    status: "oversized",
    baselineLines: null,
    delta: null,
  };
}

function classifyPolicyFile(relativePath, extension, lineCount, policyConfig, scope, baselineMap) {
  const policy = resolvePolicy(relativePath, policyConfig);
  if (!policy) {
    return null;
  }

  const warnThreshold = Number(policy.warnThreshold);
  const failThreshold = Number(policy.failThreshold);
  if (!Number.isFinite(warnThreshold) || !Number.isFinite(failThreshold)) {
    throw new Error(`Invalid thresholds in policy ${policy.id}`);
  }

  if (scope === "warn" && lineCount <= warnThreshold) {
    return null;
  }
  if (scope === "fail" && lineCount <= failThreshold) {
    return null;
  }

  const baselineEntry = baselineMap?.get(relativePath) ?? null;
  const isHardDebt = lineCount > failThreshold;
  const status = isHardDebt
    ? determineHardDebtStatus(lineCount, baselineEntry, baselineMap != null)
    : "watch";
  const baselineLines = baselineEntry?.lines ?? null;
  const delta = baselineLines == null ? null : lineCount - baselineLines;

  return {
    path: relativePath,
    lines: lineCount,
    type: detectType(relativePath, extension),
    priority: policy.priority ?? "P1",
    policyId: policy.id,
    warnThreshold,
    failThreshold,
    severity: isHardDebt ? "fail" : "warn",
    status,
    baselineLines,
    delta,
  };
}

export async function scanLargeFiles(options) {
  const policyConfig = await loadPolicyConfig(options.root, options.policyFile);
  const baseline = await loadBaseline(options.root, options.baselineFile);
  const baselineMap = buildBaselineMap(baseline);

  const allFiles = await walkDirectory(options.root);
  const sourceFiles = allFiles.filter((absolutePath) => TEXT_EXTENSIONS.has(path.extname(absolutePath)));
  const results = [];

  for (const absolutePath of sourceFiles) {
    const content = await fs.readFile(absolutePath, "utf8");
    const lineCount = countLines(content);
    const relativePath = path.relative(options.root, absolutePath).split(path.sep).join("/");
    const extension = path.extname(relativePath);
    const item = policyConfig
      ? classifyPolicyFile(relativePath, extension, lineCount, policyConfig, options.scope, baselineMap)
      : classifyLegacyFile(relativePath, extension, lineCount, options.threshold);
    if (item) {
      results.push(item);
    }
  }

  results.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

  return {
    root: options.root,
    scope: policyConfig ? options.scope : "legacy-threshold",
    threshold: policyConfig ? null : options.threshold,
    policyVersion: policyConfig?.version ?? null,
    results,
    baselineLoaded: baseline != null,
  };
}

function formatDelta(delta) {
  if (delta == null) {
    return "n/a";
  }
  if (delta > 0) {
    return `+${delta}`;
  }
  return String(delta);
}

function formatConsoleMessage(item) {
  const parts = [
    `${item.path} (${item.lines} lines`,
    item.type,
    item.policyId,
    item.priority,
  ];

  if (item.warnThreshold != null) {
    parts.push(`warn>${item.warnThreshold}`);
  }
  if (item.failThreshold != null) {
    parts.push(`fail>${item.failThreshold}`);
  }
  if (item.severity) {
    parts.push(`severity=${item.severity}`);
  }
  if (item.status) {
    parts.push(`status=${item.status}`);
  }
  if (item.baselineLines != null) {
    parts.push(`baseline=${item.baselineLines}`);
    parts.push(`delta=${formatDelta(item.delta)}`);
  }

  return `${parts.join(", ")})`;
}

function buildMarkdownReport(scan, generatedAt) {
  const title = scan.scope === "warn"
    ? "Large File Near-Threshold Watchlist"
    : scan.scope === "fail"
      ? "Large File Hard-Debt Baseline"
      : "Large File Baseline";

  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push(`- Scope: ${scan.scope}`);
  if (scan.policyVersion) {
    lines.push(`- Policy version: ${scan.policyVersion}`);
  }
  if (scan.threshold != null) {
    lines.push(`- Threshold: > ${scan.threshold} lines`);
  }
  lines.push(`- Count: ${scan.results.length}`);
  lines.push("");
  lines.push("| File | Lines | Type | Policy | Priority | Warn | Fail | Severity | Status | Baseline | Delta |");
  lines.push("|---|---:|---|---|---|---:|---:|---|---|---:|---:|");
  for (const item of scan.results) {
    lines.push(
      `| \`${item.path}\` | ${item.lines} | ${item.type} | ${item.policyId} | ${item.priority} | ${item.warnThreshold ?? ""} | ${item.failThreshold ?? ""} | ${item.severity ?? ""} | ${item.status ?? ""} | ${item.baselineLines ?? ""} | ${item.delta ?? ""} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildBaselineJson(scan, generatedAt) {
  return JSON.stringify(
    {
      generatedAt,
      scope: scan.scope,
      policyVersion: scan.policyVersion,
      entries: scan.results.map((item) => ({
        path: item.path,
        lines: item.lines,
        type: item.type,
        policyId: item.policyId,
        priority: item.priority,
        warnThreshold: item.warnThreshold,
        failThreshold: item.failThreshold,
      })),
    },
    null,
    2,
  ) + "\n";
}

async function writeOptionalOutput(root, outputPath, content) {
  const absolutePath = path.resolve(root, outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  return absolutePath;
}

function printSummary(scan, mode) {
  const scopeLabel = scan.threshold != null
    ? `threshold>${scan.threshold}`
    : `scope=${scan.scope}, policy=${scan.policyVersion ?? "unknown"}`;
  console.log(`Large file check: ${scopeLabel}, found=${scan.results.length}`);
  for (const item of scan.results) {
    const message = formatConsoleMessage(item);
    if (mode === "warn") {
      console.log(`::warning file=${item.path}::${message}`);
    } else {
      console.log(`- ${message}`);
    }
  }
}

function printRemediation(scan, mode) {
  if (mode !== "fail") {
    return;
  }
  const blockingItems = scan.results.filter((item) => item.status === "new" || item.status === "regressed");
  if (blockingItems.length === 0) {
    return;
  }
  console.log("");
  console.log("Remediation: split blocking files in the same PR or reduce them back to the recorded baseline before merge.");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const scan = await scanLargeFiles(options);
  printSummary(scan, options.mode);
  printRemediation(scan, options.mode);

  if (options.markdownOutput) {
    const generatedAt = new Date().toISOString();
    const markdown = buildMarkdownReport(scan, generatedAt);
    const markdownPath = await writeOptionalOutput(options.root, options.markdownOutput, markdown);
    console.log(`Markdown report written: ${path.relative(options.root, markdownPath)}`);
  }

  if (options.baselineOutput) {
    const generatedAt = new Date().toISOString();
    const baselineJson = buildBaselineJson(scan, generatedAt);
    const baselinePath = await writeOptionalOutput(options.root, options.baselineOutput, baselineJson);
    console.log(`Baseline JSON written: ${path.relative(options.root, baselinePath)}`);
  }

  const blockingItems = scan.results.filter((item) => item.status === "new" || item.status === "regressed");
  if (options.mode === "fail" && blockingItems.length > 0) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`large-file-check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
