# 会话分叉（Fork Conversation）设计方案

> **状态**：设计稿 v8 · **决策已全部确认，实现完成并通过三引擎真机验收**
> **范围**：Claude Code / Codex / DeepSeek Harness（dsh）三引擎，本地工作区
> **关联文档**：`docs/ui-ux-spec.zh-CN.md`（已同提交更新）
>
> **已确认的四项决策（v5 固化）**
> | # | 决策 | 出处 |
> |---|---|---|
> | 1 | ~~**惰性落地**~~ → **v7 改为「点击即落盘」**：点「创建分支」时后端就把继承的前缀转录本写好并登记 `sessions` 行，分支页签**立刻**显示分叉点之前的全部对话。不需要真发消息、不花 token、不多轮次（文件是我们自己写的）。 | §2.3 |
> | 2 | **操作区可见性**：**助手回复**下方复制、分支**常驻**；**用户气泡只有复制**且保持 hover / `focus-visible` 显形，**不放分叉入口**；元信息（时间/耗时/tokens/模型/推理档位）保持 hover 显形；**流式期间保留占位 + 禁用** | §4.3.1 |
> | 3 | **图标用 `lucide-react` 的 `GitFork`**（不用 `GitBranch`，避免与状态栏 git 分支切换器混淆） | §4.3.1 |
> | 4 | **user 气泡侧不常驻、也没有分叉入口**（只保留 hover 复制；分叉按「轮」定位，与同轮回复指向同一点，留一处即可） | §4.3.1 |
>
> **v4 关键变更（依据需求澄清 + 补充实测）**
> 1. ~~**分叉是"惰性"的**~~ → **v7 改为点击即落盘**。当时观测到 `--fork-session` 不发送就不产生文件，于是推测分叉只能等到首条消息；后来改用**自己写前缀转录本**，不必依赖引擎原生 fork，也就不必等发送。发出时落地 —— **没有浪费的轮次**。
> 2. **只有一个入口形态：完整轮次边界**。需求已澄清"半截轮次（有问无答）不值得保留"，所以分叉点一律落在**完整轮次**之后。
> 3. **两个引擎统一「自己裁前缀」**（§2.3）：tip 与中间分叉走同一条路——写文件、改身份、普通续接。原生设施（Claude `--fork-session`、Codex `thread/fork`）的实测数据仍有效（§2.1），但**实现里已不再使用**。
> 4. Claude 侧**去掉中间文件**：前缀副本直接写成目标会话文件，`--resume <新id>` 即可续接（实测通过），不需要 `--fork-session` 参与。
>
> **证据口径**：标"实测"的结论均来自对**本机真实 CLI 的隔离实验**（Claude 2.1.252 / codex-cli 0.130.0），未触碰真实 `~/.claude`、`~/.codex`。标"源码"的均带 `文件:行号`。凡属推断显式标注。

---

## 0. 实施顺序（建议）

按"风险从低到高、每步可独立验收"排：

1. **Claude tip 分叉端到端**（v4–v6 曾计划"惰性落地 + 首条消息落地"，**已被 v7 的点击即落盘取代**，此条仅存档）：`fork_session` 命令 → 人工验收（能分叉、能继承、原会话不变）。
2. **操作区 UI**（§4.3.1）：常驻复制/分支 + 元信息 hover + 流式禁用 + `focus-visible`。可与第 1 步并行。
3. **Claude 中间分叉**：前缀复制 + 记录级切点（连续前缀天然祖先闭合，无需补齐）。
4. **Codex**：与 Claude **共用同一条前缀裁剪路径**（改写 `session_meta.payload.id` 后普通续接）。**不用** `thread/rollback`（追加式，§2.4）、也**不再用** `thread/fork`（已随 v7 一并删除）。手写 rollout 可 resume 已实测确认（§5.3）。
5. **收尾**：`web/dispatch.rs` 注册、`ui-ux-spec.zh-CN.md` 同提交更新、`changelog.ts` 按需。

---

## 1. 背景与目标

### 1.1 痛点

会话里积累了需求分析、技术选型和大量项目背景后，想尝试另一种实现方案时只有两条路：

1. 新建会话 → 背景上下文全丢，要重新粘贴；
2. 在原会话里继续 → 污染原有讨论，两个方案互相干扰，无法对照。

### 1.2 目标行为

- 从已有会话派生新分支，继承分叉点之前的完整上下文（用户消息、模型回复、工具调用上下文）。
- 新分支是**独立 native session**：独立 transcript 文件、独立 session id。
- 原会话完全不变，两侧后续对话互不影响。
- 历史消息的操作区新增「创建分支」入口。
- Claude Code 与 Codex 均支持。

### 1.3 关键澄清：只有「完整轮次」才是分叉点

> **已确认**：一个**完整轮次** = 提问 + 回答。只有完整轮次才值得保留与分叉。
> 例如「问：你好，你是谁 / 答：你好，我是 Claude」构成一个完整轮次，可以在此分叉；而"只有提问、回答没来"的半截轮次**不值得保留**，分叉时丢掉它是**正确行为**，不是缺陷。

这条澄清带来两个重要简化：

1. **分叉点只落在完整轮次边界** → 分支的历史永远以「一个已回答的提问」结尾，不会出现悬空的 `tool_use` 或半截回复，模型不会看到残缺的一轮。
2. ~~**"第一次发送才算分叉落地"是可接受的** → 因此分叉可以是**惰性**的。~~ **已废弃（v7）**：不发送的轮次照样要能分叉，所以改成点击即落盘——惰性落地会让分支页签先空着，真机验收判定为错误。

### 1.4 现状调研结论（关键约束）

| 事实 | 证据 |
|---|---|
| 引擎「新建 vs 续接」只由 `SendRequest.session_id` 决定：`None`=新建，`Some(id)`=续接 | 源码 `engine/mod.rs:130`、`engine/claude.rs:203-206`、`engine/codex.rs:376-386` |
| 应用从不传 `--session-id`，Claude 的 id 由 CLI 生成 | 源码 `engine/claude.rs:214`（`preassigned_session_id: None`） |
| 仓库内**没有**任何生产代码写 native transcript（只有读 + 删） | 源码 `history/reader.rs:733-751`、`:758-827`、`:894-921` |
| 仓库内**没有**会话 fork 能力 | `use-branch-switcher.ts` 实为状态栏 git 分支切换器 |
| 前端 `Message` 无稳定身份，`seq` 既不稳定也可重复 | 源码 `src/lib/ipc.ts:65-118`、`stream.ts:424-439` |
| 会话发现按 `sessions` 表登记 → **必须显式登记新行** | 源码 `history/discovery.rs:86-94`、`scanner.rs:515-553` |

---

## 2. 核心设计

