import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileRow, DirectoryRow, STATUS_COLOR, FILE_NAME_COLOR } from "./GitTreeRow";
import type { GitFileEntry } from "@/lib/ipc";
import type { GitTreeDirNode } from "./git-tree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@/components/base/tooltip/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("react-aria-components", () => ({
  Focusable: ({ children }: any) => <>{children}</>,
  Checkbox: ({ isSelected, onChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!isSelected}
      onChange={(e) => onChange?.(e.target.checked)}
      aria-label={props["aria-label"]}
    />
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GitTreeRow styling and icons matching IntelliJ IDEA", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("exports STATUS_COLOR and FILE_NAME_COLOR mappings", () => {
    expect(STATUS_COLOR.M).toContain("text-[#0088D2]");
    expect(FILE_NAME_COLOR.M).toContain("text-[#0088D2]");
    expect(STATUS_COLOR.A).toContain("text-[#208A3C]");
    expect(FILE_NAME_COLOR.D).toContain("line-through");
  });

  it("renders modified file with IDEA blue color and file type icon", () => {
    const entry: GitFileEntry = {
      path: "src/main.ts",
      status: "M",
    };
    act(() => {
      root.render(
        <FileRow
          entry={entry}
          actionLabel="Stage"
          actionKind="stage"
          onAction={() => {}}
          onOpen={() => {}}
          actionBusy={false}
        />
      );
    });

    // Letter badge has blue color
    const badge = container.querySelector(".font-mono.text-xs.font-semibold") as HTMLElement;
    expect(badge.textContent).toBe("M");
    expect(badge.className).toContain("text-[#0088D2]");

    // Filename button has blue color
    const fileNameSpan = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "main.ts"
    );
    expect(fileNameSpan).toBeDefined();
    expect(fileNameSpan?.className).toContain("text-[#0088D2]");

    // SVG icon exists for TypeScript
    expect(container.innerHTML).toContain("TS");
  });

  it("renders added file with IDEA green color and Java icon", () => {
    const entry: GitFileEntry = {
      path: "src/App.java",
      status: "A",
    };
    act(() => {
      root.render(
        <FileRow
          entry={entry}
          actionLabel="Unstage"
          actionKind="unstage"
          onAction={() => {}}
          onOpen={() => {}}
          actionBusy={false}
        />
      );
    });

    const badge = container.querySelector(".font-mono.text-xs.font-semibold") as HTMLElement;
    expect(badge.textContent).toBe("A");
    expect(badge.className).toContain("text-[#208A3C]");

    const fileNameSpan = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "App.java"
    );
    expect(fileNameSpan).toBeDefined();
    expect(fileNameSpan?.className).toContain("text-[#208A3C]");

    // Java icon present
    expect(container.querySelector("svg")).toBeDefined();
  });

  it("renders deleted file with IDEA gray color and strikethrough", () => {
    const entry: GitFileEntry = {
      path: "src/old-module.py",
      status: "D",
    };
    act(() => {
      root.render(
        <FileRow
          entry={entry}
          actionLabel="Stage"
          actionKind="stage"
          onAction={() => {}}
          onOpen={() => {}}
          actionBusy={false}
        />
      );
    });

    const fileNameSpan = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "old-module.py"
    );
    expect(fileNameSpan).toBeDefined();
    expect(fileNameSpan?.className).toContain("line-through");
    expect(fileNameSpan?.className).toContain("text-text-tertiary");
  });

  it("renders untracked file with IDEA red color and Rust icon", () => {
    const entry: GitFileEntry = {
      path: "src/new-feature.rs",
      status: "??",
    };
    act(() => {
      root.render(
        <FileRow
          entry={entry}
          actionLabel="Stage"
          actionKind="stage"
          onAction={() => {}}
          onOpen={() => {}}
          actionBusy={false}
          isNew
        />
      );
    });

    const badge = container.querySelector(".font-mono.text-xs.font-semibold") as HTMLElement;
    expect(badge.textContent).toBe("?");
    expect(badge.className).toContain("text-[#B00020]");

    const fileNameSpan = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "new-feature.rs"
    );
    expect(fileNameSpan).toBeDefined();
    expect(fileNameSpan?.className).toContain("text-[#B00020]");

    // Rust icon present
    expect(container.innerHTML).toContain("RS");
  });

  it("renders directory row with warm amber folder icon and toggle", () => {
    const dirNode: GitTreeDirNode = {
      id: "src/features",
      name: "features",
      path: "src/features",
      type: "dir",
      depth: 1,
      children: [],
      allPaths: ["src/features/a.ts", "src/features/b.ts"],
    };

    act(() => {
      root.render(
        <DirectoryRow
          node={dirNode}
          isOpen={false}
          onToggleOpen={() => {}}
          selectedState="none"
          onToggleSelect={() => {}}
          actionLabel="Stage"
          actionKind="stage"
          onAction={() => {}}
          actionBusy={false}
        />
      );
    });

    expect(container.textContent).toContain("features");
    expect(container.textContent).toContain("(2)");

    // Amber color on folder
    const folderSpan = container.querySelector(".text-amber-500\\/80");
    expect(folderSpan).toBeDefined();
  });
});
