import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * 内置插件开发 skill 的文档生成器（scripts/build-plugin-skill-docs.ts +
 * creator-skill-docs.test.ts 消费；应用代码不 import 本模块）。
 *
 * 动机：skill 是插件作者（含 AI）看到的 SDK 说明书，而 SDK 会持续迭代。
 * 与其靠人记得同步，不如让 SDK/宿主源码成为唯一事实源——本模块用 TS AST
 * 从以下文件派生 skill 内的 `references/sdk-api.md`：
 *
 * - packages/plugin-sdk/src/version.ts          SDK_VERSION
 * - packages/plugin-sdk/src/manifest.ts         manifest 字段 + activate 契约
 * - packages/plugin-sdk/src/context.ts          PluginContext 各能力组与签名
 * - packages/plugin-sdk/spec/permissions.json   权限全集（安全边界）
 * - src/features/plugins/runtime/context.ts     扩展点 → 权限门禁（requirePermission）
 *
 * `SKILL.md`（工作流与硬性约束）手写，references/ 下的 SDK 参考全部由本模块生成；
 * 测试断言磁盘内容 == 生成内容：SDK 改了没重新生成就红。
 *
 * 刻意不复制 docs/plugin-development-guide.zh-CN.md：那份规范面向市场提交，
 * 且当前已与 SDK 漂移（如已不存在的 repo/license 字段、events:usage 权限）；
 * 复制一份过期快照进 skill 比没有更糟。
 */

/** skill 在仓库内的源目录（同时是 Tauri 资源目录，见 tauri.conf.json）。 */
export const CREATOR_SKILL_DIR = "src-tauri/resources/skills/ccgui-plugin-creator";

/** 生成物相对 skill 根的文件名。 */
export const GENERATED_SDK_DOC = "references/sdk-api.md";

