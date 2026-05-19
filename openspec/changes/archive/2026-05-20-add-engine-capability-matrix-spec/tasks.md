## 0. Branch Calibration

Current branch source of truth: `feature/v0.5.0-md`.

Closure recalibration on 2026-05-20 confirmed current-branch implementation evidence is present for the matrix fixture, TS/Rust helpers, checker, UI pilot, CI wiring, and OpenSpec validation. Prior `feature/v0.5` evidence remains non-authoritative; the authoritative evidence for this branch is the current `implementation-evidence.md`, current code facts, and the validation commands recorded below.

## 1. Capability Inventory

- [x] 1.1 [P0][depends:none][I: `src/types.ts` `EngineFeatures`][O: TS 现有 capability 字段清单][V: 字段与默认值列表完整] 抓取 TS 现有 EngineFeatures 实测字段。
- [x] 1.2 [P0][depends:none][I: `src-tauri/src/engine/mod.rs`][O: Rust 现有 EngineFeatures 实测清单][V: 列出 `claude()` / `codex()` / `gemini()` / `opencode()` 完整字段] 抓取 Rust 现有 EngineFeatures 实测字段。
- [x] 1.3 [P0][depends:none][I: UI grep `engine === '...'`][O: 硬编码分支清单][V: 文档化每条硬编码分支与对应 capability 候选] 列出 UI 现有引擎硬编码分支。
- [x] 1.4 [P0][depends:1.1,1.2,1.3][I: 上述三组实测][O: 起步 capability 集合（≤ 12）][V: 每条 capability 注明 TS / Rust / UI 三源依据] 形成 capability 起步集合草案。
- [x] 1.5 [P0][depends:1.4][I: capability 起步集合][O: 4 引擎 × N capability 矩阵实测填表][V: 每个 cell 取值与 TS+Rust+adapter test 一致] 完成 inventory 填表，**禁止猜测**。

## 2. Spec Drafting

- [x] 2.1 [P0][depends:1.5][I: inventory 表][O: `specs/engine-capability-matrix/spec.md`][V: SHALL 条款 ≤ 25] 起草 capability spec。
- [x] 2.2 [P0][depends:2.1][I: spec fixture][O: matrix.json 或 spec 内 table][V: 可被 CI 脚本直接读取] 把 matrix 落地为 fixture。
- [x] 2.3 [P0][depends:2.1][I: capability key 命名规则][O: 命名 lint 规则][V: 正则与 domain 集合显式声明] 固化 capability 命名 lint。

## 3. TS Matrix Refactor

- [x] 3.1 [P0][depends:2.2][I: spec fixture][O: `engineCapabilityMatrix.ts`][V: TS 类型穷举 capability keys] 新建 TS matrix 数据。
- [x] 3.2 [P0][depends:3.1][I: `src/types.ts` `EngineFeatures`][O: TS mapping helper][V: 现有字段形状不变，映射到 capability key] 新增 TS 字段映射。
- [x] 3.3 [P0][depends:3.1][I: TS matrix][O: `engineCapabilityMatrix.test.ts`][V: TS matrix ↔ spec fixture 1:1] 新增 TS matrix consistency test。

## 4. Rust Matrix Refactor

- [x] 4.1 [P0][depends:2.2][I: spec fixture][O: `capability_matrix.rs`][V: Rust 枚举/常量穷举 capability keys] 新建 Rust matrix 数据。
- [x] 4.2 [P0][depends:4.1][I: `EngineFeatures::{claude,codex,gemini,opencode}`][O: Rust mapping helper][V: 现有字段形状不变，snake_case ↔ capability key 映射明确] 新增 Rust 字段映射。
- [x] 4.3 [P0][depends:4.1][I: Rust matrix][O: cargo 单测][V: Rust matrix ↔ spec fixture 1:1] 新增 Rust matrix consistency test。

## 5. CI Consistency Gate

- [x] 5.1 [P0][depends:3.3,4.3][I: TS / Rust / spec fixture][O: `scripts/check-engine-capability-matrix.mjs`][V: 三源对比脚本输出明确 diff] 新增对比脚本。
- [x] 5.2 [P0][depends:5.1][I: package.json][O: `npm run check:engine-capability-matrix`][V: 本地与 CI 入口一致] 接入 npm script。
- [x] 5.3 [P0][depends:5.2][I: CI workflow][O: 三平台 CI 接入][V: ubuntu/macos/windows 等价执行] CI 三端接入。

## 6. UI Degradation Rule Pilot

- [x] 6.1 [P1][depends:3.1][I: capability lookup helper][O: 至少一处 UI 试点使用 lookup][V: 试点用例 + 单测] 选 1-2 处 UI 试点 capability-aware 渲染。
- [x] 6.2 [P1][depends:6.1][I: 试点 UI][O: i18n key（zh+en）][V: 新增 key 在 zh 与 en locale 同步落地] 试点降级文案 i18n。

## 7. Governance Gates

- [x] 7.1 [P0][depends:3,4][I: 新增 / 触及代码][O: 前端 type/test 证据][V: `npm run typecheck` + `npm run test`] 跑前端基线。
- [x] 7.2 [P0][depends:4][I: 新增 Rust 代码][O: Rust test 证据][V: `cargo test --manifest-path src-tauri/Cargo.toml engine::capability_matrix`] 跑 Rust 基线。
- [x] 7.3 [P0][depends:5][I: 跨语言对比][O: matrix consistency 证据][V: `npm run check:engine-capability-matrix`] 跑 matrix consistency。
- [x] 7.4 [P1][depends:1-6][I: 测试输出][O: heavy-noise 证据][V: `npm run check:heavy-test-noise`] heavy-test-noise sentry。
- [x] 7.5 [P1][depends:1-6][I: 源/spec/fixture 文件][O: large-file 证据][V: `npm run check:large-files:gate`] large-file sentry。
- [x] 7.6 [P0][depends:7.1-7.5][I: 全部 artifact][O: strict 验证证据][V: `openspec validate add-engine-capability-matrix-spec --strict --no-interactive`] OpenSpec strict validate。

## 8. Completion Review

- [x] 8.1 [P0][depends:7.6][I: validation 输出][O: residual risk 列表][V: 跳过的检查附原因] 记录证据与残余风险。
- [x] 8.2 [P1][depends:8.1][I: 触及边界][O: follow-up backlog][V: capability router / cost-aware routing / dynamic capability discovery 等显式列入] 列出后续 change 接力清单。
