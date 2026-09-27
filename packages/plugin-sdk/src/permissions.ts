import spec from "../spec/permissions.json";

/**
 * 权限（plan §4.1 permissions.ts）。零运行时依赖（纯 JSON + 字符串逻辑），
 * 宿主前端、插件模板校验脚本（Node）均可直接 import。
 *
 * 单一事实源是包内 spec/permissions.json：KNOWN_PERMISSIONS 与测试向量
 * 都由它生成/驱动；Rust 侧 src-tauri/src/plugins.rs 用 include_str! 消费
 * 同一份文件，漂移在 CI 暴露。修改 spec = 修改安全边界。
 */

/** 基座权限全集；`network:none` 保留作"声明无网络"语义，是基座权限，
 * 永远不是授权——`network:none` 不会被解析为放行任何主机的 grant。
 * 除此之外还可声明 `network:`/`exec:` 授权（见下），未知权限 = 安装期拒绝。 */
export const KNOWN_PERMISSIONS: Record<string, true> = Object.fromEntries(
  spec.knownPermissions.map((p) => [p, true]),
);

/** `network:` 授权体：`<host>`（任意端口）/ `<host>:<port>` / `<host>:<a>-<b>`
 *  （端口区间，含端点）。host 精确匹配（大小写不敏感，无通配/子域）。 */
const NETWORK_GRANT_RE = /^([A-Za-z0-9.-]+)(?::(\d+)(?:-(\d+))?)?$/;

/** `exec:` 授权的二进制名：裸名，禁路径分隔符。 */
const EXEC_BIN_RE = /^[A-Za-z0-9._-]+$/;

interface NetworkGrant {
  host: string;
  /** null = 任意端口。 */
  portFrom: number | null;
  portTo: number | null;
}

/** 解析 `network:` 授权体；形状非法（空 host/非数字端口/区间倒置/越界）返回
 *  null。`none` 显式拒止：`network:none` 是基座权限而非授权，Rust 侧同样
 *  从不把它解析为 grant（见 spec networkAllow 向量）。 */
function parseNetworkGrant(spec: string): NetworkGrant | null {
  const m = NETWORK_GRANT_RE.exec(spec);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (host === "none") return null;
  if (m[2] === undefined) return { host, portFrom: null, portTo: null };
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (from < 1 || to > 65535 || from > to) return null;
  return { host, portFrom: from, portTo: to };
}

/** manifest permissions 元素是否已知：spec 中的基座权限，或形状合法的
 * `network:`/`exec:` 授权。宿主 permissions.ts、模板 validate-manifest.mjs
 * 与 Rust plugins.rs 均跑 spec/permissions.json 的同一组向量。 */
export function isKnownPermission(p: string): boolean {
  if (KNOWN_PERMISSIONS[p]) return true;
  if (p.startsWith("network:")) return parseNetworkGrant(p.slice("network:".length)) !== null;
  if (p.startsWith("exec:")) return EXEC_BIN_RE.test(p.slice("exec:".length));
  return false;
}

/** url 是否命中 grants 中任一 `network:` 授权。仅 http/https；host 精确
 *  匹配（大小写不敏感，子域不算命中）；授权带端口/区间时 url 端口
 *  （缺省按协议 80/443）须落入。 */
export function networkGrantAllows(grants: readonly string[], url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  for (const g of grants) {
    if (!g.startsWith("network:")) continue;
    const grant = parseNetworkGrant(g.slice("network:".length));
    if (!grant || grant.host !== host) continue;
    if (grant.portFrom === null) return true;
    if (port >= grant.portFrom && port <= (grant.portTo as number)) return true;
  }
  return false;
}

/** bin 是否命中 grants 中的 `exec:<bin>` 授权（精确匹配；bin 须为合法裸名）。 */
export function execGrantAllows(grants: readonly string[], bin: string): boolean {
  return EXEC_BIN_RE.test(bin) && grants.includes(`exec:${bin}`);
}
