import type * as Pub from "../plugin";
import type {
  AfterTurnEvent,
  AssetDirectoryGrant,
  AssistantCompletedEvent,
  BeforeTurnEvent,
  BeforeTurnResult,
  ComposerSlotId,
  CommandFinishedEvent,
  CommandStartedEvent,
  Disposer,
  DocumentReadResult,
  DocumentStorage,
  DocumentStorageLocationKind,
  DocumentWriteResult,
  ExternalSessionRow,
  FileChangedEvent,
  InternalMessageCapture,
  InternalMessageEvent,
  isValidPluginId,
  JsonSchemaObject,
  JsonSchemaProperty,
  NormalizedRuntimeEvent,
  PermissionRequestedEvent,
  PluginAssets,
  PluginContext,
  PluginConversationProps,
  PluginAgentCatalogEntry,
  PluginManifest,
  PluginTier,
  PromptContribution,
  ResolvedDocumentStorageLocation,
  RuntimeExitedEvent,
  RuntimeSwitchEvent,
  RuntimeSwitchHooks,
  SessionClosedEvent,
  SessionCreatedEvent,
  SessionHooks,
  SessionMenuTarget,
  SessionRestoredEvent,
  ToolFinishedEvent,
  TurnCancelledEvent,
  TurnFailedEvent,
  TurnHooks,
  WorkspaceMenuLabel,
  WorkspaceMenuLabelValue,
  WorkspaceMenuStatusTone,
  WorkspaceMetadata,
  RegisteredWorkspace,
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

export type _PluginManifest = Assert<Mutual<PluginManifest, Pub.PluginManifest>>;
export type _JsonSchemaObject = Assert<Mutual<JsonSchemaObject, Pub.JsonSchemaObject>>;
export type _JsonSchemaProperty = Assert<Mutual<JsonSchemaProperty, Pub.JsonSchemaProperty>>;
export type _ComposerSlotId = Assert<Mutual<ComposerSlotId, Pub.ComposerSlotId>>;
export type _SessionMenuTarget = Assert<Mutual<SessionMenuTarget, Pub.SessionMenuTarget>>;
export type _PluginTier = Assert<Mutual<PluginTier, Pub.PluginTier>>;
export type _Disposer = Assert<Mutual<Disposer, Pub.Disposer>>;
export type _PluginIdValidator = Assert<Mutual<typeof isValidPluginId, typeof Pub.isValidPluginId>>;
export type _WorkspaceMetadata = Assert<Mutual<WorkspaceMetadata, Pub.WorkspaceMetadata>>;
export type _RegisteredWorkspace = Assert<Mutual<RegisteredWorkspace, Pub.RegisteredWorkspace>>;
export type _ExternalSessionRow = Assert<Mutual<ExternalSessionRow, Pub.ExternalSessionRow>>;
export type _WorkspaceMenuStatusTone = Assert<Mutual<WorkspaceMenuStatusTone, Pub.WorkspaceMenuStatusTone>>;
export type _WorkspaceMenuLabel = Assert<Mutual<WorkspaceMenuLabel, Pub.WorkspaceMenuLabel>>;
export type _WorkspaceMenuLabelValue = Assert<Mutual<WorkspaceMenuLabelValue, Pub.WorkspaceMenuLabelValue>>;

export type _PromptContribution = Assert<Mutual<PromptContribution, Pub.PromptContribution>>;
export type _InternalMessageCapture = Assert<Mutual<InternalMessageCapture, Pub.InternalMessageCapture>>;
export type _BeforeTurnResult = Assert<Mutual<BeforeTurnResult, Pub.BeforeTurnResult>>;
export type _SessionCreatedEvent = Assert<Mutual<SessionCreatedEvent, Pub.SessionCreatedEvent>>;
export type _SessionRestoredEvent = Assert<Mutual<SessionRestoredEvent, Pub.SessionRestoredEvent>>;
export type _SessionClosedEvent = Assert<Mutual<SessionClosedEvent, Pub.SessionClosedEvent>>;
export type _BeforeTurnEvent = Assert<Mutual<BeforeTurnEvent, Pub.BeforeTurnEvent>>;
export type _AfterTurnEvent = Assert<Mutual<AfterTurnEvent, Pub.AfterTurnEvent>>;
export type _InternalMessageEvent = Assert<Mutual<InternalMessageEvent, Pub.InternalMessageEvent>>;
export type _RuntimeSwitchEvent = Assert<Mutual<RuntimeSwitchEvent, Pub.RuntimeSwitchEvent>>;
export type _FileChangedEvent = Assert<Mutual<FileChangedEvent, Pub.FileChangedEvent>>;
export type _CommandStartedEvent = Assert<Mutual<CommandStartedEvent, Pub.CommandStartedEvent>>;
export type _CommandFinishedEvent = Assert<Mutual<CommandFinishedEvent, Pub.CommandFinishedEvent>>;
export type _ToolFinishedEvent = Assert<Mutual<ToolFinishedEvent, Pub.ToolFinishedEvent>>;
export type _PermissionRequestedEvent = Assert<Mutual<PermissionRequestedEvent, Pub.PermissionRequestedEvent>>;
export type _AssistantCompletedEvent = Assert<Mutual<AssistantCompletedEvent, Pub.AssistantCompletedEvent>>;
export type _TurnCancelledEvent = Assert<Mutual<TurnCancelledEvent, Pub.TurnCancelledEvent>>;
export type _TurnFailedEvent = Assert<Mutual<TurnFailedEvent, Pub.TurnFailedEvent>>;
export type _RuntimeExitedEvent = Assert<Mutual<RuntimeExitedEvent, Pub.RuntimeExitedEvent>>;
export type _NormalizedRuntimeEvent = Assert<Mutual<NormalizedRuntimeEvent, Pub.NormalizedRuntimeEvent>>;
export type _SessionHooks = Assert<Mutual<SessionHooks, Pub.SessionHooks>>;
export type _TurnHooks = Assert<Mutual<TurnHooks, Pub.TurnHooks>>;
export type _RuntimeSwitchHooks = Assert<Mutual<RuntimeSwitchHooks, Pub.RuntimeSwitchHooks>>;
export type _DocumentStorageLocationKind = Assert<
  Mutual<DocumentStorageLocationKind, Pub.DocumentStorageLocationKind>
>;
export type _ResolvedDocumentStorageLocation = Assert<
  Mutual<ResolvedDocumentStorageLocation, Pub.ResolvedDocumentStorageLocation>
>;
export type _DocumentReadResult = Assert<Mutual<DocumentReadResult, Pub.DocumentReadResult>>;
export type _DocumentWriteResult = Assert<Mutual<DocumentWriteResult, Pub.DocumentWriteResult>>;
export type _DocumentStorage = Assert<Mutual<DocumentStorage, Pub.DocumentStorage>>;
export type _AssetDirectoryGrant = Assert<Mutual<AssetDirectoryGrant, Pub.AssetDirectoryGrant>>;
export type _PluginAssets = Assert<Mutual<PluginAssets, Pub.PluginAssets>>;

// --- 可选成员漂移 -----------------------------------------------------------
// Mutual 的双向可赋值对「一侧新增**可选**字段/可选参数」不敏感（可选属性
// 与尾随可选参数在结构赋值中被忽略）。故对本次新增的可选成员单列断言：
// 带可选字段的结构检查 key 集合，带可选参数的方法检查参数元组。

/** 单方法的参数元组——捕获可选参数差异，Mutual 对参数列表不敏感。 */
type Params<F> = F extends (...args: infer P) => unknown ? P : never;

export type _BeforeTurnResultKeys = Assert<KeyParity<BeforeTurnResult, Pub.BeforeTurnResult>>;
export type _TurnHooksKeys = Assert<KeyParity<TurnHooks, Pub.TurnHooks>>;
export type _InternalMessageCaptureKeys = Assert<
  KeyParity<InternalMessageCapture, Pub.InternalMessageCapture>
>;
export type _DocumentStorageRemoveParams = Assert<
  Mutual<Params<DocumentStorage["remove"]>, Params<Pub.DocumentStorage["remove"]>>
>;
export type _ConversationProps = Assert<Mutual<PluginConversationProps, Pub.PluginConversationProps>>;
export type _AgentCatalogEntry = Assert<Mutual<PluginAgentCatalogEntry, Pub.PluginAgentCatalogEntry>>;
export type _AgentShape = Assert<Mutual<PluginContext["agent"], Pub.PluginContext["agent"]>>;

// --- PluginContext：顶层与各能力组 key 完全对齐 ------------------------------

export type _ContextKeys = Assert<KeyParity<PluginContext, Pub.PluginContext>>;
export type _UiKeys = Assert<KeyParity<PluginContext["ui"], Pub.PluginContext["ui"]>>;
export type _ThemeKeys = Assert<KeyParity<PluginContext["theme"], Pub.PluginContext["theme"]>>;
export type _I18nKeys = Assert<KeyParity<PluginContext["i18n"], Pub.PluginContext["i18n"]>>;
export type _StorageKeys = Assert<KeyParity<PluginContext["storage"], Pub.PluginContext["storage"]>>;
export type _EventsKeys = Assert<KeyParity<PluginContext["events"], Pub.PluginContext["events"]>>;
export type _ComposerKeys = Assert<KeyParity<PluginContext["composer"], Pub.PluginContext["composer"]>>;
export type _WorkspacesKeys = Assert<KeyParity<PluginContext["workspaces"], Pub.PluginContext["workspaces"]>>;
export type _SessionsKeys = Assert<KeyParity<PluginContext["sessions"], Pub.PluginContext["sessions"]>>;
export type _BridgeKeys = Assert<KeyParity<PluginContext["bridge"], Pub.PluginContext["bridge"]>>;
export type _HostKeys = Assert<KeyParity<PluginContext["host"], Pub.PluginContext["host"]>>;
export type _HooksKeys = Assert<KeyParity<PluginContext["hooks"], Pub.PluginContext["hooks"]>>;
export type _WorkspaceKeys = Assert<KeyParity<PluginContext["workspace"], Pub.PluginContext["workspace"]>>;
export type _AssetsKeys = Assert<KeyParity<PluginContext["assets"], Pub.PluginContext["assets"]>>;
export type _ShellKeys = Assert<KeyParity<PluginContext["shell"], Pub.PluginContext["shell"]>>;
export type _AgentKeys = Assert<KeyParity<PluginContext["agent"], Pub.PluginContext["agent"]>>;
export type _DocumentStorageKeys = Assert<
  KeyParity<PluginContext["documentStorage"], Pub.PluginContext["documentStorage"]>
>;

// --- 无组件字段的能力组：进一步要求双向可赋值 --------------------------------

export type _ThemeShape = Assert<Mutual<PluginContext["theme"], Pub.PluginContext["theme"]>>;
export type _I18nShape = Assert<Mutual<PluginContext["i18n"], Pub.PluginContext["i18n"]>>;
export type _StorageShape = Assert<Mutual<PluginContext["storage"], Pub.PluginContext["storage"]>>;
export type _EventsShape = Assert<Mutual<PluginContext["events"], Pub.PluginContext["events"]>>;
export type _ComposerShape = Assert<Mutual<PluginContext["composer"], Pub.PluginContext["composer"]>>;
export type _WorkspacesShape = Assert<Mutual<PluginContext["workspaces"], Pub.PluginContext["workspaces"]>>;
export type _SessionsShape = Assert<Mutual<PluginContext["sessions"], Pub.PluginContext["sessions"]>>;
export type _BridgeShape = Assert<Mutual<PluginContext["bridge"], Pub.PluginContext["bridge"]>>;
export type _HostShape = Assert<Mutual<PluginContext["host"], Pub.PluginContext["host"]>>;
export type _HooksShape = Assert<Mutual<PluginContext["hooks"], Pub.PluginContext["hooks"]>>;
export type _WorkspaceShape = Assert<Mutual<PluginContext["workspace"], Pub.PluginContext["workspace"]>>;
export type _AssetsShape = Assert<Mutual<PluginContext["assets"], Pub.PluginContext["assets"]>>;
export type _ShellShape = Assert<Mutual<PluginContext["shell"], Pub.PluginContext["shell"]>>;
export type _DocumentStorageShape = Assert<
  Mutual<PluginContext["documentStorage"], Pub.PluginContext["documentStorage"]>
>;
