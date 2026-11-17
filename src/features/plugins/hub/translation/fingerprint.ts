/**
 * 源文本指纹：缓存里只存它，不存原文快照。原文变了（作者改了名称、简介
 * 或 README），指纹对不上，译文就标记为过期。
 *
 * 同步的 53 位哈希（cyrb53）加长度，够区分「这段文本改没改」——这里不是
 * 安全用途，渲染时同步可算比 crypto.subtle 的异步摘要更合适。
 */
function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 首尾空白不算改动：索引与 README 常有换行差异。 */
export function textFingerprint(text: string): string {
  const normalized = text.trim();
  return `v1:${normalized.length.toString(36)}:${cyrb53(normalized).toString(36)}`;
}
