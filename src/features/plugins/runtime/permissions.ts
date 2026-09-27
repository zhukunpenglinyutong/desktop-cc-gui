import { isKnownPermission, isValidPluginId, type PluginManifest } from "@ccgui/plugin-sdk";

/**
 * Manifest validation beyond Rust's install-time checks (Rust is the
 * install-time authority; this guards builtin/AI paths that skip the
 * installer). Permission declarations must be known — 基座权限集（以 spec/permissions.json 的 knownPermissions 为准）或形状合法的
 * network:/exec: 授权，单一事实来源是 @ccgui/plugin-sdk 的
 * spec/permissions.json（Rust 侧经 include_str! 消费同一份）；typo/unknown =
 * 拒绝加载。`network:none` is informational — CSP already denies all webview
 * egress; real egress goes through the network:/exec:-granted bridge commands
 * (plugin_http_request / plugin_exec_run / plugin_exec_spawn). Runtime
 * capability gating is a plain manifest.includes check in context.ts — an
 * unknown permission can never reach it (rejected here at load time). */

export function unknownPermissions(permissions: string[]): string[] {
  return permissions.filter((p) => !isKnownPermission(p));
}

/** Validate a parsed manifest beyond what Rust checks (Rust is install-time
 *  authority; this guards builtin/AI paths that skip the installer). Returns
 *  human-readable problems; empty = valid. */
export function validateManifest(manifest: PluginManifest): string[] {
  const problems: string[] = [];
  if (!isValidPluginId(manifest.id)) problems.push(`bad id "${manifest.id}"`);
  if (!manifest.name?.trim()) problems.push("name is empty");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push(`bad version "${manifest.version}"`);
  if (manifest.minAppVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(manifest.minAppVersion)) {
    problems.push(`bad minAppVersion "${manifest.minAppVersion}"`);
  }
  if (manifest.tier !== "declarative" && manifest.tier !== "js") {
    problems.push(`bad tier "${manifest.tier}"`);
  }
  for (const p of unknownPermissions(manifest.permissions ?? [])) {
    problems.push(`unknown permission "${p}"`);
  }
  return problems;
}
