# 目录结构（UI / 扩展面）

> 本项目无 `src/components`、无页面路由。UI 相关代码位置如下。

---

## Overview

| 路径 | 角色 |
|------|------|
| `src/lark-bridge/index.ts` | **唯一** Pi 扩展实现：WS、队列、审批 UI、命令、status/notify |
| `src/index.ts` | 包默认扩展入口（re-export，无 UI） |
| `src/protocol.ts` | 消息类型（无 UI） |
| `docs/lark-hub.md` | 人类可读运维文档（非运行时 UI） |

Hub（`src/hub/*`）只打终端日志，**不**实现 Pi TUI。

---

## Directory Layout（与 UI 相关）

```text
src/
├── index.ts                 # re-export lark-bridge
├── protocol.ts              # 共享类型
└── lark-bridge/
    └── index.ts             # default export function larkBridge(pi: ExtensionAPI)
```

---

## 放置规则

| 需求 | 放哪里 |
|------|--------|
| 新的 `/lark-*` 斜杠命令 | `lark-bridge/index.ts` 内 `pi.registerCommand` |
| 状态条文案 / notify | 同上，复用局部 `status` / `notify` 助手 |
| 远程任务队列 UI 文案 | 同上（入队提示等） |
| 审批本机回退 UI | `ctx.ui.confirm` / `select` / `input`（有 UI 时） |
| Web 页面 / React 组件 | **不要加**；产品边界外 |

若 `lark-bridge/index.ts` 过大需要拆分：优先按 **职责文件** 拆到 `src/lark-bridge/`（如 `queue.ts`、`approvals-ui.ts`），仍由 `index.ts` 组装；不要新建 `frontend/` 或 `ui/` 顶层包。

---

## 反模式

- 新建 `src/pages` / `src/components` / Vite React 应用「做控制台」——超出当前包职责（控制用 curl + 飞书 + Hub HTTP）
- 在 `src/hub` 里调用 `ExtensionContext`——Hub 是独立进程，没有 Pi UI
