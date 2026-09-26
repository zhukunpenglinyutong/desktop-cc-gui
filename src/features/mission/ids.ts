import { safeRandomUUID } from "@/lib/id";

/** 任务工作台内部的 id 生成：在安全上下文及非安全 HTTP 局域网桥环境下均安全可用。 */
export function missionId(prefix: string): string {
  const random = safeRandomUUID().replaceAll("-", "").slice(0, 12);
  return `${prefix}-${random}`;
}
