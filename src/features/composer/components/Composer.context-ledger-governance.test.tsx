/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

let latestProjection: {
  visible: boolean;
  groups: Array<{
    kind: string;
    blocks: Array<{
      id: string;
      sourceRef?: string | null;
      participationState?: string;
      carryOverReason?: string | null;
    }>;
  }>;
} | null = null;
let latestComparisonBasis: string | null = null;
let contextLedgerControlVisible = true;
let forceLedgerProjectionVisible = false;

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
  invoke: vi.fn(async () => null),
}));

vi.mock("../../engine/components/EngineSelector", () => ({
  EngineSelector: () => null,
}));

vi.mock("../../client-ui-visibility/hooks/useClientUiVisibility", () => ({
  useClientUiVisibility: () => ({
    preference: { panels: {}, controls: {} },
    isPanelVisible: () => true,
    isControlVisible: (controlId: string) =>
      controlId === "curtain.contextLedger" ? contextLedgerControlVisible : true,
    isControlPreferenceVisible: () => true,
    setPanelVisible: vi.fn(),
    setControlVisible: vi.fn(),
    resetVisibility: vi.fn(),
  }),
}));

vi.mock("../../context-ledger/utils/contextLedgerProjection", async () => {
  const actual =
    await vi.importActual<typeof import("../../context-ledger/utils/contextLedgerProjection")>(
      "../../context-ledger/utils/contextLedgerProjection",
    );
  return {
    ...actual,
    buildContextLedgerProjection: (input: Parameters<typeof actual.buildContextLedgerProjection>[0]) => {
      if (!forceLedgerProjectionVisible) {
        return actual.buildContextLedgerProjection(input);
      }
      return {
        visible: true,
        totalBlockCount: 1,
        totalGroupCount: 1,
        totalUsageTokens: null,
        contextWindowTokens: null,
        groups: [
          {
            kind: "helper_selection",
            blocks: [
              {
                id: "helper-skill-doc-backup",
                kind: "helper_selection",
                title: "doc-backup",
                detail: "backup docs",
                sourceRef: "skill:doc-backup",
                sourcePath: null,
                backendSource: "global_claude",
                attributionKind: "engine_injected",
                attributionConfidence: "coarse",
                participationState: "selected",
                carryOverReason: null,
                freshness: "fresh",
                estimate: { kind: "unknown", value: null },
              },
            ],
          },
        ],
      };
    },
  };
});

vi.mock("../../opencode/components/OpenCodeControlPanel", () => ({
  OpenCodeControlPanel: () => null,
}));

