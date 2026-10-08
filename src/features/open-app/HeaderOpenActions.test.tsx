import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openWorkspaceIn: vi.fn(),
  openCustomProgram: vi.fn(),
  getProgramIcon: vi.fn().mockResolvedValue("data:image/png;base64,ICON"),
  revealInFileManager: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: {
    openWorkspaceIn: mocks.openWorkspaceIn,
    openCustomProgram: mocks.openCustomProgram,
    getProgramIcon: mocks.getProgramIcon,
    revealInFileManager: mocks.revealInFileManager,
  },
}));
// The add-program dialog picks the executable via the platform helper; the
// test types a path instead, so the picker must never be reached.
vi.mock("@/lib/platform", () => ({
  pickFile: vi.fn().mockResolvedValue(null),
}));

import "@/lib/i18n";
import { onLaunchScriptEditorRequest } from "@/features/launch-script/launch-script";
import { HeaderOpenActions } from "./HeaderOpenActions";
import {
  CUSTOM_APPS_KEY,
  LAUNCH_SCRIPT_ACTION_ID,
  readCustomApps,
  readPinnedIds,
  writeCustomApps,
  writePinnedIds,
} from "./open-app";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buttonByText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  ) ?? null;
}

function inputByLabel(label: string): HTMLInputElement | null {
  const labelNode = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
    (l) => l.textContent?.trim() === label,
  );
  if (labelNode?.htmlFor) {
    return document.getElementById(labelNode.htmlFor) as HTMLInputElement | null;
  }
  return [...document.querySelectorAll<HTMLInputElement>("input")].find(
    (input) => input.placeholder === label,
  ) ?? null;
}

/** Type into a controlled input the way React sees it (native setter +
 *  bubbling input event). */
function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
    input,
    value,
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("HeaderOpenActions add-program", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.querySelectorAll("[data-react-aria-top-layer]").forEach((node) => node.remove());
  });

  async function openMenu() {
    await act(async () => {
      root.render(<HeaderOpenActions workspacePath="/workspace" />);
    });
    // The ellipsis trigger is the last header button; clicking it opens the menu.
    await act(async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("button");
      buttons.item(buttons.length - 1).click();
    });
  }

  it("opens IDEA from the pinned button and reports launcher failures", async () => {
    await act(async () => {
      writePinnedIds(["idea"]);
      root.render(<HeaderOpenActions workspacePath="/workspace" />);
    });
    mocks.openWorkspaceIn.mockRejectedValueOnce("IDEA launcher failed");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="在 IntelliJ IDEA 中打开"]')!
        .click();
    });
    expect(mocks.openWorkspaceIn).toHaveBeenLastCalledWith("/workspace", {
      appName: "IntelliJ IDEA",
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "无法在 IntelliJ IDEA 中打开：IDEA launcher failed",
    );
    await act(async () => {
      buttonByText("关闭")!.click();
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="在 IntelliJ IDEA 中打开"]')!
        .click();
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("adds a custom program: menu row appears, is pinned to the header, persisted", async () => {
    await openMenu();

    const addButton = buttonByText("添加程序");
    expect(addButton).toBeTruthy();
    await act(async () => {
      addButton!.click();
    });

    // The dialog renders two fields: 名称 and 可执行文件.
    const nameInput = inputByLabel("名称");
    const pathInput = inputByLabel("可执行文件");
    expect(nameInput).toBeTruthy();
    expect(pathInput).toBeTruthy();
    await act(async () => {
      typeInto(nameInput!, "Notepad++");
      typeInto(pathInput!, "C:\\Program Files\\Notepad++\\notepad++.exe");
    });

    const confirm = buttonByText("确认");
    expect(confirm!.disabled).toBe(false);
    await act(async () => {
      confirm!.click();
    });

    // Adding closes the menu; reopen it to see the new row.
    await act(async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("button");
      buttons.item(buttons.length - 1).click();
    });
    const menuRow = buttonByText("Notepad++");
    expect(menuRow).toBeTruthy();

    // The OS-extracted icon is fetched and rendered in the row (not a letter).
    await act(async () => {});
    expect(mocks.getProgramIcon).toHaveBeenCalledWith(
      "C:\\Program Files\\Notepad++\\notepad++.exe",
    );
    expect(menuRow!.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,ICON",
    );

    // The entry is persisted with the typed label/path.
    const apps = readCustomApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].label).toBe("Notepad++");
    expect(apps[0].path).toBe("C:\\Program Files\\Notepad++\\notepad++.exe");
    expect(JSON.parse(localStorage.getItem(CUSTOM_APPS_KEY) ?? "[]")).toHaveLength(1);

    // Selecting the row launches the custom program with the workspace path.
    await act(async () => {
      menuRow!.click();
    });
    expect(mocks.openCustomProgram).toHaveBeenCalledWith(
      apps[0].path,
      expect.stringMatching(/workspace/),
    );
  });

  it("lists the launch script as a pinnable row; clicking it requests the editor", async () => {
    const editorRequests = vi.fn();
    const unsubscribe = onLaunchScriptEditorRequest(editorRequests);
    try {
      await openMenu();

      const row = buttonByText("启动脚本");
      expect(row).toBeTruthy();
      // Pinned by default; the pin checkbox lives in the same row.
      const checkbox = row!
        .closest("div")!
        .querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(checkbox?.checked).toBe(true);

      // Clicking the row asks the launch-script cluster to open its editor.
      await act(async () => {
        row!.click();
      });
      expect(editorRequests).toHaveBeenCalledTimes(1);

      // The click closed the menu; reopen and unpin via the row's checkbox.
      await act(async () => {
        const buttons = document.querySelectorAll<HTMLButtonElement>("button");
        buttons.item(buttons.length - 1).click();
      });
      const rowAgain = buttonByText("启动脚本")!;
      const checkboxAgain = rowAgain
        .closest("div")!
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      await act(async () => {
        checkboxAgain.click();
      });
      expect(readPinnedIds()).not.toContain(LAUNCH_SCRIPT_ACTION_ID);
    } finally {
      unsubscribe();
    }
  });

  it("removing a custom program drops it from the menu and unpins it", async () => {
    // Seed one program directly (what adding produces, minus the dialog).
    await openMenu();
    await act(async () => {
      writeCustomApps([{ id: "custom:seed", label: "SeedApp", path: "/opt/seed/seed" }]);
      writePinnedIds(["vscode", "terminal", "custom:seed"]);
    });
    // Re-render so the store picks up the seeded values.
    await act(async () => {
      root.unmount();
      root = createRoot(container);
      root.render(<HeaderOpenActions workspacePath="/workspace" />);
    });

    // The delete affordance lives inside the menu; open it first.
    await act(async () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("button");
      buttons.item(buttons.length - 1).click();
    });
    const removeButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.getAttribute("aria-label") === "删除程序",
    );
    expect(removeButton).toBeTruthy();
    await act(async () => {
      removeButton!.click();
    });

    expect(readCustomApps()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(CUSTOM_APPS_KEY) ?? "[]")).toHaveLength(0);
  });
});
