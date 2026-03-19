import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainCss = readFileSync(
  fileURLToPath(new URL("./main.css", import.meta.url)),
  "utf8",
);

describe("worktree info theme colors", () => {
  it("uses theme tokens for worktree info controls instead of hard-coded dark backgrounds", () => {
    expect(mainCss).toContain(".worktree-info-copy {");
    expect(mainCss).toContain(".worktree-info-reveal {");
    expect(mainCss).toContain(".worktree-info-input {");
    expect(mainCss).toContain(".worktree-info-confirm {");
    expect(mainCss).not.toMatch(
      /\.worktree-info-(copy|reveal|input|confirm)\s*\{[^}]*background:\s*rgba\(\s*12,\s*16,\s*26,\s*0\.94\s*\)/s,
    );
  });

  it("keeps branch/static and command surfaces on theme-driven background tokens", () => {
    expect(mainCss).toMatch(
      /\.workspace-branch-static\s*\{[^}]*background:\s*var\(--surface-card-strong\)/s,
    );
    expect(mainCss).toMatch(
      /\.worktree-info-code\s*\{[^}]*background:\s*var\(--surface-card\)/s,
    );
  });
});
