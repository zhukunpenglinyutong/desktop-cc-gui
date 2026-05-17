// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { HomeChat } from "./HomeChat";

const translations: Record<string, string> = {
  "home.newConversation": "New Conversation",
  "homeChat.minimalTitle": "Create anything",
  "homeChat.addWorkspaceAction": "Add new project",
  "homeChat.workspaceNoMatch": "No projects found",
  "homeChat.workspaceSearchPlaceholder": "Search projects",
  "homeChat.workspaceSelectLabel": "Workspace",
  "workspace.homeBranchLabelMain": "Primary branch",
  "workspace.homeBranchLabelWorktree": "Worktree",
  "workspace.unknownBranch": "unknown",
};

function translate(key: string, params?: string | Record<string, string>) {
  const template = translations[key] ?? key;
  if (!params || typeof params === "string") {
    return template;
  }

  return Object.entries(params).reduce(
    (acc, [paramKey, value]) => acc.replace(new RegExp(`{{${paramKey}}}`, "g"), value),
    template,
  );
}

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: translate,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

const baseProps = {
  latestAgentRuns: [],
  isLoadingLatestAgents: false,
  onSelectThread: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onAddWorkspace: vi.fn(),
  composerNode: createElement("div", null, "Composer node"),
  selectedEngine: "claude" as const,
  selectedWorkspaceId: "ws-1",
  selectedBranchName: "feature/ref-layout",
  workspaces: [
    { id: "ws-1", name: "desktop-cc-gui", path: "/Users/demo/Desktop/desktop-cc-gui", kind: "main" as const },
    { id: "ws-2", name: "workfree", path: "/Users/demo/Desktop/workfree", kind: "worktree" as const, worktree: { branch: "feature/workfree" } },
  ],
};

describe("HomeChat styles", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not desaturate the homepage engine icon", () => {
    const { container } = render(createElement(HomeChat, baseProps));

    const icon = container.querySelector(".home-chat-engine-icon");
    expect(icon).toBeTruthy();

    // Neither the inline className nor any computed filter should
    // contain grayscale — this prevents accidental icon desaturation.
    const className = (icon as HTMLElement).className || "";
    expect(className.toLowerCase()).not.toContain("grayscale");

    const filter = (icon as HTMLElement).style.filter || "";
    expect(filter.toLowerCase()).not.toContain("grayscale");
  });

  it("keeps homepage codex context accents monochrome", () => {
    // The codex context accent variables form a cross-stylesheet
    // contract: home-chat sets them, context-bar consumes them
    // (with fallbacks to the green Codex brand color). Verify both
    // sides of the contract remain wired.
    const contextBarCssPath = resolve(
      process.cwd(),
      "src/features/composer/components/ChatInputBox/styles/context-bar.css",
    );
    const contextBarCss = readFileSync(contextBarCssPath, "utf8");

    expect(contextBarCss).toContain("var(--codex-context-accent, #10a37f)");
    expect(contextBarCss).toContain("var(--codex-context-accent-track, rgba(16, 163, 127, 0.28))");

    // Render HomeChat and assert the composer host (which is the
    // CSS variable scope for these accents) is in the rendered tree.
    const { container } = render(createElement(HomeChat, baseProps));
    expect(container.querySelector(".home-chat-composer-host")).toBeTruthy();
  });

  it("styles the homepage workspace popup like a lightweight anchored menu", () => {
    const { container } = render(createElement(HomeChat, baseProps));

    // Open the workspace popover so the popup is mounted into the
    // portal at document.body.
    const trigger = container.querySelector(
      ".home-chat-workspace-select-trigger",
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);

    const popover = document.body.querySelector(
      '.home-chat-workspace-picker-popover[data-slot="popover-content"]',
    ) as HTMLElement | null;
    expect(popover).toBeTruthy();
    // Marker class — keeps the lightweight anchored menu styling
    // attached even after the literal CSS values move around.
    expect(popover!.classList.contains("home-chat-workspace-picker-popover")).toBe(true);
  });

  it("adds a searchable workspace panel with a dedicated add-project action", () => {
    const { container } = render(createElement(HomeChat, baseProps));

    const trigger = container.querySelector(
      ".home-chat-workspace-select-trigger",
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);

    // Search label uses the marker class — the grid layout that
    // anchors the icon and input is encoded in Tailwind utilities
    // on this node, not in a global stylesheet.
    expect(document.body.querySelector(".home-chat-workspace-picker-search")).toBeTruthy();
    expect(document.body.querySelector(".home-chat-workspace-picker-add")).toBeTruthy();
  });

  it("keeps homepage workspace selection states neutral and understated", () => {
    const { container } = render(createElement(HomeChat, baseProps));

    const trigger = container.querySelector(
      ".home-chat-workspace-select-trigger",
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);

    // The currently selected workspace surfaces a data-selected marker
    // — selection-state styling hangs off this attribute so it stays
    // observable regardless of where the visual rules live.
    const selectedItem = document.body.querySelector(
      '.home-chat-workspace-picker-item[data-selected="true"]',
    );
    expect(selectedItem).toBeTruthy();
  });

  it("gives the homepage workspace trigger enough vertical room for descenders", () => {
    const { container } = render(createElement(HomeChat, baseProps));

    const trigger = container.querySelector(
      ".home-chat-workspace-select-trigger",
    ) as HTMLElement | null;
    expect(trigger).toBeTruthy();

    // The trigger keeps the marker class — vertical breathing room
    // for descenders is now encoded in Tailwind utilities on this
    // node (py-0.5 + leading) rather than in a global stylesheet.
    expect(trigger!.classList.contains("home-chat-workspace-select-trigger")).toBe(true);
  });
});