/** 仓库根：本文件位于 <root>/src/features/plugins/skill/。 */
export function repoRootFromHere(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export interface SkillDocFile {
  /** 相对 skill 根的路径（POSIX 分隔符）。 */
  path: string;
  content: string;
}

// ── AST 工具 ────────────────────────────────────────────────────────────────

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/** JSDoc 全文压成一行（表格里要单行；多行说明全部保留，不截断）。 */
function jsDocLine(node: ts.Node): string {
  const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  const comment = docs.length ? (docs[docs.length - 1] as ts.JSDoc).comment : undefined;
  if (comment === undefined) return "";
  const text = typeof comment === "string" ? comment : comment.map((c) => c.text).join("");
  return text
    .replace(/^\s*\*?\s?/gm, " ")
    .replace(/\s+/g, " ")
    .replace(/"$/g, "")
    .trim();
}

/** 表格单元格：不能有换行，`|` 需转义。 */
function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function literalName(node: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

// ── 紧凑类型渲染（生成的签名要一行一条，人能读、模型能抄） ──────────────────

function compactParams(params: readonly ts.ParameterDeclaration[]): string {
  return params
    .map((p) => {
      const name = typeof p.name.getText === "function" ? p.name.getText() : "";
      const rest = p.dotDotDotToken ? "..." : "";
      const optional = p.questionToken ? "?" : "";
      return `${rest}${name}${optional}: ${compactType(p.type)}`;
    })
    .join(", ");
}

/** 方法签名的类型参数（如 `get<T>`）：丢掉会让引用它的插件写出错误代码。 */
function compactTypeParams(params: readonly ts.TypeParameterDeclaration[] | undefined): string {
  if (!params || params.length === 0) return "";
  return `<${params
    .map((p) =>
      p.constraint
        ? `${p.name.getText()} extends ${compactType(p.constraint)}`
        : p.name.getText(),
    )
    .join(", ")}>`;
}

function compactMember(member: ts.TypeElement): string {
  if (ts.isPropertySignature(member)) {
    const name = literalName(member.name) ?? member.name.getText();
    const optional = member.questionToken ? "?" : "";
    const type = member.type;
    if (type && ts.isFunctionTypeNode(type)) {
      return `${name}${optional}${compactTypeParams(type.typeParameters)}(${compactParams(type.parameters)}): ${compactType(type.type)}`;
    }
    return `${name}${optional}: ${compactType(type)}`;
  }
  if (ts.isMethodSignature(member)) {
    const name = literalName(member.name) ?? member.name.getText();
    const optional = member.questionToken ? "?" : "";
    return `${name}${optional}${compactTypeParams(member.typeParameters)}(${compactParams(member.parameters)}): ${compactType(member.type)}`;
  }
  return "";
}

/** 递归渲染类型源码文本：类型字面量收成一行，避免 printer 把 `{ className?: string }` 折成四行。 */
function compactType(node: ts.TypeNode | undefined): string {
  if (!node) return "";
  switch (node.kind) {
    case ts.SyntaxKind.TypeLiteral: {
      const members = (node as ts.TypeLiteralNode).members.map(compactMember).filter(Boolean);
      return members.length ? `{ ${members.join("; ")} }` : "{}";
    }
    case ts.SyntaxKind.FunctionType: {
      const fn = node as ts.FunctionTypeNode;
      return `(${compactParams(fn.parameters)}) => ${compactType(fn.type)}`;
    }
    case ts.SyntaxKind.UnionType:
      return (node as ts.UnionTypeNode).types.map((t) => compactType(t)).join(" | ");
    case ts.SyntaxKind.IntersectionType:
      return (node as ts.IntersectionTypeNode).types.map((t) => compactType(t)).join(" & ");
    case ts.SyntaxKind.ArrayType:
      return `${compactType((node as ts.ArrayTypeNode).elementType)}[]`;
    case ts.SyntaxKind.ParenthesizedType:
      return `(${compactType((node as ts.ParenthesizedTypeNode).type)})`;
    case ts.SyntaxKind.TypeReference: {
      const ref = node as ts.TypeReferenceNode;
      const base = ref.typeName.getText();
      const args = ref.typeArguments;
      return args && args.length > 0 ? `${base}<${args.map((t) => compactType(t)).join(", ")}>` : base;
    }
    default:
      return node.getText().replace(/\s+/g, " ").trim();
  }
}

// ── 源码提取 ────────────────────────────────────────────────────────────────

interface ManifestField {
  name: string;
  type: string;
  optional: boolean;
  doc: string;
}

interface ContextMember {
  name: string;
  /** 成员签名，一行（`name(args): T`）或属性（`name: T`）。 */
  signature: string;
  doc: string;
}

interface ContextGroup {
  name: string;
  doc: string;
  members: ContextMember[];
  supportingTypes?: string[];
}

function extractManifest(source: ts.SourceFile): ManifestField[] {
  const fields: ManifestField[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "PluginManifest") {
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = literalName(member.name);
        if (!name) continue;
        fields.push({
          name,
          type: compactType(member.type),
          optional: Boolean(member.questionToken),
          doc: jsDocLine(member),
        });
      }
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (fields.length === 0) throw new Error("[plugin-skill] PluginManifest not found in manifest.ts");
  return fields;
}

/** activate 的返回值类型（清理函数），不是整个函数类型。 */
function extractActivateReturn(source: ts.SourceFile): string {
  let code = "";
  const walk = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "PluginActivate") {
      const type = node.type;
      if (ts.isFunctionTypeNode(type)) code = compactType(type.type);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (!code) throw new Error("[plugin-skill] PluginActivate not found in manifest.ts");
  return code;
}

/** Expand same-file capability interfaces as well as inline groups. */
function extractContextGroups(source: ts.SourceFile): { groups: ContextGroup[]; scalars: ContextMember[] } {
  const groups: ContextGroup[] = [];
  const scalars: ContextMember[] = [];
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  for (const node of source.statements) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      declarations.set(node.name.text, node);
    }
  }
  const supportingTypes = (root: ts.InterfaceDeclaration): string[] => {
    const visited = new Set([root.name.text]);
    const definitions: string[] = [];
    const collect = (node: ts.Node): void => {
      const name = ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)
        ? node.typeName.text
        : ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)
          ? node.expression.text
          : null;
      const declaration = name ? declarations.get(name) : undefined;
      if (declaration && !visited.has(declaration.name.text)) {
        visited.add(declaration.name.text);
        definitions.push(declaration.getText(source).replace(/\r\n?/g, "\n"));
        ts.forEachChild(declaration, collect);
      }
      ts.forEachChild(node, collect);
    };
    ts.forEachChild(root, collect);
    return definitions;
  };
  const walk = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "PluginContext") {
      for (const member of node.members) {
        const name = literalName(member.name);
        if (!name || !ts.isPropertySignature(member)) continue;
        const type = member.type;
        const referenced = type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)
          ? declarations.get(type.typeName.text)
          : undefined;
        const declaration = referenced && ts.isInterfaceDeclaration(referenced) ? referenced : undefined;
        const groupMembers = type && ts.isTypeLiteralNode(type) ? type.members : declaration?.members;
        if (groupMembers) {
          const members: ContextMember[] = [];
          for (const inner of groupMembers) {
            const signature = compactMember(inner);
            if (!signature) continue;
            members.push({ name: signature.split(/[(?:]/)[0]!, signature, doc: jsDocLine(inner) });
          }
          groups.push({ name, doc: jsDocLine(member), members,
            supportingTypes: declaration ? supportingTypes(declaration) : undefined });
          continue;
        }
        scalars.push({ name, signature: `${name}${member.questionToken ? "?" : ""}: ${compactType(type)}`, doc: jsDocLine(member) });
      }
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  if (groups.length === 0) throw new Error("[plugin-skill] PluginContext not found in context.ts");
  return { groups, scalars };
}

