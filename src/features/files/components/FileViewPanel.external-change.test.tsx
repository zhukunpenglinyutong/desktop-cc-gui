/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileViewPanel } from "./FileViewPanel";
import { readWorkspaceFile } from "../../../services/tauri";
import { subscribeDetachedExternalFileChanges } from "../../../services/events";
import { pushErrorToast } from "../../../services/toasts";

const mockCodeMirrorDispatch = vi.fn();
let detachedExternalFileChangeListener: ((event: any) => void) | null = null;

function createDoc(text: string) {
  const lines = text.split("\n");
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  const lineFor = (lineNumber: number) => {
    const safeLine = Math.min(Math.max(lineNumber, 1), lines.length);
    const lineText = lines[safeLine - 1] ?? "";
    const from = starts[safeLine - 1] ?? 0;
    return {
      number: safeLine,
      from,
      to: from + lineText.length,
      length: lineText.length,
      text: lineText,
    };
  };
  const lineAt = (offset: number) => {
    const safeOffset = Math.min(Math.max(offset, 0), text.length);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (safeOffset >= (starts[index] ?? 0)) {
        return lineFor(index + 1);
      }
    }
    return lineFor(1);
  };
  return {
    length: text.length,
    lines: lines.length,
    line: lineFor,
    lineAt,
  };
}

