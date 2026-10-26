import { describe, expect, it } from "vitest";
import { resolveForkAnchor } from "./MessageTimeline";
import type { Message } from "@/lib/ipc";

const msg = (seq: number, role: string, text: string): Message => ({
  seq,
  role,
  text,
  ts: null,
});

/** 一个已稳定的两轮会话：U1 A1 U2 A2。 */
const convo: Message[] = [
  msg(1, "user", "你好，你是谁"),
  msg(2, "assistant", "你好，我是 Claude。"),
  msg(3, "user", "帮我看看这个 bug"),
  msg(4, "assistant", "先看这一段…"),
];

describe("resolveForkAnchor", () => {
  it("resolves an assistant row to its own turn's user message", () => {
    expect(resolveForkAnchor(convo, convo[3])).toEqual({
      text: "帮我看看这个 bug",
      seq: 3,
    });
    // 第一条回复 → 第一轮提问。
    expect(resolveForkAnchor(convo, convo[1])).toEqual({
      text: "你好，你是谁",
      seq: 1,
    });
  });

  it("resolves a user row to its OWN turn (that turn is included in the branch)", () => {
    // 点用户提问 U2 = 从"U2/A2"这一轮的**末尾**分叉，所以分支里包含 U2 这一轮。
    // （点同一轮的助手回复必须给出同一个分叉点，否则同一轮点哪儿结果不同。）
    expect(resolveForkAnchor(convo, convo[2])).toEqual({
      text: "帮我看看这个 bug",
      seq: 3,
    });
    expect(resolveForkAnchor(convo, convo[0])).toEqual({
      text: "你好，你是谁",
      seq: 1,
    });
    expect(resolveForkAnchor(convo, convo[2])).toEqual(
      resolveForkAnchor(convo, convo[3]),
    );
  });

  it("returns null when the turn's user message is not loaded", () => {
    // 虚拟化/分页把该轮提问裁在窗口外：宁可不给入口，也不猜位置。
    const tailOnly = [msg(9, "assistant", "回答")];
    expect(resolveForkAnchor(tailOnly, tailOnly[0])).toBeNull();
  });

  it("skips card rows (grant / question / plan_review) when walking back", () => {
    const withCard: Message[] = [
      msg(1, "user", "提问"),
      msg(2, "grant", "授权"),
      msg(3, "question", "问答"),
      msg(4, "assistant", "回答"),
    ];
    expect(resolveForkAnchor(withCard, withCard[3])).toEqual({
      text: "提问",
      seq: 1,
    });
  });

  it("locates a blank-text turn (image-only) instead of hiding the entry", () => {
    // 纯图片轮：定位得到（seq 有效），但文本为空。返回 null 会让入口直接消失，
    // 用户分不清"这条消息不支持"还是"功能坏了"——所以这里要求拿到一个 text 为空、
    // seq 正确的锚点，由调用方置灰并给出原因。
    const blank: Message[] = [msg(1, "user", "   "), msg(2, "assistant", "图")];
    expect(resolveForkAnchor(blank, blank[1])).toEqual({ text: "   ", seq: 1 });
    expect(resolveForkAnchor(blank, blank[1])?.text.trim()).toBe("");
  });

  it("returns null for an empty list", () => {
    expect(resolveForkAnchor([], msg(1, "assistant", "x"))).toBeNull();
  });
});