# 状态管理（Bridge 闭包）

> 无 Redux/Zustand/React Context。状态在 `larkBridge` 函数闭包内。

---

## Overview

所有 Bridge UI/会话状态是 **单扩展实例内存变量**，与 Hub 的 Store 分离。

参考：`src/lark-bridge/index.ts`。

---

## 状态清单

| 状态 | 类型意图 | 说明 |
|------|----------|------|
| `activeCtx` | `ExtensionContext \| null` | 当前 UI/agent 上下文 |
| `socket` / `connected` / `piId` | WS 连接 | Hub 会话 |
| `queue` | `QueuedTask[]` | 远程文本 FIFO |
| `currentFromHub` / `drainingQueue` | 槽占用标志 | 与 `isIdle()` 一起判 busy |
| `pendingAssistantSummary` | string | `agent_end` → `task_end` |
| `approvals` | `Map<requestId, PendingApproval>` | 危险命令等待决策 |
| `needReplies` | `Map<requestId, PendingNeedReply>` | `/lark-ask` 等待回答 |
| `lastNotifyAck` / `lastNeedReplyAnswer` | 调试快照 | `/lark-status` |

Hub 侧状态见 [../backend/database-guidelines.md](../backend/database-guidelines.md)（`ApprovalStore`、`MessageBindingStore`、`InstanceRegistry`）。

---

## Busy / 入队规则

视为 busy（入站应 enqueue，不直接开新远程 run）：

- `!ctx.isIdle()`
- `currentFromHub`
- `drainingQueue`
- （以及当前仍占用 reply 槽的远程 run 标志——以代码为准）

入队后：`notify("飞书消息已加入队列（第 N 条）")`。

Drain：仅 `tryDrainQueue` 在 idle 且无当前 hub run 时取 **一条**，`pi.sendUserMessage(text)` **不带** `deliverAs`。

---

## 超时

| 场景 | 常量（代码内） | 超时行为 |
|------|----------------|----------|
| 危险审批 | `APPROVAL_TIMEOUT_MS`（5min） | 视为拒绝 |
| need_reply | `NEED_REPLY_TIMEOUT_MS`（10min） | resolve 取消；不猜答案 |
| 心跳 | `HEARTBEAT_MS`（10s） | 发 heartbeat |
| 重连 | `RECONNECT_MS`（5s） | 非 intentionalClose 时重连 |

---

## 规则

1. 状态只在一个扩展闭包内；不要挂 `globalThis`。
2. Map 项必须在 done/timeout/shutdown 时删除，防泄漏。
3. stop/shutdown：**清空 queue**，取消 pending，关 WS。
4. 不与 Hub 双写同一队列。

---

## 反模式

- 远程忙时用 followUp「挂起」消息（会进 TUI 编辑器）
- 多处直接改 `queue` 而不经统一 enqueue/drain
- 用 localStorage 持久化 bridge 队列
