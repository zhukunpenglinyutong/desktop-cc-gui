# Dock 用户对话时间线

## Goal
把右下角状态面板中的 `最新对话` tab 升级为 `用户对话` 时间线，按当前线程用户消息从新到旧显示。

## Requirements
- 只显示当前 active thread 的 user messages
- 按时间线从新到旧排序
- 每条消息保留文本与图片数量摘要
- 长文本支持逐条展开/收起
- dock tab 文案改为 `用户对话`
- 不改变手动切换 tab 语义

## Acceptance Criteria
- [ ] dock 状态面板可看到 `用户对话` tab
- [ ] tab 内显示多条 user message，而不是仅最后一条
- [ ] 排序为新到旧
- [ ] 无用户消息时空态稳定
- [ ] 现有其它 tab 行为不回退

## Technical Notes
- 变更范围限定在 frontend status-panel feature
- 需要同步更新 OpenSpec 与 targeted tests
