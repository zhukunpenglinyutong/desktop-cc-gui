import { describe, expect, it } from "vitest";
import {
  canOpenInBrowser,
  canPreviewFile,
  isHtmlFile,
  isMarkdownFile,
  opensInPreview,
} from "./editor-view-mode";

describe("editor view mode", () => {
  it("opens Markdown in preview on every platform", () => {
    expect(opensInPreview("README.md")).toBe(true);
    expect(canPreviewFile("README.md", true)).toBe(true);
    expect(canPreviewFile("README.md", false)).toBe(true);
    expect(isMarkdownFile("notes.markdown")).toBe(true);
  });

  it("opens HTML in the code view; rendering is an explicit preview click", () => {
    // A rendered page runs the file's own scripts — never on open.
    for (const name of ["index.html", "index.htm", "index.xhtml", "INDEX.HTML"]) {
      expect(opensInPreview(name)).toBe(false);
      expect(canPreviewFile(name, true)).toBe(true);
    }
    // Web-access mode: the /file route cannot keep relative draft.css working.
    expect(canPreviewFile("index.html", false)).toBe(false);
    expect(isHtmlFile("index.html")).toBe(true);
  });

  it("leaves other files in the code view", () => {
    for (const name of ["styles.css", "main.tsx", "data.json", "Makefile", "index"]) {
      expect(opensInPreview(name)).toBe(false);
      expect(canPreviewFile(name, true)).toBe(false);
    }
  });

  it("does not treat lookalike extensions as previewable", () => {
    for (const name of ["index.htmlish", "index.html.bak", "report.html.txt", "notes.md.bak"]) {
      expect(canPreviewFile(name, true)).toBe(false);
    }
  });

  it("matches extensions case-insensitively", () => {
    expect(canPreviewFile("INDEX.HTML", true)).toBe(true);
    expect(opensInPreview("README.MD")).toBe(true);
  });

  it("offers open-in-browser for HTML on desktop only", () => {
    expect(canOpenInBrowser("docs/pr-flow-design.html", true)).toBe(true);
    expect(canOpenInBrowser("/abs/INDEX.HTM", true)).toBe(true);
    expect(canOpenInBrowser("docs/pr-flow-design.html", false)).toBe(false);
    for (const name of ["README.md", "index.html.bak", "docs"]) {
      expect(canOpenInBrowser(name, true)).toBe(false);
    }
  });
});
