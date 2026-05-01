import { beforeEach, describe, expect, it } from "vitest";

import { writeClientStoreData } from "../../../services/clientStorage";
import {
  isExitedSessionsHiddenForWorkspacePath,
  loadHiddenExitedSessionsByWorkspacePath,
  normalizeExitedSessionWorkspacePath,
  updateHiddenExitedSessionsByWorkspacePath,
} from "./exitedSessionVisibility";

describe("exitedSessionVisibility", () => {
  beforeEach(() => {
    writeClientStoreData("threads", {});
  });

  it("normalizes Windows paths case-insensitively", () => {
    expect(normalizeExitedSessionWorkspacePath("C:\\Users\\Demo\\Repo\\")).toBe(
      "c:/users/demo/repo",
    );
    expect(normalizeExitedSessionWorkspacePath("\\\\SERVER\\Share\\Repo\\")).toBe(
      "//server/share/repo",
    );
  });

  it("preserves macOS path casing while trimming separators", () => {
    expect(normalizeExitedSessionWorkspacePath("/Users/Demo/Repo/")).toBe(
      "/Users/Demo/Repo",
    );
  });

  it("stores hidden flags by normalized workspace path", () => {
    const initial = updateHiddenExitedSessionsByWorkspacePath(
      {},
      "C:\\Users\\Demo\\Repo",
      true,
    );

    expect(
      isExitedSessionsHiddenForWorkspacePath(initial, "c:/users/demo/repo/"),
    ).toBe(true);

    const cleared = updateHiddenExitedSessionsByWorkspacePath(
      initial,
      "c:/users/demo/repo",
      false,
    );

    expect(
      isExitedSessionsHiddenForWorkspacePath(cleared, "C:\\Users\\Demo\\Repo"),
    ).toBe(false);
  });

  it("ignores malformed persisted values", () => {
    writeClientStoreData("threads", {
      sidebarExitedSessionsHiddenByWorkspacePath: {
        "/tmp/keep": true,
        "/tmp/drop-false": false,
        "": true,
      },
    });

    expect(loadHiddenExitedSessionsByWorkspacePath()).toEqual({
      "/tmp/keep": true,
    });
  });
});
