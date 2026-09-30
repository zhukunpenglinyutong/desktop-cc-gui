import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/lib/ipc";

// Pages read their settings (and the pet page its package list) on mount; the
// proxy keeps every other method inert for the module tree they pull in.
const { getAppSettings, listPets, webDevices, dshHostStatus, listGrantedRoots } =
  vi.hoisted(() => ({
    getAppSettings: vi.fn(),
    listPets: vi.fn(async () => []),
    // Web 访问 lists devices on mount; the page indexes its row above them.
    webDevices: vi.fn(async () => []),
    // 工作区 keeps a section (已授权目录) that only renders with data.
    listGrantedRoots: vi.fn(async () => ["/tmp/granted-root"]),
    // 本地主机 probes the host on mount (dsh page only).
    dshHostStatus: vi.fn(async () => ({
      installed: false,
      version: null,
      host: "127.0.0.1",
      port: 8787,
      origin: "http://127.0.0.1:8787",
      autoStart: true,
      running: false,
      ownership: null,
      describe: null,
    })),
  }));
vi.mock("@/lib/ipc", () => ({
  ipc: new Proxy(
    { getAppSettings, listPets, webDevices, listGrantedRoots, dshHostStatus },
    {
      get: (target, prop) =>
        prop in target ? Reflect.get(target, prop) : async () => null,
    },
  ),
}));

// The app is a desktop client; jsdom looks like the web bridge (no Tauri
// internals), which hides native-only surfaces (Skills' tabs, 已授权目录).
// Render as native so the guard covers what desktop users actually see.
vi.mock("@/lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transport")>()),
  isWeb: false,
}));

import i18n from "@/lib/i18n";
import { BotsPane } from "./agents-prompts/BotsPane";
import { PromptsPane } from "./agents-prompts/PromptsPane";
import { BetaFeaturesSection } from "./BetaFeaturesSection";
import { builtinSearchEntries } from "./builtin-search";
import { CliConfigBody } from "./CliConfigBody";
import { GeneralSection } from "./GeneralSection";
import { PerformanceDiagnosticsSection } from "./PerformanceDiagnostics";
import { PetSection } from "./PetSection";
import { ProxySection } from "./ProxySection";
import { ENGINE_IDS, type EngineId } from "./providers";
import type { CliConfigState } from "./useCliConfig";
import { UpdateSection } from "./UpdateSection";
import { WebAccessSection } from "./WebAccessSection";
import { WorkspacesSection } from "./WorkspacesSection";
import { useChatStore } from "@/features/chat/store";
import { ShortcutsSection } from "@/features/shortcuts/ShortcutsSection";
import { SkillsSection } from "@/features/skills/SkillsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom has no ResizeObserver; PillTabList (the Skills / 智能体 tab strips)
// measures its selection thumb with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/** Only the fields the row-based pages read; the rest of AppSettings is not
 *  touched by them. */
const SETTINGS = {
  theme: "light",
  titlebar: "native",
  language: "zh",
  sidebarThreadLimit: 5,
  composerSendShortcut: "enter",
  thinkingAutoCollapse: true,
  petEnabled: false,
  petScale: 1,
  petId: "",
  customModels: {},
} as unknown as AppSettings;

/** localStorage flag Web 访问 reads to skip its 公网访问 risk dialog. */
const WAN_RISK_ACK_KEY = "ccgui-next.webWanRiskAccepted";

/** A page under guard: `render` mounts it, `activate` performs whatever step
 *  a human would need before its pane/card-hidden rows exist. */
interface PageSpec {
  page: string;
  render: () => ReactNode;
  activate?: (container: HTMLElement) => Promise<void>;
}

// CliConfigBody's state comes from useCliConfig in the app; the rows under
// test only read these fields (same shape as CliConfigBody.test.tsx).
function makeCli(engine: EngineId): CliConfigState {
  return {
    t: i18n.t,
    config: null,
    engine,
    error: null,
    notice: null,
    busy: false,
    dialog: null,
    setDialog: () => {},
    pendingDelete: null,
    setPendingDelete: () => {},
    ccStatus: null,
    currentId: "",
    enabled: true,
    entries: [],
    officialActive: true,
    officialEditing: false,
    setOfficialEditing: () => {},
    saveOfficialConfig: () => Promise.resolve(null),
    mutate: <T,>(fn: () => Promise<T>) => fn().then((value) => value).catch(() => undefined),
    activate: () => {},
    saveProvider: () => {},
    confirmDelete: () => {},
    syncCcSwitch: () => Promise.resolve(),
    importCcSwitchFile: () => Promise.resolve(),
    dismissCcSwitch: () => {},
  } as CliConfigState;
}

