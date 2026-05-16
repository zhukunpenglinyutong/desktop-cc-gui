# Phase P0 — layout-swapped-platform-guard test refactor

## Background

`src/styles/layout-swapped-platform-guard.test.ts` 是 CSS 字面值断言测试 (10 个
test case),它 `readFileSync` 读 .css 然后 `toContain` 检查字面 CSS 文本。这种 pin
住前面 Phase 3/4/6/9 的 .css inline + 删除工作:

| 推迟 .css | 推迟到 sub-phase | 原因 |
|-----------|------------------|------|
| `messages.history-sticky.css` | Phase 3.5 | 被 sticky 集合 test case pin |
| `messages.part1-shell.css` | Phase 3.6 | 被 sticky/render-safe test case pin |
| `messages.part1.css` | Phase 3.6 | 被 claude-render-safe test case pin |
| `messages.status-shell.css` | Phase 3.6 | 被 messages-live-controls / claude-render-safe pin |
| `diff-viewer.css` | Phase 9.2 | 被 swapped overlay anchor test pin |
| `settings.part2.css` (部分) | Phase 6.6 | 该 test 本身不引用,但同体系字面 pin 是同样反模式 |

这些字面 pin **意图防的是 layout swap regression** (左右切换时 main/sidebar 位置正
确;swapped 时 overlay anchoring 偏移;render-safe mitigation 限制到 desktop;等),
但用 CSS 字面文本检查太脆弱。Phase P0 把它们换成 **jsdom + 真 CSS cascade +
getComputedStyle DOM 行为断言**。

## Discovery Strategy

### Spike 结果 (jsdom CSS cascade)

跑过一个 throwaway spike test:把真 .css inject 到 `<style>`,build minimal DOM
fixture,toggle `app.layout-desktop`/`layout-swapped` class,用 `getComputedStyle`
读 grid-column / position / z-index / left / right。**全 pass**。 jsdom 完整支持
CSS cascade,可以信任 `getComputedStyle` 返回的计算值。

### 通用 helper 计划

新建 `src/styles/__layout-guard__/cssTestHarness.ts`:

- `loadStylesheet(filename)` — `readFileSync` 同步读 .css(支持 @import 递归解析)
- `injectStyles(...filenames)` — 把多个 .css inject 到 `<style>` 标签
- `mountApp({ layout: 'desktop' | 'phone' | 'tablet', swapped?: boolean,
   platform?: 'macos' | 'windows', canvasWidth?: 'wide', collapsed?: ... })`
   — 构造 `.app` 根元素加上 modifier class
- `mountInto(parent, html)` — 把 fragment HTML 插入 parent,返回 root
- `cleanup()` — 清空 document.head 和 document.body
- `expectCascadeApplies(el, prop, expected)` / `expectCascadeMisses(el, prop)`
   小工具(可选,直接用 expect 也可以)

### 10 个 test case before / after 对照表

