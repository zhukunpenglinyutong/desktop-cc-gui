import { describe, expect, it } from "vitest";
import { resolveForkAnchor, resolveForkAnchors } from "./MessageTimeline";
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
describe("resolveForkAnchors", () => {
  it("一趟算出每条消息的锚点，与逐条调 resolveForkAnchor 等价", () => {
    const anchors = resolveForkAnchors(convo);
    for (const message of convo) {
      const got = anchors.get(message);
      // 与逐条实现比对 text/seq（`tail` 是一趟算法额外携带的消歧信息，逐条版没有）。
      expect(got ? { text: got.text, seq: got.seq } : null).toEqual(
        resolveForkAnchor(convo, message),
      );
    }
  });

  it("首条 user 之前的行没有锚点", () => {
    const rows = [msg(1, "assistant", "开场白"), msg(2, "user", "问题")];
    const anchors = resolveForkAnchors(rows);
    expect(anchors.get(rows[0])).toBeUndefined();
    expect(anchors.get(rows[1])).toEqual({ text: "问题", seq: 2, tail: 0 });
  });

  it("卡片行（非 user）不切断已有锚点", () => {
    const rows = [
      msg(1, "user", "问题"),
      msg(2, "tool", "授权卡片"),
      msg(3, "assistant", "回答"),
    ];
    const anchors = resolveForkAnchors(rows);
    // 卡片行与它后面的助手行都归到同一条 user 消息上。
    expect(anchors.get(rows[1])).toEqual({ text: "问题", seq: 1, tail: 0 });
    expect(anchors.get(rows[2])).toEqual({ text: "问题", seq: 1, tail: 0 });
  });
});
describe("resolveForkAnchors 的 tail（从尾部数的同文本序号）", () => {
  it("连发同样文本时给出 2/1/0，供后端精确定位", () => {
    // 真机 bug：连发三次「继续」，点中间那条分叉却拿到全部三轮。前端 seq 与后端
    // 解析 seq 不同源，所以改由 tail 消歧（只依赖出现顺序，与编号无关）。
    const rows = [msg(1, "user", "继续"), msg(2, "user", "继续"), msg(3, "user", "继续")];
    const anchors = resolveForkAnchors(rows);
    expect(anchors.get(rows[0])?.tail).toBe(2);
    expect(anchors.get(rows[1])?.tail).toBe(1);
    expect(anchors.get(rows[2])?.tail).toBe(0);
  });

  it("不同文本各自从 0 开始数", () => {
    const rows = [msg(1, "user", "甲"), msg(2, "user", "乙"), msg(3, "user", "甲")];
    const anchors = resolveForkAnchors(rows);
    expect(anchors.get(rows[0])?.tail).toBe(1);
    expect(anchors.get(rows[1])?.tail).toBe(0);
    expect(anchors.get(rows[2])?.tail).toBe(0);
  });
});