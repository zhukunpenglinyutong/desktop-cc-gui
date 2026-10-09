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
  compactContext: "压缩",
  compactContextTooltip: "向会话发送 /compact 以压缩精简历史上下文",
  compacting: "压缩中…",
  refreshUsage: "刷新",
  autoCompactThreshold: "自动压缩阈值",
  autoCompactEnable: "开启自动压缩",
  autoCompactDisable: "关闭自动压缩",
  autoCompactNoSession: "新建或打开一个会话后可设置；阈值按会话保存",
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
    expect(compactBtn?.textContent).toContain("压缩");
    expect(refreshBtn?.textContent).toContain("刷新");

    await act(async () => {
      compactBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      refreshBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders a percentage threshold input and an icon-only toggle", async () => {
    const onEnabledChange = vi.fn();
    const onThresholdChange = vi.fn();

    await renderCard({
      autoCompact: {
        enabled: false,
        threshold: 80,
        onEnabledChange,
        onThresholdChange,
      },
    });

    const input = container.querySelector<HTMLInputElement>("[data-testid='auto-compact-threshold']");
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid='auto-compact-toggle']");
    expect(input?.value).toBe("80");
    expect(input?.getAttribute("aria-label")).toBe("自动压缩阈值");
    expect(container.textContent).toContain("%");
    expect(toggle?.textContent).toBe("");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      input!.focus();
      input!.value = "95";
      input!.blur();
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onThresholdChange).toHaveBeenCalledWith(95);
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("clamps threshold values to one through one hundred on blur", async () => {
    const onThresholdChange = vi.fn();
    await renderCard({
      autoCompact: {
        enabled: true,
        threshold: 80,
        onEnabledChange: vi.fn(),
        onThresholdChange,
      },
    });

    const input = container.querySelector<HTMLInputElement>("[data-testid='auto-compact-threshold']")!;
    await act(async () => {
      input.focus();
      input.value = "150";
      input.blur();
    });
    expect(onThresholdChange).toHaveBeenCalledWith(100);
  });

  it("keeps an out-of-range native threshold visible and blocks enabling it", async () => {
    const onThresholdChange = vi.fn();
    await renderCard({ autoCompact: {
      enabled: false, threshold: 80, minThreshold: 50, maxThreshold: 100,
      validationHint: "Allowed: 50–100%", hint: "Applies next send",
      onEnabledChange: vi.fn(), onThresholdChange,
    } });
    const input = container.querySelector<HTMLInputElement>("[data-testid='auto-compact-threshold']")!;
    expect(input.min).toBe("50");
    expect(input.max).toBe("100");
    await act(async () => { input.focus(); input.value = "45"; input.blur(); });
    expect(input.value).toBe("45");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Allowed: 50–100%");
    expect(container.querySelector("[data-testid='auto-compact-toggle']")?.getAttribute("aria-disabled")).toBe("true");
    expect(onThresholdChange).not.toHaveBeenCalled();
    await act(async () => { input.focus(); input.value = "50"; input.blur(); });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(container.textContent).toContain("Applies next send");
    expect(onThresholdChange).toHaveBeenCalledWith(50);
  });

  it("allows disabling an enabled setting when the model window has no valid threshold", async () => {
    const onEnabledChange = vi.fn();
    await renderCard({ autoCompact: {
      enabled: true, threshold: 80, thresholdUnavailable: true,
      validationHint: "No attainable threshold", onEnabledChange, onThresholdChange: vi.fn(),
    } });
    expect(container.querySelector<HTMLInputElement>("input[data-testid='auto-compact-threshold']")?.disabled).toBe(true);
    expect(container.querySelector("[role='alert']")?.textContent).toBe("No attainable threshold");
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid='auto-compact-toggle']")!;
    expect(toggle.getAttribute("aria-disabled")).toBeNull();
    await act(async () => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });

  it("keeps the auto-compact controls visible but inert without a session", async () => {
    await renderCard({
      autoCompact: {
        enabled: false,
        threshold: 80,
        disabled: true,
        onEnabledChange: vi.fn(),
        onThresholdChange: vi.fn(),
      },
    });

    const input = container.querySelector<HTMLInputElement>("[data-testid='auto-compact-threshold']");
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid='auto-compact-toggle']");
    expect(input).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(input?.disabled).toBe(true);
    expect(toggle?.getAttribute("aria-disabled")).toBe("true");
    expect(input?.value).toBe("80");
    // The hint rides the app tooltip (react-aria), never a native title: inside
    // the context popover a native title is painted under the overlay layer.
    expect(toggle?.getAttribute("title")).toBeNull();
    expect(toggle?.getAttribute("aria-label")).toBe("开启自动压缩");

    // Keyboard focus opens the themed tooltip with the no-session hint.
    await act(async () => {
      toggle!.focus();
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
    });
    const tip = document.querySelector("[role='tooltip']");
    expect(tip?.textContent ?? "").toContain("新建或打开一个会话");
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
    expect(compactBtn?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      compactBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCompact).not.toHaveBeenCalled();

    await renderCard({ onCompact, canCompact: true, compacting: true });
    compactBtn = container.querySelector<HTMLButtonElement>("[data-testid='compact-context-btn']");
    expect(compactBtn?.getAttribute("aria-disabled")).toBe("true");
    expect(compactBtn?.textContent).toContain("压缩中…");
  });

  it("shows spinning state on refresh button when refreshing is true", async () => {
    const onRefresh = vi.fn();

    await renderCard({ onRefresh, refreshing: true });
    const refreshBtn = container.querySelector<HTMLButtonElement>("[data-testid='refresh-usage-btn']");
    expect(refreshBtn?.getAttribute("aria-disabled")).toBe("true");
    expect(refreshBtn?.textContent).toContain("刷新中…");
    expect(refreshBtn?.querySelector(".animate-refresh-spin")).not.toBeNull();
  });
});