/**
 * 扩展点 → 权限：宿主运行时每个受门禁的方法首句是
 * `requirePermission("<权限>")`；嵌套在条件里的额外门禁（如
 * host:workspace:remote）按出现顺序排在后面，渲染时标为「按需」。
 *
 * 直接调用不够：`ctx.theme.setTokens` 自己不写 requirePermission，而是转发给
 * `ctx.theme.injectCss`。因此还要收集方法体内对同包其他方法的调用，做传递闭包。
 */
function extractPermissionGates(source: ts.SourceFile): Map<string, string[]> {
  interface Raw {
    direct: string[];
    calls: string[];
  }
  const raw = new Map<string, Raw>();
  const collectCalls = (node: ts.Node, gates: string[], calls: string[]) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "requirePermission"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) gates.push(arg.text);
    }
    // ctx.<group>.<method>(…) 转发调用（只认 ctx 开头，避免误抓同名局部函数）
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const owner = node.expression.expression;
      if (
        ts.isPropertyAccessExpression(owner) &&
        owner.expression.getText(source) === "ctx"
      ) {
        calls.push(`${owner.name.text}.${method}`);
      }
    }
    ts.forEachChild(node, (child) => collectCalls(child, gates, calls));
  };
  const walkObject = (obj: ts.ObjectLiteralExpression, prefix: string[]) => {
    for (const prop of obj.properties) {
      const name = literalName(prop.name);
      if (!name) continue;
      const pathParts = [...prefix, name];
      const body = ts.isPropertyAssignment(prop)
        ? prop.initializer
        : ts.isMethodDeclaration(prop)
          ? prop
          : undefined;
      if (!body) continue;
      if (ts.isObjectLiteralExpression(body)) {
        walkObject(body, pathParts);
        continue;
      }
      const gates: string[] = [];
      const calls: string[] = [];
      collectCalls(body, gates, calls);
      if (gates.length > 0 || calls.length > 0) {
        raw.set(pathParts.join("."), { direct: gates, calls });
      }
    }
  };
  const walk = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      literalName(node.name) === "ctx" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      walkObject(node.initializer, []);
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(source);

  // 传递闭包：转发到受门禁方法的，继承其权限（固定点，链式转发也能收敛）。
  const resolve = (path: string, seen: Set<string>): string[] => {
    const entry = raw.get(path);
    if (!entry || seen.has(path)) return [];
    if (entry.direct.length > 0) return entry.direct;
    seen.add(path);
    for (const called of entry.calls) {
      const inherited = resolve(called, seen);
      if (inherited.length > 0) return inherited;
    }
    return [];
  };
  const gates = new Map<string, string[]>();
  for (const path of raw.keys()) {
    const resolved = resolve(path, new Set());
    if (resolved.length > 0) gates.set(path, resolved);
  }
  if (gates.size === 0) {
    throw new Error("[plugin-skill] no requirePermission gates found in host context.ts");
  }
  return gates;
}

