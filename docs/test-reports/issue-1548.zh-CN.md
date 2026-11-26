# Issue #1548 纯工具调用组自动收起测试报告

## 需求与测试范围

关联问题：https://github.com/zhukunpenglinyutong/desktop-cc-gui/issues/1548

执行期间展开过程组；回答文字出现或本轮结束后，按现有「思考结束后自动收起」设置收起纯工具组；用户手动展开或收起优先，折叠后仍可展开详情。

本次最终回归仅运行新增功能的 5 个用例，直接依赖为回合状态、回答状态、设置值和手动操作状态，不执行全量回归。

## 环境与版本

- 日期：2026-11-25
- 系统：macOS arm64
- 基线：上游 `v1.2.6`，提交 `1529def67`
- 修复分支：`fix/tool-only-auto-collapse-1548`
- Node.js：26.12.0；pnpm：10.29.3；Vitest：3.2.4
- 运行环境：React DOM / jsdom，组件真实挂载并读取按钮的 `aria-expanded` 状态
- 用例文件：`src/features/chat/components/ProcessDisclosure.test.tsx`

## 根因与修复

最后一个过程组保持 `autoExpand=true`，而自动收起分支又要求 `hasThinking=true`，因此纯工具组在回答开始和回合结束时均保持展开。移除思考内容前置限制和无用的内部参数，使纯工具组复用已有折叠状态机。保留设置开关、手动覆盖和搜索展开逻辑，不变更依赖、IPC 或持久化数据。

## 缺陷复现证据

先新增回归用例，再运行原始实现：5 项中 2 项失败、3 项通过。失败分别发生于「回答开始后应收起」和「无回答文字的回合结束后应收起」，均为预期 `false`、实际 `true`。修复后同组 5 项全部通过。

## 用例清单

公共前置条件：纯工具调用组包含 10 条记录，默认开启自动收起。

| ID | 前置条件 | 操作步骤 | 预期结果 | 实际结果 | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 默认设置 | 执行中追加工具，出现回答文字，结束回合，点击摘要 | 执行中展开，回答开始后收起，结束后保持收起，点击可展开 | 与预期一致 | 通过 | `keeps tools visible while running and folds when the answer starts` |
| TC-02 | 无回答文字 | 执行中切换为回合结束 | 自动收起 | 已收起 | 通过 | `folds tools when the turn ends without answer text` |
| TC-03 | 自动收起关闭 | 出现回答文字，再结束回合 | 保持展开 | 保持展开 | 通过 | `keeps tools expanded when automatic collapse is disabled` |
| TC-04 | 用户主动收起 | 点击收起，出现回答文字，结束回合 | 保留收起状态 | 保持收起 | 通过 | `preserves the user's expanded choice: false` |
| TC-05 | 用户主动展开 | 点击收起再展开，出现回答文字，结束回合 | 保留展开状态 | 保持展开 | 通过 | `preserves the user's expanded choice: true` |

## 最终回归执行

```bash
pnpm exec vitest run src/features/chat/components/ProcessDisclosure.test.tsx -t 'tool-only expansion'
```

结果：1 个测试文件通过，5 项通过、0 项失败；其余 35 项由名称过滤排除。运行包含 Node.js 的 localStorage 实验性警告，不影响断言。

## 修复阶段已完成的检查

以下记录此前修复阶段的检查结果，最终回归未重复执行这些扩大范围的检查。

| 命令 | 范围与结果 |
| --- | --- |
| `pnpm exec vitest run src/features/chat/components/ProcessDisclosure.test.tsx src/features/chat/components/MessageTimeline.test.tsx` | 组件与直接时间线调用链，80 项通过 |
| `pnpm build` | TypeScript 检查与 Vite 构建通过；输出 CSS 伪元素、混合导入和包体积警告 |
| `pnpm exec vitest run src/features/chat` | 1063 项通过、5 项失败；原始实现复跑对应两个文件，同样 5 项失败 |
| `git diff --check` | 通过 |

上述既有失败为 `context-window-memory.test.ts` 的 1 项存储写入模拟断言失败，以及 `text-reference.acceptance.test.tsx` 的 4 项读取参数断言失败。前者模拟未拦截实际写入，后者实际调用多出第二个 `undefined` 参数。修复前后结果一致，未改动、删除或跳过这些测试。

## 代码审查与终审

已核对 `ProcessDisclosure` 状态转换与 `MessageTimeline` 的 `autoExpand`、`turnLive`、`answered` 传参，检查设置关闭、手动覆盖、搜索请求优先级及思考恢复路径。移除的内部参数无剩余调用；变更不增加子进程、凭据读取、远程代码或系统输入输出能力。同步更新交互规范。未发现阻塞提交的问题。

## 缺陷列表与覆盖边界

- 本功能的最终回归未发现缺陷。
- 既有聊天模块失败项如上，属于此前检查记录，不属于本轮定向回归范围。
- 本报告覆盖组件状态行为，不包含 Windows 原生窗口、真实引擎回合或设置页面持久化实测。

## 结论

通过：本次新增功能的 5 个定向回归用例全部通过，执行中展开、结束后收起、设置关闭、手动选择和重新展开行为符合要求。
