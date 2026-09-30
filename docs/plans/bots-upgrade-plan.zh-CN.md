# 智能体升级为 Bots：产品与技术实施方案

> 版本：v1.0 · 2026-09-29
> 这份文档写给编程模型（Claude Code、Codex 等），用来分阶段实施。
> 我不了解你的技术栈，所以文档里只给出概念、数据结构、流程、提示词和验收标准，不绑定具体框架。代码示例用 TypeScript 伪代码写，需要按现有项目的语言和框架改写。

---

## 0. 给编程模型的执行说明

1. **先读代码，不要急着写。** 在项目里找到这些东西，整理成一份对照表：
   - 现有"智能体"的数据结构（名称、图标、提示词）
   - 数据存在哪里
   - 输入框里 `#` 选择智能体的逻辑
   - 会话、消息的数据结构
   - 调用 LLM 的入口
2. **保持向后兼容。** 已有的自定义智能体、内置目录、`#` 选择功能在每个阶段都必须能正常用，数据只能迁移，不能丢。
3. **一次只做一个阶段**（见第 12 节）。每个阶段做完都要满足验收标准，并能单独发布。
4. **遵守项目已有的约定**，包括状态管理、存储、UI 组件库、国际化。不要为了这个功能额外引入重型依赖。
5. **遇到文档没写清楚的地方**，先按第 14 节的"默认决策"处理，并在 PR 描述里说明。涉及数据安全或破坏性变更时，停下来问人。
6. **CLI 参数不要凭记忆写。** Claude Code、Codex 等外部 CLI 的参数以本机 `--help` 输出为准，因为版本更新很快。

---

## 1. 背景与目标

### 1.1 现状
客户端里有"智能体"功能，本质是一段可复用的角色提示词：
- 字段只有：名称、图标（emoji）、提示词
- 分"自定义"和"内置目录"两部分
- 在输入框里用 `#` 选择

### 1.2 目标
把"智能体"升级成 **Bot**，也就是一个**有身份、有能力、有记忆、能自己干活、能和其他 Bot 协作**的长期存在的助手：

| 能力 | 说明 |
|---|---|
| 身份和人格 | 把"做什么"和"怎么说"分开，多 Bot 协作时互相认识 |
| Skills | 从单个提示词升级成完整的 skill 包（`SKILL.md` + 脚本 + 参考资料），可以导入、按 Bot 分配，后期允许 AI 自己写 skill |
| 记忆 | Bot 自己记下经验、踩过的坑、用户偏好，不用用户手动整理 |
| 运行后端 | 每个 Bot 可以指定用直连 LLM、Claude Code 还是 Codex 来执行 |
| 定时任务（Routines） | Bot 可以定时自动执行任务 |
| 协作 | Bot 之间可以委派任务，也可以多个 Bot 在一个群里讨论 |

### 1.3 这一版不做
- 不做完全自动的"AI 自己设计整个工作流"
- 不做云端常驻（定时任务只在客户端运行时执行）
- 不做 Bot 市场或分享平台（只做导入、导出）

### 1.4 参考项目
- Hermes Agent（Bot Mode、Memory、Skills）
- OpenClaw（workspace 文件结构）
- Letta（Dreaming、MemFS）

链接见文末。

---

## 2. 核心概念

| 概念 | 定义 | 对应现有功能 |
|---|---|---|
| **Bot** | 一个长期存在的助手单元，由下面各项组合而成 | 现有"智能体" |
| **Identity** | 名称、头像、头衔、一句话简介。给用户看，也给其他 Bot 看 | 名称 + 图标 |
| **Soul** | 人格：性格、语气、价值观、不确定时怎么表态 | 现有"提示词"（默认迁移到这里） |
| **Instructions** | 做事规则：职责、工作流程、限制条件、输出格式 | 新增 |
| **Skill** | 一个目录，包含 `SKILL.md`（带 frontmatter）以及可选的脚本和参考资料。平时只把名称和描述放进 prompt，需要时再加载全文 | 新增 |
| **Tool / MCP** | Bot 能调用的函数和 MCP 服务 | 看项目现有情况 |
| **Runtime** | 执行 Bot 任务的后端：直连 LLM / Claude Code / Codex | 新增 |
| **Memory** | Bot 自己的笔记（MEMORY）+ 用户画像（USER）+ 历史会话检索 | 新增 |
| **Routine** | 挂在 Bot 上的定时任务，结果发到这个 Bot 的聊天里 | 新增 |
| **Delegation** | 一个 Bot 把子任务交给另一个 Bot，并拿回结果 | 新增 |
| **Group** | 2–6 个 Bot 加上用户组成的群聊 | 新增 |

