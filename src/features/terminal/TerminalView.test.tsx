import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TerminalView drives xterm through a small public surface; the heavy
 * environment (xterm modules, FitAddon, ResizeObserver, IPC, FontFaceSet) is
 * mocked so the test asserts the wiring: what font/size reach xterm, when the
 * PTY cols/rows sync, and that late async work is dropped after unmount.
 *
 *  Settings implementations stay real so their events and storage wiring are tested.
 */

const ipcMocks = vi.hoisted(() => ({
  terminalOpen: vi.fn(async () => {}),
  terminalWrite: vi.fn(async () => {}),
  terminalResize: vi.fn(async () => {}),
  revealInFileManager: vi.fn(async () => {}),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: {
    terminalOpen: ipcMocks.terminalOpen,
    terminalWrite: ipcMocks.terminalWrite,
    terminalResize: ipcMocks.terminalResize,
    revealInFileManager: ipcMocks.revealInFileManager,
  },
}));

// The global terminal output listener opens a Tauri event; not under test here.
vi.mock("@/lib/events", () => ({
  listenTerminalOutput: vi.fn(async () => () => {}),
}));

const xtermMocks = vi.hoisted(() => {
  const instances: FakeTerminal[] = [];
  const fits: FakeFitAddon[] = [];

  class FakeTerminal {
    cols = 80;
    rows = 24;
    writes: string[] = [];
    openedWith: Element | null = null;
    disposed = false;
    /** fontFamily values that actually changed (OptionsService ignores same-value sets). */
    fontFamilySets: string[] = [];
    /** fontSize values that actually changed. */
    fontSizeSets: number[] = [];
    options: Record<string, unknown>;
    private family: string;
    private size: number;

    constructor(options: { fontFamily: string; fontSize: number; theme: unknown }) {
      this.family = options.fontFamily;
      this.size = options.fontSize;
      const self = this;
      this.options = {
        theme: options.theme,
        get fontFamily() {
          return self.family;
        },
        set fontFamily(value: string) {
          if (self.family === value) return; // same-value no-op, like xterm
          self.family = value;
          self.fontFamilySets.push(value);
        },
        get fontSize() {
          return self.size;
        },
        set fontSize(value: number) {
          if (self.size === value) return;
          self.size = value;
          self.fontSizeSets.push(value);
        },
      };
      instances.push(this);
    }

    loadAddon() {}
    open(el: Element) {
      this.openedWith = el;
    }
    write(data: string) {
      this.writes.push(data);
    }
    registerLinkProvider() {
      return { dispose() {} };
    }
    onData() {
      return { dispose() {} };
    }
    getSelection() {
      return "";
    }
    dispose() {
      this.disposed = true;
    }
  }

  class FakeFitAddon {
    fit = vi.fn();
    dispose() {}
    constructor() {
      fits.push(this);
    }
  }

  class FakeWebglAddon {
    onContextLoss() {}
    dispose() {}
  }

  return { instances, fits, FakeTerminal, FakeFitAddon, FakeWebglAddon };
});

vi.mock("./xterm-loader", () => ({
  loadXterm: async () => ({
    Terminal: xtermMocks.FakeTerminal,
    FitAddon: xtermMocks.FakeFitAddon,
    WebglAddon: xtermMocks.FakeWebglAddon,
  }),
}));

const resizeMocks = vi.hoisted(() => {
  const callbacks: ResizeObserverCallback[] = [];
  class FakeResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  return { callbacks, FakeResizeObserver };
});

const fontMocks = vi.hoisted(() => {
  const pending: Array<{ font: string; resolve: () => void }> = [];
  const load = vi.fn(
    (font: string) =>
      new Promise<void>((resolve) => {
        pending.push({ font, resolve });
      }),
  );
  return { pending, load };
});


import i18n from "@/lib/i18n";
import { TerminalView } from "./TerminalView";
import { computedMonoFontStack, terminalFontFamily, terminalFontSize } from "./appearance";
import {
  CODE_FONT_FAMILY_STORAGE_KEY,
  CUSTOM_CODE_FONT_FAMILY,
  DEFAULT_CODE_FONT_STACK,
  FONT_CHANGE_EVENT,
} from "@/features/settings/font";
import { applyInterfaceTypography } from "@/features/settings/interface-typography";
import { clearTerminalSessionState } from "./sessions";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "tab-1";
const CWD = "/tmp/project";

/** jsdom resolves no custom properties, so the terminal falls back to the
 *  localStorage mirror / bundled default; the computed-stack path is covered
 *  directly below. */
function stubComputedMono(value: string) {
  return vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name: string) => (name === "--font-mono" ? value : ""),
  } as unknown as CSSStyleDeclaration);
}

describe("terminal font/size resolution", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("prefers the computed --font-mono stack (trimmed)", () => {
    const spy = stubComputedMono('  "Foo Bar", monospace  ');
    try {
      expect(computedMonoFontStack()).toBe('"Foo Bar", monospace');
      expect(terminalFontFamily()).toBe('"Foo Bar", monospace');
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to the cached code font, then the bundled default", () => {
    expect(terminalFontFamily()).toBe(DEFAULT_CODE_FONT_STACK);
    expect(terminalFontSize()).toBe(13);

    localStorage.setItem(CODE_FONT_FAMILY_STORAGE_KEY, "custom");
    expect(terminalFontFamily()).toContain(CUSTOM_CODE_FONT_FAMILY);

    applyInterfaceTypography({ codeFontSize: 18 });
    expect(terminalFontSize()).toBe(18);
  });
});

