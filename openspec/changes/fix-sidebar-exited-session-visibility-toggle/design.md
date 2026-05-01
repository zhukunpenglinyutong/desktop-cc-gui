## Context

这次问题的根因不是单纯“按钮不好看”，而是 sidebar 对 exited session visibility 没有稳定的责任归属：

- 入口挂在 `ThreadList` 内部，视觉上属于“列表项之间的额外条带”，会打断 workspace/worktree/thread 的自然层级。
- 状态也挂在 `ThreadList` 本地，意味着它天然是短生命周期的 UI state，而不是 project-scoped preference。
- 如果未来把 key 绑到 `workspace.id`，又会遇到“删掉项目重新添加后 UUID 变化”的 identity 漂移问题。

当前实现已经把这三点一起收口：入口前移到项目行 leading icon，偏好按规范化后的 `workspace.path` 存储，并通过纯函数统一 exited row 过滤语义。

本 design 的目的，是把“为什么必须这样做”固化成明确 contract，而不是仅保留一次实现结果。

## Goals / Non-Goals

**Goals:**
- 让 exited session visibility 成为稳定的 workspace/worktree row affordance。
- 让项目隔离语义建立在稳定 path identity 上，而不是易变的 runtime id 上。
- 让隐藏 exited rows 时保留必要祖先节点，避免层级断裂。
- 让全部 exited rows 被隐藏时，用户仍然知道“这里被隐藏了内容，而且可恢复”。

**Non-Goals:**
- 不改 pinned section 的显示策略。
- 不扩展到 Workspace Home / Session Management。
- 不增加后端存储字段或跨层 API。

## Decisions

### Decision 1: exited visibility preference 以规范化后的 `workspace.path` 作为 identity key

选择：使用 workspace path 做持久化 key，并在 frontend 对 Windows 风格路径做 case-insensitive normalize。

原因：
- `workspace.id` 在重新添加项目或重建 worktree 后可能变化，不适合作为长期偏好 identity。
- 用户认知里的“同一个项目”更接近稳定路径，而不是 runtime UUID。
- Windows 路径天然大小写不敏感，若不 normalize，`C:\Repo` 与 `c:\repo` 会被错误视为两个项目。

取舍：
- 允许不同绝对路径（例如不同 symlink 入口）被视为不同项目，这是可接受的；比起过度激进地合并路径，保持 deterministic 更重要。

### Decision 2: 入口必须挂在 workspace/worktree leading icon，而不是 thread list 内联条带

选择：把 show/hide exited sessions 的 affordance 放到 workspace folder icon / worktree branch icon 旁边，并用 icon button 表示当前模式；布局必须避免覆盖原图标或压住标题首字符。

原因：
- exited visibility 是“这个项目列表怎么显示”的 row-level preference，不应打断 thread list 内容流。
- leading icon 是用户扫描项目层级时最早接触到的位置，信息密度更高，也更符合“项目级开关”的心智。

取舍：
- 为避免永远显示一个高噪音 control，只有在当前 scope 存在 exited sessions，或当前已经处于隐藏态且有 hidden count 时，才渲染该 icon。

### Decision 3: exited row 过滤必须走纯函数，并保留 running/reviewing descendant 的 ancestor

选择：把过滤逻辑抽成 feature-local pure helper，由 `Sidebar` 和 `ThreadList` 复用同一 contract。

原因：
- 之前这套语义只在 `ThreadList` 里临时实现，父级 icon 和列表可见性很容易再次分叉。
- 当 child 仍在 running/reviewing 时，直接隐藏 exited parent 会让树结构断裂，视觉上出现悬空子节点。

取舍：
- 允许 exited ancestor 在 hide 模式下继续可见，只要它仍是某个活跃 descendant 的唯一路径锚点。

### Decision 4: 当 hide 结果把整段列表清空时，仍需保留弱提示而不是完全留白

选择：如果某个 workspace/worktree 下当前只有 exited rows 且都被隐藏，thread list 内显示一个弱化 summary（如 `{{count}} exited hidden`）。

原因：
- 仅靠 icon badge 可以说明“隐藏模式已开启”，但空白列表本身不够自解释。
- 在窄侧栏里，完全空白会被误解成“这里没有会话”或“加载失败”。

取舍：
- summary 只在“没有任何可见 row”时出现，避免重新引入过去那种常驻 pill bar 的视觉噪音。

## Risks / Trade-offs

- [Risk] 使用 path 作为 key 仍可能把不同 alias / symlink 路径视为不同项目。  
  → Mitigation：优先保证 deterministic 与跨平台一致性；当前需求不要求 canonical filesystem identity merge。

- [Risk] workspace / worktree row 上新增 icon 可能让 leading 区稍显拥挤。  
  → Mitigation：仅在存在 exited/hidden state 时显示，默认保持低噪音；采用与主图标并排的安全间距布局，并为 hidden badge 预留横向安全区，避免重叠标题。

- [Risk] 过滤逻辑被多个 surface 单独重写后再次漂移。  
  → Mitigation：收口到 pure helper，并为 helper 单独补测试。

## Migration Plan

1. 增加 project-scoped exited visibility persistence helper 与 filter helper。
2. Sidebar / WorktreeSection 统一使用 path-scoped preference 驱动 row icon 与 ThreadList filtering。
3. 删除旧的 inline filter bar，保留仅在全隐藏场景出现的弱 summary。
4. 更新 OpenSpec spec delta，记录新的 affordance、identity 与 filtering contract。

回滚策略：
- 本 change 不涉及后端 schema。
- 若新 affordance 需要回退，可恢复旧 UI，但必须保留“项目隔离 + 路径持久化 + ancestor preservation”三个 contract，避免行为倒退。

## Open Questions

- pinned section 是否也应消费同一 exited visibility preference？  
  当前不纳入本 change；先保持项目列表 contract 稳定，再视用户反馈决定是否扩展。