**原则：Bot 只是一组配置加上存储，没有什么"魔法"。** Bot 的每个部分都可以查看、编辑、导出。

---

## 3. 总体架构

```
┌──────────────────────── UI ────────────────────────┐
│ Bot 列表 │ Bot 编辑器 │ Bot 聊天 │ 群聊 │ 记忆面板 │ Skills 管理 │
└───────────────┬────────────────────────────────────┘
                │
┌───────────────▼──────────── Core ─────────────────┐
│ BotRegistry      Bot 的增删改查、导入导出、迁移     │
│ PromptAssembler  拼装 system prompt，冻结快照      │
│ SkillRegistry    扫描、索引、加载 skills           │
│ MemoryService    读写、容量限制、审批、安全扫描    │
│ ReviewWorker     每轮结束后后台复盘（生成记忆/skill）│
│ SessionStore     会话存储 + 全文检索               │
│ ToolRegistry     内置工具 + MCP                    │
│ RuntimeRouter ─┬─ DirectLLMRuntime                │
│                ├─ ClaudeCodeRuntime (CLI 子进程)   │
│                └─ CodexRuntime      (CLI 子进程)   │
│ Scheduler        定时任务                          │
│ Orchestrator     任务委派 + 群聊轮转               │
└───────────────────────────────────────────────────┘
                │
        存储：文件（便于人查看）+ 数据库（索引/会话）
```

---

## 4. 数据模型

### 4.1 Bot

```ts
interface Bot {
  id: string;                 // uuid
  slug: string;               // 用于 @mention，唯一，如 "tainai"
  name: string;               // 显示名，如 "太奶智能体"
  title?: string;             // 头衔，如 "耐心的讲解员"
  description?: string;       // 一句话简介（其他 Bot 靠这个了解它）
  avatar: { type: 'emoji' | 'image'; value: string };

  soul: string;               // 人格（Markdown）
  instructions: string;       // 做事规则（Markdown）

  capabilities: {
    skills: string[];         // 启用的 skill 名称；['*'] 表示全部
    tools: string[];          // 启用的内置工具
    mcpServers: string[];     // 启用的 MCP 服务
  };

  runtime: RuntimeConfig;     // 见 4.5
  memory: BotMemoryConfig;    // 见 4.3

  source: 'custom' | 'builtin';
  builtinId?: string;         // 从内置目录复制来时，记录来源
  pinned?: boolean;
  hidden?: boolean;
  schemaVersion: number;      // 数据结构版本，从 1 开始
  createdAt: number;
  updatedAt: number;
}
```

### 4.2 Skill

```ts
interface SkillMeta {
  name: string;               // 唯一，kebab-case
  description: string;        // 说明什么时候用（会进 prompt 索引，必须写清楚）
  path: string;               // skill 目录的绝对路径
  source: 'builtin' | 'imported' | 'user' | 'agent';
  createdByBotId?: string;    // source='agent' 时记录是哪个 Bot 写的
  version: number;
  usageCount: number;
  lastUsedAt?: number;
  archived?: boolean;         // 删除时先归档，可以恢复
}
```

skill 目录结构兼容 Claude Skills 和 agentskills.io 格式：

```
<skill-name>/
├─ SKILL.md          # 必须有
├─ scripts/          # 可选
├─ references/       # 可选，按需读取
└─ assets/           # 可选
```

`SKILL.md` 的格式：

```markdown
---
name: pdf-translate
description: 当用户需要翻译 PDF 或长文档并保留中英对照时使用
---
# 步骤
1. ...
```

### 4.3 记忆

```ts
interface BotMemoryConfig {
  enabled: boolean;               // 默认 true
  writeApproval: boolean;         // 默认 false；true 时写入要先经过用户审批
  memoryCharLimit: number;        // 默认 2200
  reviewEnabled: boolean;         // 是否开启后台复盘，默认 true
  reviewEveryNTurns: number;      // 默认 5
}

interface MemoryEntry {
  id: string;
  scope: 'bot' | 'user';          // bot = 这个 Bot 自己的笔记；user = 全局用户画像
  botId?: string;                 // scope='bot' 时必填
  content: string;
  origin: 'user_explicit' | 'agent' | 'review';  // 用户明确要求 / Bot 主动 / 后台复盘
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

interface PendingMemoryWrite {
  id: string;
  op: 'add' | 'replace' | 'remove';
  scope: 'bot' | 'user';
  botId?: string;
  targetEntryId?: string;         // replace/remove 时锁定具体条目
  targetSnapshot?: string;        // 记录暂存时目标条目的原文；审批时如果原文已变，拒绝执行
  content?: string;
  origin: 'agent' | 'review';
  createdAt: number;
}
```