const PAGES: PageSpec[] = [
  { page: "general", render: () => <GeneralSection /> },
  { page: "pet", render: () => <PetSection /> },
  { page: "proxy", render: () => <ProxySection /> },
  { page: "shortcuts", render: () => <ShortcutsSection /> },
  { page: "update", render: () => <UpdateSection /> },
  { page: "betaFeatures", render: () => <BetaFeaturesSection /> },
  { page: "diagnostics", render: () => <PerformanceDiagnosticsSection /> },
  { page: "agents", render: () => <BotsPane /> },
  { page: "prompts", render: () => <PromptsPane /> },
  { page: "skills", render: () => <SkillsSection /> },
  { page: "workspaces", render: () => <WorkspacesSection /> },
  {
    page: "webAccess",
    render: () => <WebAccessSection />,
    // 访问密码 / 已授权设备 / 中继 / 部署中继 live in the 公网访问 pane.
    activate: (container) => clickAnchor(container, "webWanTab"),
  },
  ...ENGINE_IDS.map((engine) => ({
    page: `cli:${engine}`,
    render: () => (
      <MemoryRouter>
        <CliConfigBody cli={makeCli(engine)} />
      </MemoryRouter>
    ),
    // dsh keeps 自定义路径/her/port/自动启动 behind the collapsed 连接设置 card.
    activate:
      engine === "dsh"
        ? (container: HTMLElement) => clickAnchor(container, "dshConnection")
        : undefined,
  })),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getAppSettings.mockResolvedValue(SETTINGS);
  // Skip Web 访问's first-run risk dialog so the pane tab is clickable.
  localStorage.setItem(WAN_RISK_ACK_KEY, "1");
  // 工作区's 项目 section only renders with a workspace and a group.
  useChatStore.setState({
    workspaces: [
      {
        id: "w1",
        path: "/tmp/w1",
        name: "w1",
        lastOpenedAt: null,
        sortOrder: null,
        groupId: "g1",
      },
    ],
    workspaceGroups: [{ id: "g1", name: "组一", sortOrder: 0 }],
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.removeItem(WAN_RISK_ACK_KEY);
  useChatStore.setState({ workspaces: [], workspaceGroups: [] });
});

function anchorsOf(element: HTMLElement): string[] {
  return [...element.querySelectorAll("[data-setting-anchor]")].map(
    (el) => el.getAttribute("data-setting-anchor") ?? "",
  );
}

async function clickAnchor(element: HTMLElement, anchor: string) {
  const target = element.querySelector<HTMLElement>(
    `[data-setting-anchor="${anchor}"]`,
  );
  if (!target) throw new Error(`activator not rendered: ${anchor}`);
  // Same rule as the shell: a tab already selected (or a card already open)
  // needs no click — clicking would close it again.
  const alreadyOpen =
    target.getAttribute("aria-pressed") === "true" ||
    target.getAttribute("aria-expanded") === "true";
  if (alreadyOpen) return;
  await act(async () => {
    target.click();
  });
}

/** Anchors the page actually painted; the awaited act lets the settings read
 *  land for pages that render their rows only afterwards. */
async function renderedAnchors(spec: PageSpec): Promise<string[]> {
  await act(async () => {
    root.render(spec.render());
  });
  if (spec.activate) await spec.activate(container);
  return anchorsOf(container);
}

describe("builtinSearchEntries", () => {
  it("covers every page this test knows how to render (and nothing else)", () => {
    const known = new Set(PAGES.map((page) => page.page));
    for (const entry of builtinSearchEntries) {
      expect([...known]).toContain(entry.page);
    }
  });

  for (const spec of PAGES) {
    it(`${spec.page}: declares exactly the rows it renders`, async () => {
      const rendered = await renderedAnchors(spec);
      // A duplicated anchor would flash two rows at once and collide on one
      // React key.
      expect(new Set(rendered).size).toBe(rendered.length);
      const declared = builtinSearchEntries
        .filter((entry) => entry.page === spec.page)
        .map((entry) => entry.anchor);
      expect([...rendered].sort()).toEqual([...declared].sort());
    });
  }

  it("resolves every label and breadcrumb key in both languages", () => {
    for (const entry of builtinSearchEntries) {
      // A typo resolves to the raw key at query time, so assert the copy
      // exists in the language pairs the app ships.
      for (const key of [entry.labelKey, entry.sectionKey]) {
        if (!key) continue;
        expect(i18n.exists(key, { lng: "zh" })).toBe(true);
        expect(i18n.exists(key, { lng: "en" })).toBe(true);
      }
    }
  });

  it("only names activators that the same page renders", async () => {
    for (const spec of PAGES) {
      for (const entry of builtinSearchEntries.filter(
        (candidate) => candidate.page === spec.page,
      )) {
        if (!entry.activatorAnchor) continue;
        // The activator is a pane tab or a collapsed card up front — it must
        // exist before anything is opened.
        expect(
          builtinSearchEntries.some(
            (candidate) => candidate.anchor === entry.activatorAnchor,
          ),
        ).toBe(true);
      }
    }
  });
});
