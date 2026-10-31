import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Side-effect import: initializes the i18next instance useTranslation reads.
import i18n from "@/lib/i18n";
import type { EditorViewMode } from "./editor-view-mode";
import { FileEditorHeader } from "./FileEditorHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseProps() {
  return {
    path: "/ws/index.html",
    name: "index.html",
    dirty: false,
    readOnly: false,
    canPreview: true,
    isMarkdown: false,
    isHtml: true,
    viewMode: "preview" as EditorViewMode,
    onViewModeChange: vi.fn(),
    reloadFeedback: "idle" as const,
    onReloadPreview: vi.fn(),
    saving: false,
    onSave: vi.fn(),
    searchOpen: false,
    onToggleSearch: vi.fn(),
    wordWrap: false,
    onToggleWordWrap: vi.fn(),
  };
}

describe("FileEditorHeader preview controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const byLabel = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const byText = (text: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes(text),
    ) ?? null;
  const renderHeader = (overrides: Partial<ReturnType<typeof baseProps>> = {}) => {
    const props = { ...baseProps(), ...overrides };
    act(() => root.render(<FileEditorHeader {...props} />));
    return props;
  };

  it("hides reload while the HTML file is shown as code", () => {
    renderHeader({ viewMode: "edit" });
    expect(byLabel(i18n.t("common.refresh"))).toBeNull();
    expect(byText(i18n.t("files.preview"))).not.toBeNull();
  });

  it("keeps the find bar on Markdown and reload off it", () => {
    renderHeader({ isMarkdown: true, isHtml: false, name: "README.md", path: "/ws/README.md" });
    expect(byLabel(i18n.t("files.markdown.searchToggle"))).not.toBeNull();
    expect(byLabel(i18n.t("common.refresh"))).toBeNull();
  });

  it("shows no toggle and no reload for files without a preview", () => {
    renderHeader({
      canPreview: false,
      isHtml: false,
      viewMode: "edit",
      name: "main.ts",
      path: "/ws/main.ts",
    });
    expect(byText(i18n.t("files.preview"))).toBeNull();
    expect(byText(i18n.t("files.editMode"))).toBeNull();
    expect(byLabel(i18n.t("common.refresh"))).toBeNull();
  });
});
