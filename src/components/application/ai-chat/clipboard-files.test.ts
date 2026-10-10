import { describe, expect, it } from "vitest";
import {
  filePathsFromUriList,
  fileUrlToPath,
  readClipboardFiles,
} from "./clipboard-files";

function fakeClipboardData(options: {
  items?: { kind: string; type: string; file?: File }[];
  text?: string;
  uriList?: string;
}) {
  const items = (options.items ?? []).map((item) => ({
    kind: item.kind,
    type: item.type,
    getAsFile: () => item.file ?? null,
  }));
  return {
    items,
    getData: (type: string) =>
      type === "text/plain"
        ? (options.text ?? "")
        : type === "text/uri-list"
          ? (options.uriList ?? "")
          : "",
  } as unknown as DataTransfer;
}

describe("filePathsFromUriList", () => {
  it("解码 POSIX 文件 URL，跳过注释与空行", () => {
    expect(
      filePathsFromUriList(
        [
          "# copied files",
          "",
          "file:///Users/me/notes%20with%20space.md",
          "https://example.com/link",
          "file://localhost/Users/me/pic.png",
        ].join("\r\n"),
      ),
    ).toEqual(["/Users/me/notes with space.md", "/Users/me/pic.png"]);
  });

  it("Windows 盘符去掉 URL 根斜杠", () => {
    expect(filePathsFromUriList("file:///C:/Users/me/a.txt")).toEqual([
      "C:/Users/me/a.txt",
    ]);
  });

  it("网络共享主机不属于本机，交给原生剪贴板读取", () => {
    expect(filePathsFromUriList("file://server/share/a.txt")).toEqual([]);
  });
});

describe("fileUrlToPath", () => {
  it("非 file scheme 与坏转义都返回 null", () => {
    expect(fileUrlToPath("https://example.com/a")).toBeNull();
    expect(fileUrlToPath("file:///tmp/bad%2")).toBeNull();
    expect(fileUrlToPath("file://")).toBeNull();
  });
});

describe("readClipboardFiles", () => {
  it("按图片 / 其他文件分流并读取 uri-list", () => {
    const png = new File(["x"], "shot.png", { type: "image/png" });
    const md = new File(["x"], "notes.md", { type: "" });
    const payload = readClipboardFiles(
      fakeClipboardData({
        items: [
          { kind: "file", type: "image/png", file: png },
          { kind: "file", type: "", file: md },
          { kind: "string", type: "text/plain" },
        ],
        text: "notes",
        uriList: "file:///tmp/notes.md",
      }),
    );
    expect(payload.imageFiles).toEqual([png]);
    expect(payload.otherFiles).toEqual([md]);
    expect(payload.uriPaths).toEqual(["/tmp/notes.md"]);
  });

  it("空剪贴板没有文件", () => {
    expect(readClipboardFiles(null)).toEqual({
      imageFiles: [],
      otherFiles: [],
      uriPaths: [],
    });
  });
});
