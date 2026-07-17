# Frontend / UI Guidelines

> 本仓库 **没有** React/Vue/Web SPA。本目录描述 **Pi 扩展侧用户界面**（TUI status / notify / 命令）约定。

---

## Overview

`pi-lark-hub` 的「前端」= **lark-bridge** 通过 Pi `ExtensionAPI` / `ExtensionContext` 与本机 TUI 交互。  
没有组件树、没有 hooks 目录、没有全局状态库。

若任务需要改用户可见反馈，只改 `src/lark-bridge/index.ts`（及协议字段若涉及），并遵守 backend 的 quality / logging 规范。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | 无 Web 前端；UI 相关文件位置 | Filled |
| [Component Guidelines](./component-guidelines.md) | 不适用 Web 组件；Pi UI 原语映射 | Filled |
| [Hook Guidelines](./hook-guidelines.md) | 无 React hooks；扩展生命周期事件 | Filled |
| [State Management](./state-management.md) | Bridge 闭包状态与队列 | Filled |
| [Type Safety](./type-safety.md) | TypeScript / Extension 类型约定 | Filled |
| [Quality Guidelines](./quality-guidelines.md) | TUI 安全与用户可见反馈质量 | Filled |

---

## 与 Backend 的关系

| 主题 | 文档 |
|------|------|
| 禁止 followUp / stdin / stderr chrome | [../backend/quality-guidelines.md](../backend/quality-guidelines.md) |
| notify / setStatus 级别 | [../backend/logging-guidelines.md](../backend/logging-guidelines.md) |
| Hub 协议与路由 | [../backend/multi-pi-lark-hub.md](../backend/multi-pi-lark-hub.md) |

---

**Language**: 规范正文以 **简体中文** 为主；API 名保持英文。
