import { describe, expect, it } from "vitest";
import {
  EMPTY_ATTACHMENTS,
  NO_ATTACHMENT_MOVES,
  moveComposerAttachments,
  moveComposerState,
  recordAttachmentMove,
  resolveAttachmentKey,
  withoutComposerAttachments,
  type ComposerAttachmentsByKey,
} from "./attachments";

function slice(images: string[], error: string | null = null) {
  return {
    images,
    previews: Object.fromEntries(
      images.map((path) => [path, { url: `data:image/png;base64,AA==`, name: path }]),
    ),
    error,
  };
}

describe("moveComposerAttachments", () => {
  it("moves a pending tab's chips to its native session key", () => {
    const pending = "new:claude:/tmp/ws";
    const native = "claude/s-1";
    const rec: ComposerAttachmentsByKey = { [pending]: slice(["/tmp/a.png"]) };

    const next = moveComposerAttachments(rec, pending, native);

    expect(next[pending]).toBeUndefined();
    expect(next[native]?.images).toEqual(["/tmp/a.png"]);
    expect(next[native]?.previews["/tmp/a.png"]).toBeTruthy();
  });

  it("keeps the destination's own chips and never duplicates a path", () => {
    const next = moveComposerAttachments(
      {
        "claude/pending": slice(["/tmp/a.png", "/tmp/b.png"]),
        "claude/s-1": slice(["/tmp/a.png", "/tmp/c.png"]),
      },
      "claude/pending",
      "claude/s-1",
    );

    expect(next["claude/s-1"]?.images).toEqual([
      "/tmp/a.png",
      "/tmp/c.png",
      "/tmp/b.png",
    ]);
  });

  it("is a no-op for a same-key migration and for an empty source", () => {
    const rec: ComposerAttachmentsByKey = { "claude/s-1": slice(["/tmp/a.png"]) };
    expect(moveComposerAttachments(rec, "claude/s-1", "claude/s-1")).toBe(rec);

    const empty: ComposerAttachmentsByKey = {
      "claude/pending": { ...EMPTY_ATTACHMENTS },
    };
    expect(moveComposerAttachments(empty, "claude/pending", "claude/s-1")).toBe(empty);
  });
});

describe("withoutComposerAttachments", () => {
  it("drops the dead session and keeps the record reference otherwise", () => {
    const rec: ComposerAttachmentsByKey = {
      "claude/s-1": slice(["/tmp/a.png"]),
      "claude/s-2": slice(["/tmp/b.png"]),
    };
    const next = withoutComposerAttachments(rec, ["claude/s-1"]);
    expect(next["claude/s-1"]).toBeUndefined();
    expect(next["claude/s-2"]?.images).toEqual(["/tmp/b.png"]);

    const untouched = withoutComposerAttachments(rec, ["claude/missing"]);
    expect(untouched).toBe(rec);
  });
});

describe("attachment key moves (uploads still in flight)", () => {
  const PENDING = "new:claude:/tmp/ws";
  const NATIVE = "claude/s-1";

  it("sends an upload started before the move to the tab's new key", () => {
    const since = NO_ATTACHMENT_MOVES.seq;
    const moves = recordAttachmentMove(NO_ATTACHMENT_MOVES, PENDING, NATIVE);
    expect(resolveAttachmentKey(moves, PENDING, since)).toBe(NATIVE);
  });

  it("leaves an upload started after the move on its own key", () => {
    // One pending tab per workspace + engine: the next new chat reuses the
    // old pending key, and its pastes must stay in that new chat.
    const moves = recordAttachmentMove(NO_ATTACHMENT_MOVES, PENDING, NATIVE);
    expect(resolveAttachmentKey(moves, PENDING, moves.seq)).toBe(PENDING);
  });

  it("follows chained moves in order and ends where the tab ended", () => {
    const codex = "new:codex:/tmp/ws";
    let moves = recordAttachmentMove(NO_ATTACHMENT_MOVES, PENDING, codex);
    moves = recordAttachmentMove(moves, codex, PENDING);
    // Retargeted claude → codex → claude: back where it started.
    expect(resolveAttachmentKey(moves, PENDING, 0)).toBe(PENDING);
    moves = recordAttachmentMove(moves, PENDING, NATIVE);
    expect(resolveAttachmentKey(moves, PENDING, 0)).toBe(NATIVE);
  });

  it("ignores a later move of the same key by the next new chat", () => {
    let moves = recordAttachmentMove(NO_ATTACHMENT_MOVES, PENDING, NATIVE);
    // The next new chat in this workspace adopts its own id later on.
    moves = recordAttachmentMove(moves, PENDING, "claude/s-2");
    expect(resolveAttachmentKey(moves, PENDING, 0)).toBe(NATIVE);
  });

  it("does not record a same-key move and keeps the log bounded", () => {
    expect(recordAttachmentMove(NO_ATTACHMENT_MOVES, NATIVE, NATIVE)).toBe(
      NO_ATTACHMENT_MOVES,
    );
    let moves = NO_ATTACHMENT_MOVES;
    for (let i = 0; i < 100; i++) moves = recordAttachmentMove(moves, `a${i}`, `b${i}`);
    expect(moves.seq).toBe(100);
    expect(moves.log.length).toBeLessThan(100);
    expect(moves.log.at(-1)).toEqual({ from: "a99", to: "b99", seq: 100 });
  });

  it("records the move even while the source slice is still empty", () => {
    // The race this exists for: the picture has not landed yet when the tab
    // adopts its native id, so there is nothing to move — only a forward.
    const next = moveComposerState(
      { composerAttachments: {}, composerAttachmentMoves: NO_ATTACHMENT_MOVES },
      PENDING,
      NATIVE,
    );
    expect(next.composerAttachments).toEqual({});
    expect(resolveAttachmentKey(next.composerAttachmentMoves, PENDING, 0)).toBe(NATIVE);
  });
});
