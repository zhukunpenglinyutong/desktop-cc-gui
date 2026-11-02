# PR #1396 登录 shell 密钥注入：评审整改记录

日期：2026-10-29。对应 [PR #1396](https://github.com/zhukunpenglinyutong/desktop-cc-gui/pull/1396) 及[维护者评审](https://github.com/zhukunpenglinyutong/desktop-cc-gui/pull/1396#pullrequestreview-5681823365)。整改基线：`bc23836f4`。

## 已落实的六项反馈

| 反馈 | 最终行为 |
| --- | --- |
| 1. Windows 不应执行 `/bin/bash` 测试 | `bash_probe` 及所有依赖它的测试用 `#[cfg(unix)]`；真实 CLI 烟测模块用 `#[cfg(all(test, unix))]`。纯解析、配置隔离、共享 helper 测试保留跨平台执行。 |
| 2. OMP 不展开 `$NAME` | 复用 `validate_models_config_text("omp", text)` 解析 YAML，只收集 `providers.*.apiKey` 中整体合法的裸变量名。`!command`、`$NAME`、`${NAME}` 和非变量名字面量留给 OMP 自己处理。 |
| 3. 缓存阻断补 export / 换密钥 | 不缓存缺失、失败、超时；正值逐项缓存 5 秒。配置内容、引擎或 shell 路径变化立即失效。过期值不会在探测失败时重新注入。 |
| 4. 对齐 PI 模板语义 | PI 先解析 JSONC，再扫描字符串值。支持 `$KEY-suffix`、`${KEY}`、`$$` / `$!` 转义；不闭合 `${` 继续扫描；闭合但无效的 `${...}` 整段当字面量；`!command` 不当模板处理。 |
| 5. 只读当前引擎配置 | `apply(command, engine)` 只选 PI `models.json` 或 OMP `models.yml`，不再同时读取两边配置。WSL 仍跳过本机注入。 |
| 6. 共享 helper，测试走生产路径 | 新建 `shell_env.rs`，PI/OMP 与 Codex 共用 shell 选择、合法名字校验、帧解析、超时及显式环境保护。注入回归直接调用生产 `inject_from_probe_cached`，每个测试使用独立缓存。 |

正值短 TTL 是维护者明确允许的方案。它覆盖 rc 文件继续 source 其他脚本的情况，代价是已有密钥的轮换最多延迟 5 秒生效，首次补 export 则下次发送立即重试。探测总超时仍为 5 秒，子进程使用 `kill_on_drop(true)`；不改用户配置，不记录密钥。

## 红灯证据

修改生产实现前，向原有生产缓存路径补入测试，执行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib engine::pi_family_env::tests
```

实际结果：

```text
missing_key_is_reprobed_after_user_exports_it ... FAILED
omp_bare_api_key_is_injected ... FAILED
pi_suffix_is_an_env_ref ... FAILED
pi_escaped_dollar_is_not_an_env_ref ... FAILED
pi_malformed_brace_does_not_swallow_later_refs ... FAILED
test result: FAILED. 5 passed; 5 failed
```

进一步对照本机 PI 1.4.0 的 `dist/core/resolve-config-value.js`，补测闭合无效模板中的嵌套引用，先确认 `pi_invalid_braced_literal_does_not_resolve_nested_refs` 红灯，再对齐实现。

## 验证结果

仅验证受影响的 Rust 链路，没有修改依赖、CI、公共 IPC 或 UI。

```text
cargo test --manifest-path src-tauri/Cargo.toml --lib engine::pi_family_env
15 passed; 0 failed; 1 ignored

cargo test --manifest-path src-tauri/Cargo.toml --lib engine::codex_provider_env::tests
3 passed; 0 failed

cargo test --manifest-path src-tauri/Cargo.toml --lib engine::shell_env::tests
3 passed; 0 failed

cargo test --manifest-path src-tauri/Cargo.toml --test send_path omp_send_uses_persisted_tier_and_model_without_touching_cli_config
1 passed; 0 failed; 3 filtered out
```

被忽略的是依赖本机安装的 CLI 的手动烟测，不是功能单测。已在本机显式执行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib engine::pi_family_env::smoke_tests -- --ignored --nocapture
```

实际结果：

```text
pi: login .zshrc -> production injection -> real CLI -> loopback Authorization: PASS (fake credential)
omp: login .zshrc -> production injection -> real CLI -> loopback Authorization: PASS (fake credential)
test result: ok. 1 passed; 0 failed; 0 ignored
```

烟测载体：PI 1.4.0、OMP 17.2.9、macOS。本地临时 HOME / agent 目录、临时 `.zshrc`、虚构密钥、仅监听 `127.0.0.1` 的假 OpenAI 服务。测试进程清空 CLI 的继承环境，使用生产缓存注入后启动真实 CLI，并断言服务收到 `Bearer ccgui-fake-shell-secret`；假服务返回 401 结束请求，不调用真实模型。临时目录在测试结束或 panic 时清理。可通过 `CCGUI_SMOKE_PI_BIN` / `CCGUI_SMOKE_OMP_BIN` 指定 CLI 可执行文件。

四个生产修改文件的主动 LSP 检查：`Files checked: 4; Total diagnostics: 0`。`git diff --check` 和锚点污染检查通过。合入最新目标分支后的编译存在上游代码的 `unused_assignments`、`unused_variables`、`dropping_copy_types` 和 `dead_code` 警告；本次没有改动这些无关代码。

## 与最新目标分支集成

推送前 GitHub 显示原 PR 为 `CONFLICTING`。已合入最新 `v1.1.9`（`602dc7abd87c524af160dbe43e57c0e5990b88b2`）；唯一冲突是发送入口中本次密钥注入与上游 served-model bridge 同时插入同一位置。最终保留两段逻辑，先注入当前引擎的缺失密钥，再设置上游 `CCGUI_SERVED_MODEL_FILE`，不覆盖 served-model 桥接逻辑。相对最新目标分支，`mod.rs` 仅增加两个模块声明与五行注入入口。

合入后重新执行了上文全部五条定向验证命令，结果仍为 `15 + 3 + 3 + 1 + 1` 项通过，0 失败；真实 CLI 烟测显式执行通过。

## 独立复审

独立 Reviewer 对最终源码和合并后的发送入口只读审查：**无 P0 / P1 / P2，结论通过，无阻断**。逐项确认 Windows 条件编译、OMP 裸名字段范围、逐项正值 TTL、PI 模板规则、引擎隔离、Codex helper 复用，以及注入先于上游 served-model bridge 的顺序。Reviewer 没有自行执行编译或测试；上述实际运行结果由主代理核验。

## 验证边界

- 没有在 Windows 主机实际编译或运行；Windows 修复依据为测试的条件编译边界，最终以 Windows CI 为准。
- 没有从 Finder / Dock 重启桌面应用后发消息。真实 CLI 烟测验证了 rc 取值、生产注入、CLI 消费和 HTTP 认证头，没有验证 GUI 入口本身。
- 本机 OMP 为 17.2.9，并非维护者的 18.12.5；两者已核实的裸变量名语义一致，但没有宣称在 18.12.5 上复测。
- 维护者已明确 OMP 内置模板的 `$MY_RELAY_API_KEY` 是项目原有问题，不纳入本 PR；没有顺手改模板。其他 OMP 配置扩展名和迁移机制也不扩展本 PR 的配置入口。
