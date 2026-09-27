/**
 * @ccgui/plugin-sdk — 插件系统契约包（single source of truth）。
 *
 * 宿主（src/features/plugins/）实现这里定义的接口；插件（独立仓库）只依赖
 * 这里的类型与常量。版本独立演进（见 CHANGELOG.md），插件经 manifest 的
 * `sdkVersion` range 声明兼容区间，宿主加载时握手校验。
 *
 * 本文件是纯 re-export barrel；实现按关注点拆分为同目录模块：
 * - manifest.ts    基础类型 + PluginManifest / JSON Schema（零运行时依赖）
 * - permissions.ts 权限全集与 network:/exec: 授权（零依赖，Node 脚本可用）
 * - version.ts     SDK_VERSION / 版本比较与 range 求值（零依赖）
 * - registry.ts    扩展点 Def 类型 + Registry/useRegistry + 注册表单例
 *                  （包内唯一依赖 React 运行时的模块）
 * - context.ts     PluginContext 门面接口（纯类型）
 *
 * 权限/授权形状的单一事实源是 spec/permissions.json（TS/Rust/模板三方消费）。
 * 分层信任模型见 .omx/plans/plugin-system-plan.md ADR-1。
 */

export * from "./manifest";
export * from "./permissions";
export * from "./version";
export * from "./registry";
export * from "./context";
/**
 * 类型漂移守卫的编译锚点（P3）：contract-check.ts 纯类型、无运行时代码，
 * 但只有被编译图引用才会真正参与 typecheck。此前它既不在 barrel 里也没人
 * import，宿主 `tsc --noEmit` 与包自身的 typecheck 脚本都不覆盖它，
 * plugin.d.ts 与 src/* 的漂移会静默发布。这条副作用 import 让任何导入本包
 * 的编译单元（含宿主 build 的 tsc 阶段）都把守卫拉进编译图——运行时零产物。
 */
import "./contract-check";