| # | Test name | 当前字面断言 | 行为本质 | 新 DOM 断言策略 |
|---|-----------|--------------|----------|-----------------|
| 1 | `scopes swapped structure selectors to desktop layout` | base.css/main.css 包含 5 个 `.app.layout-desktop.layout-swapped ...` 字面 + 不包含 1 个 `.app.layout-swapped .sidebar-resizer` 字面 + 不包含 1 个 `.app.layout-swapped .main:not(...)` 字面 | swap 必须 require `layout-desktop`,phone/tablet 模式下 swap 不会改变结构 | jsdom: 加载 base+main; 用 `mountApp({layout:'desktop',swapped:true})` 验证 `.main.grid-column === '1'`, `.sidebar.grid-column === '2'`,`.sidebar-resizer.left === 'auto'` 且 `.sidebar-resizer.right === calc(...)`; 然后切换到 `mountApp({layout:'phone',swapped:true})` (即只有 `.layout-swapped` 没有 `.layout-desktop`) 验证 `.main.grid-column === ''` 和 `.sidebar-resizer.right === ''` |
| 2 | `keeps Win/mac titlebar safety selectors mirrored between default and swapped modes` | main.css 包含 6 个特定的 `.app.windows-desktop.right-panel-collapsed:not(.layout-swapped) .main-topbar` / `.app.windows-desktop.layout-swapped.sidebar-collapsed .main-topbar` 等字面 | Windows 下:default 模式 right-panel-collapsed 时,swap 模式 sidebar-collapsed 时,topbar 要给 titlebar buttons 留 padding;macOS 镜像对称(sidebar-collapsed 给 traffic lights 留 padding) | jsdom: 加载 main+base; 用 `.app.windows-desktop.right-panel-collapsed` 构造 → `.main-topbar.paddingRight !== ''`;然后用 `.app.windows-desktop.layout-swapped.sidebar-collapsed` → 同样 padding;然后只 `.app.windows-desktop.layout-swapped.right-panel-collapsed` (即 swap 但 right collapsed) → padding-right 应该 *没有* 这个 padding。镜像 macOS 同样 4 cases。`.main-header-actions` margin 同理 |
| 3 | `keeps sidebar titlebar controls above the drag strip on macOS` | base.css 包含 `.drag-strip { z-index: 2; }` + sidebar.css 包含 `.sidebar-topbar-placeholder` 的 position/z-index:3 + `.sidebar-topbar-content` 的 `-webkit-app-region: no-drag` | drag-strip 是绝对定位的 macOS 拖拽条 (z:2);sidebar topbar placeholder 必须 z:3 才能盖过 drag-strip 让用户能点 toggle | jsdom: 加载 base+sidebar(+sidebar.chrome); mount: drag-strip 和 sidebar-topbar-placeholder 兄弟;`getComputedStyle(drag-strip).zIndex === '2'`、`(sidebar-topbar-placeholder).zIndex === '3'`、`(sidebar-topbar-placeholder).position === 'relative'`、`(sidebar-topbar-content).webkitAppRegion === 'drag'`(注意 `-webkit-app-region` 在 jsdom 不一定 reified 到 computed style — 退到 inline checking via cssRules) |
| 4 | `keeps the floating homepage sidebar restore control icon-only` | base.css 中特定深层 selector 的 rule 包含 border:none / background:transparent / box-shadow:none | floating 的 sidebar restore button 应该是无装饰 icon-only | jsdom: 加载 base; mount `<div class="titlebar-sidebar-toggle"><button class="main-header-action">...</button></div>`;读 button 的 computed style — `.border === ''` 或 `none`,`.backgroundColor === 'rgba(0, 0, 0, 0)'`,`.boxShadow === 'none'`;并验证带 `open-app-action` class 的 button **不** 会被这个 rule 命中 (negative) |
| 5 | `keeps the floating homepage sidebar restore control on the shared titlebar inset anchor` | base.css `.titlebar-toggle-left` 包含 `var(--titlebar-inset-left, 0px)`;`.titlebar-toggle-right` 包含 `right: 10px;`;**不**包含旧 selector `.titlebar-sidebar-toggle.titlebar-toggle-left` / `.titlebar-sidebar-toggle.titlebar-toggle-right` | toggle anchor 通过 left/right + inset var 定位;旧 sidebar-toggle 专属 anchor 已废弃,改用 shared inset anchor | jsdom: 加载 base; mount `<div class="titlebar-toggle titlebar-toggle-left">` + `<div class="titlebar-toggle titlebar-toggle-right">`;`.left` 应包含 `calc(10px + var(--titlebar-inset-left`(因 jsdom 不计算 var,会保留 calc/var 文本)或解析后的 `10px`;`.right === '10px'`;然后 mount `<div class="titlebar-sidebar-toggle titlebar-toggle-left">` 验证依然继承 shared anchor 的 left/right(即 not regressed 到 sidebar-toggle 独立 selector) |
| 6 | `keeps the expanded sidebar titlebar toggle icon-only` | sidebar.css `.sidebar-titlebar-toggle .main-header-action:not(.open-app-action):not(.open-app-toggle)` 包含 border:none / background:transparent / box-shadow:none | 同 #4 但作用域是 expanded sidebar 而非 floating titlebar | jsdom: 加载 sidebar(+chrome); mount `<div class="sidebar-titlebar-toggle"><button class="main-header-action">..</button></div>`;计算 button style — 同 #4 验证 |
| 7 | `keeps swapped-only overlay anchoring isolated from default mode` | main.css 含 `.app.layout-desktop.layout-swapped .workspace-branch-dropdown` / `.workspace-project-dropdown` 字面;messages.css 含 `.app.layout-desktop.layout-swapped .messages-live-controls` 字面;diff-viewer.css 含 `.app.layout-desktop.layout-swapped .diff-viewer-anchor-floating:not(.is-embedded)` 字面 | swapped 时 dropdowns 要从 left:0 翻到 right:0;live-controls / diff-viewer 要从 right:original 偏移 sidebar 宽度 | jsdom: 加载 main+messages+diff-viewer; mount `.app.layout-desktop` (default 模式) 内放 dropdowns/live-controls/diff-viewer-anchor → 记录 default position;再 toggle 到 `.app.layout-desktop.layout-swapped` → 验证 dropdowns 的 left=`auto` && right=`0`、live-controls 的 right 含 sidebar-width;再 toggle 到 `.app.layout-phone.layout-swapped` (即没 layout-desktop) → 验证 dropdowns 又回到 default(swap 不生效) |
| 8 | `keeps collapsed message sticky peek anchored to the canvas right edge` | 6+ 个字面 + 1 个正则匹配 .messages-history-sticky-header-peek/::before + 1 个 indexOf 排序 check | collapsed sticky peek 必须紧贴 canvas 右边缘:margin-right 负值;wide canvas 时是 -25px;peek 是无圆角 border-radius:0 + 圆形 ::before 5x26px;peek width = var(--peek-width); `--peek-width=16px` 默认 | jsdom: 加载 messages(全套); mount `.app` 内放 `messages-history-sticky-header[data-history-sticky-collapsed="true"]` 嵌套 inner/content/bubble;验证 collapsed sticky `.marginRight !== ''`(即被覆盖,不是默认 0);加 `canvas-width-wide` class 后 marginRight === `-25px`;inner `.paddingRight === '0px'`;content `.justifyContent === 'flex-end'`;collapsed bubble `.width === 'var(...)'` 或解析值,`.transform === 'none'`;然后用 cssRules 检查 `messages-history-sticky-header-peek` rule 含 `border-radius:0;clip-path:none` + `::before` rule 含 `width:5px;height:26px`(这两个 CSS pseudo-element 在 jsdom getComputedStyle 不靠谱 — 用 styleSheet.cssRules 字符串扫,但范围只局限到这个 selector body) |
| 9 | `keeps Claude render-safe mitigation scoped to desktop messages shell` | messages.css 复杂 `[\s\S]*` 正则匹配 `.app.(windows\|macos)-desktop ... .messages-shell.claude-render-safe ... .working.is-ingress .working-spinner`,并 negative 不存在裸 `.messages-shell.claude-render-safe .working.is-ingress .working-spinner` | claude-render-safe mitigation (修 Claude 输出时奇怪 hiccup) 必须只在 desktop 平台生效,不能影响 mobile/tablet 平台 | jsdom: 加载 messages 全套; mount `.app` 内放 `.messages-shell.claude-render-safe .working.is-ingress` 嵌 spinner+message;切到 `.app.windows-desktop` → spinner.animationDuration !== '' (即被覆盖);切到 `.app.macos-desktop` → 同;切到 `.app.layout-phone` (即 platform class 不在) → spinner.animationDuration === '' (即默认未应用 mitigation);切到 `.app.windows-desktop` → `.message` 的 contentVisibility === 'visible' |
| 10 | `keeps swapped sidebar quick nav in normal LTR order` | sidebar.css 5 个 .app.layout-desktop.layout-swapped .sidebar-primary-nav 各 selector + 字面的 justify-content/order/text-align 等 | swap 时 quick nav 保持正常 LTR 顺序 (icon→text→shortcut),不要变 RTL | jsdom: 加载 sidebar; mount `.app.layout-desktop.layout-swapped` 内放 `.sidebar-primary-nav .sidebar-primary-nav-item` 含 icon/text/shortcut 三个子节点;读 item `.justifyContent === 'flex-start'` + `.textAlign === 'left'`;icon `.order === '0'`;text `.order === '1'`;shortcut `.order === '2'` + `.marginLeft === 'auto'` + `.marginRight === '0px'`;同时切到 `.app.layout-desktop` 无 swap 时验证 order 是 '' (即默认 0) |