interface BridgeCommand {
  commands: string[];
  /** 该分支要求的授权（裸字符串或 `network:`/`exec:` 形状描述）。 */
  grants: string[];
}

/**
 * `ctx.bridge.invoke` 的命令表：宿主用 `if (command === "x")` 链逐命令预检授权，
 * 每个分支里的授权检查就是该命令需要的声明。硬写进文档会随实现漂移，所以从
 * if/else 链提取（命令集与授权一起）。
 */
function extractBridgeCommands(source: ts.SourceFile): BridgeCommand[] {
  const out: BridgeCommand[] = [];
  const commandEquals = (cond: ts.Node, acc: string[]) => {
    if (
      ts.isBinaryExpression(cond) &&
      cond.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(cond.left) &&
      cond.left.text === "command" &&
      ts.isStringLiteral(cond.right)
    ) {
      acc.push(cond.right.text);
    }
    ts.forEachChild(cond, (child) => commandEquals(child, acc));
  };
  const grantsIn = (node: ts.Node, acc: string[]) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        if (callee.text === "networkGrantAllows") acc.push("`network:<host>` 授权");
        if (callee.text === "execGrantAllows") acc.push("`exec:<bin>` 授权");
      }
      if (ts.isPropertyAccessExpression(callee)) {
        const arg = node.arguments[0];
        const literal = arg && ts.isStringLiteral(arg) ? arg.text : null;
        if (callee.name.text === "includes" && literal) acc.push(`\`${literal}\``);
        if (callee.name.text === "startsWith" && literal) acc.push(`任意 \`${literal}\` 授权`);
      }
    }
    ts.forEachChild(node, (child) => grantsIn(child, acc));
  };
  const walkIfs = (node: ts.Node) => {
    if (ts.isIfStatement(node)) {
      const commands: string[] = [];
      commandEquals(node.expression, commands);
      if (commands.length > 0) {
        const grants: string[] = [];
        grantsIn(node.thenStatement, grants);
        out.push({ commands, grants: [...new Set(grants)] });
      }
    }
    ts.forEachChild(node, walkIfs);
  };
  // 定位 bridge.invoke 之后再看它的 if 链。
  walkIfs(source);
  if (out.length === 0) throw new Error("[plugin-skill] bridge command table not found in host context.ts");
  return out;
}

interface PermissionsSpec {
  knownPermissions: string[];
  networkGrantShapes: { valid: string[]; invalid: string[] };
}

function readPermissionsSpec(file: string): PermissionsSpec {
  const spec = JSON.parse(readFileSync(file, "utf8")) as Partial<PermissionsSpec>;
  if (!Array.isArray(spec.knownPermissions) || spec.knownPermissions.length === 0) {
    throw new Error(`[plugin-skill] knownPermissions missing in ${file}`);
  }
  return {
    knownPermissions: spec.knownPermissions,
    networkGrantShapes: spec.networkGrantShapes ?? { valid: [], invalid: [] },
  };
}

function extractSdkVersion(file: string): string {
  const match = readFileSync(file, "utf8").match(/export const SDK_VERSION = "([^"]+)"/);
  if (!match) throw new Error("[plugin-skill] SDK_VERSION not found in version.ts");
  return match[1]!;
}

// ── 渲染 ────────────────────────────────────────────────────────────────────

/** 权限单元格：首个是调用前置条件，其余是特定分支的附加授权。 */
function permissionCell(perms: string[] | undefined): string {
  if (!perms || perms.length === 0) return "—";
  const [required, ...extra] = perms;
  const base = `\`${required}\``;
  return extra.length > 0 ? `${base}（${extra.map((p) => `\`${p}\``).join("、")} 按需）` : base;
}

function renderHeader(sdkVersion: string): string {
  return [
    "<!-- 由 src/features/plugins/skill/creator-skill-docs.ts 从源码生成，请勿手改。 -->",
    "<!-- 重新生成：pnpm plugin-skill:docs（测试 creator-skill-docs.test.ts 会断言本文件与源码一致）。 -->",
    "",
    `# CC GUI 插件 SDK 参考（SDK ${sdkVersion}）`,
    "",
    "本文件由脚本从 `packages/plugin-sdk`（公共契约）与宿主运行时（权限门禁）派生，属于 `ccgui-plugin-creator` skill。",
    "字段、方法、权限以本文件为准：**文中没有的 API 一律视为不存在**，不要凭记忆猜测方法名或权限名。",
    "",
  ].join("\n");
}