### 2.1 实测验证总表（真实 CLI，隔离环境）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | Claude `--resume --fork-session --session-id <新id> -p "<真实消息>"` | ✅ exit 0；**新开独立会话文件**、源文件不变；上下文正确继承（答出 seed 里的暗号） |
| 2 | Claude `--fork-session` **不带 `-p`**（不发送） | ❌ exit 1 `Provide a prompt to continue the conversation`，**不产生任何文件** → 分叉必须由一次发送落地 |
| 3 | Claude **中间截断**的前缀副本 + `--resume <新id>`（**不用** `--fork-session`） | ✅ exit 0；分支历史只含被保留的轮次（问它"列出所有用户消息"，只列出 TURN-A，TURN-B 已被裁掉） |
| 4 | Claude 中间截断 + `--fork-session` 二次分叉 | ✅ 也能成功，但会**多留一个中间文件** → 故不采用（见 §2.5） |
| 5 | Claude 逐行改写 `sessionId`（保留 `uuid`/`parentUuid`）后 `--resume` | ✅ exit 0；CLI 追加到复制出的链；**不必重映射 uuid 链** |
| 6 | Claude 会话链结构 | **单根、无分支**（764 条子记录、每父恰好 1 子、1 个根）→ 按记录前缀截断天然祖先闭合 |
| 7 | Claude 截断后**悬空 `parentUuid`** | **0**。（但 765 条里有 29 条的 `parentUuid` 指向 `attachment`/`system` 等非会话记录 → 必须搬**完整记录前缀**） |
| 8 | Claude `--resume` 的身份依据 | **文件名 stem**，且**必须是合法 UUID**：非 UUID stem → exit 1 `is not a UUID…`；行内 `sessionId` 不作定位 |
| 9 | Claude 切在工具对中间（丢 `tool_result`） | ✅ exit 0（容忍）→ 但**我们仍不主动制造**（§1.3） |
| 10 | Claude workspace 是否需在 `.claude.json` 注册 | **不需要**（有无 entry 都 exit 0，CLI 也不自动建 entry） |
| 11 | Claude sidechain 位置与是否被读 | 在兄弟目录 `…/<session-id>/subagents/agent-<agentId>.jsonl`，`sessionId` 等于主会话 id；`--resume` **完全不读**（毒化后仍 exit 0，tokens 仅 +36）→ **不必搬** |
| 12 | Codex `thread/fork {threadId}` | ✅ 新线程 id、`forkedFromId`=源 id、自建 rollout 文件 |
| 13 | Codex `thread/fork {path}` | ✅ 亦成功（官方 schema：*"load the thread from disk by path and fork it into a new thread"*） |
| 14 | Codex `thread/rollback {numTurns:1}` | ✅ `thread/read` 轮次数 2→1；**rollback 是追加式记录**（文件 73→75 行，追加 `event_msg/thread_rolled_back`） |
| 15 | **Codex rollback 是否真的影响模型可见历史** | ✅ **是**。分叉后回退 1 轮，再问"列出你收到的所有用户消息"，模型只列出 TURN1 与当前消息，**TURN2 消失** |
| 16 | Codex app-server `thread/resume` 接受手工 fork 的 rollout | ✅ `thread.id` 一致、`preview` 带出继承历史、`inputTokens=84994` |
| 17 | Codex 身份依据 | **文件内 `session_meta.payload.id`**（文件名不参与定位）——与 Claude 正好相反 |
| 18 | Codex 全新 home（无 `state_*.sqlite`/索引） | ✅ exit 0 → **不需要写引擎侧 db/索引**；日期目录也不敏感 |
| 19 | 改写 1,854,872 B / 953 行 transcript 的耗时 | **中位数 ~10 ms**（进程含启动 113–121 ms）→ 同步改写完全够用 |
| 20 | 转录本含坏行 | 一行非法 JSON + 一行截断 JSON 仍 exit 0（坏行被跳过） |

### 2.2 两种可选机制（v4 的权衡；**已成定论：统一用 (B) 前缀复制**，见 §2.3）

| 机制 | 适用 | 实测 | 评价 |
|---|---|---|---|
| **(A) 原生分叉** | Claude / Codex 支持，dsh 无此设施 | #1、#12–#15 | ❌ **已否决（v7）**：原生 fork 与"点击即落盘"冲突——它要等到发第一条消息才产生文件，且 dsh 根本没有 `session/fork` 接口 |
| (B) 复制前缀 | 通用后备 | #3、#5、#6、#7 | 保留为后备；实测也完全可用 |

**为什么 (A) 更优**：它把"转录本格式"这个最容易随 CLI 版本漂移的东西**交还给引擎自己**。方案不再依赖我们对 `.jsonl` 字段的理解是否正确。

### 2.3 点击即落盘（v7；推翻 v4–v6 的"惰性"设计）

**v4–v6 的设计（已废弃）**：点击只在前端登记"待落地分支"，等到该分支发出第一条真实消息时才落地。
当时的理由是"`--fork-session` 不发送就不落地（实测 #2），所以不伪造发送"。

**它错在哪**：把"引擎原生 fork 需要发送"当成了"分叉必须等发送"。实际上我们**可以自己写前缀文件**
（这正是中间分叉一直在用的机制），所以根本不需要等：

- **点击「创建分支」时**：后端立刻按分叉点裁好前缀、写成新会话文件、登记 `sessions` 行。
  分支页签打开即可看到**分叉点之前的全部对话**。
- **不需要发送**：不花 token、不多出一个轮次、源会话毫发无损（只读源文件）。
- **运行时分叉点包含用户点的那一轮**：点「请教一个数学题」这一轮 → 分支里有这一轮 + 之前所有内容。

**为什么这是对的**：用户点分支的意图是"基于当前进度换个方案继续"，那他就必须**看见**这份进度。
v4–v6 的分支页签点开是一片空白，与意图直接冲突——这在真机验收里被判定为错误。

**分叉点包含用户点的那一轮**（v7 修正）：点「请教一个数学题」这一轮 → 分支里有这一轮 + 之前全部。
三个引擎的切点都按"该轮结束、下一轮开始"取（**每条判据都与解析器同源**，见下）：
- Claude：切在**下一个**可见 user 记录之前（锚点轮是最后一轮则保留整份文件）。
- Codex：保留"锚点轮及之前"的完整轮（切在锚点轮 `task_complete` 之后）；锚点轮还没定稿就明确报错。

⚠️ 前端 `resolveForkAnchor` 对**用户行**必须**包含它自己**（原先退到上一轮结束，会把用户刚点的那一轮
排除掉，且与点同一轮的助手回复给出不同结果）。回归：`resolve-fork-anchor.test.ts` 里"用户行 == 该轮
助手行"那条断言。

**代价**：点了不发会留下一个真实会话文件（多一条侧栏记录）。这是"立刻看到上下文"的必要代价，
且它内容完整、可随时删除，不属于垃圾数据。

### 3.5 dsh：切在 `turn/end` 之后（第三引擎）

dsh 的转录本是**多帧 zstd**（`<dsh home>/sessions/<cwd-slug>/session-<uuid>/session.v<N>.jsonl.zstd`），
所以它的落盘形状与两个明文引擎整条都不同，实现单独放在 `engine/fork_dsh.rs`（能力表里一行
`DSH_FORK` 指向它）：

- **来源 id**：`session-<uuid>`（目录名 = 转录本 header 的 `id`）；分支 id 同样带前缀。
- **切点**：锚点轮的**第一个 `turn/end`**（含该行）。dsh 一轮里可以有多条可见 user 消息，
  所以**按锚点行号往后找轮尾**，不能"数第几轮的 turn/end"。
- **锚点定位**同样走 `user_row_lines("dsh", …)`：自己拿 `dsh_user_message_text` 数原始行会
  把注入块/内部帧算成用户消息，切点提前一轮。
- **没有 `turn/end`** 时明确报错，不退化成"从末尾分叉"。
- **回滚**要连目录一起删（分支是"目录 + 转录本"，只删文件会留下空目录占住那个
  `session-<uuid>`），所以能力表里 `cleanup` 指向 `remove_written_transcript_and_dir`。
> 相关：`--fork-session`（Claude）与 `thread/fork`（Codex）这两个**原生**设施**不再用于分叉落地**
> ——两个引擎统一走"自己裁前缀"。实测数据（#1/#3/#12）仍然有效，只是不再是主路径。

### 2.4 落地时的引擎调用

> ⚠️ **本节记录的是 v4–v6 用过的原生设施，v7 起两个引擎统一走"自己裁前缀"（§2.3），
> 这些调用已不再用于分叉落地。** 保留本节是因为里面的实测数据（#1/#3/#12）仍然有效，
> 也是"后备方案确实可用"的证据；但**实现里已经没有这些代码**，不要照本节去找。
> 下面 Claude 小节描述的原生路径已被 §2.3 的前缀复制取代。

#### Claude（实测 #1 / #3）

**tip 分叉**（分叉点就是源会话末尾）：

```
claude --resume <源id> --fork-session --session-id <新id> -p <用户的第一条消息>
```

- `--fork-session` 交出独立新会话；`--session-id` 让**新 id 由我们指定**（便于前端立刻建 tab）。
- 源文件不变；新会话文件立刻出现（实测 #1）。

