#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_SCAN_DIRS = ["src"];
const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "target", ".turbo", ".vite"]);
const ALLOWLIST_MARKER = "capability-router-allow-engine-branch";
const ENGINE_BRANCH_PATTERN =
  /\b(?:activeEngine|engine|engineType|selectedEngine)\s*(?:={2,3}|!={1,2})\s*["'](?:claude|codex|gemini|opencode)["']/g;

function normalizePathForReport(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeInputPath(inputPath) {
  return inputPath.replace(/\\/g, "/");
}

function parseArgs(argv) {
  const config = {
    root: process.cwd(),
    paths: DEFAULT_SCAN_DIRS,
    format: "json",
    hasExplicitPaths: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --root");
      }
      config.root = value;
      index += 1;
      continue;
    }
    if (token === "--path") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --path");
      }
      config.paths = config.hasExplicitPaths ? [...config.paths, value] : [value];
      config.hasExplicitPaths = true;
      index += 1;
      continue;
    }
    if (token === "--format") {
      const value = argv[index + 1];
      if (value !== "json") {
        throw new Error(`Unsupported --format value: ${value ?? "<missing>"}`);
      }
      config.format = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    root: path.resolve(config.root),
    paths: config.paths,
    format: config.format,
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectSourceFiles(root, scanPaths = DEFAULT_SCAN_DIRS) {
  const files = new Set();

  async function visit(currentPath) {
    const stat = await fs.stat(currentPath);
    if (stat.isDirectory()) {
      const dirName = path.basename(currentPath);
      if (IGNORED_DIRS.has(dirName)) {
        return;
      }
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      const sortedEntries = entries.sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
      );
      for (const entry of sortedEntries) {
        await visit(path.join(currentPath, entry.name));
      }
      return;
    }

    if (stat.isFile() && DEFAULT_EXTENSIONS.has(path.extname(currentPath).toLowerCase())) {
      files.add(currentPath);
    }
  }

  for (const scanPath of scanPaths) {
    const absolutePath = path.resolve(root, normalizeInputPath(scanPath));
    if (await pathExists(absolutePath)) {
      await visit(absolutePath);
    }
  }

  return [...files].sort((left, right) =>
    normalizePathForReport(path.relative(root, left)).localeCompare(
      normalizePathForReport(path.relative(root, right)),
      "en",
    ),
  );
}

function scanEngineNameBranchesInText(sourceText, filePath) {
  const findings = [];
  const lines = sourceText.split(/\r?\n/);

  lines.forEach((line, index) => {
    const allowed = line.includes(ALLOWLIST_MARKER);
    for (const match of line.matchAll(ENGINE_BRANCH_PATTERN)) {
      findings.push({
        path: filePath,
        line: index + 1,
        column: (match.index ?? 0) + 1,
        expression: match[0],
        allowed,
      });
    }
  });

  return findings;
}

export async function scanEngineNameBranches(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const scanPaths = options.paths ?? DEFAULT_SCAN_DIRS;
  const files = await collectSourceFiles(root, scanPaths);
  const findings = [];

  for (const filePath of files) {
    const relativePath = normalizePathForReport(path.relative(root, filePath));
    const sourceText = await fs.readFile(filePath, "utf8");
    findings.push(...scanEngineNameBranchesInText(sourceText, relativePath));
  }

  findings.sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path, "en");
    if (pathOrder !== 0) {
      return pathOrder;
    }
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    return left.column - right.column;
  });

  return {
    version: 1,
    root: ".",
    scannedFiles: files.length,
    findingCount: findings.length,
    findings,
  };
}

function printJsonReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function main() {
  try {
    const config = parseArgs(process.argv.slice(2));
    const report = await scanEngineNameBranches({
      root: config.root,
      paths: config.paths,
    });
    printJsonReport(report);
  } catch (error) {
    console.error(`[scan-engine-name-branches] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

export const scanEngineNameBranchesInternals = {
  ALLOWLIST_MARKER,
  collectSourceFiles,
  normalizePathForReport,
  parseArgs,
  scanEngineNameBranchesInText,
};
