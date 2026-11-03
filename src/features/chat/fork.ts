/**
 * 会话分叉入口的可用性判定。
 *
 * 引擎白名单**只有这一份**（`FORK_ENGINES`），权威在后端的**能力表**
 * `src-tauri/src/engine/fork/mod.rs` 的 `FORK_SUPPORT`
 * （`&[CLAUDE_FORK, CODEX_FORK, DSH_FORK]`，由 `fork_support()` 查表）——加引擎时
 * 两处必须一起改。`fork.test.ts` 有一条测试直接读后端源码比对这两份清单，漏改会红。
 *
 * 为什么要在前端也拦一道：**远程会话**没有任何本地 `sessions` 行（后端那张表
 * 根本没有 `remote` 列），点下去只会在更深处失败并给出一句与真实原因对不上的
 * 错；所以远程置灰必须由这里负责（依据 store 里 catalog meta 的 `remote`）。
 * 注意后端**没有** `remote` 守卫：那条按构造不可达（远程会话不落 `sessions` 行）。
 *
 * 分叉能力将来若在后端扩成按引擎的能力位，这里也要跟着改——两边分开写必然漂移：
 * 后端能力表漏掉的引擎，前端照样会显示入口。
 */

/** 分叉入口不可用的原因；`null` = 可用。可见性另算（见 MessageTimeline 的
 *  `ForkButton`）：能当锚点就有入口，不可用只置灰，不隐藏。 */
export type ForkUnavailable = "remote" | "engine" | "image-only" | "live" | "busy";

export const FORK_ENGINES: readonly string[] = ["claude", "codex", "dsh"];

export function engineSupportsFork(engine: string): boolean {
  return FORK_ENGINES.includes(engine);
}

/**
 * 取「用户最该先知道的那一件事」当禁用原因。
 *
 * 远程会话排在引擎之前：WSL 一类会话源没有本地转录本，分叉要写本地文件、要查
 * 本地 `sessions` 表，后端一律拒绝，说"引擎不支持"会把人引到错的方向。
 * `image-only` 排在会话级阻塞之后、进行态之前：它说的是**用户刚点的这条消息**
 * 不能当锚点，比"这一轮还在跑"更具体、也更持久。进行中排在流式之前：等待态
 * （`cursor-wait`）比"这一轮还在跑"更具体。
 */
export function forkUnavailableReason(input: {
  engine: string;
  /** 会话目录里的 `SessionMeta.remote`（插件会话源，如 WSL 发行版内的 CLI）。 */
  remote: boolean;
  /** 这一轮只有图片、没有文字：定位得到，但没有文本摘要可当锚点。 */
  imageOnly?: boolean;
  /** 这一轮还在流式：分叉点还没定稿。 */
  live: boolean;
  /** 这次分叉还在飞（store 的防重入标记）。 */
  pending: boolean;
}): ForkUnavailable | null {
  if (input.remote) return "remote";
  if (!engineSupportsFork(input.engine)) return "engine";
  if (input.imageOnly) return "image-only";
  if (input.pending) return "busy";
  if (input.live) return "live";
  return null;
}