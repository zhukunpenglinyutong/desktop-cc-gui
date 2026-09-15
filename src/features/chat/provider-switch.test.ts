import { beforeEach, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "./store";

vi.mock("@/lib/ipc", () => ({ ipc: {
  setCurrentProvider: vi.fn(async () => {}),
  rememberSessionProvider: vi.fn(async () => {}),
} }));

const tab = { engine: "codex", sessionId: null, workspacePath: "/ws", provider: "old" };
beforeEach(() => {
  vi.resetAllMocks();
  useChatStore.setState({ active: tab, openTabs: [tab], providers: { codex: "old" }, actionError: null });
});

it("preserves the old selection when the backend refuses a channel switch", async () => {
  vi.mocked(ipc.setCurrentProvider).mockRejectedValueOnce("migration conflict");
  await useChatStore.getState().setProvider("codex", "new");
  expect(useChatStore.getState().providers.codex).toBe("old");
  expect(useChatStore.getState().active?.provider).toBe("old");
  expect(useChatStore.getState().actionError).toBe("migration conflict");
});

it("does not stamp a different tab after a delayed successful switch", async () => {
  let resolve!: () => void;
  vi.mocked(ipc.setCurrentProvider).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
  const pending = useChatStore.getState().setProvider("codex", "new");
  expect(useChatStore.getState().providers.codex).toBe("old");
  const other = { ...tab, workspacePath: "/other", provider: "other" };
  useChatStore.setState({ active: other, openTabs: [tab, other] });
  resolve();
  await pending;
  expect(useChatStore.getState().providers.codex).toBe("new");
  expect(useChatStore.getState().active?.provider).toBe("other");
});
