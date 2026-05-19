## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。`feature/v0.5` 的任何治理实现尝试不作为本 change 的输入或完成证据。

当前分支状态：bundle chunking 未实施。近两天当前分支新增 Markdown preview、tool-call card、user-input question card 等 UI 体积变化；后续实施必须重新跑当前分支 build/cold-start baseline，不能沿用旧 bundle contributor 判断。

## Why

`add-runtime-perf-baseline` 已经记录冷启动 / bundle 体积基线：

- `S-CS-COLD`：`bundleSizeMain = 1858800 bytes`，artifact `App-CeJA-2sJ.js`
- `S-CS-COLD`：`bundleSizeVendor = 163595 bytes`，artifact `index-Gcp9yPgO.js`
- `S-CS-COLD`：`firstPaintMs = unsupported`
- `S-CS-COLD`：`firstInteractiveMs = unsupported`

当前可执行的优化入口是 bundle composition，而不是伪造 webview timing。下一步应先把 main bundle
拆分成可解释的 domain chunks，再决定是否引入更重的 Tauri/webview cold-start instrumentation。

治理关联：这不是普通性能微调，而是 harness 治理层的 **delivery governance blocker**。SpecHub、audit trail、cost/budget、policy log、admin surface 都会增加前端体积；如果低频治理面板继续进入首屏 bundle，治理能力越完善，Tauri 启动越慢。这个 change 的职责是为治理 surface 增长建立可解释 chunk 边界。

## Scope

### In Scope

- 分析 Vite build output，定位 main bundle 的主要来源。
- 为低频 feature 或重依赖设计 lazy import / manual chunk 策略。
- 保持 Tauri desktop 首屏 critical path 不被异步拆分破坏。
- 用 `S-CS-COLD` bundle rows 作为优化前对照。

### Out of Scope

- 不在本 change 内引入 Playwright/Lighthouse 作为强依赖。
- 不改变运行时 feature 语义。
- 不处理 long-list / realtime / hub split。
- 不把治理功能本身改成 lazy-only；只移动低频 surface，不破坏首屏治理信号可见性。

## Acceptance Criteria

- `bundleSizeMain` 必须相对 `1858800 bytes` 有可解释的下降，或给出不能下降的证据。
- `bundleSizeVendor = 163595 bytes` 不得因错误 chunking 明显膨胀。
- `firstPaintMs/firstInteractiveMs` unsupported 状态必须继续显式记录，不得静默填假值。
- 必须运行 `npm run perf:cold-start:baseline` 与 `npm run perf:baseline:aggregate`。
- 若 chunking 触及 tests，必须等价满足 `.github/workflows/heavy-test-noise-sentry.yml` 的 parser tests 与 `npm run check:heavy-test-noise`。
- chunk plan 不得制造新的近阈值 source/config 文件，必须等价满足 `.github/workflows/large-file-governance.yml` 的 parser、near-threshold 与 hard gate。
- chunking/lazy import 不得引入平台专属 dynamic import path、case-sensitive path 假设或 POSIX-only resource path；Win/macOS/Linux 构建产物必须等价。