vi.mock("@uiw/react-codemirror", async () => {
  const React = await import("react");
  const MockCodeMirror = React.forwardRef<
    { view: any },
    {
      value?: string;
      onChange?: (value: string) => void;
      onCreateEditor?: (view: any, state: any) => void;
      theme?: string;
    }
  >((props, ref) => {
    const viewRef = React.useRef<any>({
      state: {
        doc: createDoc(props.value ?? ""),
        selection: { main: { head: 0 } },
      },
      dispatch: mockCodeMirrorDispatch.mockImplementation((transaction: any) => {
        const anchor = transaction?.selection?.anchor;
        if (typeof anchor === "number") {
          viewRef.current.state.selection.main.head = anchor;
        }
      }),
      focus: vi.fn(),
      posAtCoords: vi.fn(() => 0),
    });

    React.useEffect(() => {
      viewRef.current.state.doc = createDoc(props.value ?? "");
    }, [props.value]);

    React.useEffect(() => {
      props.onCreateEditor?.(viewRef.current, viewRef.current.state);
    }, [props]);

    React.useImperativeHandle(ref, () => ({ view: viewRef.current }), []);

    return (
      <textarea
        data-testid="mock-codemirror"
        data-editor-theme={props.theme ?? ""}
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  });

  return {
    __esModule: true,
    default: MockCodeMirror,
  };
});

vi.mock("../../app/components/OpenAppMenu", () => ({
  OpenAppMenu: () => <div data-testid="open-app-menu" />,
}));

vi.mock("./FilePdfPreview", () => ({
  FilePdfPreview: () => <div data-testid="pdf-preview" />,
}));

vi.mock("./FileTabularPreview", () => ({
  FileTabularPreview: () => <div data-testid="tabular-preview" />,
}));

vi.mock("./FileDocumentPreview", () => ({
  FileDocumentPreview: () => <div data-testid="document-preview" />,
}));

vi.mock("../hooks/useFilePreviewPayload", () => ({
  useFilePreviewPayload: vi.fn(() => ({
    payload: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../../../components/FileIcon", () => ({
  default: () => <span data-testid="file-icon" />,
}));

vi.mock("../../../services/tauri", () => ({
  readWorkspaceFile: vi.fn(),
  readExternalSpecFile: vi.fn(),
  readExternalAbsoluteFile: vi.fn(),
  readLocalImageDataUrl: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  writeExternalSpecFile: vi.fn(),
  getGitFileFullDiff: vi.fn(),
  getCodeIntelDefinition: vi.fn(),
  getCodeIntelReferences: vi.fn(),
}));

vi.mock("../../../services/events", () => ({
  subscribeDetachedExternalFileChanges: vi.fn((onEvent: (event: any) => void) => {
    detachedExternalFileChangeListener = onEvent;
    return () => {
      detachedExternalFileChangeListener = null;
    };
  }),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => ({
      svg: `<svg data-mermaid-source="${source.replace(/"/g, "&quot;")}"></svg>`,
    })),
  },
}));

describe("FileViewPanel external change awareness in detached mode", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockCodeMirrorDispatch.mockReset();
    detachedExternalFileChangeListener = null;
  });

  it("auto-syncs clean buffer when disk content changes", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockResolvedValue({ content: "const value = 2;", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-clean"
        workspacePath="/repo"
        filePath="src/value.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    expect((editor as HTMLTextAreaElement).value).toBe("const value = 1;");

    await waitFor(() => {
      expect(screen.getByText("files.externalChangeAutoSynced")).toBeTruthy();
    });
    expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value)
      .toBe("const value = 2;");
  });

  it("continues polling after the first tick", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockResolvedValueOnce({ content: "const value = 2;", truncated: false })
      .mockResolvedValue({ content: "const value = 3;", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-poll-loop"
        workspacePath="/repo"
        filePath="src/value-loop.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    await screen.findByTestId("mock-codemirror");

    await waitFor(() => {
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value)
        .toBe("const value = 3;");
      expect(vi.mocked(readWorkspaceFile).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("keeps polling after a read error and recovers on later tick", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockRejectedValueOnce(new Error("disk temporary failure"))
      .mockResolvedValue({ content: "const value = 2;", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-poll-error-recover"
        workspacePath="/repo"
        filePath="src/value-recover.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    await waitFor(() => {
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value)
        .toBe("const value = 2;");
      expect(vi.mocked(readWorkspaceFile).mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("does not show unavailable monitor toast for missing-file polling errors", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockRejectedValue(new Error("Failed to open file: No such file or directory (os error 2)"));

    render(
      <FileViewPanel
        workspaceId="ws-ext-poll-missing"
        workspacePath="/repo"
        filePath="src/value-missing.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    await waitFor(() => {
      expect(vi.mocked(readWorkspaceFile).mock.calls.length).toBeGreaterThanOrEqual(4);
    });
    expect(vi.mocked(pushErrorToast)).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: "External file monitor is unavailable",
      }),
    );
  });

  it("does not show unavailable monitor toast for Windows path-not-found polling errors", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockRejectedValue(new Error("Failed to open file: 系统找不到指定的路径。 (os error 3)"));

    render(
      <FileViewPanel
        workspaceId="ws-ext-poll-win-path-missing"
        workspacePath="C:/repo"
        filePath="src/value-missing.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    await waitFor(() => {
      expect(vi.mocked(readWorkspaceFile).mock.calls.length).toBeGreaterThanOrEqual(4);
    });
    expect(vi.mocked(pushErrorToast)).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: "External file monitor is unavailable",
      }),
    );
  });

  it("keeps unavailable monitor toast for non-path missing os error 3 polling errors", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const value = 1;", truncated: false })
      .mockRejectedValue(new Error("Unexpected backend failure (os error 3)"));

    render(
      <FileViewPanel
        workspaceId="ws-ext-poll-os-error-3"
        workspacePath="/repo"
        filePath="src/value-error.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    await screen.findByTestId("mock-codemirror");
    await waitFor(() => {
      expect(vi.mocked(pushErrorToast)).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "External file monitor is unavailable",
          message: "Unexpected backend failure (os error 3)",
        }),
      );
    });
  });

  it("shows conflict actions for dirty buffer and can keep local edits", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "console.log('v1');", truncated: false })
      .mockResolvedValue({ content: "console.log('v2');", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-dirty"
        workspacePath="/repo"
        filePath="src/app.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    fireEvent.change(editor, { target: { value: "console.log('local');" } });

    await waitFor(() => {
      expect(screen.getByText("files.externalChangeConflictTitle")).toBeTruthy();
      expect(screen.getByText("files.externalChangeKeepLocal")).toBeTruthy();
    });
    expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value)
      .toBe("console.log('local');");

    fireEvent.click(screen.getByText("files.externalChangeKeepLocal"));
    await waitFor(() => {
      expect(screen.queryByText("files.externalChangeConflictTitle")).toBeNull();
    });
  });

  it("reloads disk content when user chooses reload action", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "line-a", truncated: false })
      .mockResolvedValue({ content: "line-b", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-reload"
        workspacePath="/repo"
        filePath="src/reload.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangePollIntervalMs={20}
      />,
    );

    const editor = await screen.findByTestId("mock-codemirror");
    fireEvent.change(editor, { target: { value: "line-local" } });

    await waitFor(() => {
      expect(screen.getByText("files.externalChangeReload")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("files.externalChangeReload"));

    await waitFor(() => {
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value).toBe("line-b");
    });
  });

  it("applies watcher-driven external change events when watcher mode is enabled", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const watcher = 1;", truncated: false })
      .mockResolvedValue({ content: "const watcher = 2;", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-watcher"
        workspacePath="/repo"
        filePath="src/watcher.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangeTransportMode="watcher"
      />,
    );

    await screen.findByTestId("mock-codemirror");
    await waitFor(() => {
      expect(vi.mocked(subscribeDetachedExternalFileChanges)).toHaveBeenCalled();
    });
    detachedExternalFileChangeListener?.({
      workspaceId: "ws-ext-watcher",
      normalizedPath: "src/watcher.ts",
      detectedAtMs: Date.now(),
      source: "watcher",
      eventKind: "modify(data)",
      platform: "macos",
    });

    await waitFor(() => {
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value)
        .toBe("const watcher = 2;");
    });
  });

  it("reconciles watcher mode on startup even without incoming events", async () => {
    vi.mocked(readWorkspaceFile)
      .mockResolvedValueOnce({ content: "const startup = 1;", truncated: false })
      .mockResolvedValue({ content: "const startup = 2;", truncated: false });

    render(
      <FileViewPanel
        workspaceId="ws-ext-watcher-startup"
        workspacePath="/repo"
        filePath="src/startup.ts"
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={vi.fn()}
        onClose={vi.fn()}
        externalChangeMonitoringEnabled
        externalChangeTransportMode="watcher"
      />,
    );

    await screen.findByTestId("mock-codemirror");
    await waitFor(() => {
      expect(vi.mocked(readWorkspaceFile).mock.calls.length).toBeGreaterThanOrEqual(2);
      expect((screen.getByTestId("mock-codemirror") as HTMLTextAreaElement).value)
        .toBe("const startup = 2;");
    });
  });
});