### 无法 DOM 替代的字面 CSS

- **`-webkit-app-region`** 在 jsdom 不一定 reified 到 computed style(jsdom 没识别这个非标准属性)。备选:用 `style.cssText` 或 `styleSheet.cssRules[i].style.getPropertyValue` 查 inline rule 文本。已确认 spike: `getComputedStyle(el).webkitAppRegion` 返回空,但 `cssRules` 可以拿到。仍是 jsdom 内做、不是字面 toContain。
- **Pseudo-element `::before`** properties:`getComputedStyle(el, '::before')` 在 jsdom 返回的对象大部分 prop 为空。退化方案:用 `Array.from(document.styleSheets[0].cssRules)` 找包含 `::before` 的 rule 然后读 `.style.width` / `.style.height`。仍属 cssRules 行为查,比字面文本 `toContain` 更稳。
- **selector 排序** (case 8 末尾的 `indexOf > indexOf`):验证 `.app.canvas-width-wide` 通用 rule 出现在 collapsed override 之前。这个 *仅* 在 CSS 文本中有意义(cascade 顺序),DOM 不能直接验证。**保留为字面 indexOf check** — 比 toContain 更宽松,只关心两个 selector 的相对顺序。
- **缺失的旧 selector**(case 5 的 `.titlebar-sidebar-toggle.titlebar-toggle-left {`):本质是 "确认某 selector 不再存在于 CSS 中"。DOM 行为可以反向验证(挂个有该 class 的元素,验证它没拿到该 selector 独有的属性),但要确认那 selector 没有其它独立属性必须 verify。**保留为 cssRules 文本 scan** — 比字面 toContain 更稳,直接遍历 stylesheet rules 找 selectorText 匹配。

