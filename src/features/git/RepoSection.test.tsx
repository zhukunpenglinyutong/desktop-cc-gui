import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepoSection } from "./RepoSection";
import { useGitStore } from "./store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RepoSection snapshot freshness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useGitStore.setState({
      statusByWorkspace: {
        "/ws/api": { branch: "old-main", ahead: 5, behind: 0, staged: [], unstaged: [], untracked: [] },
      },
      statusRevisionByWorkspace: { "/ws/api": 1 },
      reposByWorkspace: {
        "/ws": [{ path: "/ws/api", branch: "feature", changed: 1, untracked: 0 }],
      },
      reposRevisionByWorkspace: { "/ws": 2 },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(
      <RepoSection workspacePath="/ws" repoPath="/ws/api" defaultOpen={false}>
        <div data-testid="body">repository content</div>
      </RepoSection>,
    ));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the newer dirty discovery and opens despite an old clean status", () => {
    expect(container.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("feature");
    expect(container.textContent).toContain("M1");
    expect(container.textContent).not.toContain("old-main");
    expect(container.textContent).not.toContain("↑5");
    expect(container.querySelector('[data-testid="body"]')).not.toBeNull();
  });

  it("switches back to a newer detailed status after the repository refreshes", () => {
    act(() => useGitStore.setState({
      statusByWorkspace: {
        "/ws/api": { branch: "latest", ahead: 1, behind: 2, staged: [{ path: "a.ts", status: "M" }], unstaged: [], untracked: [] },
      },
      statusRevisionByWorkspace: { "/ws/api": 3 },
    }));
    expect(container.textContent).toContain("latest");
    expect(container.textContent).toContain("↑1 ↓2");
    expect(container.textContent).not.toContain("feature");
  });

  it("uses the current workspace's summary when a repository appears in several scans", () => {
    act(() => useGitStore.setState({
      statusByWorkspace: {},
      reposByWorkspace: {
        "/other": [{ path: "/ws/api", branch: "wrong", changed: 0, untracked: 0 }],
        "/ws": [{ path: "/ws/api", branch: "feature", changed: 1, untracked: 0 }],
      },
    }));
    expect(container.textContent).toContain("feature");
    expect(container.textContent).not.toContain("wrong");
  });
});