- 全局用户画像（USER）的字符上限默认 1375，是全局设置，不属于某个 Bot。

### 4.4 会话

在现有会话结构上扩展：

```ts
interface Session {
  // ...现有字段
  botId?: string;
  groupId?: string;
  kind: 'chat' | 'bot_main' | 'routine' | 'delegation' | 'group_member';
  promptSnapshot?: string;        // 会话开始时冻结的 system prompt
  parentSessionId?: string;       // 委派任务产生的子会话
}
```

### 4.5 运行后端

```ts
type RuntimeKind = 'direct' | 'claude-code' | 'codex';

interface RuntimeConfig {
  kind: RuntimeKind;              // 默认 'direct'
  model?: string;                 // direct 模式下用；不填则沿用全局默认模型
  cwd?: string;                   // CLI 模式下的工作目录
  extraArgs?: string[];           // CLI 额外参数（高级选项）
  permissionMode?: 'ask' | 'auto-safe' | 'full';  // 默认 'ask'
}
```

### 4.6 定时任务

```ts
interface Routine {
  id: string;
  botId: string;
  name: string;
  schedule: string;               // cron 表达式
  prompt: string;                 // 每次触发时发给 Bot 的内容
  enabled: boolean;
  missedPolicy: 'skip' | 'run_once';  // 客户端关闭期间错过的任务：跳过 / 启动后补跑一次；默认 run_once
  lastRunAt?: number;
  nextRunAt?: number;
  lastStatus?: 'ok' | 'error';
}
```

### 4.7 群聊

```ts
interface Group {
  id: string;
  name: string;
  avatar?: string;
  memberBotIds: string[];         // 2–6 个
  settings: {
    maxRounds: number;            // 默认 3
    maxBotMessagesPerSend: number;// 默认 10
    detectStopDirectives: boolean;// 默认 true
  };
  createdAt: number;
}
```

### 4.8 推荐的存储结构

如果项目已有存储方案，优先沿用。

```
<appData>/
├─ bots/<botId>/
│   ├─ bot.json          # Bot 除 soul/instructions 以外的字段
│   ├─ SOUL.md
│   └─ AGENTS.md         # 即 instructions
├─ skills/<skill-name>/SKILL.md ...
├─ skills/.archive/      # 归档的 skill
└─ state.db              # 记忆条目、待审批写入、会话、定时任务、群聊；会话用全文索引（如 SQLite FTS5）
```

---

## 5. 迁移（阶段 1 的第一件事）

| 旧字段 | 新字段 |
|---|---|
| 名称 | `name`；`slug` 由名称生成（中文转拼音或用 id，保证唯一） |
| 图标 emoji | `avatar = {type:'emoji', value}` |
| 提示词 | `soul`（`instructions` 留空） |
| 内置目录 | `source='builtin'`，只读；用户编辑时先复制一份成 `custom` |

迁移要求：
- **幂等**：重复运行不会产生重复数据
- **迁移前先备份**原数据
- 迁移完成后记录 `schemaVersion = 1`
- `#` 选择器照常可用，列出的是 Bot；选中 Bot 后的效果与原来一致
- 迁移后，一个 Bot 如果只有 soul、其他全是默认值，行为必须和原来的智能体**完全一样**：拼出来的 prompt 除了新增的空区块，内容一致

---

## 6. System Prompt 拼装

### 6.1 拼装顺序

内容为空的区块整块省略：

```
1. [应用基础系统提示]            ← 现有
2. # 你的身份                    ← Identity：名称、头衔、简介
3. # 你的人格                    ← SOUL.md
4. # 工作规则                    ← AGENTS.md
5. # 关于用户 (USER)             ← 全局用户画像条目
6. # 你的笔记 (MEMORY) [用量 x/2200] ← Bot 记忆条目，条目之间用 § 分隔
7. # 可用 Skills                 ← 只列 name + description
8. # 记忆使用说明                ← 固定文案，见 8.4（记忆开启时才加）
9. # 协作者                      ← 可以委派的其他 Bot（slug + 简介）
```

