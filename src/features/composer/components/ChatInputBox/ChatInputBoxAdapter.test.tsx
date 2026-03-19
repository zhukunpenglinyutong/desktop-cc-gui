// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  latestProps: null as Record<string, unknown> | null,
  getClaudeProviders: vi.fn(),
  getClaudeAlwaysThinkingEnabled: vi.fn(),
  setClaudeAlwaysThinkingEnabled: vi.fn(),
  updateClaudeProvider: vi.fn(),
  switchClaudeProvider: vi.fn(),
  projectMemoryList: vi.fn(),
}));

vi.mock('./ChatInputBox', async () => {
  const React = await import('react');
  const MockChatInputBox = React.forwardRef((props: Record<string, unknown>, ref) => {
    mockState.latestProps = props;
    React.useImperativeHandle(ref, () => ({
      getValue: () => '',
      setValue: () => {},
      focus: () => {},
      clear: () => {},
      hasContent: () => false,
      getFileTags: () => [],
    }));
    return <div data-testid="mock-chat-input-box" />;
  });
  MockChatInputBox.displayName = 'MockChatInputBox';
  return { ChatInputBox: MockChatInputBox };
});

vi.mock('../../../../services/tauri', () => ({
  getClaudeProviders: mockState.getClaudeProviders,
  getClaudeAlwaysThinkingEnabled: mockState.getClaudeAlwaysThinkingEnabled,
  setClaudeAlwaysThinkingEnabled: mockState.setClaudeAlwaysThinkingEnabled,
  updateClaudeProvider: mockState.updateClaudeProvider,
  switchClaudeProvider: mockState.switchClaudeProvider,
}));

vi.mock('../../../project-memory/services/projectMemoryFacade', () => ({
  projectMemoryFacade: {
    list: mockState.projectMemoryList,
  },
}));

import { ChatInputBoxAdapter } from './ChatInputBoxAdapter';

function renderAdapter(
  overrides: Partial<ComponentProps<typeof ChatInputBoxAdapter>> = {},
) {
  return render(
    <ChatInputBoxAdapter
      text=""
      isProcessing={false}
      canStop={false}
      selectedModelId="claude-sonnet-4-6"
      onSend={() => {}}
      onStop={() => {}}
      onTextChange={() => {}}
      selectedEngine="claude"
      {...overrides}
    />,
  );
}