function renderManifest(fields: ManifestField[], activateReturn: string): string {
  return [
    "## manifest.json 字段",
    "",
    fenced(
      "ts",
      [
        "export default function activate(ctx: PluginContext): " + activateReturn + " {",
        "  …",
        "}",
      ].join("\n"),
    ),
    "",
    "返回值（可选）是卸载清理函数：卸载时先跑它，再按注册顺序逆序执行所有 Disposer；" +
      "插件不需要（也不应该）自己保存 Disposer 列表。",
    "",
    "| 字段 | 类型 | 必填 | 说明 |",
    "|---|---|---|---|",
    ...fields.map(
      (f) =>
        `| \`${f.name}\`${f.optional ? "?" : ""} | \`${cell(f.type)}\` | ${f.optional ? "可选" : "必填"} | ${cell(f.doc) || "—"} |`,
    ),
    "",
    "字段取值规则（`id` 命名、`version` 与 Release tag 的关系、`tier` 取值、`configSchema` 渲染范围、`contributes` 声明式能力）见 " +
      "`references/development-guide.md` §5 与 §8。",
    "",
    "### 版本握手",
    "",
    "- `sdkVersion` 接受：`\"*\"`、精确 `\"0.3.13\"`、`\"^0.3\"`、`\"~0.3.0\"`、`\">=0.3.0\"`；其余写法一律不满足（插件进入 incompatible 态，宿主不会静默放行）。",
    "- 运行时自检用 `ctx.host.sdkVersion` / `ctx.host.appVersion`；`minAppVersion` 由宿主在加载前比对。",
    "",
  ].join("\n");
}

