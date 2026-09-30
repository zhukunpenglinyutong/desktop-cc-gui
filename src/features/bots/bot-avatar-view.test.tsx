/**
 * A 16px bot avatar keeps painting frames.
 *
 * `#` menu rows and the composer chip render the paper avatar at 14–16px and
 * the settings list at 36px. Those sizes used to be handed to the engine as
 * `paused`, so the one place a bot is picked or recognised showed a still
 * frame. The canvas is not inspectable in jsdom, so the contract under test is
 * the one the size gate broke: a small avatar asks the browser for frames and
 * repaints on each of them (and still stops when motion is reduced).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { BotAvatar } from "@/lib/ipc";
import { BotAvatarView } from "./bot-avatar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AVATAR: BotAvatar = {
  type: "generated",
  foldShape: "shield",
  eyes: "angry",
  hue: 321,
  saturation: 74,
};

let frames: FrameRequestCallback[] = [];
let cleared = 0;
let clock = 0;
let reducedMotion = false;

/** Runs the frames the engine asked for, moving the clock past its throttle
 *  (16ms while it eases in, 32ms once it settles). */
async function runFrames(count: number) {
  for (let i = 0; i < count; i++) {
    const queued = frames;
    frames = [];
    clock += 40;
    const now = clock;
    await act(async () => {
      for (const frame of queued) frame(now);
    });
  }
}

/** Stand-in for the 2D context: a real canvas is unavailable under jsdom, and
 *  the count of `clearRect` calls is exactly the count of painted frames. */
function stubContext() {
  const gradient = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    canvas: { width: 64, height: 64 },
    globalAlpha: 1,
    clearRect: () => {
      cleared += 1;
    },
    createPattern: () => ({}),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: () => ({ data: new Uint8ClampedArray(192 * 192 * 4) }),
  };
  return new Proxy(base, {
    get: (target, prop: string | symbol) =>
      prop in target ? target[prop as string] : () => undefined,
    set: (target, prop: string | symbol, value) => {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

class StubIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/** jsdom has no matchMedia; the engine reads it for `prefers-reduced-motion`. */
function mediaQueryList(query: string) {
  return {
    matches: reducedMotion,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}

describe("BotAvatarView animation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    frames = [];
    cleared = 0;
    clock = 0;
    reducedMotion = false;
    vi.stubGlobal("matchMedia", mediaQueryList);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => {
      frames.push(frame);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
    // jsdom ships neither Path2D nor DOMMatrix; the fold silhouettes build
    // one of each per draw.
    vi.stubGlobal(
      "Path2D",
      class {
        addPath() {}
        moveTo() {}
        lineTo() {}
        bezierCurveTo() {}
        quadraticCurveTo() {}
        closePath() {}
      },
    );
    vi.stubGlobal(
      "DOMMatrix",
      class {
        a = 1;
        b = 0;
        c = 0;
        d = 1;
        e = 0;
        f = 0;
        constructor(values?: number[]) {
          if (values?.length === 6) {
            [this.a, this.b, this.c, this.d, this.e, this.f] = values;
          }
        }
      },
    );
    HTMLCanvasElement.prototype.getContext = (() =>
      stubContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.unstubAllGlobals();
  });

  async function mount(size: number) {
    await act(async () => {
      root.render(<BotAvatarView avatar={AVATAR} seed="bot-1" size={size} />);
    });
  }

  it("keeps a 16px avatar painting instead of freezing at one frame", async () => {
    await mount(16);
    const painted = cleared;
    expect(frames).toHaveLength(1); // subscribed to the shared frame loop

    await runFrames(3);
    expect(cleared).toBeGreaterThan(painted);
    const afterFirstFrames = cleared;

    await runFrames(3);
    expect(cleared).toBeGreaterThan(afterFirstFrames);
    expect(frames).toHaveLength(1);
  });

  it("stops the small avatar under prefers-reduced-motion", async () => {
    reducedMotion = true;
    await mount(16);
    const painted = cleared;

    await runFrames(2);
    expect(frames).toHaveLength(0);
    expect(cleared).toBe(painted);
  });
});
