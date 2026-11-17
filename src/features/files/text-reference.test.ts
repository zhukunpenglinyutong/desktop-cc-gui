import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { formatTextReference, parseTextReferenceLocation } from "./text-reference";

describe("file text references", () => {
  it("quotes the exact reversed selection and excludes the next line at its start", () => {
    const state = EditorState.create({
      doc: "one\n  中文🙂\n  two\nthree",
      selection: { anchor: 17, head: 4 },
    });
    const reference = formatTextReference("src/有 空格.ts", state);
    expect(reference).toBe("./src/有 空格.ts#L2-L3\n>   中文🙂\n>   two\n> ");
    expect(parseTextReferenceLocation(reference!.split("\n")[0])).toEqual({
      path: "src/有 空格.ts", from: 2, to: 3,
    });
  });

  it("ignores empty selections and rejects invalid history locations", () => {
    const state = EditorState.create({ doc: "example" });
    expect(formatTextReference("file.ts", state)).toBeNull();
    expect(parseTextReferenceLocation("./src/../secret#L1")).toBeNull();
    expect(parseTextReferenceLocation("./file.ts#L3-L2")).toBeNull();
    expect(parseTextReferenceLocation("./file.ts#L99999999999999999")).toBeNull();
  });
});
