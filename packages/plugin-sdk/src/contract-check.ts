import type * as Pub from "../plugin";
import type {
  ComposerSlotId,
  Disposer,
  JsonSchemaObject,
  JsonSchemaProperty,
  PluginContext,
  PluginManifest,
  PluginTier,
} from "./index";

/**
 * 契约漂移守卫（纯类型层面，无运行时代码；经 tsconfig include 参与
 * typecheck，刻意不从 barrel 导出）。
 *
 * 包根 plugin.d.ts 是插件作者面对的公共 API 镜像（VS Code 的 vscode.d.ts
 * 同款模式），必须与 src/* 的宿主侧定义保持同步：任何一侧增删/改形，
 * 本文件即编译错误。
 *
 * 两个断言维度：
 * - Mutual：双向可赋值（结构等价），用于无组件字段的纯数据类型。
 * - KeyParity：key 集合完全一致（增删方法即失败），用于 PluginContext
 *   各能力组。ui 组含组件类型——plugin.d.ts 用独立的 ComponentLike 而
 *   宿主侧用 React ComponentType（刻意分歧，blob bundle 无法共享 React
 *   类型身份），故含组件的组只校 key 不校赋值。
 */

/** T 必须为 true 才能实例化；false 落在 extends 约束外即编译错误。 */
type Assert<T extends true> = T;

/** A 与 B 双向可赋值。元组包裹避免联合类型的分配律干扰。 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** A 与 B 的 key 集合完全一致（双向子集）。 */
type KeyParity<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;

// --- 纯数据类型：双向可赋值 -------------------------------------------------

type _PluginManifest = Assert<Mutual<PluginManifest, Pub.PluginManifest>>;
type _JsonSchemaObject = Assert<Mutual<JsonSchemaObject, Pub.JsonSchemaObject>>;
type _JsonSchemaProperty = Assert<Mutual<JsonSchemaProperty, Pub.JsonSchemaProperty>>;
type _ComposerSlotId = Assert<Mutual<ComposerSlotId, Pub.ComposerSlotId>>;
type _PluginTier = Assert<Mutual<PluginTier, Pub.PluginTier>>;
type _Disposer = Assert<Mutual<Disposer, Pub.Disposer>>;

// --- PluginContext：顶层与各能力组 key 完全对齐 ------------------------------

type _ContextKeys = Assert<KeyParity<PluginContext, Pub.PluginContext>>;
type _UiKeys = Assert<KeyParity<PluginContext["ui"], Pub.PluginContext["ui"]>>;
type _ThemeKeys = Assert<KeyParity<PluginContext["theme"], Pub.PluginContext["theme"]>>;
type _I18nKeys = Assert<KeyParity<PluginContext["i18n"], Pub.PluginContext["i18n"]>>;
type _StorageKeys = Assert<KeyParity<PluginContext["storage"], Pub.PluginContext["storage"]>>;
type _EventsKeys = Assert<KeyParity<PluginContext["events"], Pub.PluginContext["events"]>>;
type _ComposerKeys = Assert<KeyParity<PluginContext["composer"], Pub.PluginContext["composer"]>>;
type _BridgeKeys = Assert<KeyParity<PluginContext["bridge"], Pub.PluginContext["bridge"]>>;
type _HostKeys = Assert<KeyParity<PluginContext["host"], Pub.PluginContext["host"]>>;

// --- 无组件字段的能力组：进一步要求双向可赋值 --------------------------------

type _ThemeShape = Assert<Mutual<PluginContext["theme"], Pub.PluginContext["theme"]>>;
type _I18nShape = Assert<Mutual<PluginContext["i18n"], Pub.PluginContext["i18n"]>>;
type _StorageShape = Assert<Mutual<PluginContext["storage"], Pub.PluginContext["storage"]>>;
type _EventsShape = Assert<Mutual<PluginContext["events"], Pub.PluginContext["events"]>>;
type _ComposerShape = Assert<Mutual<PluginContext["composer"], Pub.PluginContext["composer"]>>;
type _BridgeShape = Assert<Mutual<PluginContext["bridge"], Pub.PluginContext["bridge"]>>;
type _HostShape = Assert<Mutual<PluginContext["host"], Pub.PluginContext["host"]>>;