### 6.2 冻结快照
- 会话**开始**时拼装一次，结果存进 `Session.promptSnapshot`；会话中途**不再重新拼装**。好处是能利用模型的前缀缓存，行为也可预期。
- 会话中途写入的记忆立刻落盘，但要到**下一个会话**才会进入 prompt。工具调用的返回结果可以反映最新状态。
- 用户可以通过"刷新上下文"按钮手动重新拼装（这会让缓存失效）。

### 6.3 各区块的长度上限（可配置）
- SOUL + AGENTS 合计建议 ≤ 10,000 字符，超出时在编辑器里提示
- Skills 索引 ≤ 3,000 字符，超出时按使用频率截断，并在末尾注明"还有 N 个 skill 可以用 skill_list 查看"

---

## 7. Skills

### 7.1 功能
- **扫描**：启动时扫描 `skills/` 目录，解析 frontmatter 建立索引；监听目录变化，自动刷新
- **导入**：支持从文件夹、zip、git 仓库 URL 导入；导入前先校验 frontmatter
- **按 Bot 分配**：在 Bot 编辑器里勾选启用哪些 skill
- **渐进加载**：prompt 里只放索引，Bot 需要时调用 `skill_view` 读取全文，再按需读 `references/` 下的文件

### 7.2 工具定义

```ts
skill_list(): { name, description }[]            // 只列当前 Bot 已启用的
skill_view(name: string, file?: string): string  // 不传 file 时返回 SKILL.md；file 是 skill 目录内的相对路径
```

- `skill_view` 必须校验路径**不能逃出 skill 目录**
- 每次调用 `skill_view`，给对应 skill 的 `usageCount` 加 1

### 7.3 脚本执行
- skill 中的脚本**通过现有的代码执行或终端工具运行**（如果项目有的话），并遵循同一套权限审批
- 项目里没有执行能力时，只支持纯文本 skill

### 7.4 AI 自己写 skill（阶段 5）

```ts
skill_manage(op: 'create' | 'patch', name, content, files?)
```

- 写出来的 skill 标记为 `source='agent'`
- **默认需要用户审批**才会生效
- patch 前自动备份原版本，可以回滚

---

## 8. 记忆系统（重点）

### 8.1 两个存储 + 一个检索

| 存储 | 作用域 | 内容 | 上限 | 怎么进 prompt |
|---|---|---|---|---|
| MEMORY | 每个 Bot 单独一份 | 环境信息、项目约定、踩过的坑、解决办法、完成的重要工作 | 2200 字符 | 每次会话开始时注入 |
| USER | 全局共享 | 用户的姓名、角色、偏好、沟通风格、忌讳 | 1375 字符 | 每次会话开始时注入 |
| 历史会话 | 全部会话 | 原始消息 | 无上限 | 不注入，需要时用 `session_search` 查 |

**为什么 USER 是全局的**：所有 Bot 面对的都是同一个用户，不应该让用户对每个 Bot 重复介绍自己。

**为什么设字符上限**：强迫记忆保持精炼，同时控制每次请求的 token 成本。

### 8.2 工具定义

```ts
memory(action: 'add' | 'replace' | 'remove',
       target: 'memory' | 'user',
       content?: string,
       old_text?: string)   // replace/remove 时，用一段能唯一定位条目的子串
→ { success, usage: "1474/2200", current_entries?: string[], error?, pending?: boolean }

session_search(query: string, botId?: string, limit?: number)
→ { sessionId, messageId, snippet, createdAt }[]
```

规则：
- `old_text` 匹配到多个条目时报错，要求 Bot 提供更具体的子串
- `replace` 会**替换整条内容**，所以 content 必须是完整的新条目
- 和已有条目完全重复时，不新增，直接返回成功
- **超出上限时返回错误，并附上当前所有条目**，由 Bot 在同一轮里自行合并或删除后重试。**不要自动截断或丢弃条目。**
- 开启 `writeApproval` 时，写入先存为待审批（PendingMemoryWrite），返回 `pending: true`

### 8.3 安全扫描（每次写入前必须执行）

以下内容直接拒绝写入：
- 疑似 prompt 注入：如"忽略之前的指令""你现在是""system:"等模式
- 密钥或凭证：API key、私钥、token、密码等格式
- 不可见的 Unicode 字符：零宽字符、方向控制符

被拒绝时返回错误原因，不写入。

### 8.4 什么时候存：注入 prompt 的固定文案

