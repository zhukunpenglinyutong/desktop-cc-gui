# #1521 引用选区到对话测试报告

## 环境与方法

- 基于上游 v1.2.5 的 `0f330a9b9`，在 macOS 使用 Node.js 26.12.0、pnpm 10.29.3 和锁文件中的依赖运行。
- jsdom 挂载实际的 CodeMirror、输入框和历史消息组件。文件读取、历史页和发送在 IPC 边界使用模拟响应。队列由合成的引擎完成事件推进，无需账户或模型服务。

## 功能验收

| 场景 | 验收断言 | 结果 |
|---|---|---|
| 选区与草稿 | 反向选择含中文、emoji、缩进和未保存改动的多行文本。选区止于下一行行首时，行范围排除该行。保留两个会话各自的草稿，切回后引用仍可编辑。空选区及跨工作区文件无法引用。 | 通过 |
| 直接发送 | 从实际输入框提交，在 IPC 边界核对目标会话、工作区及完整正文。 | 通过 |
| 排队发送 | 上一轮正在生成时入队。修改文件、切换会话并重复投递上一轮完成事件后，原会话只收到一次与入队时相同的正文。 | 通过 |
| 历史定位，文件未打开 | 从模拟持久化页加载消息，点击引用后等待读取完成，打开原工作区中带中文和空格的文件并选中对应行。 | 通过 |
| 历史定位，文件已打开 | 复用编辑器，选中对应行，无重复读取。 | 通过 |
| 历史定位，Markdown 预览 | 点击后切换至编辑模式并选中对应行。 | 通过 |
| 历史定位，文件缩短 | 历史片段保留，超出当前长度的行号定位到末行。 | 通过 |
| 历史定位，文件删除和恢复 | 显示读取错误并保留历史片段。文件恢复后再次点击会重读并定位。 | 通过 |
| 无效位置 | 零行、反向行范围、超过安全整数的行号、父级路径和含尾随空格的点目录路径段均不触发文件读取。 | 通过 |

## 执行结果

| 项目 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|
| 新增功能验收 | 9 | 0 | 0 |
| 编辑器、输入框、队列和时间线回归 | 143 | 0 | 0 |
| 全量 Node 测试 | 52 | 0 | 0 |
| 全量 Vitest | 2783 | 0 | 11 |
| 上下文窗口缓存独立复跑，Node 26 默认设置 | 4 | 1 | 0 |
| 上下文窗口缓存独立复跑，禁用 Node Web Storage | 5 | 0 | 0 |

`pnpm build` 的前端类型检查及生产构建通过。全量 Vitest 有 2 个测试文件跳过，共 11 个用例。

Node 26 默认设置下，已有的上下文窗口缓存测试仍会失败。测试在 `Storage.prototype.setItem` 注入异常，但存储回退实现绕过了该方法，读回了预期写入失败的值。禁用 Node 自带 Web Storage 后该测试通过，全量回归使用相同设置。

## 复跑命令

```sh
export NODE_OPTIONS=--no-webstorage
pnpm exec vitest run src/features/chat/components/text-reference.acceptance.test.tsx
pnpm exec vitest run \
  src/features/files/EditorPane.test.tsx \
  src/features/files/FileEditorHeader.test.tsx \
  src/features/files/store.test.ts \
  src/features/files/text-reference.test.ts \
  src/components/application/ai-chat/ai-chat-composer.test.tsx \
  src/features/chat/components/ConversationFooter.test.tsx \
  src/features/chat/queue-drain.test.ts \
  src/components/application/ai-chat/message-queue.test.tsx \
  src/features/chat/components/MessageTimeline.test.tsx
pnpm test
pnpm build
pnpm exec vitest run src/features/chat/context-window-memory.test.ts
env -u NODE_OPTIONS pnpm exec vitest run src/features/chat/context-window-memory.test.ts
```