**中间分叉**（分叉点是更早的完整轮次）：**两个引擎统一「自己裁剪前缀」**（v6 决策，理由见下），不用引擎的原地裁剪设施：

1. 生成 `新id = UUIDv4`。
2. 逐行读源文件，**复制到分叉点**（见 §3.3/§3.4 的记录级切点）。
3. 改写身份字段后写成 `<源目录>/<新id>.jsonl`（**直接写目标文件，不留中间文件**）：
   - Claude：每行 `sessionId` → 新 id（`uuid`/`parentUuid` **原样保留**，实测 #5）。
   - Codex：第一行 `session_meta.payload.id` → 新 id、`payload.cwd` → 源工作区。
4. 首条消息走普通续接：Claude `--resume <新id>`、Codex `thread/resume <新id>`
   （**都不加 fork 标志**，实测 #3）。

#### Codex（实测 #12、#15、#16）

**tip 分叉**：`thread/fork {threadId}` → Codex 自己复制并分配新 thread id
（回包带 `forkedFromId` = 源 id，以及 `thread.path` = 它真正写的 rollout）。
**中间分叉**：走上面的「自己裁剪前缀」，然后普通 `thread/resume <新id>`。

> **为什么 Codex 不用 `thread/rollback`（v6 决策，有实测依据）**
> `thread/rollback` 是**追加式**记录：实测（§2.1 #14）文件 73→**75** 行，多出一条
> `event_msg/thread_rolled_back {"num_turns":1}`，被回退的轮次**仍留在转录本里**。
> 引擎侧确实按它裁剪了模型可见历史（#15 已证：模型只列出 TURN1 与当前消息），
> 但**应用时间线仍会显示模型已经看不到的那几轮**——界面与模型上下文不一致，
> 不可接受。自己裁剪前缀则两者天然一致，且与 Claude 共用同一套机制与同一份测试；
> 顺带也不必再做「回退几轮 ↔ 保留到哪条记录」的换算。
>
> ⚠️ 这条修正了 v4/v5 的规划错误：当时把 `thread/rollback` 当作 Codex 中间分叉
> 的实现，却没考虑它是追加式的——而那条实测数据（#14）当时就已经在手上了。

**Codex 中间分叉的切点必须落在轮边界**（与 Claude 不同）：Codex 的轮次被
`event_msg` 的 `task_started` … `task_complete` 包起来，轮内还夹着
`turn_context` / `token_count` 等非会话记录。所以切点取「第 n−1 轮那条
`task_complete` 的后一行」，而不是"第 n 条 user 记录的行号"——后者会切进某一轮
中间，留下没有 `task_complete` 的残轮。（回归：`codex_cut_lands_between_complete_turns`、
`codex_cut_never_lands_inside_a_turn`。）

### 2.5 两引擎的身份规则（必须同时满足）

| | 权威来源 | 硬约束 |
|---|---|---|
| **Claude** | **文件名 stem** | stem 必须是**合法 UUIDv4**（实测 #8）；行内 `sessionId` 也要等于它，否则"应用认它、CLI 不认它" |
| **Codex** | **文件内 `session_meta.payload.id`** | 文件名需同步改名以保持一致；日期目录不重要 |

**统一规则：新 UUIDv4 同时写进文件名与全部内部身份字段。**

### 2.6 机制 (B) 的前缀复制现在是主干（原"后备"定位已作废）

机制 (A) 被否决后，复制前缀就是**唯一**路径：两个引擎的复制实现都已在 §2.1 #3/#5/#6/#7 验证通过。下面这段是当时"留一条后备"的推理，结论已被 §2.3 采纳为设计本身。**后缀若某个引擎版本不再支持原生分叉，不必再"退回"——本来就走这条路。是已验证可用的事实**——这也是本方案敢把原生路径当首选的原因。

---

## 3. 分叉点定位

### 3.1 问题：前端 `seq` 不能当锚点

- `Message` 只有 `seq: number`，**无 id/uuid**（源码 `ipc.ts:65-118`）。
- `seq` 由后端**按解析顺序**生成（`extract.rs:297`），前端为 live 行自行合成 `lastSeq + 1`（`stream.ts:282`、`session-utils.ts:96-107`），且**明确容忍重复**（`stream.ts:424-439`）。
- 解析还会**折叠**：`__usage__` 不产出行、`__tool_result__` 折回其 call 行（`extract.rs:241-279`）→ 行数 ≠ 记录数。

### 3.2 否决「给 `Message` 加原生锚点字段」

**缺陷一：原生 `uuid` 不是"每条消息唯一"。** `seq += 1` 是 per-Row（`extract.rs:297`），而**一条 assistant 记录可产出多行**：遇 `thinking`（`:1193`）/`tool_use`（`:1204`）会先把文本 flush 成独立行 → 一个 `uuid` 对应最多 N 条 Message；反向 `__usage__`/`__tool_result__` 不产出 Message。要拿它当锚点还得再造"记录内序号"，复杂度并未降低。

**缺陷二：当场流式的行永远拿不到锚点。** `selectSession` 有一句早退 `if (existing && existing.messages.length > 0) return;`（`sessions.ts:421-422`），而 `refreshSessionUsage` 只 patch `usage` → 本次会话里刚聊出来的消息 `anchor` 恒为 `undefined`，按钮大面积不出现。（这条早退是有意的性能保护，不该为 fork 去动它。）

### 3.3 方案：以「该轮的用户消息」为定位键，精确匹配

依据一条**可证的 1:1 关系**：

| | 前端 | 后端解析 | 能否精确匹配 |
|---|---|---|---|
| **用户消息** | 一轮 → 一个 live user 行 | 一条 `user` 记录 → **一个** user 行（用户轮无 thinking/tool_use 块，不会触发 flush） | ✅ **文本全等** |
| 助手消息 | 每文本段一个行 | **一条记录可产出多行** | ❌ 会错配 |

**所以定位键 = 被点击消息所属「完整轮次」的用户消息文本**，而不是被点击消息自身的文本。

```rust
/// 分叉点：以「该轮的用户消息」定位。
pub struct ForkAnchor {
    /// 该轮用户消息的**原始存储文本**（store 里的 message.text，
    /// 不是显示层 strip 过的文本）的 SHA-256；避免超长文本进 IPC。
    user_text_sha256: String,
    /// 该轮用户消息的 seq，仅作多处命中时的就近消歧。
    seq_hint: Option<i64>,
}
```

前端如何拿到：被点击行若 `role === "user"` 就是它自己；若是 `assistant` 则**向前**找最近的 `role === "user"`（与 `timeline-rows.ts:145-168` 的 `turnFinal` 同一种"遇 user 重置"扫描）。

**后端算法（确定性）**：

1. 以磁盘文件为准重新解析（`parse_session_file`）。
2. 取 `role == "user"` 且 `sha256(text) == user_text_sha256` 的行集合 `C`。
3. `C` 为空 → **明确报错**（`"未能在转录本中定位该轮消息，文件可能已被外部修改"`），不猜测、不退化。
4. `C` 多于一 → 取 `seq` 最接近 `seq_hint` 的一个；`seq_hint` 缺失则取最后一个。
5. **切点 = 该命中行「之后」第一条 user 行的起始**；若其后没有 user 行（末轮），切点 = 文件末尾。

**为什么能匹配上**：应用每个轮次都会把用户文本写成一条 user row；Claude 的 CLI chrome 由 `claude_drop_local_command`（`extract.rs:159-187`）整条丢掉，**被丢掉的行在前端也不会出现** → 「前端存在的用户消息」↔「后端存在的 user 行」1:1 且文本全等。

**对当场流式行同样成立**：流式 user 行在发送时写入 `text`，与转录本同源 → **刚发出的那一轮也能分叉**（这正好覆盖 tip 分叉）。

### 3.4 记录级切点