记忆开启时，把下面这段放进第 6.1 节的第 8 区块：

```markdown
# 记忆使用说明
你有持久记忆，下次对话还能看到。用 `memory` 工具管理记忆。
注意：只说"我记住了"不会保存任何东西，必须真正调用工具。

## 应该主动保存（不用等用户要求）
- 用户表达了偏好或习惯 → target=user
- 用户纠正了你（"不对，应该……"）→ 把正确做法存到 target=memory
- 你踩了坑并找到了解决办法（报错原因 + 修复方法）→ target=memory
- 项目或环境的固定事实：路径、技术栈、命令、约定 → target=memory
- 完成了重要工作（日期 + 做了什么）→ target=memory
- 用户明确说"记住……"→ 马上保存

## 不要保存
- 琐碎、模糊的信息（例如"用户问了 Python"）
- 上网就能查到的公共知识
- 大段代码、日志、表格
- 只跟这次会话有关的临时信息
- 已经写在"人格"或"工作规则"里的内容
- 任何密钥、密码、token

## 写法
- 每条信息密度要高，写清具体路径、命令、原因
- 用量超过 80% 时，先合并相近的条目再新增
- 发现旧条目过时了，用 replace 或 remove 更新
```

### 8.5 后台复盘

对应 Hermes 的后台复盘和 Letta 的 Dreaming。

**触发时机**（满足任意一条就排队，同一个会话同时只跑一个复盘）：
1. 每累计 `reviewEveryNTurns` 轮对话（默认 5）
2. 会话结束：用户新开会话、切换 Bot，或会话空闲超过 30 分钟
3. 本轮中**工具调用失败后又成功了**（说明踩过坑）
4. 本轮用户消息里出现纠正信号（"不对""错了""不是这样""应该是"等），可以用关键词加简单规则判断
5. 上下文压缩之前（防止被压缩掉的信息丢失）

**执行方式**：
- 在后台异步调用 LLM，不阻塞当前对话
- 可以用更便宜的模型，可配置
- 输入：Bot 的当前 MEMORY、全局 USER、本次待复盘的对话片段、已启用 skill 的索引
- 输出：严格的 JSON，经过解析和校验后逐条执行，同样走容量限制、安全扫描和审批流程

**复盘提示词：**

```markdown
你是记忆整理员。阅读下面的对话片段，判断有没有值得长期保存的信息。

当前 Bot 笔记（MEMORY，{usage}）：
{memory_entries}

当前用户画像（USER，{usage}）：
{user_entries}

可用 skills：
{skill_index}

对话片段：
{transcript}

判断标准：
- 只保存以后的对话里还会用到的信息：偏好、纠正、踩坑经验、环境事实、重要结果
- 重复出现 2 次以上的多步骤做法，可以提议写成 skill（skill_proposals）
- 宁缺毋滥：没有值得保存的内容就返回空数组
- 优先用 replace 合并已有条目，不要新增相似条目
- 严禁保存密钥或敏感个人信息

只输出 JSON：
{
  "memory_ops": [
    {"action":"add|replace|remove","target":"memory|user","content":"...","old_text":"...","reason":"..."}
  ],
  "skill_proposals": [
    {"name":"...","description":"...","content":"SKILL.md 全文","reason":"..."}
  ]
}
```

- `skill_proposals` 在阶段 5 之前**只记录不执行**；阶段 5 之后走 `skill_manage`，默认需要审批

### 8.6 UI 要求
- 写入记忆后，在聊天中显示一条轻提示：`💾 记忆已更新`。设置里可以改成"关闭"或"详细"（详细模式显示变更预览）
- **记忆面板**：分 Bot 笔记和用户画像两个标签；显示用量条；支持编辑、删除、手动新增；每条记忆可以跳转到来源会话
- **待审批队列**：逐条或全部批准、拒绝；replace 类的写入要显示修改前后的对比
- Bot 编辑器里放三个开关：启用记忆、写入需要审批、后台复盘
- 支持导出和清空：一键导出为 MEMORY.md / USER.md，一键清空（需要二次确认）

---

## 9. 运行后端

### 9.1 统一接口

```ts
interface AgentRuntime {
  kind: RuntimeKind;
  isAvailable(): Promise<{ ok: boolean; version?: string; reason?: string }>;
  run(input: RunInput, signal: AbortSignal): AsyncIterable<RunEvent>;
}

interface RunInput {
  bot: Bot;
  session: Session;
  systemPrompt: string;          // 第 6 节拼好的快照
  messages: Message[];
  tools: ToolDef[];              // direct 模式下使用
  cwd?: string;
}

type RunEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; result: unknown; isError?: boolean }
  | { type: 'approval_request'; id: string; description: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done'; externalSessionId?: string };
```