vi.mock("../../context-ledger/components/ContextLedgerPanel", () => ({
  ContextLedgerPanel: ({
    projection,
    comparison,
    onTogglePinBlock,
    onExcludeBlock,
    onClearCarryOverBlock,
    onBatchKeepBlocks,
  }: {
    projection: typeof latestProjection;
    comparison?: { basis: string } | null;
    onTogglePinBlock?: (block: { id: string }) => void;
    onExcludeBlock?: (block: { id: string }) => void;
    onClearCarryOverBlock?: (block: {
      id: string;
      participationState?: string;
    }) => void;
    onBatchKeepBlocks?: (blocks: Array<{ id: string }>) => void;
  }) => {
    latestProjection = projection;
    latestComparisonBasis = comparison?.basis ?? null;
    const manualBlock = projection?.groups
      .find((group) => group.kind === "manual_memory")
      ?.blocks[0];

    return (
      <div data-testid="context-ledger-mock">
        <div data-testid="ledger-visible">{String(projection?.visible ?? false)}</div>
        <div data-testid="ledger-comparison-basis">{comparison?.basis ?? "none"}</div>
        <div data-testid="ledger-manual-count">
          {String(
            projection?.groups.find((group) => group.kind === "manual_memory")?.blocks.length ?? 0,
          )}
        </div>
        <div data-testid="ledger-manual-state">
          {manualBlock?.participationState ?? "none"}
        </div>
        <div data-testid="ledger-manual-carry-reason">
          {manualBlock?.carryOverReason ?? "none"}
        </div>
        {manualBlock && onTogglePinBlock ? (
          <button
            type="button"
            data-testid="ledger-pin-manual"
            onClick={() => onTogglePinBlock(manualBlock)}
          >
            pin
          </button>
        ) : null}
        {manualBlock && onExcludeBlock ? (
          <button
            type="button"
            data-testid="ledger-exclude-manual"
            onClick={() => onExcludeBlock(manualBlock)}
          >
            exclude
          </button>
        ) : null}
        {manualBlock && onClearCarryOverBlock ? (
          <button
            type="button"
            data-testid="ledger-clear-carried-manual"
            onClick={() => onClearCarryOverBlock(manualBlock)}
          >
            clear
          </button>
        ) : null}
        {manualBlock && onBatchKeepBlocks ? (
          <button
            type="button"
            data-testid="ledger-batch-keep-manual"
            onClick={() => onBatchKeepBlocks([manualBlock])}
          >
            batch-keep
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    onTextChange,
    onSend,
    onManualMemorySelect,
  }: {
    onTextChange: (next: string, cursor: number | null) => void;
    onSend: () => void;
    onManualMemorySelect?: (memory: {
      id: string;
      title: string;
      summary: string;
      detail: string;
      kind: string;
      importance: string;
      updatedAt: number;
      tags: string[];
    }) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="fill-text"
        onClick={() => onTextChange("hello", 5)}
      >
        fill
      </button>
      <button
        type="button"
        data-testid="select-manual-memory"
        onClick={() =>
          onManualMemorySelect?.({
            id: "memory-1",
            title: "Known issue",
            summary: "summary",
            detail: "用户输入：Question\n\n助手输出摘要：Answer",
            kind: "known_issue",
            importance: "high",
            updatedAt: 1,
            tags: [],
          })
        }
      >
        memory
      </button>
      <button type="button" data-testid="send-message" onClick={() => onSend()}>
        send
      </button>
    </div>
  ),
}));

function renderComposer(onSend = vi.fn(() => Promise.resolve())) {
  return render(
    <Composer
      onSend={onSend}
      onQueue={() => {}}
      onStop={() => {}}
      canStop={false}
      isProcessing={false}
      steerEnabled={false}
      collaborationModes={[]}
      collaborationModesEnabled={true}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      selectedEngine="claude"
      models={[]}
      selectedModelId={null}
      onSelectModel={() => {}}
      reasoningOptions={[]}
      selectedEffort={null}
      onSelectEffort={() => {}}
      reasoningSupported={false}
      accessMode="current"
      onSelectAccessMode={() => {}}
      skills={[]}
      prompts={[]}
      commands={[]}
      files={[]}
      draftText=""
      onDraftChange={() => {}}
      dictationEnabled={false}
      activeWorkspaceId="ws-1"
      activeThreadId="thread-1"
    />,
  );
}

describe("Composer context ledger governance", () => {
  afterEach(() => {
    cleanup();
    latestProjection = null;
    latestComparisonBasis = null;
    contextLedgerControlVisible = true;
    forceLedgerProjectionVisible = false;
  });

  it("keeps a pinned manual memory for exactly one additional send", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    const view = renderComposer(onSend);

    await act(async () => {
      fireEvent.click(screen.getByTestId("fill-text"));
      fireEvent.click(screen.getByTestId("select-manual-memory"));
    });

    expect(view.container.querySelector(".composer-context-stack")).toBeTruthy();
    expect(screen.getByTestId("ledger-manual-count").textContent).toBe("1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("ledger-pin-manual"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("send-message"));
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("ledger-manual-count").textContent).toBe("1");
    expect(screen.getByTestId("ledger-manual-state").textContent).toBe("carried_over");
    expect(screen.getByTestId("ledger-manual-carry-reason").textContent).toBe("inherited_from_last_send");

    await act(async () => {
      fireEvent.click(screen.getByTestId("fill-text"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("send-message"));
    });

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("ledger-manual-count").textContent).toBe("0");
    expect(screen.getByTestId("ledger-visible").textContent).toBe("true");
    expect(screen.getByTestId("ledger-comparison-basis").textContent).toBe("last_send");
    expect(latestComparisonBasis).toBe("last_send");
    expect(view.container.querySelector(".composer-context-stack")).toBeTruthy();
  });

  it("clears an inherited manual memory immediately from the current preparation state", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    renderComposer(onSend);

    await act(async () => {
      fireEvent.click(screen.getByTestId("fill-text"));
      fireEvent.click(screen.getByTestId("select-manual-memory"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("ledger-pin-manual"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("send-message"));
    });

    expect(screen.getByTestId("ledger-manual-state").textContent).toBe("carried_over");

    await act(async () => {
      fireEvent.click(screen.getByTestId("ledger-clear-carried-manual"));
    });

    expect(screen.getByTestId("ledger-manual-count").textContent).toBe("0");
    expect(screen.getByTestId("ledger-comparison-basis").textContent).toBe("last_send");
  });

  it("supports batch keep for selected governable blocks", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    renderComposer(onSend);

    await act(async () => {
      fireEvent.click(screen.getByTestId("fill-text"));
      fireEvent.click(screen.getByTestId("select-manual-memory"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("ledger-batch-keep-manual"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("send-message"));
    });

    expect(screen.getByTestId("ledger-manual-state").textContent).toBe("carried_over");
    expect(screen.getByTestId("ledger-manual-carry-reason").textContent).toBe("inherited_from_last_send");
  });

  it("excludes a manual memory from the next send immediately", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    const view = renderComposer(onSend);

    await act(async () => {
      fireEvent.click(screen.getByTestId("fill-text"));
      fireEvent.click(screen.getByTestId("select-manual-memory"));
    });

    expect(screen.getByTestId("ledger-manual-count").textContent).toBe("1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("ledger-exclude-manual"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("send-message"));
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    const firstCall = onSend.mock.calls[0] as unknown[] | undefined;
    expect(firstCall?.[2]).toBeUndefined();
    expect(screen.queryByTestId("ledger-manual-count")).toBeNull();
    expect(screen.queryByTestId("ledger-comparison-basis")).toBeNull();
    expect(view.container.querySelector(".composer-context-stack")).toBeNull();
  });

  it("does not render the context ledger card when curtain visibility disables it", async () => {
    contextLedgerControlVisible = false;
    forceLedgerProjectionVisible = true;
    const view = renderComposer();

    expect(screen.queryByTestId("context-ledger-mock")).toBeNull();
    expect(view.container.querySelector(".composer-context-stack")).toBeNull();
  });
});
