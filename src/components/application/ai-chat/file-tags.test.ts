import { describe, expect, it, vi } from "vitest";
import {
  COMPOSER_INSERTING_ATTR,
  FILE_TAG_CLASS,
  extractText,
  htmlFromText,
  insertTextAtCaret,
  mentionToken,
  renderFileTags,
} from "./file-tags";

describe("mentionToken", () => {
  it("normalizes Windows paths to the /-rooted mention form", () => {
    expect(mentionToken("S:\\AIWorker\\desktop-cc-gui/tests")).toBe(
      "@/S:/AIWorker/desktop-cc-gui/tests",
    );
    expect(mentionToken("C:\\Users\\Me\\My Docs\\proj")).toBe(
      '@"/C:/Users/Me/My Docs/proj"',
    );
  });

  it("leaves canonical absolute paths untouched", () => {
    expect(mentionToken("/Users/me/proj")).toBe("@/Users/me/proj");
    expect(mentionToken("//wsl$/Ubuntu/home/u/proj")).toBe("@//wsl$/Ubuntu/home/u/proj");
  });
});

describe("renderFileTags", () => {
  it("renders a Windows-path mention as a chip", () => {
    // Regression: `@S:\…\path` used to skip the mention grammar entirely, so
    // tree-inserted mentions stayed plain text — no chip, no round-trip.
    const el = document.createElement("div");
    el.textContent = `${mentionToken("S:\\AIWorker\\desktop-cc-gui/tests")} `;
    renderFileTags(el);
    const chip = el.querySelector(`.${FILE_TAG_CLASS}`);
    expect(chip).not.toBeNull();
    // The chip carries the canonical mention path (what gets sent), not the
    // native separator spelling.
    expect(chip?.getAttribute("data-file-path")).toBe(
      "/S:/AIWorker/desktop-cc-gui/tests",
    );
  });
});

describe("htmlFromText", () => {
  it.each(["\r\n", "\r", "\n"])("restores internal %j as one newline around file tags", (newline) => {
    const el = document.createElement("div");
    el.innerHTML = htmlFromText(`deploy${newline}@/tmp/notes.md${newline}production`);
    expect(extractText(el)).toBe("deploy\n@/tmp/notes.md\nproduction");
    expect(el.querySelector(`.${FILE_TAG_CLASS}`)?.getAttribute("data-file-path")).toBe("/tmp/notes.md");
  });
});

describe("insertTextAtCaret", () => {
  function mount(): HTMLDivElement {
    const el = document.createElement("div");
    el.contentEditable = "true";
    document.body.appendChild(el);
    return el;
  }

  function mockExecCommand(implementation: Document["execCommand"]) {
    const original = document.execCommand;
    const exec = vi.fn(implementation);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: exec,
    });
    return {
      exec,
      restore: () => {
        Object.defineProperty(document, "execCommand", {
          configurable: true,
          writable: true,
          value: original,
        });
      },
    };
  }

  it("inserts through insertHTML so a paste is its own undo step", () => {
    const el = mount();
    const command = mockExecCommand(() => true);
    try {
      insertTextAtCaret(el, "a <b>\r\n&\n");
      // Not insertText: that gets merged into the still-open typing command,
      // and one Ctrl+Z then drops the typed text together with the paste.
      expect(command.exec).toHaveBeenCalledWith("insertHTML", false, "a &lt;b&gt;<br>&amp;<br>");
      // Command succeeded — the DOM fallback must not insert a second copy.
      expect(el.textContent).toBe("");
      expect(el.hasAttribute(COMPOSER_INSERTING_ATTR)).toBe(false);
    } finally {
      command.restore();
      el.remove();
    }
  });

  it("marks the editable while the command runs so input can be ignored", () => {
    const el = mount();
    let marked = false;
    const command = mockExecCommand(() => {
      marked = el.hasAttribute(COMPOSER_INSERTING_ATTR);
      return true;
    });
    try {
      insertTextAtCaret(el, "x");
      expect(marked).toBe(true);
    } finally {
      command.restore();
      el.remove();
    }
  });

  it("falls back to a DOM insert when insertHTML is unavailable", () => {
    const el = mount();
    const command = mockExecCommand(() => false);
    try {
      insertTextAtCaret(el, "a\nb");
      expect(el.querySelector("br")).not.toBeNull();
      expect(el.textContent).toBe("ab");
    } finally {
      command.restore();
      el.remove();
    }
  });
});
