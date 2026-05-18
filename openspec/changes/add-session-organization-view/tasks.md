## 1. 实现前 Trace（不要跳过）

- [ ] 1.1 [P0][depends:none][I: `src/features/threads/**` 现有 message 渲染组件][O: 渲染组件 props 边界报告 + 是否能脱离 thread runtime 渲染的结论][V: 在 design.md / journal 中记录组件入口、props 与 runtime 耦合点] Trace 现有聊天 message 渲染组件的边界，决定详情 modal 是直接复用还是先抽一层只读 viewer。
- [ ] 1.2 [P0][depends:none][I: `src/services/tauri/sessionManagement.ts` + 现有 thread runtime][O: 完整 message timeline 拉取链路][V: 标注 catalog summary 与 full timeline 各自的来源 command + 触发时机] 找出完整 message timeline 的拉取链路（catalog 只给 summary）。
- [ ] 1.3 [P1][depends:none][I: 后端 `assignWorkspaceSessionFolder` 实现][O: archived 会话能否归类的结论][V: 在 design.md / journal 中记录 archived assignment 行为，决定 v1 是否限定为仅 active 会话开放归类] 确认 `assignWorkspaceSessionFolder` 对 archived 会话的行为，必要时在视图层限定 scope。

## 2. 左栏专题树 + 虚拟未分类节点

- [ ] 2.1 [P0][depends:1.1][I: 现有 `WorkspaceSessionFolderTree` + `listWorkspaceSessionFolders`][O: 左栏树骨架（含 collapsed/expanded 状态）][V: vitest 覆盖树渲染 + 节点选中切换] 实现左栏专题树最小可见骨架，能展开 / 折叠并切换选中节点。
- [ ] 2.2 [P0][depends:2.1][I: 现有 `listWorkspaceSessions` 客户端聚合][O: 顶部虚拟节点「📥 未分类 (n)」][V: vitest 覆盖 unfiled 计数 + 选中切换为「__unfiled__」] 在树顶部插入固定虚拟节点，展示 `folderId == null` 会话总数。
- [ ] 2.3 [P0][depends:2.1][I: 左栏选中态][O: view-local `selectedFolderId` 状态][V: vitest 断言选中节点切换会驱动右栏数据源切换] 引入 view-local 选中态，与右栏数据源联动。

## 3. 右栏：直属会话列表

- [ ] 3.1 [P0][depends:2.3][I: 现有 `SessionListSection` 或等价渲染 + `listWorkspaceSessions` 按 `folderId` 分桶][O: 右栏直属会话列表][V: vitest 覆盖选中虚拟节点 → 只显示 unfiled；选中真实专题 → 只显示该专题直属会话] 实现右栏直属会话列表，复用现有 catalog 渲染能力。
- [ ] 3.2 [P0][depends:3.1][I: 现有 `selectedIds` 模式][O: 会话行复选框（选中语义）][V: vitest 覆盖多选 / 反选 / 跨节点保留选中态] 实现会话行复选框，沿用现有批量选中模式。
- [ ] 3.3 [P0][depends:3.1][I: 会话行点击区分离][O: 点会话标题打开详情 modal 的 hit area][V: vitest 断言点标题不触发 selection，点 checkbox 不打开 modal] 实现「点标题 = 打开详情」与「复选框 = 选中」的 hit area 分离；MUST NOT 引入双击。

## 4. 右栏：子专题卡片区

- [ ] 4.1 [P0][depends:2.3,3.1][I: folder 树 + 客户端会话聚合][O: 子专题卡片元数据（名称 / 直属数 / 最近更新时间）][V: vitest 覆盖聚合逻辑 + 边界情况（0 子专题 / 0 直属会话）] 实现子专题卡片元数据聚合。
- [ ] 4.2 [P0][depends:4.1][I: 卡片元数据][O: 极简三行卡片（名 / 数 / 时间，无 icon、无预览）][V: vitest + RTL 覆盖渲染 + 点击切换左栏选中] 渲染子专题卡片并支持点击切换左栏选中。
- [ ] 4.3 [P0][depends:4.2][I: 选中节点类型判断][O: 虚拟节点选中时不渲染卡片区；专题无子专题时不渲染卡片区][V: vitest 覆盖两种「不渲染」分支] 限定卡片区只在「真实专题 + 有子专题」组合下渲染。

## 5. 详情 Modal（只读 Timeline + 跳转按钮）

- [ ] 5.1 [P0][depends:1.1,1.2][I: trace 结论][O: read-only timeline viewer（直接复用或抽一层）][V: vitest 覆盖 viewer 在没有 thread runtime 时也能渲染][若需 refactor，先小幅抽层再继续后续步骤] 准备只读 timeline 渲染入口。
- [ ] 5.2 [P0][depends:5.1][I: 现有更新公告 modal 尺寸约定][O: 主窗口 80–90% 尺寸的 modal 容器（非全屏）][V: vitest + RTL 覆盖打开 / 关闭（右上角 × / 点遮罩）] 实现 modal 容器骨架。
- [ ] 5.3 [P0][depends:5.2][I: catalog entry + folder 路径计算][O: modal 顶部 metadata（engine / updated / 所属专题路径 / parent session 若有）][V: vitest 覆盖各字段渲染] 实现 modal 顶部 metadata 区。
- [ ] 5.4 [P0][depends:5.2,5.3,5.1][I: timeline 拉取链路][O: modal 主体只读 message timeline][V: vitest + RTL 覆盖 timeline 渲染 + 只读约束（无输入框 / 无 actions）] 在 modal 主体渲染完整 timeline。
- [ ] 5.5 [P0][depends:5.4][I: 现有 thread switching 入口][O: 「在主窗口打开此会话」按钮][V: vitest 覆盖按钮触发 thread switching 并按需求关闭 modal] 实现跳转主窗口按钮。

