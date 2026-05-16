# `src/components/ui/`

可复用的基础 UI 组件落位目录。

> 本目录与 `.trellis/spec/frontend/directory-structure.md` 一致：可复用基础 UI → `src/components/ui`；feature business logic 严禁塞进来。

## 体系迁移状态（2026-05）

当前目录混合了两个体系，正在统一向 **coss.ui（Base UI 底层）** 收敛：

| 状态 | 含义 |
|---|---|
| **legacy / shadcn-radix** | 当前 24 个文件（`accordion.tsx`、`button.tsx`、`dropdown-menu.tsx`、`select.tsx` 等）使用 shadcn 风格 + `radix-ui` 底层。Phase 1+ 会按 task `05-16-migrate-css-to-coss-ui` 逐个替换为 coss。 |
| **coss** | 迁移后目标态。每个 primitive 严格遵循 `.agents/skills/coss/references/primitives/<name>.md`。 |

迁移规划完整版：`docs/migration-to-coss-ui.md`。

## 添加 / 替换 coss 组件

```bash
# 单个组件
npx shadcn@latest add @coss/<name>

# 例：dialog
npx shadcn@latest add @coss/dialog
```

执行后会在本目录写入或覆盖对应文件。**必须**：

1. 先阅读 `.agents/skills/coss/references/primitives/<name>.md`，确认 import、props、composition、pitfalls。
2. 至少参考一个 particle：`apps/ui/registry/default/particles/p-<name>-N.tsx`（catalog: https://coss.com/ui/particles）。
3. 按 `.agents/skills/coss/references/rules/migration.md` 修正所有调用点（`asChild` → `render`、`onSelect` → `onClick`、Select items-first、ToggleGroup `multiple`、Slider scalar、Accordion `defaultValue` 数组 等）。
4. 测试通过 `tooltip-icon-button.test.tsx` / `LoadingProgressDialog.test.tsx` 这一类既有 unit test 验证 contract。

## 命名约定

- 文件名：小写连字符（`alert-dialog.tsx`、`dropdown-menu.tsx`）——与 coss/shadcn CLI 默认输出一致。
- 复合自定义组件（基于 coss 原语二次封装）：PascalCase（`LoadingProgressDialog.tsx`、`RendererContextMenu.tsx`）。
- 测试与源码同目录：`<name>.test.tsx`。

## 禁止项

- ❌ 不要混用 shadcn 风格 API 与 coss API（例如 coss `DialogTrigger` 用 `render`，不是 `asChild`）。
- ❌ 不要把 feature business state 放进 `src/components/ui`（放到对应 `src/features/<feature>/...`）。
- ❌ 不要在 ui 组件里直接 import `@/styles/**.css`——base style 由 `src/styles/coss.css`（Phase 1 起）统一管理。
- ❌ 不要把 `--alpha()` 改成 `color-mix()` / `rgba()`：那是 coss / Tailwind v4 合法语法。

## 引用

- `.trellis/spec/frontend/component-guidelines.md` — 组件设计、props、styling 规范。
- `.trellis/spec/frontend/directory-structure.md` — 全前端落位规则。
- `.agents/skills/coss/SKILL.md` — coss skill entry。
- `.agents/skills/coss/references/component-registry.md` — 53 个 coss primitive 索引。
- `.agents/skills/coss/references/rules/` — styling / forms / composition / migration 详细规则。
- `docs/migration-to-coss-ui.md` — coss 迁移路线图与 follow-up 清单。
