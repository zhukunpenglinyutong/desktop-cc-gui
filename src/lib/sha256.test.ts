import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

/**
 * Known-answer tests (FIPS 180-4 / NIST examples). 会话分叉拿这个摘要当
 * 「那一轮用户消息」的定位键，摘要错了就会定位不到消息或定位到别的轮次，
 * 所以这里必须钉死标准向量，而不是只断言「长度是 64」。
 */
describe("sha256Hex", () => {
  it("matches the empty-string vector", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the 'abc' vector", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the 56-byte multi-block vector", () => {
    // 448-bit message: exercises the padding boundary (56 mod 64).
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("matches the 112-byte two-block vector", () => {
    expect(
      sha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno" +
          "ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      ),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("handles multi-byte UTF-8 (Chinese) deterministically", () => {
    // 同一文本必须得到同一摘要，且与「按字节」无关。
    const a = sha256Hex("你好，你是谁");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("你好，你是谁")).toBe(a);
    expect(sha256Hex("你好，你是谁 ")).not.toBe(a);
  });

  it("handles code points beyond the BMP (emoji)", () => {
    const a = sha256Hex("🀄️ fork");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("🀄️ fork")).toBe(a);
  });

  it("handles a cross-block boundary with multi-byte chars", () => {
    // 63 Chinese chars = 189 bytes: padding lands across a block edge.
    const text = "汉".repeat(63);
    const a = sha256Hex(text);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(`${text}汉`)).not.toBe(a);
  });
});