describe("TerminalView wiring", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<TerminalView id={ID} cwd={CWD} />);
    });
    // loadXterm() → setXterm → setup effect → ipc.terminalOpen.
    await flush();
    await flush();
  }

  async function unmount() {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  }

  beforeEach(() => {
    localStorage.clear();
    xtermMocks.instances.length = 0;
    xtermMocks.fits.length = 0;
    resizeMocks.callbacks.length = 0;
    fontMocks.pending.length = 0;
    fontMocks.load.mockClear();
    ipcMocks.terminalOpen.mockClear();
    ipcMocks.terminalWrite.mockClear();
    ipcMocks.terminalResize.mockClear();
    clearTerminalSessionState(ID);
    vi.stubGlobal("ResizeObserver", resizeMocks.FakeResizeObserver);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: fontMocks.load, add: () => {}, delete: () => {}, has: () => false },
    });
  });

  afterEach(async () => {
    if (root) await unmount();
    vi.unstubAllGlobals();
  });

  it("opens with the resolved default stack and cached 代码字号", async () => {
    applyInterfaceTypography({ codeFontSize: 16 });
    await mount();

    const term = xtermMocks.instances[0];
    expect(term.options.fontFamily).toBe(DEFAULT_CODE_FONT_STACK);
    expect(term.options.fontSize).toBe(16);
    expect(term.openedWith).not.toBeNull();
    expect(xtermMocks.fits[0].fit).toHaveBeenCalled();
    // Waits for the bundled webfont with a legal font shorthand.
    expect(fontMocks.load).toHaveBeenCalledWith(expect.stringMatching(/^16px .*monospace$/));
  });

  it("font-change event re-reads the family, refits, and debounces the PTY resize", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const fit = xtermMocks.fits[0];
    const fitCalls = fit.fit.mock.calls.length;

    localStorage.setItem(CODE_FONT_FAMILY_STORAGE_KEY, "custom");
    await act(async () => {
      window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
    });

    expect(term.options.fontFamily).toContain(CUSTOM_CODE_FONT_FAMILY);
    expect(term.fontFamilySets).toContain(term.options.fontFamily);
    expect(fit.fit.mock.calls.length).toBeGreaterThan(fitCalls);

    expect(ipcMocks.terminalResize).not.toHaveBeenCalled(); // debounced
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(ipcMocks.terminalResize).toHaveBeenCalledExactlyOnceWith(ID, term.cols, term.rows);
  });

  it("typography-change event updates the font size and refits", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const fit = xtermMocks.fits[0];
    const fitCalls = fit.fit.mock.calls.length;

    await act(async () => {
      applyInterfaceTypography({ codeFontSize: 19 });
    });

    expect(term.options.fontSize).toBe(19);
    expect(fit.fit.mock.calls.length).toBeGreaterThan(fitCalls);
  });

  it("re-measures the same family once its webfont finishes loading", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const family = term.options.fontFamily as string;
    expect(term.fontFamilySets).toEqual([]); // nothing re-assigned yet

    await act(async () => {
      fontMocks.pending.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
    });
    await flush();

    // Probe value forces OptionsService to fire a real change, then the real
    // family is restored — two measures against the freshly loaded face.
    expect(term.fontFamilySets).toEqual([`${family}, monospace`, family]);
  });

  it("debounces and collapses container resize churn into one PTY resize", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const onChange = resizeMocks.callbacks[0];
    expect(onChange).toBeTypeOf("function");

    act(() => {
      onChange([], {} as ResizeObserver);
      onChange([], {} as ResizeObserver);
    });
    expect(xtermMocks.fits[0].fit).toHaveBeenCalled();
    expect(ipcMocks.terminalResize).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(ipcMocks.terminalResize).toHaveBeenCalledExactlyOnceWith(ID, term.cols, term.rows);
  });

  it("ignores an older font load after a newer font choice", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const older = fontMocks.pending.shift()!;
    localStorage.setItem(CODE_FONT_FAMILY_STORAGE_KEY, '"Consolas", monospace');
    await act(async () => window.dispatchEvent(new Event(FONT_CHANGE_EVENT)));
    const latest = term.options.fontFamily;
    const sets = [...term.fontFamilySets];
    await act(async () => {
      older.resolve();
      await Promise.resolve();
    });
    expect(term.options.fontFamily).toBe(latest);
    expect(term.fontFamilySets).toEqual(sets);
  });

  it("drops a late font load after unmount and detaches listeners", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const fit = xtermMocks.fits[0];
    const setsBefore = [...term.fontFamilySets];
    const fitCalls = fit.fit.mock.calls.length;

    await unmount();

    window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
    await act(async () => {
      fontMocks.pending.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
    });
    await flush();

    expect(term.fontFamilySets).toEqual(setsBefore);
    expect(fit.fit.mock.calls.length).toBe(fitCalls);
  });

  it("syncs refitted dimensions after a slow PTY open completes", async () => {
    let resolveOpen!: () => void;
    ipcMocks.terminalOpen.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOpen = resolve; }));
    await mount();
    const term = xtermMocks.instances[0];
    term.cols = 96;
    term.rows = 18;
    await act(async () => {
      fontMocks.pending.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(ipcMocks.terminalResize).not.toHaveBeenCalled();
    await act(async () => {
      resolveOpen();
      await Promise.resolve();
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 170)); });
    expect(ipcMocks.terminalResize).toHaveBeenLastCalledWith(ID, 96, 18);
  });

  it("drops a pending debounced PTY resize when the view unmounts first", async () => {
    await mount();
    const onChange = resizeMocks.callbacks[0];
    act(() => {
      onChange([], {} as ResizeObserver);
    });

    await unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(ipcMocks.terminalResize).not.toHaveBeenCalled();
  });
});
