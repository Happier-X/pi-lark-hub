# Backend Development Guidelines

> `pi-lark-hub` 后端（Hub 守护进程 + lark-bridge 扩展）开发规范索引。

---

## Overview

本目录描述 **真实代码库约定**，供 `trellis-implement` / `trellis-check` 与人类贡献者共用。  
产品形态：本机 multi-Pi 飞书远程控制（loopback HTTP/WS + Pi 扩展），**无数据库、无独立 Web 前端**。

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | `src/hub` / `lark-bridge` / `protocol` 布局与依赖方向 | Filled |
| [Database / Persistence](./database-guidelines.md) | 无 ORM；内存 Store + 配置文件 | Filled |
| [Error Handling](./error-handling.md) | Hub/bridge 错误、远程队列、fail-closed | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Hub `log`/console vs Bridge `notify`/`setStatus` | Filled |
| [Quality Guidelines](./quality-guidelines.md) | 禁止 followUp/steer、禁止 TUI 下 stdin/stderr chrome | Filled |
| [Multi-Pi Lark Hub](./multi-pi-lark-hub.md) | 协议、路由、配置、飞书 mode、测试矩阵 | Filled |

---

## 实现前必读

1. 远程文本与 multi-Pi 路由 → **先读** [multi-pi-lark-hub.md](./multi-pi-lark-hub.md) + [quality-guidelines.md](./quality-guidelines.md)
2. 改目录/新模块 → [directory-structure.md](./directory-structure.md)
3. 用户可见失败路径 → [error-handling.md](./error-handling.md) + [logging-guidelines.md](./logging-guidelines.md)

---

## 验证命令

```bash
npm run typecheck
npm test
```

---

**Language**: 规范正文以 **简体中文** 为主；协议字段名 / 代码标识符保持英文。
