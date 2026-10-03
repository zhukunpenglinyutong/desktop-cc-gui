import { vi } from "vitest";

const { storage } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => storage.set(key, String(val)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
  if (typeof globalThis.CSS === "undefined") {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s,
    };
  } else if (!globalThis.CSS.escape) {
    globalThis.CSS.escape = (s: string) => s;
  }
  return { storage };
});

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const webAccessStatus = vi.fn();
const webAccessStart = vi.fn();
const webAccessStop = vi.fn();
const webAccessRotateToken = vi.fn();
const getAppSettings = vi.fn();
const updateAppSettings = vi.fn();

vi.mock("@/lib/ipc", () => ({
  ipc: {
    webAccessStatus: () => webAccessStatus(),
    webAccessStart: () => webAccessStart(),
    webAccessStop: () => webAccessStop(),
    webAccessRotateToken: () => webAccessRotateToken(),
    getAppSettings: () => getAppSettings(),
    updateAppSettings: (settings: unknown) => updateAppSettings(settings),
  },
}));

vi.mock("@/lib/platform", () => ({
  isWeb: false,
}));

import "@/lib/i18n";
import { WebAccessSection } from "./WebAccessSection";
import {
  WEB_ACCESS_AUTO_START_KEY,
  WEB_ACCESS_SELECTED_IP_KEY,
} from "./web-access-keys";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  storage.clear();
  webAccessStatus.mockReset().mockResolvedValue(null);
  webAccessStart.mockReset();
  webAccessStop.mockReset().mockResolvedValue(undefined);
  getAppSettings.mockReset().mockResolvedValue({ webAccessAutoStart: false });
  updateAppSettings.mockReset().mockResolvedValue(undefined);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<WebAccessSection />);
  });
}

describe("WebAccessSection", () => {
  it("renders stopped state and auto-start toggle when not running", async () => {
    await render();

    expect(container.textContent).toContain("已停止");
    expect(container.textContent).toContain("启动 Web 访问");
    expect(container.textContent).toContain("随应用自动开启");

    const autoStartSwitch = container.querySelector<HTMLInputElement>(
      `input[role="switch"]`,
    );
    expect(autoStartSwitch).toBeTruthy();
    expect(autoStartSwitch?.checked).toBe(false);
  });

  it("toggles auto-start and persists to storage and app settings", async () => {
    await render();

    const autoStartSwitch = container.querySelector<HTMLInputElement>(
      `input[role="switch"]`,
    );
    expect(autoStartSwitch).toBeTruthy();

    await act(async () => {
      autoStartSwitch?.click();
    });

    expect(storage.get(WEB_ACCESS_AUTO_START_KEY)).toBe("1");
    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ webAccessAutoStart: true }),
    );
  });

  it("renders IP selector and updates display URL when running with multiple IPs", async () => {
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [
        { ip: "192.168.1.100", label: "192.168.1.100 (Wi-Fi)" },
        { ip: "100.88.99.11", label: "100.88.99.11 (Tailscale)" },
        { ip: "127.0.0.1", label: "127.0.0.1 (Localhost)" },
      ],
    });

    await render();

    expect(container.textContent).toContain("运行中");
    expect(container.textContent).toContain("停止");
    expect(container.textContent).toContain("访问 IP / 网卡");
    expect(container.textContent).toContain("http://192.168.1.100:7316/?token=mock-token");

    const selectTrigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(selectTrigger).toBeTruthy();
  });

  it("changes display URL when selecting a different IP from the dropdown", async () => {
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [
        { ip: "192.168.1.100", label: "192.168.1.100 (Wi-Fi)" },
        { ip: "100.88.99.11", label: "100.88.99.11 (Tailscale)" },
      ],
    });

    await render();

    const trigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    const options = Array.from(document.querySelectorAll("[role='option']"));
    const tailscaleOption = options.find((opt) => opt.textContent?.includes("Tailscale"));
    expect(tailscaleOption).toBeTruthy();

    await act(async () => {
      tailscaleOption?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain("http://100.88.99.11:7316/?token=mock-token");
    expect(storage.get(WEB_ACCESS_SELECTED_IP_KEY)).toBe("100.88.99.11");
  });

  it("remembers previously selected IP from localStorage", async () => {
    storage.set(WEB_ACCESS_SELECTED_IP_KEY, "100.88.99.11");

    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [
        { ip: "192.168.1.100", label: "192.168.1.100 (Wi-Fi)" },
        { ip: "100.88.99.11", label: "100.88.99.11 (Tailscale)" },
      ],
    });

    await render();

    expect(container.textContent).toContain("http://100.88.99.11:7316/?token=mock-token");
  });

  it("stops running when clicking the stop button", async () => {
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [{ ip: "192.168.1.100", label: "192.168.1.100" }],
    });

    await render();

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "停止",
    );
    expect(stopButton).toBeTruthy();

    await act(async () => {
      stopButton?.click();
    });

    expect(webAccessStop).toHaveBeenCalled();
    expect(container.textContent).toContain("已停止");
  });

  it("renders port and token inputs and updates settings on change", async () => {
    getAppSettings.mockResolvedValue({
      webAccessAutoStart: false,
      webAccessPort: 14200,
      webAccessToken: "test-token-12345",
    });

    await render();

    expect(container.textContent).toContain("服务端口");
    expect(container.textContent).toContain("访问凭证 (Token)");

    const portInput = container.querySelector<HTMLInputElement>(
      `input[aria-label="服务端口"]`,
    );
    expect(portInput?.value).toBe("14200");

    const tokenInput = container.querySelector<HTMLInputElement>(
      `input[aria-label="访问凭证 (Token)"]`,
    );
    expect(tokenInput?.value).toBe("test-token-12345");
  });

  it("allows rotating token and shows restart notice when running", async () => {
    webAccessRotateToken.mockResolvedValue("new-token-67890");
    webAccessStatus.mockResolvedValue({
      url: "http://192.168.1.100:7316/?token=mock-token",
      port: 7316,
      token: "mock-token",
      lanIp: "192.168.1.100",
      availableIps: [{ ip: "192.168.1.100", label: "192.168.1.100" }],
    });

    await render();

    const rotateBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("重新生成"),
    );
    expect(rotateBtn).toBeTruthy();

    await act(async () => {
      rotateBtn?.click();
    });

    expect(webAccessRotateToken).toHaveBeenCalled();
    expect(container.textContent).toContain("配置已保存，需重启服务以应用新端口或凭证");
    expect(container.textContent).toContain("立即重启服务");
  });
});