- **Claude**：链线性（实测 #6）。取"下一条 user 记录"的行号 `L_next`，复制 `[0, L_next)` 的**全部记录**（含 `attachment` 等辅助记录，实测 #7 要求）；无下一条则复制整个文件。
- **Codex**：与 Claude 共用同一条前缀裁剪路径（tip 也一样），但切点求法不同——
  `fork_keep_count_codex` 求的是**轮边界**（锚点轮那条 `task_complete` 的后一行），
  而不是"下一条 user 记录的行号"：Codex 的轮内夹着 `turn_context`/`token_count`，
  按 user 记录切会切出没有 `task_complete` 的残轮（§2.4）。

**祖先闭合（v8 修正：不再单独实现）**：这一条原本要求"复制后校验每个保留记录的 `parentUuid` 都在保留集内、缺失则递归纳入祖先"。**实际不需要**——复制的是文件的**连续前缀**，而转录本里父记录必然排在子记录之前，所以只要源文件闭合，任何前缀**必然闭合**（§2.1 #7 实测悬空 = 0）。为一条构造上不会触发的路径加防御步骤，只会多一段永远跑不到的代码；如果真遇到悬空引用，那是**源文件坏了**，该修源文件而不是在分叉时顺手补。

> 因为切点由"下一条 user 行"界定，**不会切在未完成轮中间**——除非那正是文件最后一轮，此时复制整个文件是正确的。

---

## 4. 实现方案

### 4.1 后端：`src-tauri/src/engine/fork/`（mod / anchor / title / landing）

```rust
#[tauri::command]
pub async fn fork_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,        // "claude" | "codex"
    session_id: String,    // 源会话 id
    at: Option<ForkAnchor>, // 分叉锚点；None = 取整份文件（tip）
) -> Result<ForkPlan, String>
```

> ⚠️ **下面这一整段是 v4 的惰性落地设计，已被 v7 推翻**：现在 `fork_session` 点击即落盘，`SendRequest` 上没有分叉字段。保留它是为了解释"为什么在代码里搜不到 `fork_from`/`--fork-session`/`thread/fork`"。

**~~惰性落地设计（v4 核心，已废弃）~~**：该命令**不**立即创建引擎侧会话，而是返回一个"待落地分支"的描述，前端把它挂在 tab 上；该分支的**第一条消息**通过既有的 `send_message` 发出时携带分叉参数，由引擎适配层执行 §2.4 的落地调用。

具体落点（源码核对）：

- `SendRequest`（`engine/mod.rs:130` 一带）新增可选字段 `fork_from: Option<ForkSpec>`：`{ source_session_id, mode: Tip | Trimmed(u32 /*保留轮次数*/) }`。
> ⚠️ **引擎适配层不需要任何改动**（v7 起）：分叉在 `fork_session` 里就落盘完成，分支的每条消息
> 都是**普通续接**（Claude `--resume <id>` / Codex `thread/resume <id>`），
> `SendRequest` 上没有分叉字段、`build_command` 与 `thread_open_request` 里没有分叉分支。
> 早先设计里"发送时落地"的那套适配（`fork_from`、`--fork-session`、`thread/fork`、
> `prepare_launch` 阶段的 staging）**已全部删除**，不要按旧描述去找。

**登记与通知（两引擎共用）**：

| 步 | 动作 | 依据 |
|---|---|---|
| 1 | 定位源文件 | 用 `session_meta_by_id(engine, session_id)` 取 `file_path`（`reader.rs`，无需改可见性）（先例：私有 `mod codex_titles` + `pub(super) fn sync`，被 `scanner.rs:586` 调用） |
| 2 | 拒绝不支持情形 | 引擎 ∉ {claude, codex, dsh} → `Err("该引擎暂不支持会话分叉: {engine}")`（能力表查不到该引擎）。~~`remote` 会话 → `Err`~~ **已删（v7 实测）**：该判断**按构造不可达** —— `session_meta_by_id` 硬编码 `remote: None`（`reader.rs:129`），`sessions` 表**没有 `remote` 列**，远程会话根本不会产生 `sessions` 行。远程门禁由**前端**按 catalog meta 负责（置灰 + 说明），后端不再留死分支 |
| 3 | 定位 + 算切点 | §3.3 / §3.4 |
| 4 | 生成新 id | `Uuid::new_v4()`（`Cargo.toml:41` 已有 `uuid`+`v4`）。**必须 UUIDv4**（实测 #8） |
| 5 | Claude 中间分叉：写前缀文件 | `create_new(true)`，**不覆盖任何已有文件**；失败即 `remove_file` 清理 |
| 6 | 登记 `sessions` 行 | **不可复用 `upsert_rows`**（私有 + 绑 `PreparedUpsert`/`Tier1` + `advance_markers` 会写全局 marker）。用 `scan_summary_file`（`extract.rs:50-72`）+ `stat_signature`（`mod.rs:101-114`）+ 一条与 `scanner.rs:525-537` 同形态的 INSERT…ON CONFLICT |
| 7 | 复制 `accepted_internal_frames` | **必须**（否则分支会把 CCGUI 内部帧重新显示出来）。⚠️ **不要**用 `db.record_accepted_internal_frame_hash`——v7 实测该函数（`db.rs:382-412`）**没有任何上限逻辑**，只是 `INSERT OR IGNORE` + `DELETE FROM fts_state`；上限只活在 IPC 命令 `record_accepted_internal_frame`（`reader.rs:1209`）里，且它的 `Ok(false)` 含义是"标识已存在"（`changed == 0`）而非"超上限"。正确做法：一条 `INSERT OR IGNORE … SELECT … LIMIT`，上限取 `history::reader::{MAX_RECORDED_FRAMES_PER_SESSION, MAX_RECORDED_FRAMES_TOTAL}`（每会话 5 000 / 全局 100 000），并只删一次 `fts_state`。**超限时让分叉失败并回滚文件，而不是复制一个子集**——子集会静默重新显示源会话已隐藏的内部帧，那是假成功 |
| 8 | 写 `accepted_frames_signature` | 该列是 `ALTER TABLE … NOT NULL DEFAULT ''`（`db.rs:1022-1032`）；**写 NULL 会失败**。用 `db::accepted_internal_frames_from(&tx, engine, target_session_id)` 取**同一事务内**复制后的集合再算签名 |
| 9 | 复制会话记忆 | 复用 `db.remember_session_model`（`:223`）/`remember_session_effort`（`:245`）/`remember_session_provider`（`:267`），不手写 SQL。**`session_providers` 只影响计划审批**（唯一消费点 `codex_app.rs:1310` ← `run_plan_decision`:1928），普通对话由前端每次传 providerId |
| 10 | 标题 | `custom_title` 写分支标题（`upsert_rows` **不碰** `pinned`/`custom_title`），`title` 列写**扫描推导**的标题。**命名规则（v8 用户定，推翻 v7 的"统一世系编号"）**：`<来源会话当前名> (fork #N)`——"当前名" = 源行 `custom_title` 非空则用它，否则用它推导的 `title`；`N = 1 + max{ k \| 存在名为「父当前名 (fork #k)」的会话 }`（**max+1，空号不复用**）。从分支再分叉**会堆叠**成 `数学 (fork #1) (fork #1)`，这是**有意**的：v7 的"反复剥掉后缀、整条世系共用一套编号"在真机上表现为"从 #2 分出来的却叫 #3"，看起来像兄弟而非子节点，血缘丢失。**判兄弟必须整串精确匹配**（前缀匹配会把孙节点算成兄弟而虚高编号）。旧函数 `fork_base_title` 已删除。后缀语言中立 → 由后端拼，不需要走 `src/i18n`。**长度上限（v8）**：整条标题最多 **80 字符**、后缀链最多 **5 段**——超出时丢**最旧**段并在根名后插 `…`；根名被预算截断时同样补 `…`（"凡截断必留痕"，与 `git.rs` 截 diff 插标记同一条约定）；编号 `N` 仍按**完整**父名计算 |
| 11 | 通知前端 | `emit_sessions_changed()`（`event_sink.rs:191-193`）——注意它**只重读表、不重扫**，所以第 6 步必须先成功 |

