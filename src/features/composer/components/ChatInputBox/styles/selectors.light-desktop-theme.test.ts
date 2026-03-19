import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const selectorsCss = readFileSync(
  fileURLToPath(new URL("./selectors.css", import.meta.url)),
  "utf8",
);

describe("selector light desktop theme guards", () => {
  it("applies the same light dropdown surface style to all desktop platforms", () => {
    expect(selectorsCss).toContain(
      ':root[data-theme="light"] .app.layout-desktop .selector-dropdown',
    );
    expect(selectorsCss).not.toContain(
      ':root[data-theme="light"] .app.windows-desktop .selector-dropdown',
    );
  });

  it("keeps system-light desktop path aligned with explicit light theme", () => {
    expect(selectorsCss).toContain(
      ':root:not([data-theme]) .app.layout-desktop .selector-dropdown',
    );
    expect(selectorsCss).toContain(
      ':root:not([data-theme]) .app.layout-desktop .selector-option.disabled',
    );
  });

  it("uses the same disabled opacity baseline for light and system-light desktop selectors", () => {
    const opacityMatches = selectorsCss.match(/opacity:\s*0\.68;/g) ?? [];
    expect(opacityMatches.length).toBeGreaterThanOrEqual(2);
  });
});