function renderExtensionTable(groups: ContextGroup[], gates: Map<string, string[]>): string {
  const rows: string[] = [];
  for (const group of groups) {
    for (const member of group.members) {
      const gate = gates.get(`${group.name}.${member.name}`);
      // 标量能力组（composer/workspaces/…）的入口也列，ui 之外没有门禁的略过。
      if (!gate && group.name !== "ui") continue;
      rows.push(`| \`ctx.${group.name}.${member.name}\` | ${permissionCell(gate)} | ${cell(member.doc) || "—"} |`);
    }
  }
  return [
    "## 扩展点与所需权限",
    "",
    "声明式能力写进 manifest 的 `contributes`（Tier-0，零 JS）；下表是 JS 插件的注册入口。",
    "**权限列不是建议**：manifest `permissions` 没声明对应权限时，调用会抛错" +
      "（`used <capability> without declaring it`）——先声明权限，再写代码。",
    "",
    "| 入口 | 权限 | 说明 |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function renderGroups(
  groups: ContextGroup[],
  scalars: ContextMember[],
  gates: Map<string, string[]>,
): string {
  const parts: string[] = ["## PluginContext 完整签名", "", "以下签名与 `@ccgui/plugin-sdk` 源码逐字对应（类型已收成一行）。", ""];
  for (const group of groups) {
    parts.push(`### ctx.${group.name}`, "");
    if (group.doc) parts.push(group.doc, "");
    if (group.supportingTypes?.length) parts.push(fenced("ts", group.supportingTypes.join("\n\n")), "");
    const lines = [`${group.name}: {`];
    for (const member of group.members) {
      const gate = gates.get(`${group.name}.${member.name}`);
      if (gate) lines.push(`  /** 权限：${gate.join("、")} */`);
      lines.push(`  ${member.signature};`);
    }
    lines.push("}");
    parts.push(fenced("ts", lines.join("\n")), "");
  }
  if (scalars.length > 0) {
    parts.push("### 标量属性", "");
    parts.push(
      fenced(
        "ts",
        scalars
          .map(
            (m) =>
              `ctx.${m.signature};${m.doc ? ` // ${m.doc.length > 160 ? `${m.doc.slice(0, 160)}…` : m.doc}` : ""}`,
          )
          .join("\n"),
      ),
      "",
    );
  }
  return parts.join("\n");
}

function renderPermissions(
  spec: PermissionsSpec,
  gates: Map<string, string[]>,
  bridge: BridgeCommand[],
): string {
  const usedBy = new Map<string, string[]>();
  for (const [path, perms] of gates) {
    for (const perm of perms) {
      usedBy.set(perm, [...(usedBy.get(perm) ?? []), `\`ctx.${path}\``]);
    }
  }
  const shapes = spec.networkGrantShapes;
  return [
    "## 权限目录",
    "",
    "`manifest.permissions` 只接受下表列出的基座权限，或形状合法的 `network:` / `exec:` 授权；" +
      "未声明能力的调用会抛错，未知权限 = 安装/加载期直接拒绝。",
    "",
    "| 权限 | 门禁的入口 |",
    "|---|---|",
    ...spec.knownPermissions.map(
      (perm) =>
        `| \`${perm}\` | ${(usedBy.get(perm) ?? []).join("、") || "—"} |`,
    ),
    "",
    "### network: / exec: 授权形状",
    "",
    "- `network:<host>`（任意端口）/ `network:<host>:<port>` / `network:<host>:<a>-<b>`（含端点，1–65535）。" +
      "host 精确匹配（大小写不敏感，无通配、子域不命中），仅 http/https。" +
      (shapes.valid.length > 0 ? `合法示例：${shapes.valid.slice(0, 4).map((v) => `\`${v}\``).join("、")}。` : ""),
    "- `exec:<bin>`：裸二进制名（`^[A-Za-z0-9._-]+$`，禁路径分隔符），精确匹配、大小写敏感。",
    "- `network:none` 是基座权限，语义为「本插件不用网络」，**不是**授权——它永远不放行任何主机。",
    "- 出网/执行只能走 `ctx.bridge.invoke` 的命令表（下表从宿主实现提取；未列出的命令名会被 reject）：",
    "",
    "| bridge 命令 | 需要的授权 |",
    "|---|---|",
    ...bridge.map(
      (entry) =>
        `| ${entry.commands.map((c) => `\`${c}\``).join("、")} | ${entry.grants.join("、") || "—"} |`,
    ),
    "",
  ].join("\n");
}

function fenced(lang: string, body: string): string {
  return ["```" + lang, body, "```"].join("\n");
}

/** 生成 skill 内需要脚本维护的全部文件（内容确定：同输入必然同字节）。 */
export function buildCreatorSkillFiles(repoRoot = repoRootFromHere()): SkillDocFile[] {
  const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
  const sdkDir = "packages/plugin-sdk/src";

  const manifestSource = parse(`${sdkDir}/manifest.ts`, read(`${sdkDir}/manifest.ts`));
  const contextSource = parse(`${sdkDir}/context.ts`, read(`${sdkDir}/context.ts`));
  const hostContextPath = "src/features/plugins/runtime/context.ts";
  const hostContextSource = parse(hostContextPath, read(hostContextPath));

  const sdkVersion = extractSdkVersion(path.join(repoRoot, `${sdkDir}/version.ts`));
  const manifestFields = extractManifest(manifestSource);
  const activateReturn = extractActivateReturn(manifestSource);
  const { groups, scalars } = extractContextGroups(contextSource);
  const gates = extractPermissionGates(hostContextSource);
  const bridge = extractBridgeCommands(hostContextSource);
  const permissions = readPermissionsSpec(path.join(repoRoot, "packages/plugin-sdk/spec/permissions.json"));

  const sdkDoc = [
    renderHeader(sdkVersion),
    renderManifest(manifestFields, activateReturn),
    renderExtensionTable(groups, gates),
    renderGroups(groups, scalars, gates),
    renderPermissions(permissions, gates, bridge),
  ].join("\n");

  return [{ path: GENERATED_SDK_DOC, content: sdkDoc }];
}
