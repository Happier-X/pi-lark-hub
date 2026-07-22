# 审批卡片按钮与幂等回调

## 目标

审批出站卡片渲染「批准/拒绝」按钮；用户点击经飞书 `card.action.trigger`（长连接）回调，走现有 `handleInboundApproval` 与幂等状态机。

## 需求

1. approval 事件且含 actions 时，卡片末尾有批准/拒绝按钮；value 含 requestId、decision、版本标识。
2. actor open_id 来自回调事件 operator，不信任按钮 value 内的 open_id。
3. 文本 `批准/拒绝` 命令保留。
4. 重复点击、非主人、未知 requestId、离线 Pi 均可读反馈；不改投。
5. 多批卡片仅首张带按钮（绑定 messageId 为第一张）。

## 验收

- [ ] 格式层可生成带 action 的卡片 JSON
- [ ] sendApprovalCard / send(approval) 使用该格式
- [ ] WS 注册 card.action.trigger 并解析
- [ ] 单元测试覆盖按钮 JSON 与回调解析
- [ ] typecheck/test 通过

## 不做

- 公网 webhook 必需；多用户审批；自动批准