### 9.2 三种实现

**DirectLLMRuntime**：沿用现有的 LLM 调用方式，接入工具循环（memory、skill_*、session_search、delegate_task、MCP 工具）。

**ClaudeCodeRuntime / CodexRuntime**：
- 用子进程启动 CLI 的**非交互模式**，并选择 **JSON 流式输出**，逐行解析后转换成 `RunEvent`
- 通过 CLI 提供的"追加系统提示"类参数传入 SOUL + AGENTS + 记忆等内容。如果 CLI 没有这类参数，就把这些内容写进工作目录的上下文文件（如 `CLAUDE.md` / `AGENTS.md`）；**用完要恢复原文件**，或写到临时目录
- 保存 CLI 返回的会话 id，下一轮用恢复会话参数继续同一个会话
- **启动前运行 `<cli> --help` 确认参数**，把检测结果缓存起来；版本不兼容时给出明确提示
- 记忆写入：CLI 模式下拿不到应用内的 memory 工具，改成**会话结束后必定触发一次后台复盘**，由复盘来写记忆。如果项目支持 MCP，也可以把 memory 暴露成本地 MCP 服务给 CLI 使用（可选）
- 权限：`permissionMode` 映射到 CLI 对应的权限参数。默认 `ask`，也就是 CLI 请求权限时转成 `approval_request` 交给用户确认
- 支持中止：用户点停止时结束子进程

### 9.3 检测与配置
- 设置页里显示"运行后端检测"：每个 CLI 是否安装、版本、是否已登录
- Bot 编辑器里选择运行后端时，不可用的选项置灰并说明原因

### 9.4 自动路由（阶段 5，默认关闭）
- 先用**规则**实现，不要一开始就交给 LLM 判断：
  - 任务涉及代码仓库或文件修改，且 `cwd` 已设置 → 使用 Bot 首选的 CLI
  - 纯问答、翻译、写作 → direct
- 每次路由都记录决策原因，界面上可以查看，用户可以手动覆盖

---

## 10. 定时任务

- **调度器**：客户端运行期间由进程内调度器执行，cron 解析选用轻量库
- **触发时**：在该 Bot 下新建一个 `kind='routine'` 的会话并运行 `prompt`，结果同时推送到这个 Bot 的主聊天，并显示未读标记
- **错过的任务**：客户端启动时检查 `nextRunAt < now` 的任务，按 `missedPolicy` 处理，**最多补跑一次**
- **UI**：Bot 详情页里有 Routines 面板；新建时用结构化的时间选择器（频率 → 具体时间），高级模式下可以直接填 cron
- 同一个 Bot 的定时任务**依次执行**，不并行

---

## 11. 协作

### 11.1 委派

```ts
delegate_task(bot_slug: string, task: string, context?: string)
→ { result: string, sessionId: string }
```

- 在目标 Bot 下新建 `kind='delegation'` 的子会话，用**目标 Bot 自己的** prompt 快照、运行后端和工具执行
- **委派深度最多 2 层**（A→B→C 为止），同时进行的委派最多 3 个，超出直接报错
- 子会话的结果以工具结果的形式返回；UI 上可以展开查看子会话
- 能委派给哪些 Bot 由第 6.1 节的"协作者"区块决定。默认是全部未隐藏的 Bot，也可以在 Bot 编辑器里限制

### 11.2 群聊

**轮转算法：**

```
用户发送消息 M：
  如果 M 里 @ 了某些成员 → 本轮发言人 = 被 @ 的成员；否则 = 全部成员
  round = 1
  while round ≤ maxRounds 且 本次 Bot 消息总数 < maxBotMessagesPerSend：
    本轮有人发言 = false
    按成员顺序，对每个本轮发言人依次执行：
      输入 = 该成员自己的群聊会话 + 自它上次发言以来的群消息
             （最多约 200 条或 32,000 字符，超出时注明省略了多少条）
      回复 = 运行该成员
      如果回复是 "[PASS]" → 跳过，不显示
      否则 → 发到群里，本轮有人发言 = true
             回复里 @ 了其他成员 → 下一轮加入被 @ 的成员
             回复里有 @user → 群聊标记为"需要你"，本次结束
    如果本轮没人发言 → 结束
    下一轮发言人 = 被 @ 的成员；没人被 @ 时仍为全部成员
    round++
```