## 6. 「移动到专题…」按钮 + Folder Picker

- [ ] 6.1 [P0][depends:3.2][I: 工具栏现有布局][O: 「移动到专题…」按钮（仅在有 selectedSessionIds 时可用）][V: vitest 覆盖 enable / disable 状态] 在工具栏新增按钮。
- [ ] 6.2 [P0][depends:6.1][I: folder 树数据 + 现有 picker 风格][O: folder picker 弹层（树形选择 + 「取消归类」选项）][V: vitest + RTL 覆盖树渲染 / 选中 / 取消归类] 实现 folder picker。
- [ ] 6.3 [P0][depends:6.2][I: `assignWorkspaceSessionFolder`][O: 批量归类 mutation + 成功后失效数据缓存][V: vitest 覆盖成功路径 + 部分失败处理 + 右栏更新] 接通归类 mutation 与右栏数据失效。

## 7. Folder CRUD UI

- [x] 7.1 [P0][depends:2.1][I: `createWorkspaceSessionFolder`][O: 左栏节点旁「新建子专题」入口][V: vitest 覆盖创建成功 + 错误提示] 实现新建子专题入口。
- [x] 7.2 [P0][depends:2.1][I: `renameWorkspaceSessionFolder`][O: 左栏节点重命名入口][V: vitest 覆盖重命名成功 + 名称校验] 实现重命名入口。
- [x] 7.3 [P0][depends:2.1][I: `deleteWorkspaceSessionFolder` + 非空拦截策略][O: 左栏节点删除入口 + 非空拦截提示][V: vitest 覆盖空专题删除成功 / 非空专题拦截 + 解释文案] 实现删除入口，非空时默认拦截并提示用户先清空 / 解除归类。

## 8. 视图模式入口与 i18n

- [x] 8.1 [P0][depends:2.1,3.1][I: 现有 `SessionManagementSection`][O: 视图模式入口（最小化插入，不重写现有 section）][V: vitest 覆盖视图切换不影响 catalog 视图原有行为] 在 `SessionManagementSection` 内嵌入整理视图入口（具体形态实现阶段定）。
- [x] 8.2 [P0][depends:8.1][I: 沿用 `t("settings....")` 命名空间][O: 视图相关 i18n 文案（zh + en）][V: 关键字串均通过 i18n key 渲染，无硬编码] 补齐 i18n 文案。
- [ ] 8.3 [P1][depends:8.1,8.2][I: 现有视觉风格][O: 视觉一致性微调][V: 视觉走查（截图对比 catalog 视图风格）] 视觉润色。
- [x] 8.4 [P0][depends:8.1][I: design.md Decision 8][O: SessionOrganizerModal 容器（92vw × 88vh、header workspace label / 副标题、close 按钮 + Esc + 遮罩、body 嵌 SessionOrganizationView、footer 批量 toolbar）][V: SessionOrganizerModal.test.tsx 覆盖 title / close / backdrop / esc / 批量按钮 fire 回调] 把整理视图改为 modal 弹出：drop 旧 toggle / inline 视图，新增「会话整理」按钮 + SessionOrganizerModal。

## 9. 验证与上游 PR 准备

- [ ] 9.1 [P0][depends:8.3][I: 受影响 TS 模块][O: 基础门禁结果][V: `npm run lint`、`npm test`、`npm run build` 全通过] 跑基础质量门禁并修复回归。
- [ ] 9.2 [P0][depends:9.1][I: 视图集成测试][O: 端到端用户旅程通过][V: 至少覆盖「未分类 → 创建专题 → 移动会话 → 查看 modal → 跳转主窗口」一条完整旅程] 覆盖主要用户旅程的集成测试。
- [ ] 9.3 [P0][depends:9.2][I: PR 边界（plan.md §3）][O: clean staged diff][V: `git diff` 核对所有 staged 文件，确认无 `AGENTS.md` / `.trellis/**` / `.omc/**` / host adapter / 无关 bugfix / `package.json` 行尾差异等被混入] 在提交前严格核对 PR 边界。
- [ ] 9.4 [P0][depends:9.3][I: 本 change 的 proposal / design / tasks / spec delta][O: OpenSpec verify 通过][V: `openspec validate --all --strict --no-interactive` 通过] 执行 OpenSpec verify。
- [ ] 9.5 [P0][depends:9.4][I: change 完成证据][O: sync 主 spec + archive 本 change][V: 按 `openspec/project.md` workflow 同步并归档] 完成后 sync 主 spec 并 archive。
