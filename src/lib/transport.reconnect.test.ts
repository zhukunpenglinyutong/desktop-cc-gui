import { afterEach, expect, it, vi } from "vitest";
import { listenSessionsChanged } from "./events";

// The web bridge retries forever so the UI heals when the desktop restarts the
// relay. That timer outlives the page it belongs to. Under vitest each test file
// gets its own jsdom environment, and teardown deletes the browser globals
// (`vitest/dist/chunks/index.*.js`: `keys.forEach(key => delete global[key])`,
// with `window` folded in through `skipKeys`) while Node's own `setTimeout`
// keeps the pending reconnect queued. Firing it dereferenced the bare
// `location` global and threw `ReferenceError: location is not defined`, which
// vitest counts as an unhandled error — CI run 37764774618 exited 1 with all
// 1734 tests passing.

interface FakeSocket {
  readyState: number;
  onclose: (() => void) | null;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  binaryType: string;
  close: () => void;
  send: () => void;
}

const sockets: FakeSocket[] = [];
const realWebSocket = globalThis.WebSocket;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");

afterEach(() => {
  globalThis.WebSocket = realWebSocket;
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
  vi.useRealTimers();
  sockets.length = 0;
});

it("stops reconnecting once the page it belongs to is gone", async () => {
  vi.useFakeTimers();
  function FakeWebSocket(this: FakeSocket) {
    this.readyState = 0;
    this.onclose = null;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.binaryType = "blob";
    this.close = () => {};
    this.send = () => {};
    sockets.push(this);
  }
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  // Any module-scope subscription reaches the bridge; this is the same entry
  // point src/lib/ipc.ts uses at import time.
  await listenSessionsChanged(() => {});
  expect(sockets).toHaveLength(1);

  // The relay drops: pending work rejects and the bridge arms its retry.
  sockets[0].readyState = 3;
  sockets[0].onclose?.();

  // Environment teardown: the browser globals go, the queued timer stays.
  Reflect.deleteProperty(globalThis, "location");
  Reflect.deleteProperty(globalThis, "window");

  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  // No page, no socket: the retry chain stops instead of throwing forever.
  expect(sockets).toHaveLength(1);
});
