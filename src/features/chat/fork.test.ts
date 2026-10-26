import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORK_ENGINES, engineSupportsFork, forkUnavailableReason } from "./fork";

/** 分叉入口的可用性判定：引擎白名单必须与后端 `fork_session` 的允许集合一致，
 *  原因按"用户最该先知道的那一件事"取。 */
describe("fork availability", () => {
  const base = { engine: "claude", remote: false, live: false, pending: false };

  it("is available for every engine the backend can fork, at rest", () => {
    // 逐引擎列出来而不是只挑两个：漏掉任何一个，那个引擎的分叉入口会永远置灰，
    // 而其余测试**照样全绿**（行为测试只覆盖被列出的引擎）。
    for (const engine of ["claude", "codex", "dsh"]) {
      expect(engineSupportsFork(engine), engine).toBe(true);
      expect(forkUnavailableReason({ ...base, engine }), engine).toBeNull();
    }
  });

  it("keeps FORK_ENGINES in step with the backend capability table", () => {
    // 权威在后端：能力表每行都有一个 `engine: "<id>",`。前端这份是**镜像**，漏一个
    // 就会静默少一个引擎的入口——所以这里直接读后端源码比对。不这样做的话，这份
    // 清单只能靠人记得改，而它恰恰是最容易漏的一处。
    const sources = [
      "../../../src-tauri/src/engine/fork.rs",
      "../../../src-tauri/src/engine/fork_dsh.rs",
    ]
      .map((relative) => readFileSync(new URL(relative, import.meta.url), "utf8"))
      .join("\n");
    const declared = [...sources.matchAll(/^\s{4}engine:\s*"([a-z]+)",$/gm)].map(
      (match) => match[1],
    );
    expect(declared.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(declared)].sort()).toEqual([...FORK_ENGINES].sort());
  });

  it("reports remote ahead of everything else", () => {
    // 远程会话即使引擎在白名单里也只能说远程：没有本地转录本可写，说"引擎
    // 不支持"会把用户引到错的方向。
    expect(forkUnavailableReason({ ...base, remote: true })).toBe("remote");
    expect(
      forkUnavailableReason({
        engine: "kimi",
        remote: true,
        live: true,
        pending: true,
      }),
    ).toBe("remote");
  });

  it("reports an engine outside the backend allow-list", () => {
    expect(forkUnavailableReason({ ...base, engine: "kimi" })).toBe("engine");
    expect(forkUnavailableReason({ ...base, engine: "" })).toBe("engine");
  });

  it("reports an image-only turn, after the session-level blockers", () => {
    // 纯图片轮：定位得到但没有文本摘要可当锚点。它比"这一轮还在跑"更持久、也更
    // 贴近用户刚点的那条消息，所以排在会话级阻塞之后、进行态之前。
    expect(forkUnavailableReason({ ...base, imageOnly: true })).toBe("image-only");
    expect(forkUnavailableReason({ ...base, imageOnly: true, live: true })).toBe(
      "image-only",
    );
    expect(forkUnavailableReason({ ...base, imageOnly: true, pending: true })).toBe(
      "image-only",
    );
    // 会话级阻塞仍然优先：远程 / 引擎不支持时，说"这一轮只有图片"会把方向引错。
    expect(forkUnavailableReason({ ...base, imageOnly: true, remote: true })).toBe(
      "remote",
    );
    expect(
      forkUnavailableReason({ ...base, imageOnly: true, engine: "kimi" }),
    ).toBe("engine");
    // 有文本就不该落到这个原因上。
    expect(forkUnavailableReason({ ...base, imageOnly: false })).toBeNull();
  });

  it("reports an in-flight fork as busy, ahead of a live turn", () => {
    expect(forkUnavailableReason({ ...base, pending: true })).toBe("busy");
    expect(forkUnavailableReason({ ...base, pending: true, live: true })).toBe(
      "busy",
    );
    expect(forkUnavailableReason({ ...base, live: true })).toBe("live");
  });
});