### 解锁价值评估

新 test 体系下,**.css 文件本身** (selector、property 名)的删除/重命名仍会被
检测到(因为 DOM 行为会变);但 **CSS 字面文本**(空格、引号、format)的小改动
**不会**被错杀。这正是想要的:

- ✅ 删除某条 `.app.layout-desktop.layout-swapped .messages-live-controls
   {...}` rule → DOM live-controls 的 right 计算值会变 → test fail ✓
- ✅ 把 `.app.layout-desktop.layout-swapped` 改成 `.app.layout-swapped`
   (regression) → phone/tablet 模式 mount 后 main.grid-column 会被错误覆盖 →
   test fail ✓
- ❌ format CSS(空格,加换行)→ DOM 行为不变 → test pass ✓ (这是 *好事*,正是
   要解的痛点)

### 推迟 .css 解锁情况

新 test 体系下,以下 6 个推迟 .css **可以在后续 sub-phase 安全 inline + 删除**:

| 推迟 .css | 新 test 是否仍 pin | 解锁状态 |
|-----------|---------------------|----------|
| `messages.history-sticky.css` | jsdom 加载 `messages.css` (含 @import 递归),只要 sticky 行为正确 → 不 pin 文件本身 | ✅ 解锁 |
| `messages.part1-shell.css` | 同上 | ✅ 解锁 |
| `messages.part1.css` | 同上 | ✅ 解锁(.message contentVisibility 由 cascade 验证) |
| `messages.status-shell.css` | 同上 | ✅ 解锁 |
| `diff-viewer.css` | jsdom 加载 diff-viewer,验证 anchor floating 行为 → 不 pin 文件本身 | ✅ 解锁 |
| `settings.part2.css`(部分) | layout-guard test 没引用 settings.part2.css | ✅ 解锁(原本就不被本 test pin) |

注:这里的"解锁"意指 layout-guard test 不再用文件字面 pin。其它独立 test
(如 `settings-email-card-surface.test.ts`, `main.worktree-info-theme.test.ts`,
`sidebar-titlebar-drag-region.test.ts`, `status-panel-theme.test.ts`) 还在用
字面 pin,与本 P0 范围无关,不属于解锁列表。

## 实现路径

1. 新建 `src/styles/__layout-guard__/cssTestHarness.ts` helper
2. 改写 `src/styles/layout-swapped-platform-guard.test.ts` 保留同文件名
3. 跑 `npm run test:layout-guard`、`npm run lint`、`npm run typecheck`、 `npm test`
4. (可选) 选 `diff-viewer.css` 做 spike:确认新 test 体系下能 detect 该 .css
   被部分修改/删除时行为退化

## 验证

- ✅ 10 个原 test case 全部映射到 1+ 个新 DOM/cssRules 断言
- ✅ 解析非 desktop 平台 (phone/tablet) swap 是 no-op 的反向断言保留
- ✅ Win/mac titlebar safety 4 镜像方向 (Win+left、Win+right、mac+left、mac+right) 全部覆盖
- ✅ `npm run test:layout-guard` 10/10 pass
- ✅ `npm test` 不引入新失败
