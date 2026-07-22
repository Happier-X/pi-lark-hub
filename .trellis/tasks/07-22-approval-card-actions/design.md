# 设计

## 出站

- `buildInteractiveCardContents` 增加 `actions?: { requestId; decisions }`；仅第一张卡片 elements 追加 `tag:action` 按钮组。
- `NativeFeishuTransport.send`：当 `event==="approval"` 且 `actions` 含 approve/reject 时附加按钮。
- 实现 `sendApprovalCard` 与 `send` 同路径。

## 入站

- `EventDispatcher.register({ "card.action.trigger": handler })`
- 解析 operator.open_id + action.value
- `handlers.onApprovalAction` → `server.handleInboundApproval`
- 响应 toast（成功/失败），尽量不抛未捕获异常

## value 约定

```json
{ "v": 1, "kind": "approval", "requestId": "...", "decision": "approve"|"reject" }
```
