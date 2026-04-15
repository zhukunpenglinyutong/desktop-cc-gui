// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPromptUsageForTests,
  recordPromptUsage,
} from '../../../prompts/promptUsage';

const mockState = vi.hoisted(() => ({
  latestProps: null as Record<string, unknown> | null,
  renderCount: 0,
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
    mockState.renderCount += 1;
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
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockState.latestProps = null;
    mockState.renderCount = 0;
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
    clearPromptUsageForTests();
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
    expect(window.localStorage.getItem('ccgui.composer.streaming-enabled')).toBe('0');
  });

  it('avoids rerendering ChatInputBox when adapter props stay referentially stable', async () => {
    const stableProps: ComponentProps<typeof ChatInputBoxAdapter> = {
      text: '',
      isProcessing: false,
      canStop: false,
      selectedModelId: 'claude-sonnet-4-6',
      onSend: () => {},
      onStop: () => {},
      onTextChange: () => {},
      selectedEngine: 'claude',
    };

    const view = render(<ChatInputBoxAdapter {...stableProps} />);
    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    expect(mockState.renderCount).toBe(1);

    view.rerender(<ChatInputBoxAdapter {...stableProps} />);
    expect(mockState.renderCount).toBe(1);
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

  it('falls back to direct claude settings when active provider lacks thinking field', async () => {
    mockState.getClaudeProviders.mockResolvedValue([
      {
        id: '__local_settings_json__',
        name: 'Local settings.json',
        isActive: true,
        isLocalProvider: true,
        settingsConfig: {},
      },
    ]);
    mockState.getClaudeAlwaysThinkingEnabled.mockResolvedValue(true);

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const getLatest = () => mockState.latestProps as {
      alwaysThinkingEnabled?: boolean;
    };
    await waitFor(() => expect(getLatest().alwaysThinkingEnabled).toBe(true));
    expect(mockState.getClaudeAlwaysThinkingEnabled).toHaveBeenCalledTimes(1);
  });

  it('uses direct claude settings write when local provider is active', async () => {
    mockState.getClaudeProviders.mockResolvedValue([
      {
        id: '__local_settings_json__',
        name: 'Local settings.json',
        isActive: true,
        isLocalProvider: true,
        settingsConfig: {},
      },
    ]);

    renderAdapter();

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());
    const latest = mockState.latestProps as {
      onToggleThinking?: (enabled: boolean) => void | Promise<void>;
    };

    await act(async () => {
      await Promise.resolve(latest.onToggleThinking?.(true));
    });

    expect(mockState.setClaudeAlwaysThinkingEnabled).toHaveBeenCalledWith(true);
    expect(mockState.updateClaudeProvider).not.toHaveBeenCalled();
    expect(mockState.switchClaudeProvider).not.toHaveBeenCalled();
  });

  it('forwards send shortcut to ChatInputBox', async () => {
    renderAdapter({ sendShortcut: 'cmdEnter' });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      sendShortcut?: 'enter' | 'cmdEnter';
    };
    expect(latest.sendShortcut).toBe('cmdEnter');
  });

  it('forwards queue fusion props to ChatInputBox', async () => {
    const onFuseQueued = vi.fn();

    renderAdapter({
      queuedMessages: [
        {
          id: 'queued-1',
          text: 'queue full text',
          createdAt: 123,
        },
      ],
      onFuseQueued,
      canFuseQueuedMessages: true,
      fusingQueuedMessageId: 'queued-1',
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      messageQueue?: Array<{
        id: string;
        content: string;
        fullContent?: string;
        queuedAt: number;
        isFusing?: boolean;
      }>;
      onFuseFromQueue?: (id: string) => void;
      canFuseFromQueue?: boolean;
      fusingQueueMessageId?: string | null;
    };

    expect(latest.messageQueue).toEqual([
      {
        id: 'queued-1',
        content: 'queue full text',
        fullContent: 'queue full text',
        queuedAt: 123,
        isFusing: true,
      },
    ]);
    expect(latest.canFuseFromQueue).toBe(true);
    expect(latest.fusingQueueMessageId).toBe('queued-1');

    act(() => {
      latest.onFuseFromQueue?.('queued-1');
    });

    expect(onFuseQueued).toHaveBeenCalledWith('queued-1');
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

  it("falls back to external attachments when submit callback omits attachments", async () => {
    const onSend = vi.fn();
    renderAdapter({
      onSend,
      attachments: ["file:///tmp/fallback-image.png"],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      onSubmit?: (content: string) => void;
    };

    act(() => {
      latest.onSubmit?.("fresh child snapshot");
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [
      "file:///tmp/fallback-image.png",
    ]);
  });

  it("keeps file URI attachments unchanged for claude sends", async () => {
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
          id: "att-2",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file:///tmp/a%20b.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", ["file:///tmp/a%20b.png"]);
  });

  it("normalizes file URI attachments into host paths for gemini sends", async () => {
    const onSend = vi.fn();
    renderAdapter({ onSend, selectedEngine: "gemini" });

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
          id: "att-2b",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file:///tmp/a%20b.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", ["/tmp/a b.png"]);
  });

  it("keeps miswrapped data URL payload containing file URI for claude sends", async () => {
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
          id: "att-3",
          fileName: "image.png",
          mediaType: "image/png",
          data: "data:image/png;base64,file:///tmp/c%20d.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [
      "data:image/png;base64,file:///tmp/c%20d.png",
    ]);
  });

  it("keeps localhost file URI attachments unchanged for claude sends", async () => {
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
          id: "att-4",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file://localhost/tmp/e%20f.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", ["file://localhost/tmp/e%20f.png"]);
  });

  it("keeps UNC-like file URI host attachments unchanged for claude sends", async () => {
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
          id: "att-5",
          fileName: "image.png",
          mediaType: "image/png",
          data: "file://server/share/folder/a%20b.png",
        },
      ]);
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [
      "file://server/share/folder/a%20b.png",
    ]);
  });

  it("extracts a Windows basename when adapting external attachment paths", async () => {
    renderAdapter({
      attachments: ["C:\\Users\\demo\\Desktop\\Bug Shot.PNG"],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      attachments?: Array<{
        fileName: string;
        mediaType: string;
        data: string;
      }>;
    };

    expect(latest.attachments).toEqual([
      expect.objectContaining({
        fileName: "Bug Shot.PNG",
        mediaType: "image/png",
        data: "C:\\Users\\demo\\Desktop\\Bug Shot.PNG",
      }),
    ]);
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
    expect(mapped?.content).toBe(longMessage);
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

  it('bridges prompt completion data and settings opener', async () => {
    const onOpenPromptSettings = vi.fn();
    renderAdapter({
      prompts: [
        {
          path: '/tmp/workspace/.ccgui/prompts/review.md',
          name: 'review',
          content: '请审查这段代码',
          description: '代码评审',
          argumentHint: undefined,
          scope: 'workspace',
        },
      ],
      onOpenPromptSettings,
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          name: string;
          content: string;
          description?: string;
        }>
      >;
      onOpenPromptSettings?: () => void;
    };

    expect(typeof latest.promptCompletionProvider).toBe('function');
    expect(latest.onOpenPromptSettings).toBe(onOpenPromptSettings);

    const results = await latest.promptCompletionProvider?.('rev', new AbortController().signal);
    expect(results).toEqual([
      expect.objectContaining({
        name: 'review',
        content: '请审查这段代码',
        description: '代码评审',
        usageCount: 0,
        heatLevel: 0,
      }),
      expect.objectContaining({
        id: '__create_new__',
      }),
    ]);
  });

  it('sorts prompt completion by usage heat', async () => {
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/review.md');
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/review.md');
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/review.md');
    recordPromptUsage('/tmp/workspace/.ccgui/prompts/fix.md');

    renderAdapter({
      prompts: [
        {
          path: '/tmp/workspace/.ccgui/prompts/fix.md',
          name: 'fix',
          content: '帮我修复问题',
          description: '修复',
          argumentHint: undefined,
          scope: 'workspace',
        },
        {
          path: '/tmp/workspace/.ccgui/prompts/review.md',
          name: 'review',
          content: '请审查这段代码',
          description: '代码评审',
          argumentHint: undefined,
          scope: 'workspace',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<
        Array<{
          id: string;
          name: string;
          usageCount?: number;
          heatLevel?: number;
        }>
      >;
    };

    const results = await latest.promptCompletionProvider?.('', new AbortController().signal);
    expect(results?.[0]).toEqual(
      expect.objectContaining({
        name: 'review',
        usageCount: 3,
        heatLevel: 1,
      }),
    );
    expect(results?.[1]).toEqual(
      expect.objectContaining({
        name: 'fix',
        usageCount: 1,
        heatLevel: 1,
      }),
    );
  });

  it('matches prompt completion query against argument hint and scope metadata', async () => {
    renderAdapter({
      prompts: [
        {
          path: '/tmp/workspace/.ccgui/prompts/deploy.md',
          name: 'deploy',
          content: '帮我生成部署步骤',
          description: '部署流程',
          argumentHint: 'ticket, env',
          scope: 'global',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      promptCompletionProvider?: (
        query: string,
        signal: AbortSignal,
      ) => Promise<Array<{ name: string }>>;
    };

    const byHint = await latest.promptCompletionProvider?.('ticket', new AbortController().signal);
    expect(byHint?.[0]).toEqual(expect.objectContaining({ name: 'deploy' }));

    const byScope = await latest.promptCompletionProvider?.('global', new AbortController().signal);
    expect(byScope?.[0]).toEqual(expect.objectContaining({ name: 'deploy' }));
  });

  it('uses current engine model fallback when selected model is empty', async () => {
    renderAdapter({
      selectedEngine: 'gemini',
      selectedModelId: null,
      models: [
        {
          id: 'gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro',
          model: 'gemini-2.5-pro',
        },
        {
          id: 'gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          model: 'gemini-2.5-flash',
        },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
      models?: Array<{ id: string; label: string; description?: string }>;
    };

    expect(latest.selectedModel).toBe('gemini-2.5-pro');
    expect(latest.models).toEqual([
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'gemini-2.5-pro',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'gemini-2.5-flash',
      },
    ]);
  });

  it('does not fallback to claude model when gemini has no models yet', async () => {
    renderAdapter({
      selectedEngine: 'gemini',
      selectedModelId: null,
      models: [],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
    };

    expect(latest.selectedModel).toBe('');
  });

  it('falls back to default claude model when claude has no models yet', async () => {
    renderAdapter({
      selectedEngine: 'claude',
      selectedModelId: null,
      models: [],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      selectedModel?: string;
    };

    expect(latest.selectedModel).toBe('claude-sonnet-4-6');
  });

  it('disables gemini and opencode provider options inside shared sessions', async () => {
    renderAdapter({
      isSharedSession: true,
      engines: [
        { type: 'claude', installed: true, version: '1.0.0' },
        { type: 'codex', installed: true, version: '1.0.0' },
        { type: 'gemini', installed: true, version: '1.0.0' },
        { type: 'opencode', installed: true, version: '1.0.0' },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      providerAvailability?: Record<string, boolean>;
    };

    expect(latest.providerAvailability).toMatchObject({
      claude: true,
      codex: true,
      gemini: false,
      opencode: false,
    });
  });

  it('keeps gemini and opencode provider options enabled in native sessions', async () => {
    renderAdapter({
      isSharedSession: false,
      engines: [
        { type: 'claude', installed: true, version: '1.0.0' },
        { type: 'codex', installed: true, version: '1.0.0' },
        { type: 'gemini', installed: true, version: '1.0.0' },
        { type: 'opencode', installed: true, version: '1.0.0' },
      ],
    });

    await waitFor(() => expect(mockState.latestProps).toBeTruthy());

    const latest = mockState.latestProps as {
      providerAvailability?: Record<string, boolean>;
    };

    expect(latest.providerAvailability).toMatchObject({
      claude: true,
      codex: true,
      gemini: true,
      opencode: true,
    });
  });
});
