import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("update release configuration", () => {
  it("points the updater endpoint at the desktop-cc-gui release feed", () => {
    const config = JSON.parse(readWorkspaceFile("src-tauri/tauri.conf.json")) as {
      plugins?: { updater?: { endpoints?: string[] } };
    };

    expect(config.plugins?.updater?.endpoints).toContain(
      "https://github.com/zhukunpenglinyutong/desktop-cc-gui/releases/latest/download/latest.json",
    );
  });

  it("generates latest.json asset URLs from the desktop-cc-gui repo", () => {
    const workflow = readWorkspaceFile(".github/workflows/release.yml");

    expect(workflow).toContain("zhukunpenglinyutong/desktop-cc-gui/releases/download");
    expect(workflow).not.toContain("zhukunpenglinyutong/ccgui/releases/download");
  });
});
