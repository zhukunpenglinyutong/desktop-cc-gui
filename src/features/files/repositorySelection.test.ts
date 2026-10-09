import { describe, expect, it } from "vitest";
import {
  isWithinDirectory,
  resolveSelectedRepository,
  resolveSelectedRoot,
  resolveWorkspaceRepository,
} from "./repositorySelection";


describe("resolveSelectedRepository", () => {
  const WS = "S:/AIWorker/ReverseProject";
  it("returns the nested repository for a selected file and falls back to the workspace", () => {
    const nested = `${WS}/Project/CialloAssist`;
    expect(
      resolveWorkspaceRepository({
        selectedPath: `${nested}/src/main.rs`,
        repositoryRoots: [nested],
        workspacePath: WS,
      }),
    ).toBe(nested);
    expect(
      resolveWorkspaceRepository({
        selectedPath: `${WS}/notes`,
        repositoryRoots: [WS],
        workspacePath: WS,
      }),
    ).toBe(WS);
  });

  it("finds the nested repo when a repo directory itself is selected", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: `${WS}/Project/CialloAssist`,
        repositoryRoots: [`${WS}/Project/CialloAssist`, `${WS}/yysls-messiah-re`],
        workspacePath: WS,
      }),
    ).toBe(`${WS}/Project/CialloAssist`);
  });

  it("finds the repo from a file deep inside it", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: `${WS}/Project/CialloAssist/src/main.rs`,
        repositoryRoots: [`${WS}/Project/CialloAssist`],
        workspacePath: WS,
      }),
    ).toBe(`${WS}/Project/CialloAssist`);
  });

  it("prefers the deepest repo when repos nest", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: `${WS}/Project/CialloAssist/tools/x.txt`,
        repositoryRoots: [`${WS}/Project`, `${WS}/Project/CialloAssist`],
        workspacePath: WS,
      }),
    ).toBe(`${WS}/Project/CialloAssist`);
  });

  it("returns null for a plain folder with no repo ancestor", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: `${WS}/temp/notes`,
        repositoryRoots: [`${WS}/Project/CialloAssist`],
        workspacePath: WS,
      }),
    ).toBeNull();
  });

  it("returns null when the deepest hit is the workspace root itself", () => {
    // The workspace-root case is what the default workspace status shows; the
    // resolver must not shadow it (that would disable the workspace chip).
    expect(
      resolveSelectedRepository({
        selectedPath: `${WS}/src/app.ts`,
        repositoryRoots: [WS],
        workspacePath: WS,
      }),
    ).toBeNull();
  });

  it("ignores stale selections from another workspace", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: "C:/other/repo/file.ts",
        repositoryRoots: ["C:/other/repo"],
        workspacePath: WS,
      }),
    ).toBeNull();
  });

  it("matches across mixed separators and drive-letter case", () => {
    // Tree paths use "/" joins; Windows picker workspace paths keep "\" and
    // an arbitrary drive case.
    expect(
      resolveSelectedRepository({
        selectedPath: `${WS}/Project/CialloAssist/README.md`,
        repositoryRoots: ["s:\\AIWorker\\ReverseProject\\Project\\CialloAssist"],
        workspacePath: "s:\\AIWorker\\ReverseProject",
      }),
    ).toBe("s:\\AIWorker\\ReverseProject\\Project\\CialloAssist");
  });
});

describe("isWithinDirectory", () => {
  it("is identity-true and prefix-true, but not sibling-true", () => {
    expect(isWithinDirectory("S:/a/repo", "S:/a/repo")).toBe(true);
    expect(isWithinDirectory("S:/a/repo", "S:/a/repo/src")).toBe(true);
    expect(isWithinDirectory("S:/a/repo", "S:/a/repo-other")).toBe(false);
    expect(isWithinDirectory("S:/a/repo/", "S:/a/repo")).toBe(true);
  });
});

describe("resolveSelectedRoot (多根)", () => {
  const PRIMARY = "S:/ws";
  const EXTRA = "S:/ws-extra";

  it("缺省 roots 时等于单根边界（主目录内命中，外部为 null）", () => {
    expect(resolveSelectedRoot({ selectedPath: `${PRIMARY}/src`, repositoryRoots: [], workspacePath: PRIMARY })).toBe(PRIMARY);
    expect(resolveSelectedRoot({ selectedPath: `${EXTRA}/src`, repositoryRoots: [], workspacePath: PRIMARY })).toBeNull();
  });

  it("多根时返回包含选择的最深根", () => {
    expect(
      resolveSelectedRoot({
        selectedPath: `${EXTRA}/src/main.ts`,
        repositoryRoots: [],
        workspacePath: PRIMARY,
        roots: [PRIMARY, EXTRA],
      }),
    ).toBe(EXTRA);
    expect(
      resolveSelectedRoot({
        selectedPath: PRIMARY,
        repositoryRoots: [],
        workspacePath: PRIMARY,
        roots: [PRIMARY, EXTRA],
      }),
    ).toBe(PRIMARY);
  });
});

describe("resolveSelectedRepository (多根)", () => {
  const PRIMARY = "S:/ws";
  const EXTRA = "S:/ws-extra";

  it("附加根内的普通文件返回 null（由该根分组自身展示，不额外指向）", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: `${EXTRA}/src/main.rs`,
        repositoryRoots: [EXTRA],
        workspacePath: PRIMARY,
        roots: [PRIMARY, EXTRA],
      }),
    ).toBeNull();
  });

  it("附加根自身被选中时返回 null（由该根分组自己展示）", () => {
    expect(
      resolveSelectedRepository({
        selectedPath: EXTRA,
        repositoryRoots: [EXTRA],
        workspacePath: PRIMARY,
        roots: [PRIMARY, EXTRA],
      }),
    ).toBeNull();
  });

  it("多根下的嵌套仓库仍解析到最深仓库", () => {
    const nested = `${EXTRA}/nested`;
    expect(
      resolveSelectedRepository({
        selectedPath: `${nested}/a.ts`,
        repositoryRoots: [nested],
        workspacePath: PRIMARY,
        roots: [PRIMARY, EXTRA],
      }),
    ).toBe(nested);
  });
});
