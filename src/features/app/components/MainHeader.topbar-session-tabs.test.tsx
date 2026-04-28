// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MainHeader } from "./MainHeader";
import { TopbarSessionTabs } from "./TopbarSessionTabs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

const workspace = {
  id: "w1",
  name: "Workspace 1",
  path: "/tmp/w1",
  connected: true,
  settings: {
    sidebarCollapsed: false,
  },
};

function renderHeaderWithWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
  const onExtraAction = vi.fn();
  const onSelectThread = vi.fn();

  render(
    <MainHeader
      workspace={workspace}
      openTargets={[]}
      openAppIconById={{}}
      selectedOpenAppId=""
      onSelectOpenAppId={() => {}}
      branchName="main"
      branches={[{ name: "main", lastCommit: Date.now() }]}
      onCheckoutBranch={() => {}}
      onCreateBranch={() => {}}
      sessionTabsNode={
        <TopbarSessionTabs
          ariaLabel="topbar tabs"
          onSelectThread={onSelectThread}
          onCloseThread={vi.fn()}
          onShowTabMenu={vi.fn()}
          tabs={[
            {
              workspaceId: "w2",
              threadId: "t1",
              label: "Session A",
              displayLabel: "Sess...",
              engineType: "codex",
              engineLabel: "Codex",
              isActive: false,
            },
            {
              workspaceId: "w1",
              threadId: "t2",
              label: "Session B",
              displayLabel: "Sess...",
              engineType: "claude",
              engineLabel: "Claude",
              isActive: true,
            },
          ]}
        />
      }
      extraActionsNode={
        <button type="button" onClick={onExtraAction} data-testid="extra-action">
          extra action
        </button>
      }
    />,
  );

  return { onExtraAction, onSelectThread };
}

describe("MainHeader topbar session tabs integration", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([1280, 1024, 800])(
    "keeps active tab visible and actions clickable at width %d",
    (width) => {
      const { onExtraAction, onSelectThread } = renderHeaderWithWidth(width);
      expect(screen.getByRole("tab", { name: "Claude · Session B" })).toBeTruthy();
      fireEvent.click(screen.getByTestId("extra-action"));
      expect(onExtraAction).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("tab", { name: "Codex · Session A" }));
      expect(onSelectThread).toHaveBeenCalledWith("w2", "t1");
    },
  );

  it("keeps draggable blank lanes around the topbar session tabs", () => {
    renderHeaderWithWidth(1280);

    const slot = document.querySelector(".main-header-session-tabs-slot");
    expect(slot?.getAttribute("data-tauri-drag-region")).toBe("false");

    const interactive = document.querySelector(".main-header-session-tabs-interactive");
    expect(interactive?.getAttribute("data-tauri-drag-region")).toBe("false");

    const dragLane = document.querySelector(".main-header-session-tabs-drag-lane");
    expect(dragLane?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("removes hidden launch and open-app controls from the header", () => {
    render(
      <MainHeader
        workspace={workspace}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => {}}
        branchName="main"
        branches={[{ name: "main", lastCommit: Date.now() }]}
        onCheckoutBranch={() => {}}
        onCreateBranch={() => {}}
        launchScript="npm test"
        launchScriptEditorOpen={false}
        launchScriptDraft="npm test"
        launchScriptSaving={false}
        launchScriptError={null}
        onRunLaunchScript={vi.fn()}
        onOpenLaunchScriptEditor={vi.fn()}
        onCloseLaunchScriptEditor={vi.fn()}
        onLaunchScriptDraftChange={vi.fn()}
        onSaveLaunchScript={vi.fn()}
        showLaunchScriptControls={false}
        showOpenAppMenu={false}
      />,
    );

    expect(document.querySelector(".launch-script-cluster")).toBeNull();
    expect(document.querySelector(".open-app-menu")).toBeNull();
  });
});