describe('ChatInputBoxAdapter toggle bridge', () => {
  beforeEach(() => {
    mockState.latestProps = null;
    mockState.getClaudeProviders.mockReset().mockResolvedValue([
      {
        id: 'provider-1',
        name: 'Claude',
        isActive: true,
        settingsConfig: { alwaysThinkingEnabled: false },
      },
    ]);
    mockState.getClaudeAlwaysThinkingEnabled.mockReset().mockResolvedValue(false);
    mockState.setClaudeAlwaysThinkingEnabled.mockReset().mockResolvedValue(undefined);
    mockState.updateClaudeProvider.mockReset().mockResolvedValue(undefined);
    mockState.switchClaudeProvider.mockReset().mockResolvedValue(undefined);
    mockState.projectMemoryList.mockReset().mockResolvedValue({ items: [], total: 0 });
    window.localStorage.clear();
  });

  it('provides internal thinking and streaming handlers by default', async () => {
    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
      streamingEnabled?: boolean;
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
      onStreamingEnabledChange?: (enabled: boolean) => void;
    };

    await waitFor(() => expect(latest.alwaysThinkingEnabled).toBe(false));
    expect(latest.streamingEnabled).toBe(true);
    expect(typeof latest.onToggleThinking).toBe('function');
    expect(typeof latest.onStreamingEnabledChange).toBe('function');

    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(true));
    });

    expect(mockState.updateClaudeProvider).toHaveBeenCalledTimes(1);
    expect(mockState.switchClaudeProvider).toHaveBeenCalledWith('provider-1');
    expect(mockState.updateClaudeProvider).toHaveBeenCalledWith(
      'provider-1',
      expect.objectContaining({
        settingsConfig: expect.objectContaining({
          alwaysThinkingEnabled: true,
        }),
      }),
    );

    act(() => {
      latest.onStreamingEnabledChange?.(false);
    });
    expect(window.localStorage.getItem('mossx.composer.streaming-enabled')).toBe('0');
  });

  it('uses external thinking callback when supplied', async () => {
    const onToggleThinking = vi.fn();
    renderAdapter({
      alwaysThinkingEnabled: true,
      onToggleThinking,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };
    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(false));
    });

    expect(onToggleThinking).toHaveBeenCalledWith(false);
    expect(mockState.updateClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
  });

  it('falls back to direct claude settings when no active provider exists', async () => {
    mockState.getClaudeProviders.mockResolvedValue([]);
    mockState.getClaudeAlwaysThinkingEnabled.mockResolvedValue(true);

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const getLatest = () => mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };

    await waitFor(() => expect(getLatest().alwaysThinkingEnabled).toBe(true));

    await act(async () => {
      await Promise.resolve(getLatest().onToggleThinking?.(false));
    });

    expect(mockState.updateClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.setClaudeAlwaysThinkingEnabled).toHaveBeenCalledWith(false);
  });

  it('forwards send shortcut to ChatInputBox', async () => {
    renderAdapter({ sendShortcut: 'cmdEnter' });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      sendShortcut?: 'enter' | 'cmdEnter';
    };
    expect(latest.sendShortcut).toBe('cmdEnter');
  });

  it('forwards input text changes without runtime errors', async () => {
    const onTextChange = vi.fn();
    renderAdapter({ onTextChange });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onInput?: (content: string) => void;
    };
    expect(typeof latest.onInput).toBe('function');

    expect(() => {
      latest.onInput?.('hello');
    }).not.toThrow();
    expect(onTextChange).toHaveBeenCalledWith('hello', null);
  });

  it("forwards submitted content snapshot to parent send handler", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (content: string) => void;
    };
    expect(typeof latest.onSubmit).toBe("function");

    act(() => {
      latest.onSubmit?.("fresh child snapshot");
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", undefined);
  });

  it("converts submitted attachments into image inputs for parent send handler", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (
        content: string,
        attachments?: Array<{
          id: string;
          fileName: string;
          mediaType: string;
          data: string;
        }>,
      ) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot", [
        {
          id: "att-1",
          fileName: "image.png",
          mediaType: "image/png",
          data: "ZmFrZS1pbWFnZQ==",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith(
      "fresh child snapshot",
      ["data:image/png;base64,ZmFrZS1pbWFnZQ=="],
    );
  });

  it('forwards dual context usage model and flag to ChatInputBox', async () => {
    renderAdapter({
      contextUsage: { used: 120_000, total: 256_000 },
      contextDualViewEnabled: true,
      dualContextUsage: {
        usedTokens: 80_000,
        contextWindow: 256_000,
        percent: 31.25,
        hasUsage: true,
        compactionState: 'idle',
      },
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      contextDualViewEnabled?: boolean;
      dualContextUsage?: {
        usedTokens: number;
        contextWindow: number;
        percent: number;
        hasUsage: boolean;
        compactionState: string;
      } | null;
      usageUsedTokens?: number;
      usageMaxTokens?: number;
    };

    expect(latest.contextDualViewEnabled).toBe(true);
    expect(latest.dualContextUsage).toMatchObject({
      usedTokens: 80_000,
      contextWindow: 256_000,
      percent: 31.25,
      hasUsage: true,
      compactionState: 'idle',
    });
    expect(latest.usageUsedTokens).toBe(120_000);
    expect(latest.usageMaxTokens).toBe(256_000);
  });

  it('maps queued messages to preview content while preserving full text metadata', async () => {
    const longMessage = '队列消息'.repeat(60);
    renderAdapter({
      queuedMessages: [
        {
          id: 'queue-1',
          text: longMessage,
          createdAt: 1_700_000_000_000,
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      messageQueue?: Array<{
        id: string;
        content: string;
        fullContent?: string;
        queuedAt: number;
      }>;
    };

    const mapped = latest.messageQueue?.[0];
    expect(mapped?.id).toBe('queue-1');
    expect(mapped?.queuedAt).toBe(1_700_000_000_000);
    expect(mapped?.content.length).toBeLessThan(longMessage.length);
    expect(mapped?.content.endsWith('…')).toBe(true);
    expect(mapped?.fullContent).toBe(longMessage);
  });

  it('forwards manual context compaction callback to ChatInputBox', async () => {
    const onRequestContextCompaction = vi.fn();
    renderAdapter({
      selectedEngine: 'codex',
      contextDualViewEnabled: true,
      onRequestContextCompaction,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onRequestContextCompaction?: () => Promise<void> | void;
    };
    expect(latest.onRequestContextCompaction).toBe(onRequestContextCompaction);
  });

  it('bridges @@ manual memory provider and selection callback', async () => {
    const onManualMemorySelect = vi.fn();
    mockState.projectMemoryList.mockResolvedValue({
      items: [
        {
          id: 'm-1',
          title: '发布步骤',
          summary: '先构建再发布',
          detail: '用户输入：发布\n助手输出摘要：先构建再发布',
          cleanText: '发布 clean text',
          kind: 'conversation',
          importance: 'high',
          tags: ['release'],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_100,
        },
      ],
      total: 1,
    });

    renderAdapter({
      workspaceId: 'ws-1',
      onManualMemorySelect,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      manualMemoryCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          title: string;
          summary: string;
          detail: string;
          kind: string;
          importance: string;
          tags: string[];
          updatedAt: number;
        }>
      >;
      onSelectManualMemory?: (memory: {
        id: string;
        title: string;
      }) => void;
    };

    expect(typeof latest.manualMemoryCompletionProvider).toBe('function');
    const signal = new AbortController().signal;
    const results = await latest.manualMemoryCompletionProvider?.('发布', signal);
    expect(mockState.projectMemoryList).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        query: '发布',
      }),
    );
    expect(results?.[0]).toEqual(
      expect.objectContaining({
        id: 'm-1',
        title: '发布步骤',
        summary: '先构建再发布',
        kind: 'conversation',
        importance: 'high',
      }),
    );

    latest.onSelectManualMemory?.({
      id: 'm-1',
      title: '发布步骤',
    });
    expect(onManualMemorySelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'm-1',
        title: '发布步骤',
      }),
    );
  });
});
