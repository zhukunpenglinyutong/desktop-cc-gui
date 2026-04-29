/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineType, ThreadTokenUsage } from "../../../types";
import { Composer } from "./Composer";

afterEach(() => {
  cleanup();
});

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

vi.mock("../../opencode/components/OpenCodeControlPanel", () => ({
  OpenCodeControlPanel: () => null,
}));

vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    contextUsage,
    contextDualViewEnabled,
    dualContextUsage,
    onRequestContextCompaction,
  }: {
    contextUsage?: { used: number; total: number } | null;
    contextDualViewEnabled?: boolean;
    dualContextUsage?: {
      usedTokens: number;
      contextWindow: number;
      percent: number;
      hasUsage: boolean;
      compactionState: string;
    } | null;
    onRequestContextCompaction?: () => Promise<void> | void;
  }) => (
    <div
      data-testid="chat-input-box-adapter"
      data-dual-enabled={String(contextDualViewEnabled)}
      data-legacy-used={String(contextUsage?.used ?? "")}
      data-legacy-total={String(contextUsage?.total ?? "")}
      data-dual-used={String(dualContextUsage?.usedTokens ?? "")}
      data-dual-total={String(dualContextUsage?.contextWindow ?? "")}
      data-dual-percent={String(dualContextUsage?.percent ?? "")}
      data-dual-has-usage={String(dualContextUsage?.hasUsage ?? "")}
      data-dual-state={String(dualContextUsage?.compactionState ?? "")}
    >
      <button
        type="button"
        data-testid="compact-now"
        onClick={() => {
          void onRequestContextCompaction?.();
        }}
      >
        compact
      </button>
    </div>
  ),
}));

function ComposerHarness({
  selectedEngine = "claude",
  contextUsage = null,
  contextDualViewEnabled = false,
  isProcessing = false,
  isContextCompacting = false,
  items = [],
  onRequestContextCompaction,
}: {
  selectedEngine?: EngineType;
  contextUsage?: ThreadTokenUsage | null;
  contextDualViewEnabled?: boolean;
  isProcessing?: boolean;
  isContextCompacting?: boolean;
  items?: Array<{ id: string; kind: "message"; role: "assistant" | "user"; text: string }>;
  onRequestContextCompaction?: () => Promise<void> | void;
}) {
  return (
    <Composer
      items={items}
      onSend={() => {}}
      onQueue={() => {}}
      onRequestContextCompaction={onRequestContextCompaction}
      onStop={() => {}}
      canStop={false}
      isProcessing={isProcessing}
      steerEnabled={false}
      collaborationModes={[]}
      collaborationModesEnabled={true}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      selectedEngine={selectedEngine}
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
      contextUsage={contextUsage}
      contextDualViewEnabled={contextDualViewEnabled}
      isContextCompacting={isContextCompacting}
    />
  );
}

describe("Composer dual context usage model", () => {
  it("disables dual view on non-codex engines", () => {
    render(
      <ComposerHarness
        selectedEngine="claude"
        contextDualViewEnabled={true}
      />,
    );
    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-dual-enabled")).toBe("false");
  });

  it("keeps legacy usage and computes dual usage from input+cached tokens", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        contextUsage={{
          total: {
            totalTokens: 220_000,
            inputTokens: 140_000,
            cachedInputTokens: 40_000,
            outputTokens: 40_000,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 80_000,
            inputTokens: 50_000,
            cachedInputTokens: 10_000,
            outputTokens: 20_000,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 200_000,
        }}
      />,
    );

    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-dual-enabled")).toBe("true");
    expect(adapter.getAttribute("data-legacy-used")).toBe("220000");
    expect(adapter.getAttribute("data-legacy-total")).toBe("200000");
    expect(adapter.getAttribute("data-dual-used")).toBe("60000");
    expect(adapter.getAttribute("data-dual-total")).toBe("200000");
    expect(adapter.getAttribute("data-dual-percent")).toBe("30");
    expect(adapter.getAttribute("data-dual-has-usage")).toBe("true");
    expect(adapter.getAttribute("data-dual-state")).toBe("idle");
  });

  it("does not fallback dual usage to cumulative totals when last snapshot is empty", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        contextUsage={{
          total: {
            totalTokens: 900000,
            inputTokens: 600000,
            cachedInputTokens: 100000,
            outputTokens: 200000,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258400,
        }}
      />,
    );

    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-dual-used")).toBe("0");
    expect(adapter.getAttribute("data-dual-percent")).toBe("0");
    expect(adapter.getAttribute("data-dual-has-usage")).toBe("false");
  });

  it("keeps dual usage state idle during regular processing and shows compacted marker when present", () => {
    const { rerender } = render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        isProcessing={true}
      />,
    );

    let adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-dual-state")).toBe("idle");

    rerender(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        isProcessing={false}
        items={[
          {
            id: "context-compacted-turn-1",
            kind: "message",
            role: "assistant",
            text: "Context compacted.",
          },
        ]}
      />,
    );

    adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-dual-state")).toBe("compacted");
  });

  it("keeps compacting state when context compaction event is in progress", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        isContextCompacting={true}
        items={[
          {
            id: "context-compacted-turn-1",
            kind: "message",
            role: "assistant",
            text: "Context compacted.",
          },
        ]}
      />,
    );

    const adapter = screen.getByTestId("chat-input-box-adapter");
    expect(adapter.getAttribute("data-dual-state")).toBe("compacting");
  });

  it("forwards manual compaction requests to the external handler when provided", () => {
    const onRequestContextCompaction = vi.fn();
    render(
      <ComposerHarness
        selectedEngine="codex"
        contextDualViewEnabled={true}
        onRequestContextCompaction={onRequestContextCompaction}
      />,
    );

    fireEvent.click(screen.getByTestId("compact-now"));

    expect(onRequestContextCompaction).toHaveBeenCalledTimes(1);
  });
});
