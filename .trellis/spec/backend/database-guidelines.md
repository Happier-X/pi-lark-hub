# 持久化与状态存储

> 本项目 **没有数据库 / ORM / 迁移**。本文档描述实际的状态存放方式，避免 AI 臆造 Prisma/SQL 层。

---

## Overview

`pi-lark-hub` 的运行时状态均为 **进程内内存**。进程退出即丢失。配置通过 JSON 文件 + 环境变量加载，**不**用数据库持久化。

| 数据 | 存放 | 生命周期 |
|------|------|----------|
| Hub 配置 | `~/.pi/lark-hub/config.json` + env | 启动时 `loadHubConfig` 读入内存 |
| 在线 Pi 实例 | `InstanceRegistry`（`src/hub/registry.ts`） | WS 连接 + 心跳；超时扫除 |
| messageId 绑定 | `MessageBindingStore`（`src/hub/bindings.ts`） | 内存 Map；可选 max 条目淘汰 |
| 审批记录 | `ApprovalStore`（`src/hub/approvals.ts`） | 内存 Map + 超时定时器 |
| Bridge 远程队列 | `lark-bridge` 内 `queue: QueuedTask[]` | 单 Pi 进程内存；stop/shutdown 清空 |
| 待审批 / need_reply | bridge 内 `Map` | 单次请求 + 本地超时 |

**没有**：SQL、Redis、ORM、migration、repository 模式。

---

## 配置（唯一“落盘”）

- 路径默认：`~/.pi/lark-hub/config.json`（`PI_LARK_HUB_CONFIG` 可覆盖）
- 合并顺序：**defaults < 文件 < 环境变量**（见 `src/hub/config.ts`）
- 校验：`assertValidHubConfig` — lark-cli 模式强制 allowlist 与 userId/chatId

参考：`src/hub/config.ts`、`src/hub/config.test.ts`、`docs/lark-hub.md`。

---

## 内存状态模式

### 1. Store 类 + 显式 API

审批 / 绑定 / 注册都用 **class + 方法**，而不是散落全局变量：

- `ApprovalStore.create` / `decide` / `markDelivered` / 超时
- `MessageBindingStore.bind` / `get` / `delete`
- `InstanceRegistry.register` / `heartbeat` / `listOnline` / sweeper

新增同类状态时：放在 `src/hub/` 独立模块，由 `server.ts` 或 `cli.ts` 注入，便于测试替换。

### 2. 不落盘、不跨进程共享

- 多 Hub 进程 **不会**共享绑定/审批（设计上单机单 hub）
- Bridge 队列 **不会** 通过 Hub 重放历史任务

### 3. 测试注入

允许通过构造参数 / options 注入 mock（如 `feishu` transport、`fileContent` 配置），避免真实 IO：

- `loadHubConfig({ skipFile: true, fileContent, env })`
- `LarkCliFeishuTransport` 可注入 `runner` mock spawn

---

## 命名约定

| 对象 | 约定 | 示例 |
|------|------|------|
| 实例 ID | `piId` 字符串 | Hub 生成或客户端提供 |
| 请求 ID | `requestId` | `generateRequestId()` |
| 飞书消息 ID | `messageId` | `om_xxx` 或 `console-…` |
| open_id | `openId` / 配置 `allowedOpenIds` | `ou_xxx` |
| 群 | `chatId` | `oc_xxx` |

---

## 禁止事项

| 禁止 | 原因 |
|------|------|
| 引入 SQLite/Postgres「顺便持久化审批」 | 超出当前 MVP；需单独产品决策 |
| 把绑定/审批写进配置文件 | 配置是静态运维项，不是运行时状态 |
| 在 bridge 与 hub 之间双写同一队列 | 队列只属于发起任务的 Pi 扩展 |
| 假设重启后 messageId 绑定仍在 | 必须 fail-closed 或用户重新交互 |

---

## 若未来要加持久化

单独开任务，至少明确：

1. 哪些状态需要跨重启（绑定？审批？）
2. 文件 vs 嵌入式 DB 的取舍
3. 与 fail-closed 路由的兼容

在此之前，**所有新功能默认进程内内存**。
