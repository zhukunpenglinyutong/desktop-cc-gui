import { act, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Side-effect import: initializes the i18next instance useTranslation reads.
import i18n from "@/lib/i18n";
import { FindOnlyPanel, type FindOnlyPanelProps } from "./find-only-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function baseProps(): FindOnlyPanelProps {
  const inputRef: MutableRefObject<HTMLInputElement | null> = { current: null };
  return {
    inputRef,
    placeholder: i18n.t("files.editorSearch.find"),
    query: "needle",
    onQueryChange: vi.fn(),
    caseSensitive: false,
    onCaseSensitiveChange: vi.fn(),
    wholeWord: false,
    onWholeWordChange: vi.fn(),
    useRegex: false,
    onUseRegexChange: vi.fn(),
    current: 2,
    total: 3,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("FindOnlyPanel", () => {
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

  const renderPanel = (overrides: Partial<FindOnlyPanelProps> = {}) => {
    const props = { ...baseProps(), ...overrides };
    act(() => root.render(<FindOnlyPanel {...props} />));
    return props;
  };

  const byLabel = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const input = () =>
    container.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.t("files.editorSearch.find")}"]`,
    )!;

  it("shows the new find row and no replace controls", () => {
    renderPanel();
    expect(input()).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("2/3");
    expect(byLabel(i18n.t("files.editorSearch.nextMatch"))).not.toBeNull();
    expect(byLabel(i18n.t("files.editorSearch.previousMatch"))).not.toBeNull();
    // Read-only preview: there is nothing to replace.
    expect(
      container.querySelector(`input[placeholder="${i18n.t("files.editorSearch.replace")}"]`),
    ).toBeNull();
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent === i18n.t("files.editorSearch.replace"),
      ),
    ).toBe(false);
  });

  it("toggles case, whole word and regexp on the find row", () => {
    const props = renderPanel();
    act(() => byLabel(i18n.t("files.editorSearch.caseSensitive"))!.click());
    act(() => byLabel(i18n.t("files.editorSearch.wholeWord"))!.click());
    act(() => byLabel(i18n.t("files.editorSearch.regex"))!.click());
    expect(props.onCaseSensitiveChange).toHaveBeenCalledWith(true);
    expect(props.onWholeWordChange).toHaveBeenCalledWith(true);
    expect(props.onUseRegexChange).toHaveBeenCalledWith(true);
    expect(byLabel(i18n.t("files.editorSearch.caseSensitive"))!.getAttribute("aria-pressed")).toBe("false");
  });

  it("steps with Enter / Shift+Enter and closes on Escape", () => {
    const props = renderPanel();
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(props.onNext).toHaveBeenCalledTimes(1);
    act(() =>
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows no-results when the query has no matches", () => {
    renderPanel({ current: 0, total: 0 });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      i18n.t("files.editorSearch.noResults"),
    );
    expect(byLabel(i18n.t("files.editorSearch.nextMatch"))!.disabled).toBe(true);
  });
});
