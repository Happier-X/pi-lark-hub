# 设计

## 文件格式

```json
{
  "schemaVersion": 1,
  "savedAt": 0,
  "approvals": [ { "requestId", "piId", "status", "decision?", "createdAt", "timeoutMs", "messageId?", "title?", "body?", "actorOpenId?", "deliveredToPi" } ],
  "bindings": [ { "messageId", "piId", "requestId?", "event?", "createdAt" } ]
}
```

- 路径：`PI_LARK_HUB_STATE` 或 `~/.pi/lark-hub/state.json`
- 仅序列化 `pending` | `failed_delivery` 审批；绑定经 `list()` 已 purge

## 模块

- `src/hub/state-persist.ts`：`loadHubState` / `saveHubState` / `defaultStatePath` / debounce helper
- `ApprovalStore`：`importRecords` / `exportPersistable`；或 server 层读写 records（优先 store 方法保持封装）
- `MessageBindingStore`：`importBindings` / 已有 `list`

## 生命周期

1. `startHubServer`：load → hydrate stores → re-arm timeouts（`remaining = createdAt+timeoutMs-now`）
2. 在 create/decide/timeout/bind/delete 后 `schedulePersist()`（debounce 200–500ms）
3. `close`：flush 同步 save；`lark_reset`：clear stores + 写空状态或删文件

## 失败

- load 失败：log，空 store
- save 失败：log，不抛到热路径（或 close 时再试一次）

## 隐私

- 文件仅本机；body 为审批上下文需要保留
- 禁止写入 credentials/token
