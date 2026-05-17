import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Phase 11.1.5: worktree info popup migrated to coss Popover + Tailwind.
// Old `.worktree-info-*` CSS rules removed from main.css; styling now lives
// inline in MainHeader.tsx via theme tokens. Anti-regression: ensure no one
// reintroduces the legacy hard-coded dark background fallback.

const mainCss = readFileSync(
  fileURLToPath(new URL("./main.css", import.meta.url)),
  "utf8",
);

describe("worktree info theme anti-regression", () => {
  it("does not reintroduce the hard-coded rgba(12,16,26,0.94) dark background", () => {
    expect(mainCss).not.toMatch(/rgba\(\s*12,\s*16,\s*26,\s*0\.94\s*\)/);
  });
});
