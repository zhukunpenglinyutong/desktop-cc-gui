/** @vitest-environment jsdom */
import { createRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerAutocompleteState } from "./useComposerAutocompleteState";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import { noteCardsFacade } from "../../note-cards/services/noteCardsFacade";

vi.mock("../../project-memory/services/projectMemoryFacade", () => ({
  projectMemoryFacade: {
    list: vi.fn(),
  },
}));

vi.mock("../../note-cards/services/noteCardsFacade", () => ({
  noteCardsFacade: {
    list: vi.fn(),
  },
}));

function createTextareaRef() {
  const textareaRef = createRef<HTMLTextAreaElement>();
  textareaRef.current = {
    focus: vi.fn(),
    setSelectionRange: vi.fn(),
  } as unknown as HTMLTextAreaElement;
  return textareaRef;
}

describe("useComposerAutocompleteState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectMemoryFacade.list).mockResolvedValue({
      items: [],
      total: 0,
    } as never);
    vi.mocked(noteCardsFacade.list).mockResolvedValue({
      items: [],
      total: 0,
    } as never);
  });

  it("suggests a file when trigger is single @", () => {
    const files = ["src/App.tsx", "src/main.tsx"];
    const text = "Please review @src/A";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files,
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    expect(result.current.isAutocompleteOpen).toBe(true);
    expect(result.current.autocompleteMatches.map((item) => item.label)).toContain(
      "src/App.tsx",
    );
  });

  it("filters gitignored files and directories from @ suggestions", () => {
    const text = "请看 @src/";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: ["src/App.tsx", "src/generated.ts"],
        directories: ["src", "src/generated"],
        gitignoredFiles: new Set(["src/generated.ts"]),
        gitignoredDirectories: new Set(["src/generated"]),
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    expect(result.current.isAutocompleteOpen).toBe(true);
    expect(result.current.autocompleteMatches.map((item) => item.label)).toContain("src/App.tsx");
    expect(result.current.autocompleteMatches.map((item) => item.label)).not.toContain(
      "src/generated.ts",
    );
    expect(result.current.autocompleteMatches.map((item) => item.label)).not.toContain(
      "src/generated/",
    );
  });

  it("shows only top-level entries when @ query has no directory scope", () => {
    const text = "看看 @";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: ["README.md", "src/App.tsx", "src/main.tsx"],
        directories: ["src", "src/components", "docs"],
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    expect(result.current.autocompleteMatches.map((item) => item.label)).toEqual([
      "docs/",
      "src/",
      "README.md",
    ]);
  });

  it("shows only direct children inside the queried directory scope", () => {
    const text = "看看 @src/";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: [
          "src/App.tsx",
          "src/components/Button.tsx",
          "src/components/forms/Input.tsx",
          "src/config.ts",
        ],
        directories: ["src", "src/components", "src/components/forms", "src/core"],
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    expect(result.current.autocompleteMatches.map((item) => item.label)).toEqual([
      "src/components/",
      "src/core/",
      "src/App.tsx",
      "src/config.ts",
    ]);
    expect(result.current.autocompleteMatches.map((item) => item.label)).not.toContain(
      "src/components/forms/",
    );
    expect(result.current.autocompleteMatches.map((item) => item.label)).not.toContain(
      "src/components/forms/Input.tsx",
    );
  });

  it("suggests workspace memories when trigger is @@", async () => {
    vi.useFakeTimers();
    vi.mocked(projectMemoryFacade.list).mockResolvedValue({
      items: [
        {
          id: "mem-1",
          workspaceId: "ws-1",
          kind: "note",
          title: "数据库连接池参数",
          summary: "生产环境连接池参数建议",
          cleanText: "",
          tags: [],
          importance: "high",
          source: "manual",
          fingerprint: "fp-1",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 1,
    } as never);
    const text = "@@数据";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        workspaceId: "ws-1",
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(result.current.isAutocompleteOpen).toBe(true);
    expect(result.current.autocompleteMatches[0]?.label).toBe("数据库连接池参数");
    expect(projectMemoryFacade.list).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        query: "数据",
      }),
    );
    vi.useRealTimers();
  });

  it("adds selected memory via @@ and clears trigger text", async () => {
    vi.useFakeTimers();
    vi.mocked(projectMemoryFacade.list).mockResolvedValue({
      items: [
        {
          id: "mem-2",
          workspaceId: "ws-1",
          kind: "note",
          title: "发布步骤",
          summary: "发布前检查清单",
          cleanText: "",
          tags: [],
          importance: "medium",
          source: "manual",
          fingerprint: "fp-2",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 1,
    } as never);
    const setText = vi.fn();
    const setSelectionStart = vi.fn();
    const onManualMemorySelect = vi.fn();
    const text = "请参考 @@发布";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        workspaceId: "ws-1",
        onManualMemorySelect,
        textareaRef,
        setText,
        setSelectionStart,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    await act(async () => {
      const item = result.current.autocompleteMatches[0];
      if (!item) {
        throw new Error("Expected a memory suggestion for @@");
      }
      result.current.applyAutocomplete(item);
    });

    expect(onManualMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mem-2",
        title: "发布步骤",
      }),
    );
    expect(setText).toHaveBeenCalledWith("请参考 ");
    vi.useRealTimers();
  });

  it("suggests workspace note cards when trigger is @#", async () => {
    vi.useFakeTimers();
    vi.mocked(noteCardsFacade.list)
      .mockResolvedValueOnce({
        items: [
          {
            id: "note-1",
            title: "发布清单",
            plainTextExcerpt: "正文里包含部署和回滚步骤",
            updatedAt: 2,
            createdAt: 1,
            archived: false,
            imageCount: 1,
            previewAttachments: [
              {
                id: "attachment-1",
                fileName: "deploy.png",
                contentType: "image/png",
                absolutePath: "/tmp/demo/deploy.png",
              },
            ],
          },
        ],
        total: 1,
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            id: "note-2",
            title: "发布回滚清单",
            plainTextExcerpt: "这是归档发布便签",
            updatedAt: 3,
            createdAt: 1,
            archived: true,
            imageCount: 0,
          },
        ],
        total: 1,
      } as never);
    const text = "@#发布";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        workspaceId: "ws-1",
        workspaceName: "demo",
        workspacePath: "/tmp/demo",
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(result.current.isAutocompleteOpen).toBe(true);
    expect(result.current.autocompleteMatches.map((item) => item.label)).toEqual([
      "发布清单",
      "发布回滚清单",
    ]);
    expect(result.current.autocompleteMatches[0]?.noteCardPreviewAttachments).toEqual([
      {
        id: "attachment-1",
        fileName: "deploy.png",
        contentType: "image/png",
        absolutePath: "/tmp/demo/deploy.png",
      },
    ]);
    expect(noteCardsFacade.list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspaceId: "ws-1",
        workspaceName: "demo",
        workspacePath: "/tmp/demo",
        archived: false,
        query: "发布",
      }),
    );
    expect(noteCardsFacade.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspaceId: "ws-1",
        archived: true,
        query: "发布",
      }),
    );
    vi.useRealTimers();
  });

  it("supports selecting memory with Space key when @@ suggestions are open", async () => {
    vi.useFakeTimers();
    vi.mocked(projectMemoryFacade.list).mockResolvedValue({
      items: [
        {
          id: "mem-3",
          workspaceId: "ws-1",
          kind: "note",
          title: "回滚预案",
          summary: "数据库异常回滚步骤",
          detail: "先冻结写入，再切回备份快照。",
          cleanText: "",
          tags: ["db"],
          importance: "high",
          source: "manual",
          fingerprint: "fp-3",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 1,
    } as never);
    const setText = vi.fn();
    const setSelectionStart = vi.fn();
    const onManualMemorySelect = vi.fn();
    const text = "请使用 @@回滚";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        workspaceId: "ws-1",
        onManualMemorySelect,
        textareaRef,
        setText,
        setSelectionStart,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    await act(async () => {
      result.current.handleInputKeyDown({
        key: " ",
        shiftKey: false,
        preventDefault,
      } as unknown as Parameters<typeof result.current.handleInputKeyDown>[0]);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onManualMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mem-3",
        title: "回滚预案",
      }),
    );
    expect(setText).toHaveBeenCalledWith("请使用 ");
    vi.useRealTimers();
  });

  it("supports ArrowDown + Enter keyboard flow for @@ memory selection", async () => {
    vi.useFakeTimers();
    vi.mocked(projectMemoryFacade.list).mockResolvedValue({
      items: [
        {
          id: "mem-4",
          workspaceId: "ws-1",
          kind: "note",
          title: "部署步骤",
          summary: "发布前检查",
          detail: "第一条",
          cleanText: "",
          tags: [],
          importance: "medium",
          source: "manual",
          fingerprint: "fp-4",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "mem-5",
          workspaceId: "ws-1",
          kind: "note",
          title: "故障回滚",
          summary: "异常回滚策略",
          detail: "第二条",
          cleanText: "",
          tags: [],
          importance: "high",
          source: "manual",
          fingerprint: "fp-5",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 2,
    } as never);
    const setText = vi.fn();
    const onManualMemorySelect = vi.fn();
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text: "@@",
        selectionStart: 2,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        workspaceId: "ws-1",
        onManualMemorySelect,
        textareaRef,
        setText,
        setSelectionStart: vi.fn(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    await act(async () => {
      result.current.handleInputKeyDown({
        key: "ArrowDown",
        preventDefault: vi.fn(),
      } as unknown as Parameters<typeof result.current.handleInputKeyDown>[0]);
    });

    await act(async () => {
      result.current.handleInputKeyDown({
        key: "Enter",
        shiftKey: false,
        preventDefault: vi.fn(),
      } as unknown as Parameters<typeof result.current.handleInputKeyDown>[0]);
    });

    expect(onManualMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mem-5",
        title: "故障回滚",
      }),
    );
    expect(setText).toHaveBeenCalledWith("");
    vi.useRealTimers();
  });

  it("closes @@ suggestions on Escape without selecting", async () => {
    vi.useFakeTimers();
    vi.mocked(projectMemoryFacade.list).mockResolvedValue({
      items: [
        {
          id: "mem-6",
          workspaceId: "ws-1",
          kind: "note",
          title: "发布窗口",
          summary: "发布窗口约束",
          detail: "发布时间与冻结窗口说明",
          cleanText: "",
          tags: [],
          importance: "low",
          source: "manual",
          fingerprint: "fp-6",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      total: 1,
    } as never);
    const onManualMemorySelect = vi.fn();
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text: "@@发",
        selectionStart: 3,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        workspaceId: "ws-1",
        onManualMemorySelect,
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    await act(async () => {
      result.current.handleInputKeyDown({
        key: "Escape",
        preventDefault,
      } as unknown as Parameters<typeof result.current.handleInputKeyDown>[0]);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onManualMemorySelect).not.toHaveBeenCalled();
    expect(result.current.isAutocompleteOpen).toBe(false);
    vi.useRealTimers();
  });

  it("includes built-in slash commands in alphabetical order", () => {
    const text = "/";
    const selectionStart = text.length;
    const textareaRef = createTextareaRef();

    const { result } = renderHook(() =>
      useComposerAutocompleteState({
        text,
        selectionStart,
        disabled: false,
        skills: [],
        prompts: [],
        files: [],
        textareaRef,
        setText: vi.fn(),
        setSelectionStart: vi.fn(),
      }),
    );

    const labels = result.current.autocompleteMatches.map((item) => item.label);
    expect(labels.slice(0, 10)).toEqual([
      "export",
      "fork",
      "import",
      "lsp",
      "mcp",
      "new",
      "resume",
      "review",
      "share",
      "status",
    ]);
  });
});