路径来源：`session_meta_by_id(engine, session_id)?.file_path`（`reader.rs`）。**不需要** `session_file_path` 的可见性变更——**不需要**动 `PreparedUpsert`/`Tier1`（不走 `upsert_rows`）。

**失败语义**：步骤 1–5 任一失败 → `Err`，此时**文件还没写**，不留半成品；步骤 6–8 失败 → **删掉已写出的分支文件并让命令失败**（`register_fork_or_rollback`）。不回滚是错的：留一个"有文件、没行"的分支，扫描器看不到它、它却占着名字，用户拿不到也用不上。**步骤 9（会话记忆）是唯一例外**——分支已成立，写失败不回滚，但**逐项记日志、不静默**（否则分支会悄悄用引擎默认模型跑）。

### 4.2 命令注册（四处，缺一不可）

| 位置 | 动作 |
|---|---|
| `src-tauri/src/engine/fork/mod.rs` | 新模块：引擎无关的主流程（`fork_session` / `resolve_fork_plan`）+ 能力表 `FORK_SUPPORT` |
| `src-tauri/src/engine/fork/anchor.rs` | 锚点与切点：`ForkAnchor`、`text_sha256_hex`、`anchor_turn`、两个 `fork_keep_count*` |
| `src-tauri/src/engine/fork/title.rs` | 分支标题编号、堆叠与长度上限 |
| `src-tauri/src/engine/fork/landing.rs` | 落盘与登记：前缀复制、身份改写、`register_fork_landing_with_path`、失败回滚 |
| src-tauri/src/lib.rs:474-492 | 注册进 invoke_handler |
| `src-tauri/src/web/dispatch.rs:768-860` | 加 `"fork_session"` 分支 + args 结构体。**网页模式走这条通道，漏了只有桌面端能用** |
| `src/lib/ipc.ts`（约 `1546`） | `forkSession` wrapper + 类型（对照 `deleteSession`） |

### 4.3 前端

**入口**：`src/features/chat/components/MessageTimeline.tsx`

已核实：每消息操作**只有复制按钮**，无右键菜单、无通用 edit/retry（唯一的 per-message 重发是权限卡 `GrantCard.tsx:62`，其 disabled/loading 视觉可借鉴）。

- **签名现实**：`MessageActions` 入参是 `{ text }: { text: string }`（`:223`），**拿不到 message**；`UserMessageCopy` 同样（`:252`，`:255` 空文本早退）。要让按钮知道"点的是哪条消息"，必须补参数。
- 入口：**只加在助手回复的操作行**（`MessageActions`）。用户气泡**不加**分叉入口——分叉按「轮」定位，用户气泡与同轮回复指向同一个分叉点，两侧都放会让图标密度翻倍而信息量为零（**不是** `GitBranch`，理由见 §4.3.1），复用 `iconBtn` 规格（`size-6`）。
- ⚠️ **不要放宽 `turnFinal` 守卫**：`368-378` 的守卫同时包住 `MessageActions` **和 `MessageMeta`**，而 `turnFinal` 在整个流式窗口为 false（`:107` 还有 `&& !turnLive`）。整体放宽会让「时间/用量/模型」出现在**仍在增长**的回复上。→ 按 §4.3.1 拆成"常驻行 + hover 元信息"。
- 分叉点构造：按 §3.3 先取**该轮的用户消息**，用**store 里的原始 `message.text`**算 hash（**不是** `UserMessageRow` 渲染的 `stripped.text`，`:327`）。
- 交互：点击 → 调 `forkSession` → 成功后新会话以新 tab 打开 → 用户在该 tab 继续。失败 → 见下"错误呈现"。
  （v7 更正：分支在 `fork_session` 里就已经落盘，§2.3——旧描述"此时引擎侧尚未落地、要发第一条消息才落地"已废弃。）

### 4.3.1 操作区可见性方案（已确认，覆盖原 hover-only 方案）

**目标**：复制、分支两个按钮**常驻**；时间·耗时·tokens·模型·推理档位**保持 hover 显形**；不做点赞/点踩（仓库现状也没有，无需删改）。

**结构改动（必须按此拆分，否则会连带暴露元信息）**：现状是两个组件共用一行、整行被 `turnFinal` 包住（`MessageTimeline.tsx:368-378`）。正确切法：

```tsx
<div className="group flex flex-col text-left">
  <Markdown … />
  {/* 常驻行：复制 + 分支（不再依赖 turnFinal） */}
  <div className="mt-1 flex items-center gap-2">
    <MessageActions … onFork={…} />
    {/* 元信息仍留同一 flex 行内，继续用 opacity→group-hover 显形 ⇒ 不产生布局跳动
        （MessageMeta 用 opacity-0 而非条件渲染，:210；沿用现有做法） */}
    <MessageMeta message={message} />
  </div>
</div>
```

**附带收益**：该行不再依赖 `turnFinal`，分支入口得以出现在**任意** assistant 段落上——正好解决"用户想分叉的那条回复未必是本轮最后一段"的既有问题。

**流式期间（已定：保留占位 + 禁用，不隐藏）**

- 整行**始终渲染**；流式期间两个按钮以 `disabled`（`opacity-50 cursor-not-allowed`）呈现，`turnLive` 结束后变可用。
- 理由：① 避免回复结束时多出一行的布局跳动；② **语义正确**——回复还在增长时复制会拿到半句话，"看得见但明确不可用"比"藏起来"更诚实；③ 复用 `GrantCard.tsx:165-173` 的既有禁用视觉。
- 按 `ui-ux-spec.zh-CN.md` §3「前置条件未满足的禁用」：**若**该禁用需要解释文案，必须用 `aria-disabled` + 点击守卫（原生 `disabled` 收不到 hover/focus，解释性 tooltip 读不到）。本处禁用原因自明、**不加 tooltip**，因此用原生 `disabled` 属合规；一旦将来要加提示，必须改成 `aria-disabled`。

**图标：分叉用 `lucide-react` 的 `GitFork`，不用 `GitBranch`**

- 状态栏的 git 分支切换器（`useBranchSwitcher` → `ChatConversation.tsx:368-375` → `ConversationFooter`）已占用 `GitBranch` 的视觉语义；分叉若复用同形图标，「切换 git 分支」与「分叉会话」会长得一样。
- 已确认 `lucide-react@0.562.0` 同时导出 `GitBranch` 与 `GitFork`，两者轮廓差异明显（GitFork：两上节点 + 汇合线 + 一下节点；GitBranch：一竖线 + 一弧线）。对比预览：`docs/design/fork-icon-preview.html`。

**可达性（顺带修掉既有违规）**：现状 `MessageActions`（`:229`）与 `UserMessageCopy`（`:262`）只靠 `group-hover` 显形，**没有 `focus-visible` 兜底** → 键盘/读屏用户无法触达「复制」，违反 `ui-ux-spec.zh-CN.md:80`（"可交互元素至少实现：默认 / hover / `focus-visible`（`ring-border-focus-ring`）/ active / disabled"）。常驻化后可见性问题自然消失；仍需为按钮补 `focus-visible` 焦点环。

**user 气泡侧不放分叉入口，复制也不常驻**：保留改动前的 hover / `focus-visible` 显形即可（其 `:255` 空文本守卫继续负责纯图片消息）。理由见 §3 的分叉规则块：分叉语义按「轮」定位，用户气泡与同轮回复指向同一个分叉点，只留助手侧一处。

**复制反馈**：复用 `useCopied`（`src/hooks/use-copied.ts`，成功后 `Check` + **1500ms** 复位）；按 `ui-ux-spec:224`，可访问名一并改为"已复制"。

