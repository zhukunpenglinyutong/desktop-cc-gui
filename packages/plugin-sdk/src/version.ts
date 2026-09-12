/**
 * 版本握手（manifest sdkVersion range）。零依赖，Node 脚本可直接 import。
 */

/** 本包版本。插件可用 `ctx.host.sdkVersion` 在运行时自检。 */
export const SDK_VERSION = "0.3.2";

/**
 * Compare dotted numeric versions; >0 when a is newer. 缺省段按 0 计
 * （"0.3" 与 "0.3.0" 相等）。
 *
 * 段必须是非负整数字符串：任何非数字段（含空段、负数、小数）抛出 Error，
 * 而不是静默返回 NaN 让比较结果失真。调用方（loader）的版本串已由
 * validateManifest / Rust 安装期校验把关，正常路径不会触发。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (const segs of [pa, pb]) {
    for (const seg of segs) {
      if (!/^\d+$/.test(seg)) {
        throw new Error(`compareVersions: non-numeric segment "${seg}" in "${segs.join(".")}"`);
      }
    }
  }
  const na = pa.map(Number);
  const nb = pb.map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 最小 semver range 求值（无聊实现，刻意不引 semver 包）：
 * 支持 "*" / 缺省、精确 "0.2.0"、"^x.y.z"、"~x.y.z"、">=x.y.z"。
 * 其余写法一律视为不满足（插件作者会得到明确的 incompatible 错误，
 * 而不是被静默放行）。
 *
 * caret 对 0 主版本的左锚定规则（semver）：
 * - "^0.2" ≡ "^0.2.0"，只允许 0.2.x；
 * - "^0.0"（省略 patch）允许任意 0.0.x——与 "^0.2" 的省略语义一致；
 * - "^0.0.3" 精确锚定 0.0.3（0.0.x 里 patch 即破坏性位）。
 */
export function satisfiesSdkRange(range: string | undefined, version: string): boolean {
  const r = (range ?? "*").trim();
  if (r === "*" || r === "") return true;
  const v = version.split(".").map(Number);
  // patch 段仅在带操作符时可省略（"^0.2" ≡ "^0.2.0"）；裸精确匹配必须三段齐全。
  const m = r.match(/^(\^|~|>=)?\s*(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!m) return false;
  const [, op, maj, min, pat] = m;
  if (!op && pat === undefined) return false;
  const base = `${maj}.${min}.${pat ?? "0"}`;
  if (op === ">=") return compareVersions(version, base) >= 0;
  if (op === "^") {
    if (Number(maj) > 0) return v[0] === Number(maj) && compareVersions(version, base) >= 0;
    // 0.x：^0.2 只允许 0.2.x（semver 对 0 主版本的左锚定规则）
    if (Number(min) > 0) {
      return v[0] === 0 && v[1] === Number(min) && compareVersions(version, base) >= 0;
    }
    // ^0.0：省略 patch = 任意 0.0.x；带 patch = 精确锚定该 patch。
    if (pat === undefined) return v[0] === 0 && v[1] === 0;
    return v[0] === 0 && v[1] === 0 && v[2] === Number(pat);
  }
  if (op === "~") {
    return v[0] === Number(maj) && v[1] === Number(min) && compareVersions(version, base) >= 0;
  }
  return compareVersions(version, base) === 0;
}
