import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { readStoredNumber, writeStored } from "@/lib/storage";
import { newId } from "@/lib/id";
import { clearTerminalSessionState } from "./sessions";

const HEIGHT_KEY = "ccgui-next.terminalHeight";
export const TERMINAL_MIN_HEIGHT = 120;
export const TERMINAL_MAX_HEIGHT = 600;
export const TERMINAL_DEFAULT_HEIGHT = 240;

export interface TerminalTab {
  /** Globally unique; doubles as the backend PTY session key. */
  id: string;
  /** 工作区多目录：该标签的根（主目录或附加根），决定 shell 的 cwd。单根时
   *  恒等于工作区主目录，行为与旧的按工作区键控完全一致。 */
  root: string;
}

interface TerminalState {
  open: boolean;
  height: number;
  /**
   * Tabs keyed by the **workspace path** (dock scope: which workspace's tabs
   * the dock shows). 工作区多目录：单个 workspace 可含多个根，标签自身携带根
   * `TerminalTab.root`，因而同一工作区内可按根开多个 shell。
   */
  tabsByWorkspace: Record<string, TerminalTab[]>;
  activeByWorkspace: Record<string, string>;
  toggle: (workspacePath: string) => void;
  closePanel: () => void;
  /** 新建标签；`root` 缺省 = 主目录（首个根）。 */
  newTab: (workspacePath: string, root?: string) => void;
  selectTab: (workspacePath: string, id: string) => void;
  closeTab: (workspacePath: string, id: string) => void;
  removeWorkspace: (workspacePath: string) => void;
  setHeight: (height: number) => void;
}

/** Kill the backend session and drop its frontend buffer. */
function destroySession(id: string): void {
  clearTerminalSessionState(id);
  void ipc.terminalClose(id).catch(() => {});
}

function clampHeight(height: number): number {
  return Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, height));
}
// Drags call setHeight per animation frame; the localStorage write waits for
// the drag to settle so storage isn't touched 60+ times per second.
let heightWriteTimer: number | undefined;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  open: false,
  height: clampHeight(readStoredNumber(HEIGHT_KEY, TERMINAL_DEFAULT_HEIGHT)),
  tabsByWorkspace: {},
  activeByWorkspace: {},

  toggle: (workspacePath) => {
    const { open } = get();
    if (open) {
      set({ open: false });
      return;
    }
    // Opening with no tabs in this workspace creates the first shell.
    if (!(get().tabsByWorkspace[workspacePath]?.length)) {
      get().newTab(workspacePath);
    }
    set({ open: true });
  },

  closePanel: () => {
    set({ open: false });
  },

  newTab: (workspacePath, root = workspacePath) => {
    const id = newId();
    set((s) => ({
      tabsByWorkspace: {
        ...s.tabsByWorkspace,
        [workspacePath]: [
          ...(s.tabsByWorkspace[workspacePath] ?? []),
          { id, root: root || workspacePath },
        ],
      },
      activeByWorkspace: { ...s.activeByWorkspace, [workspacePath]: id },
    }));
  },

  selectTab: (workspacePath, id) =>
    set((s) => ({
      activeByWorkspace: { ...s.activeByWorkspace, [workspacePath]: id },
    })),

  closeTab: (workspacePath, id) => {
    destroySession(id);
    set((s) => {
      const tabs = (s.tabsByWorkspace[workspacePath] ?? []).filter((tab) => tab.id !== id);
      const nextActive =
        s.activeByWorkspace[workspacePath] === id
          ? (tabs[tabs.length - 1]?.id ?? "")
          : s.activeByWorkspace[workspacePath];
      return {
        tabsByWorkspace: { ...s.tabsByWorkspace, [workspacePath]: tabs },
        activeByWorkspace: { ...s.activeByWorkspace, [workspacePath]: nextActive },
        // Closing the last tab closes the panel; sessions stay per workspace.
        open: tabs.length > 0 ? s.open : false,
      };
    });
  },

  removeWorkspace: (workspacePath) => {
    for (const tab of get().tabsByWorkspace[workspacePath] ?? []) {
      destroySession(tab.id);
    }
    set((s) => {
      const tabsByWorkspace = { ...s.tabsByWorkspace };
      const activeByWorkspace = { ...s.activeByWorkspace };
      delete tabsByWorkspace[workspacePath];
      delete activeByWorkspace[workspacePath];
      return { tabsByWorkspace, activeByWorkspace };
    });
  },

  setHeight: (height) => {
    const next = clampHeight(height);
    set({ height: next });
    clearTimeout(heightWriteTimer);
    heightWriteTimer = window.setTimeout(() => {
      heightWriteTimer = undefined;
      writeStored(HEIGHT_KEY, next);
    }, 300);
  },
}));