**回调传递（可以不做）**：已核实 `MessageTimeline` **本来就有 store context**（`:9` 导入、`:537-538` 订阅），且 store action 在 `create<ChatStore>` 里只创建一次（`store.ts:80`、`134-214`）→ `useChatStore(s => s.forkSession)` 是**稳定引用**，无需逐层穿参。
⚠️ **分屏陷阱**：读"当前是哪一栏的会话"必须用 `useScopedSession()`（`split/session-scope.tsx:28-32`），**不能**用 `useChatStore(s => s.active)`（SplitLayout 每栏一个 `ChatConversation`，各有自己的 `active`）。
若仍选择穿参：链路含 `ConversationBody`（`ChatConversation.tsx:75-89`）、`SessionTimeline`（`:50-58`）、以及用户气泡的 `UserMessageRow`（`:311`）→ `UserMessageCopy`；回调必须 `useCallback` 固定标识，否则每个流式 flush 重渲所有已挂载行（行稳定性依赖 `timeline-rows.ts:33-58` 的 WeakMap 缓存，虚拟列表 `overscan: 8`）。测试影响：`MessageTimeline.test.tsx` 多处直接渲染 `MessageRow`/`MessageTimeline`，**新增 prop 必须可选**。

**打开新 tab**：复用 `selectSession(engine, newId, workspacePath)`（`sessions.ts:368`）。
- `sessionKey` 对 native 会话是 `${engine}/${sessionId}`（`persistence.ts:25-33`，**不含 workspacePath**），新 uuid 天然不冲突；新 tab 只需 `{engine, sessionId, workspacePath}`。
- ⚠️ `selectSession` **不依赖前端 catalog**（catalog 读取全是可选 `?.model` 等），真正依赖 **后端 `sessions` 行**（`reader.rs:271-278` 找不到就报 `session not found`）→ 该行登记失败会变成"tab 已激活但空白 + 错误横幅"。
- ⚠️ **顺序**：`upsertSessionMetaInto(set, 返回的真实 meta)` 要在 `selectSession` **之前**，分支才能立刻继承 model/effort/provider。**不要用 `optimisticMeta`**（命令已返回真实 meta）。

**错误呈现**：仓库**没有通用 toast**。用 `set({ actionError: errorText(error) })`，与 `deleteSession`/`renameSession`/`pinSession`/`archiveSession` 完全一致（`sessions.ts:546-549` 等）→ 由 `ChatPage.tsx:297-303` 渲染、可关闭、已本地化。

**i18n**：`zh.ts` / `en.ts` 的 chat 命名空间（对照 `zh.ts:160-165`）新增 `forkConversation`（「创建分支」/ "Fork conversation"）与 `forkFailed`。**双语一致性由类型系统强制**（`zh.ts:2310` `export type Messages = typeof zh` + `en.ts:1-3`），不是靠测试；仓库**没有**通用 i18n parity 测试。

**搜索索引无需处理**：`search.rs` 的 `index_pending`（`:314`）按 stat 变化增量索引，新会话会被自动索引。

### 4.3.2 待落地分支的页签表现（验收发现的缺口，已补）

> ⚠️ **本节描述的是 v4–v6 的「待落地分支」状态，v7 起改为「点击即落盘」（§2.3），
> 该状态在实现里已经不存在。** 保留本节是因为它记录了那次真机验收的缺口与当时的
> 修法，也是"不要再把未创建提示请回页签"的依据；但**不要照本节去找代码**：
> `tab.forkFrom` 绑定、`forkPendingBadge` 角标、待落地空态与标题回退都已删除
> （`docs/ui-ux-spec.zh-CN.md` 的会话分叉条已写明：**不存在"待落地分支"这个
> 状态**，页签标题一律走后端写入的 `customTitle`）。

分叉是**点击即落盘**的（v7 起；v4–v6 曾设计成惰性）：点分支图标时后端就写好前缀转录本、发一个新 id 并登记 `sessions` 行。
于是有两处必须显式处理，否则用户看到的界面与真实状态不符：

| 缺口 | 现象 | 修法 |
|---|---|---|
| 页签标题 | `use-chat-tabs.ts` 取 `meta?.customTitle \|\| meta?.title`，待落地时 `meta` 是 `undefined` → 显示 **「新对话」**，看不出这条页签从哪来 | 标题再回退一层到 `tab.forkFrom.sourceTitle`，用 i18n 的 `chat.forkBranchTitle`（`"{{title}} · 分支"`）拼 |
| 状态说明 | 用户会以为会话已经建好了 | 页签上挂一个 `GitFork` 角标，`role="img"`、可访问名 `chat.forkPendingBadge`、`title` 用 `chat.forkPendingHint`（"在输入框发出第一条消息后…"）。**用 `role="img"` 而不是按钮**——页签里不该嵌可聚焦控件，也避免多一个 tab 停靠点 |
| 会话区 | **真机验收的实际反馈**：时间线为空，用户读成"当前窗口被清空了"，以为原会话丢了 | `ChatConversation` 在 `active.forkFrom && messageCount === 0` 时渲染空态（`chat.forkPendingBadge` + `chat.forkPendingFrom` 说明来源 + `chat.forkPendingHint` 说明如何落地）。**空视图必须自解释**，不能让用户猜是"空"还是"坏" |

`SessionTabItem.pendingFork` 由 `use-chat-tabs.ts` 从 `Boolean(tab.forkFrom)` 得出；落地后
`forkFrom` 会被摘除（§4.4），角标与标题回退同时失效，自动切到后端那行的 `customTitle`。

**文案归属（架构约束）**：标题后缀**必须**由前端按当前语言拼好、经 `fork_from.title`
下发（§4.1 第 10 步）。早先的实现把 `" · 分支"` 写死在 Rust 里，英文界面会显示中文后缀
——用户可见文本一律走 `src/i18n`，原生层不造句。回归：`use-chat-tabs.test.tsx`（标题回退）、
`session-tab-strip.test.tsx`（角标可访问名）。

### 4.4 明确不改的东西

- **不改** `session_providers` 的语义、`upsert_rows`、`PreparedUpsert`/`Tier1`。
- **不改** `selectSession` 的早退（`sessions.ts:421-422`）——那是有意的性能保护。
- **不引入** `preassigned_session_id` 的 Claude 预注册（v1 的 (b) 优化）——`--session-id` 已能指定新 id，无需动那套 12 引擎共用的注册语义。

---

## 5. 边界与失败路径

| 场景 | 行为 |
|---|---|
| 半截轮次（有问无答） | **不作为分叉点**（需求已澄清）；分叉点一律落在完整轮次边界 |
| 对分支再分叉 | 允许，链式派生 |
| 点了分叉但没发消息 | 分支**已经是一个真实会话**（点击即落盘，§2.3）：有文件、有 `sessions` 行、页签里能看到继承的历史；不想要就按普通会话删除 |
| 源会话在分支落地后被删除 | 分支不受影响（落地时已独立） |
| 分叉点之后源会话继续追加 | 分支不感知（分支继承的是分叉那一刻的前缀），符合预期 |
| 正在流式的行 | 操作行保留占位、两个按钮 `disabled`（§4.3.1）；流式结束后可用 |
| 会话被 compact 过 | 前缀含 `compact_boundary` 记录，摘要语义天然保留 |
| 图片附件 | 记录原样搬运（Claude data URL、Codex 绝对路径） |
| sidechain / subagent | Claude 的在兄弟目录、`--resume` 不读 → **不必搬**（实测 #11） |
| 消息文本被外部改写 / 编辑过 | 定位失败 → **明确报错**，不猜测 |
| 同文本消息出现多次 | 用 `seq_hint` 就近选 |
| 转录本含坏行 | 容忍（实测 #20）；复制时不需逐行校验 |
| WSL / 远程会话 | v1 不支持，**入口置灰并用 `title` 说明**（不是不显示） |
| 其他引擎 | 后端 `Err("该引擎暂不支持会话分叉: {engine}")`；前端按同一份白名单在本地就置灰并说明——点下去才报错等于把后端错误当反馈 |
| 磁盘写失败/权限不足 | 明确报错 + 清理半成品 |
| 转录本超 64 MiB | 明确报错（与 `load_remote_session_page` 同口径） |
| Codex 回退记录应用侧未识别 | **已不适用**：分叉不走引擎原生回退（`thread/rollback`），分支是自己写出来的前缀转录本，所以不存在"应用侧认不出回退"的情形 |
| 会话记忆复制失败 | 不回滚，**如实上报降级**，不静默 |

