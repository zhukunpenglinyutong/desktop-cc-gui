# OMP Fast 模式

在聊天输入框的模型菜单中选择 OMP，再选择明确的 `openai-codex/…` 模型。思考强度区域左侧的闪电按钮控制 Fast，右侧重置按钮恢复 OMP 设置：

- 点击重置恢复 OMP 设置：不传递覆盖参数，保留 CLI 自己的默认值。
- 关闭闪电按钮使用标准速度：下一次发送传入 `--service-tier default`。
- 点亮闪电按钮启用 Fast：下一次发送传入 `--service-tier priority`，输入框模型按钮显示 Fast。

设置保存在本应用的 `ompOpenaiServiceTier` 字段中，适用于各会话之后发送的
OMP Codex 请求。默认不覆盖；不会改写 OMP 的全局配置，亦不调整思考强度。
正在生成的回复不受切换影响。切换到其他供应商（包括 `openai/…` API 模型）或 CLI 默认模型时，本应用不发送
这个覆盖参数，也不显示 Fast 控件；原有思考深度控件保持原样。

Fast 会增加额度或费用消耗，实际支持与速度取决于模型、账户和服务端。
界面的 Fast 标记表示请求偏好，不表示服务端已确认按该档处理。

需要支持 `--service-tier` 的 OMP，已核对本地 18.1.14 的 CLI 帮助。
旧版 CLI 若拒绝该参数，发送会显示错误；可点击重置恢复无覆盖的
启动方式，或升级 OMP。没有为验证功能发起付费模型请求。

验证覆盖：三档参数、设置兼容与保存、思考强度独立、供应商与引擎隔离，
以及使用假 OMP 进程的真实发送链路；前端测试覆盖选择、保存中状态及保存失败。

## 推理参数的协议边界

Pi/OMP 的推理档位通过 `--thinking` 和 RPC `set_thinking_level` 原样交给 CLI，
由 CLI 根据实际模型与供应商协议生成请求。本应用的提问桥不再追加推理字段。
例如 Codex Responses 使用 `reasoning.effort`，不能同时加入 Chat Completions 的
顶层 `reasoning_effort`；Anthropic 和 Google 的原生思考配置也由 CLI 负责。
这修复了 1.0.6 起通用字段注入导致的 `Unsupported parameter: reasoning_effort`，
不要求降低 `xhigh`，也不改变 Fast 的 `service_tier` 行为。

协议回归：`node --experimental-strip-types --test tests/pi-request-payload.test.ts`。
本地验证还使用 OMP 18.2.10 的 Codex 请求模块发送至回环校验端点：
旧桥触发参数拒绝，修复后保留 `reasoning.effort=xhigh` 并完成 SSE 响应。
这不是线上账户或已打包桌面应用的端到端验证。