**群聊成员额外的 prompt：**

```markdown
# 群聊规则
你在群聊「{group_name}」中，成员有：{members: slug - 简介}，以及用户（@user）。
- 只在你有新的、有价值的内容要补充时才发言，并且保持简短；否则只回复 [PASS]
- 需要某位成员参与时，用 @slug 叫对方
- 遇到需要用户拍板的事，用 @user 提问，然后停止
- 不要重复别人已经说过的话，不要互相客套
```

**停止指令**：`stop`、`停`、`暂停` 这类词**紧挨着某个 @ 时**，暂停被 @ 的成员；出现在代码块或引用里时忽略。整个群的"停止"按钮始终可用。

**UI**：
- 消息按时间顺序显示，每条带发言人头像和名字
- 显示"需要你"徽标
- 群设置里可以改名、管理成员（2–6 个）、给单个成员压缩上下文

---

## 12. 分阶段实施与验收标准

### 阶段 1：Bot 基础结构 + 迁移 + Skills
**任务：**
1. 实现第 4 节的数据模型和存储、第 5 节的迁移
2. Bot 列表：搜索、置顶、隐藏；`#` 选择器改为读取 Bot
3. Bot 编辑器：
   - 基础页：名称、头衔、简介、头像
   - 人格页（SOUL）
   - 工作规则页（AGENTS）
   - 能力页：勾选 skills、工具、MCP
   - 模型页
4. 实现 PromptAssembler 和冻结快照
5. 实现 SkillRegistry：扫描、导入（文件夹/zip）、`skill_list`、`skill_view`
6. Bot 导入导出（打包为 zip：`bot.json` + md 文件 + 引用的 skills）
7. 支持复制已有 Bot

**验收：**
- [ ] 旧的智能体全部迁移成功，内容一致，`#` 选择器正常
- [ ] 只有 soul 的 Bot 和原来的智能体行为一致
- [ ] 导入一个标准 `SKILL.md` 目录后，Bot 能在需要时调用 `skill_view` 并按 skill 执行
- [ ] 未启用的 skill 对该 Bot 不可见
- [ ] `skill_view` 无法读取 skill 目录以外的文件（附测试用例）
- [ ] 导出的 Bot 在另一台机器上能完整导入

### 阶段 2：记忆
**任务：**
1. 实现第 8 节全部内容：两个存储、memory 工具、容量限制、安全扫描、审批流程
2. 实现历史会话全文检索和 `session_search`
3. 实现后台复盘和各种触发时机
4. 实现记忆面板、待审批队列、写入提示、导出、清空

**验收：**
- [ ] 对 Bot 说"记住我喜欢简短的回答"后，新开会话时 prompt 里有这一条，回答风格也随之变化
- [ ] 纠正 Bot 一次，后台复盘能在 MEMORY 里写入正确做法
- [ ] 超出上限时 Bot 会在同一轮里自己合并条目后写入成功，没有条目被静默丢弃
- [ ] 包含 API key 或注入文本的写入被拒绝（附测试用例）
- [ ] 开启审批后，写入只进入待审批队列；批准后才生效；目标条目已变时拒绝执行
- [ ] 会话中途写入的记忆不改变当前会话的 prompt 快照
- [ ] USER 在所有 Bot 之间共享，MEMORY 各个 Bot 互不影响

### 阶段 3：运行后端 + 定时任务
**任务：**
1. 实现 AgentRuntime 接口；把现有调用方式改造成 DirectLLMRuntime
2. 实现 ClaudeCodeRuntime 和 CodexRuntime：检测、流式解析、恢复会话、权限审批、中止
3. CLI 会话结束后必定触发复盘
4. 实现第 10 节的调度器和 Routines 面板

**验收：**
- [ ] 同一个 Bot 切换三种运行后端都能完成一个简单任务，流式输出正常
- [ ] CLI 没安装时，对应选项置灰并说明原因
- [ ] CLI 请求权限时能在 UI 上确认或拒绝；点停止后子进程在 2 秒内结束
- [ ] 一个每分钟执行的测试定时任务能按时运行，结果出现在 Bot 聊天里
- [ ] 客户端关闭期间错过的任务，启动后按 `missedPolicy` 处理，最多补跑一次

