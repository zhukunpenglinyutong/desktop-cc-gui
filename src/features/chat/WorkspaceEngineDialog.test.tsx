import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No backend here: keep IPC from dialing the web bridge, whose retry timer
// would outlive the test environment.
vi.mock("@/lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transport")>()),
  isWeb: false,
  invoke: vi.fn(() => Promise.resolve(null)),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import i18n from "@/lib/i18n";
import { useChatStore } from "./store";
import { WorkspaceEngineDialog } from "./WorkspaceEngineDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lacks CSS.escape, which react-aria's listbox calls when a Select opens.
if (typeof window.CSS === "undefined" || typeof window.CSS.escape !== "function") {
  const css = (window.CSS ?? {}) as { escape?: (value: string) => string };
  css.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  window.CSS = css as typeof CSS;
}

const WS = "/ws";
const engine = (id: string) => ({ id, enabled: true, available: true, supportsImages: true, permissions: [] });

async function press(el: Element) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  });
}

/** The default engine is unavailable: the dialog picks one for this chat. */
describe("WorkspaceEngineDialog for an unavailable default", () => {
  let container: HTMLDivElement;
  let root: Root;
  let setWorkspaceDefaultEngine: ReturnType<typeof vi.fn>;
  let onOpened: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setWorkspaceDefaultEngine = vi.fn().mockResolvedValue(undefined);
    onOpened = vi.fn();
    useChatStore.setState({
      workspaces: [{ id: "a", path: WS, name: "ws", lastOpenedAt: null, sortOrder: 0, groupId: null }],
      workspaceDefaultEngines: { a: "codex" },
      engines: [engine("claude")],
      openTabs: [],
      active: null,
      unavailableNewChat: { workspacePath: WS, engine: "codex", onOpened },
      setWorkspaceDefaultEngine,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const request = useChatStore.getState().unavailableNewChat!;
    act(() =>
      root.render(
        <WorkspaceEngineDialog unavailable={request} onClose={() => useChatStore.getState().dismissUnavailableNewChat()} />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function pickClaude() {
    await press(document.querySelector('[role="dialog"] button[aria-haspopup="listbox"]')!);
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (el) => el.textContent?.trim() === i18n.t("settings.engines.claude"),
    );
    await press(option!);
  }

  function button(label: string): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (el) => el.textContent === label,
    )!;
  }

  async function tickMakeDefault() {
    const checkbox = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')][0]!;
    await act(async () => checkbox.click());
  }

  it("opens the chat without touching the default unless asked", async () => {
    await pickClaude();
    await press(button(i18n.t("common.confirm")));
    expect(setWorkspaceDefaultEngine).not.toHaveBeenCalled();
    expect(useChatStore.getState().active).toMatchObject({ engine: "claude", workspacePath: WS });
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it("also saves the pick as the workspace default when ticked", async () => {
    await pickClaude();
    await tickMakeDefault();
    await press(button(i18n.t("common.confirm")));
    expect(setWorkspaceDefaultEngine).toHaveBeenCalledWith("a", "claude");
    expect(useChatStore.getState().active).toMatchObject({ engine: "claude", workspacePath: WS });
  });

  it("does not open the chat when saving the default fails", async () => {
    setWorkspaceDefaultEngine.mockRejectedValue(new Error("disk full"));
    await pickClaude();
    await tickMakeDefault();
    await press(button(i18n.t("common.confirm")));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("chat.workspaceEngineSaveFailed"));
    expect(useChatStore.getState().active).toBeNull();
    expect(onOpened).not.toHaveBeenCalled();
  });
});
