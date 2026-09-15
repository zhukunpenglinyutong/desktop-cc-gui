import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentLimitsCard, type AgentLimitsCardProps } from "./agent-limits-card";

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const baseText: AgentLimitsCardProps["text"] = {
  contextWindow: "上下文窗口",
  freeSpace: "空闲",
  planUsageLimits: "套餐用量上限",
  managePlan: "管理套餐",
  compactContext: "压缩上下文",
  compactContextTooltip: "向会话发送 /compact 以压缩精简历史上下文",
  compacting: "压缩中…",
  refreshUsage: "刷新用量",
  refreshUsageTooltip: "重新获取当前会话最新上下文占用",
  refreshing: "刷新中…",
};

describe("AgentLimitsCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderCard(props: Partial<AgentLimitsCardProps> = {}) {
    await act(async () => {
      root.render(
        <AgentLimitsCard
          context={{
            max: 200_000,
            segments: [
              { label: "输入", tokens: 50_000 },
              { label: "输出", tokens: 10_000 },
            ],
          }}
          text={baseText}
          {...props}
        />,
      );
    });
  }

  it("renders compact and refresh action buttons when callbacks provided", async () => {
    const onCompact = vi.fn();
    const onRefresh = vi.fn();

    await renderCard({ onCompact, onRefresh, canCompact: true });

    const compactBtn = container.querySelector<HTMLButtonElement>("[data-testid='compact-context-btn']");
    const refreshBtn = container.querySelector<HTMLButtonElement>("[data-testid='refresh-usage-btn']");

    expect(compactBtn).not.toBeNull();
    expect(refreshBtn).not.toBeNull();
    expect(compactBtn?.textContent).toContain("压缩上下文");
    expect(refreshBtn?.textContent).toContain("刷新用量");

    await act(async () => {
      compactBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      refreshBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders a one-million-token window as 1M", async () => {
    await renderCard({ context: { max: 1_000_000, segments: [{ label: "输入", tokens: 90_000 }] } });
    expect(container.textContent).toContain("90k / 1M (9%)");
    expect(container.textContent).toContain("空闲910k91.0%");
  });

  it("disables compact button when compacting is true or canCompact is false", async () => {
    const onCompact = vi.fn();

    await renderCard({ onCompact, canCompact: false });
    let compactBtn = container.querySelector<HTMLButtonElement>("[data-testid='compact-context-btn']");
    expect(compactBtn?.disabled).toBe(true);

    await renderCard({ onCompact, canCompact: true, compacting: true });
    compactBtn = container.querySelector<HTMLButtonElement>("[data-testid='compact-context-btn']");
    expect(compactBtn?.disabled).toBe(true);
    expect(compactBtn?.textContent).toContain("压缩中…");
  });

  it("shows spinning state on refresh button when refreshing is true", async () => {
    const onRefresh = vi.fn();

    await renderCard({ onRefresh, refreshing: true });
    const refreshBtn = container.querySelector<HTMLButtonElement>("[data-testid='refresh-usage-btn']");
    expect(refreshBtn?.disabled).toBe(true);
    expect(refreshBtn?.textContent).toContain("刷新中…");
    expect(refreshBtn?.querySelector(".animate-spin")).not.toBeNull();
  });
});