### 阶段 4：协作
**任务：**
1. 实现 `delegate_task`，包括深度和并发限制，以及子会话的查看入口
2. 实现"协作者"区块
3. 实现群聊：数据结构、轮转算法、`[PASS]`、@ 解析、@user、停止指令、上限控制、UI

**验收：**
- [ ] Bot A 能把翻译任务委派给 Bot B，并拿回结果；超过 2 层时报错
- [ ] 在 3 个 Bot 的群里提问：只有相关的 Bot 发言，不超过 3 轮，不出现互相客套刷屏
- [ ] 只 @ 某个 Bot 时只有它回复
- [ ] Bot 发出 @user 后，群聊显示"需要你"，并停止继续轮转

### 阶段 5：自我学习 + 自动路由（可选）
- 开放 `skill_manage`：默认需要审批，有版本和回滚
- 复盘产生的 `skill_proposals` 进入审批流程
- 实现第 9.4 节的规则路由（默认关闭），并显示决策原因
- 做一个"学习时间线"：按时间展示新增的记忆和 skill，可以编辑、删除

---

## 13. 安全与隐私（所有阶段都要遵守）

1. **记忆里不存任何凭证**；凭证放进系统的密钥存储或现有的加密配置
2. **所有外部执行都要经过权限审批**：CLI、脚本、写文件。默认是"每次都询问"
3. **记忆和 skills 都是用户可见、可改、可删的**，没有隐藏状态
4. **导出的 Bot 包不包含**记忆（除非用户勾选）和任何密钥
5. **限制后台任务的开销**：复盘、定时任务、群聊都有调用次数上限；设置页显示 Bot 的 token 用量统计

---

## 14. 默认决策

编程模型遇到下面这些没有明确说明的问题时，先按默认方案做，并在 PR 里注明。

| 问题 | 默认决策 |
|---|---|
| 旧提示词迁移到 SOUL 还是 AGENTS？ | SOUL |
| USER 画像是全局的还是每个 Bot 一份？ | 全局 |
| 记忆写入默认要不要审批？ | 不需要，但显示"💾 记忆已更新"提示 |
| 后台复盘用什么模型？ | 与 Bot 相同；可以在设置里改成更便宜的模型 |
| 记忆存在文件里还是数据库里？ | 数据库存条目，界面支持导出为 md |
| 内置 Bot 能不能编辑？ | 不能，编辑时自动复制一份 |
| 群聊成员按什么顺序发言？ | 按加入顺序 |
| CLI 的工作目录没设置时怎么办？ | 禁止运行，提示用户选择目录 |
| 定时任务在客户端关闭时怎么办？ | 不运行，启动后按 `missedPolicy` 处理 |

---

## 15. 测试清单

- **单元测试**：
  - PromptAssembler（区块顺序、空区块省略、长度截断）
  - memory 工具（add、replace、remove、子串匹配、重复条目、超限、安全扫描）
  - 复盘 JSON 的解析和校验（包括 LLM 返回非法 JSON 时的容错）
  - cron 下次运行时间的计算
  - 群聊轮转算法（包括 PASS、@ 解析、上限、停止指令）
  - skill 路径安全
- **集成测试**：迁移（用旧数据样本）、CLI 输出解析（用录制好的 JSONL 样本回放，不依赖真实 CLI）、会话全文检索
- **手动测试**：第 12 节每个阶段的验收清单

---

## 16. 参考资料

- Hermes Agent：[GitHub](https://github.com/nousresearch/hermes-agent) · [Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode) · [Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) · [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- OpenClaw：[Agent workspace](https://docs.openclaw.ai/concepts/agent-workspace) · [workspace 文件说明](https://clawpane.co/blog/openclaw-workspace-files-guide)
- Letta：[GitHub](https://github.com/letta-ai/letta) · [Memory & Dreaming](https://docs.letta.com/configuration/memory/)
- Skills 标准：[agentskills.io](https://agentskills.io/)
- 多 CLI 编排：[awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents) · [vibe-kanban](https://github.com/BloopAI/vibe-kanban)

---

**使用建议：**
- **不要一次把整份文档都交给编程模型去实现。** 先发第 0 到 6 节加第 12 节"阶段 1"，并让它先输出与现有代码的对照表和改动计划，你确认后再写代码。之后每个阶段都这样做。
- **有些信息你知道、我不知道，最好补进第 14 节**：客户端的技术栈（Electron、Tauri 还是原生）、数据现在存在哪里、项目有没有工具调用和 MCP。这样编程模型可以少猜。