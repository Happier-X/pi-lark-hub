# 生命周期与事件（无 React Hooks）

> 本项目不使用 `useState` / `useEffect`。等价物是 **Pi 扩展回调** 与闭包状态。

---

## Overview

扩展入口：

```ts
export default function larkBridge(pi: ExtensionAPI) {
  // 闭包状态 + 注册 handlers
}
```

参考：`src/lark-bridge/index.ts`。

---

## 使用的扩展钩子（模式）

| 时机 | 典型行为 |
|------|----------|
| 扩展加载 | 建立 WS、注册命令、订阅 agent 事件 |
| 上下文可用 | 保存 `activeCtx`，更新 status |
| `agent_start` / 忙 | 心跳 `status: busy`；远程槽占用 |
| `agent_end` | 缓存助手摘要供 task_end |
| `agent_settled` | **先**清当前远程标志并回传，**再** `tryDrainQueue` |
| 工具调用前（危险 bash） | 拦截 → hub 审批或本机 UI |
| 扩展停止 / unload | `intentionalClose`、清队列、unregister、关 WS |

具体订阅 API 名称以当前 `@earendil-works/pi-coding-agent` 类型为准；**新增逻辑必须挂在已有事件语义上**，不要轮询 TUI。

---

## 命令（类「用户触发 hook」）

| 命令 | 行为 |
|------|------|

注册方式：`pi.registerCommand({ name, ... })`（以现有代码为准）。

---

## 规则

1. **drain 顺序**：`agent_settled` 上 reply-then-drain，不可在 `agent_end` 抢跑清队列导致串台。
3. **不要**引入 React Query / SWR 等前端数据 hook；Hub 通信是 WS 消息驱动。

---

## 反模式

- 在 `setInterval` 里 `sendUserMessage` 刷任务
- 把远程任务塞进 Pi followUp 队列「图省事」