### 5.1 继承上下文的成本：各家方案对比（本机实测）

"分支的第一条消息要重读继承的全部上下文"这件事，各家的解法差别很大。以下全部来自**本机验证**，
不是文档推测。

| | 谁拥有模型循环 | 历史怎么进请求 | 大历史的代价 |
|---|---|---|---|
| **Claude Code 2.1.252** | CLI 自己 | 转录本**内联**全部 `tool_result`（实测占转录本 31.5% 字节）；`--resume` 读全量 | 继承多少付多少。只有 `--autocompact <auto\|100k–1M>` 抑制**未来**增长 |
| **Codex** | CLI / app-server 自己 | rollout 内联；`model_auto_compact_token_limit` 触发压缩；`wire_api="responses"` 时可用服务端保存会话状态（该开关由用户配置决定） | 同上 |
| **本方案（CC GUI 分叉）** | 借用上面两个 CLI | 复制前缀，**内联全部** | **与原会话同一进度时同价** |

**核心结论：能不能"把历史挡在请求之外"，取决于谁拥有模型循环。** 自己拼 prompt 的 agent 可以自由决定
发多少；Claude Code / Codex 是**自成闭环的 CLI**，我们只能通过"往转录本里放什么"来影响它们。
而 `tool_result` 块必须与 `tool_use` 成对出现（API 约束），所以**"把工具输出挪出转录本"这条路对这两个
引擎不成立**——那正是自研 agent 才有资格做的优化。

**我们唯一能做的是"少放一点"，而实测收益很小**（§5.2 的字节构成：机器载荷仅 35%）：

| 可选做法 | 实测收益 | 代价 | 判断 |
|---|---|---|---|
| 丢掉完整的工具调用对 + 思考块 | 省 ≈35% 体积 | 模型不知道它改过哪些文件 | **不做**：有损换 35% 不划算 |
| 截断超大 `tool_result` 内容（保留块、内容换成标记） | 省 ≈31%（上限） | 丢失工具输出细节 | 不做，同上；实测样本里工具输出并非大头 |
| **少继承几轮**（如"只继承最近 N 轮"） | **实测无收益**：体积 4.6× 差 → 耗时 0.35×（反向），见 §5.1.1 | 违背"包含分叉点之前全部对话"的已定语义 | **不做**：为不存在的收益牺牲上下文完整性不值 |

**所以：分叉没有引入新的成本类别。** 分支第一条消息发的 token 量与原会话在同一进度下**相同**
（实测 Codex 分叉 resume 的 `inputTokens 84994`）。要更快，只有"少继承"这一条路，而它需要先改语义。

#### 5.1.1 分支首轮为什么慢：三次实测，两个假设都被否掉

这一节记录**实测过程与结论**，因为前后两个直觉都被数据推翻了。测法都是"复制真实转录本成带新
`sessionId` 的副本 → `claude --resume <副本> -p ok` 计时"，只碰副本，不动用户会话。

**第一次：热/冷缓存**（同一份 252 KiB 转录本，3 个副本背靠背，第三个空闲 6 分钟）

```
A 首次（缓存未知） 345.0s      B 紧随其后（前缀完全相同）271.1s      C 空闲 6 分钟后 410.4s
```

热/冷差异**真实但不主导**（C 比 B 慢 51%，B 只比 A 快 21%）；且 252 KiB 要 271–410 s，而更早一次
**1.84 MB 只花 22 s** —— **体积与耗时不成比例**。**那次 22 s 因此作废，不要再引用。**

**第二次：极小上下文对照**（全新会话，几近零历史）

```
T1 新会话 16.9s    T2 新会话 8.9s    T3 resume 刚建的会话 5.5s
```

"零上下文 ≈ 6 s" vs "真实会话 ≈ 150–440 s"。看起来像"体积主导"。

**第三次：同源不同裁剪比例**（同一份转录本，取前 25% / 50% / 100%）

```
 25%   55 KiB : 443.7s
 50%  133 KiB : 233.1s
100%  252 KiB : 154.5s        ← 体积比 4.6x，耗时比 0.35x
```

**体积翻了 4.6 倍，耗时反而降到 0.35 倍。** 所以**体积不是主导因素**，第二次的"体积主导"印象是
"有真实内容 vs 几乎没有内容"这个跃变造成的，不是线性关系。

**结论（三条，都可引用）**

1. **分支首轮耗时约 150–440 s，run-to-run 方差极大**，与继承体积**不相关**。先前引用的 22 s 作废。
2. **"少继承几轮"不该做**：4.6 倍体积差没能带来任何稳定收益，为一个不存在的收益牺牲上下文完整
   性不值。§5.1 那张表里的这一行据此从"待产品决策"改为**不做**。
3. 成本落在**模型/代理栈**上，不在我们的复制逻辑、也不在分叉机制：这台机器的 `claude` 走本地代理
   （`ANTHROPIC_BASE_URL` 指向**本机代理**）跑 **一个 1M 上下文的模型**，并开着
   思考。**我们唯一该做的是让等待可见**（分支首轮给出明确进行中状态），而不是去优化一个我们控制
   不了的延迟。

> 方法论教训（值得记住）：这一节我先猜"缓存主导"，再猜"体积主导"，**两次都被自己的实测推翻**。
> 单次测量在这套栈上毫无代表性（同一操作 154 s 与 443 s 都出现过）；要下结论必须先有对照点。

> 附注：我们的复制用 `serde_json::Value` 重新序列化每一行，**键顺序可能与源文件不同**（文件字节
> 不同），但**解析出的消息语义相同**，因此不影响模型侧的缓存键。这是"改字节但不改语义"的有意行为。

### 5.2 创建分支本身的规模评估（实测，回答"轮次很多会不会卡死"）

按真实会话的比例（4 轮 / 29 记录 / 49 KiB）合成 **100 轮**转录本实测：

```
100 轮 → 800 条记录 / 1.38 MiB
  裁到  25%（200 条）→ 逐行改写 1.9 ms（中位）
  裁到  50%（400 条）→ 逐行改写 3.9 ms
  裁到 100%（800 条）→ 逐行改写 7.2 ms（最大 7.9 ms）
  解析全部 800 条 JSON: 7.3 ms
```

**结论：创建分支本身不会卡死应用。** 文件工作量约 15 ms 且随规模线性；上表量的是 Node 的 JSON 往返
（比 Rust serde 慢，是**偏保守的上界**），早先对真实 1.8 MiB / 953 行文件的 Rust 实测同样约 **10 ms**。

真正要留意的两点：

1. **分支里发第一条消息会慢**——引擎侧要为这一轮处理继承的全部上下文。实测 **150–440 s**（方差极大，
   见 §5.1.1）。这是**分叉语义的固有代价**（分支必然携带全部前文），而且**原会话在同一进度下每轮
   同样要付这个代价**——分叉只是把已有的成本也带给分支，**不是应用卡死**，也不是分叉新增的成本。
   **且不能靠限制继承轮数缓解**：§5.1.1 的实测显示体积 4.6× 差 → 耗时 0.35×（反向），无收益。
2. **体积上限必须存在**——上表按**纯文本**估算。转录本里的图片是 base64，巨量工具输出也会膨胀，
   极端情况下可到几百 MB，同步复制就会变成数秒 + 大量磁盘占用。§5 的「超 64 MiB 报错」这一行
   就是为此设的硬护栏（与 `reader.rs:704` 的 `MAX_REMOTE_SESSION_BYTES` 同口径）。

---

### 5.3 Codex 手写 rollout 的可行性（实测，关闭最大未知项）

Codex 的分支落地曾经是**唯一没有真机验证**的环节：我们手写 rollout 并把第一行的
`session_meta.payload.id` 换成新 id，但没人确认 Codex 是否认这份文件。现已实测确认：

| 实验 | 结果 |
|---|---|
| 复制一份真实 rollout，只把内容里的旧 id 换成新 id，命名保持 `rollout-<时间戳>-<id>.jsonl` | `codex exec resume <新id>` **成功**，回 `ok`，`tokens used 16,841` → 确实加载了继承的上下文 |
| 同样复制但**故意**命名成 `<新id>.jsonl`（不带 `rollout-` 前缀） | 同样**成功** |

**结论两条**：
1. Codex 按**内容里的 `session_meta.payload.id`** 发现会话，手写 rollout 可以 resume。
2. **文件名约定无关紧要**（带不带 `rollout-` 前缀都行），所以我们的复制命名 `<新id>.jsonl` 是对的，
   不需要迁就 Codex 的命名风格。

**顺带修正**：复制时**不再改写 `cwd`**。分支必然与源会话同工作区，rollout 里记的就是正确路径；
改写它等于引入第二个"工作区"来源（DB 的 `workspace_path` vs rollout 的 `cwd`），两者拼写若不同
就会把分支悄悄跑到别处。**只改身份、少改字段**。

> 另外：`thread/fork`（Codex 原生 tip 分叉）已随"发送时落地"整条链路一起删除（§2.3 v7）。
> 现在两个引擎**共用同一条前缀复制路径**，而这条路径现在两边都实测过了。

## 6. 验证计划

### 6.1 已在设计阶段完成（§2.1 共 20 项，全部通过）

最大风险均已消解：能否分叉、**是否必须发送才落地**、中间分叉是否可行、两个原生设施是否可用、rollback 是否真影响模型可见历史、身份权威来源、stem 格式约束、引擎侧 db/索引、workspace 注册、sidechain、性能、坏行容忍。

### 6.2 实施期必须验证

1. **端到端（点击即落盘）**：点击分叉 → **不发消息**就确认分支页签已有继承历史、独立会话文件已产生、源文件未变 → 再在分支里发一条消息，确认回答体现继承上下文（Claude / Codex / dsh 各一遍）。
2. **Codex 与 Claude 各跑一次中间分叉**：确认分支历史只含被保留的轮次、且
   不含分叉点之后的内容。前缀裁剪在文件层就切干净了，所以时间线与模型上下文
   应当一致；这一条要人工确认（原先担心的 `thread_rolled_back` 展示缺口已因
   改用前缀裁剪而不存在，见 §2.4）。
3. **`session_file_path` 可见性**：改 `pub(super)` 后确认无回归。
4. **前端零回归**：`pnpm build` + `pnpm exec vitest run`；确认新增函数 prop（若穿参）未破坏 `MessageRow` 的 `memo`。

### 6.3 单元/集成测试（`src-tauri`）

- `cargo test fork`：锚点定位（唯一命中 / 多处 + `seq_hint` / 零命中报错）、记录级切点、Claude「存在才改 `sessionId`」且保留 `uuid`、Codex 轮次数推导（`task_complete` 计数）、`create_new` 防覆盖与失败清理。
- 复用 `extract.rs` 既有 fixture 风格构造测试转录本。

### 6.4 网页模式

`fork_session` 在 `web/dispatch.rs` 注册后，从浏览器经 web 通道走一次同一入口。

### 6.5 端到端（真实应用，必须人验）

Claude / Codex / dsh **各一遍**：长会话 → 中间分叉 → 分支里问「我们刚才定了什么方案」→ 确认回答体现继承上下文且**不含被裁掉的轮次** → 回原会话继续 → 两侧互不影响、侧栏两条独立会话。

**各自要盯的点**：
- Claude：分支 tab 打开时历史为**空**就说明落地登记没生效（登记成功时历史应当**立刻可见**——点击即落盘）。
- Codex：分支的标题是 `<来源标题> (fork #N)`，且分支里发第一条消息能正常续接（手写 rollout 已被 §5.3 实测确认可 resume；
  若报 `session not found`，说明 `session_meta.payload.id` 没被改写）。
- dsh：分支目录必须是源会话目录的**同级兄弟**（不是嵌套在源目录里），目录名与 header 的 `id` **逐字相等**，且转录本**第一帧恰好只有 header 一行**（host 会校验，不满足时 `session/create` 直接以 `corrupt Zstandard session log` 拒绝）。分支里发消息能续接、回答能体现继承上下文。
- 三个引擎都不该出现「文件在、`sessions` 行不在」的半成品——那正是 §4.1 失败语义要防的状态。

---

## 7. v1 明确不做

- 分叉点可视化「分支树」/ 血缘图（Codex 有现成 `forkedFromId`，Claude 无等价物，留待后续）。
- 跨工作区分叉（默认同工作区）。
- WSL / 远程会话分叉。
- 分叉时自动建 git 分支/worktree（与本功能正交，另见 `docs/design/worktree-implementation.zh-CN.md`）。
- 分支合并回主会话。
- Claude / Codex 之外的引擎。**（v8 起已做 DSH；本条改为"能力表之外的引擎"）**
- sidechain / subagent 记录迁移。
- 撤销/回收分叉（用既有会话删除即可）。

### 7.1 后续优化：用**语义总结**当标题（已调研，待定方案）

产品意向：分支标题与其用行为式的 `<父名> (fork #N)`，不如用**首条消息的语义总结**。以下是把调研结果先记下来，避免下次从头讨论。

**关键事实：引擎通常已经自己生成标题，我们不必自己造。**
- `extract.rs` 的推导顺序是**先取引擎提供的标题记录**（`self.title = truncate_chars(&body, 80)`），取不到才退回首条用户消息（同样截 80）。
- Codex 有专门的 `history/codex_titles.rs`：从**追加式索引**同步 app task name（同 id 多名时后者胜出），**即使 rollout 的 stat 未变也会跑**。
- dsh 的转录本里有 `session/title` 记录类型——**host 自己会生成标题**。

所以这一项应写成"**优先读引擎/host 提供的标题；只有引擎不提供时才考虑合成**"，而不是"我们做一个总结服务"。

**硬约束：总结请求不能出现在会话里。**
- 引擎支持标题记录时（dsh `session/title`、Codex 的 task name 索引）**写进那里**——它天然不是可见消息。
- 必须由我们发起时，**只能用带外的一次性会话/非会话调用**（本项目压测时用的"复制一份转录本再跑"就是这种形态），**绝不能进用户的会话，也不能作为可见记录落盘**。

**与分叉命名的冲突（必须先解决）**：分叉时我们**有意**用 `<父名> (fork #N)` 覆盖引擎标题，为的是血缘可见。两者共存的合理形态是**总结当"根"、血缘后缀照旧**：`<总结> (fork #1)`。

**待定**：谁发起、何时发起（分叉时？首轮结束时？）、失败时是否回退到"首条消息截 80"。

---

## 附录 A：Claude Code 记录形态（953 行真实转录本实测）

| 记录种类 | 数量 | 属于会话链 |
|---|---|---|
| `assistant` | 523 | 是 |
| `user` | 242 | 是 |
| `last-prompt` | 48 | 否（含 `leafUuid`，标记链尾） |
| `queue-operation` | 46 | 否 |
| `mode` | 35 | 否 |
| `attachment` | 29 | 否（但**被会话记录引用为 parentUuid**） |
| `file-history-snapshot` | 23 | 否 |
| `file-history-delta` | 4 | 否 |
| `system` | 3 | 否 |

→ 必须搬**完整记录前缀**（实测 #7）。链结构：1 个根、764 个子记录、每父恰好 1 子。

## 附录 B：Codex rollout 记录形态（516 行真实 rollout 实测）

- 第 1 行 `session_meta`（`payload.id` / `cwd` / `base_instructions`）。
- `turn_context`：该轮 `cwd` / `approval_policy` / `sandbox_policy` / `model` / `effort`。
- `event_msg`：`task_started` / `user_message` / `agent_message` / `agent_reasoning` / `token_count` / `task_complete` / **`thread_rolled_back`**。
- `response_item`：`message` / `reasoning` / `function_call` / `function_call_output`。
- 轮边界 = `task_started` … `task_complete`；**完整轮次数 = `task_complete` 条数**。
