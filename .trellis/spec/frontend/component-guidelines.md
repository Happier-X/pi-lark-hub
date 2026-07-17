# UI 原语（非 Web 组件）

> 无 React/Vue 组件。用户可见交互一律走 Pi Extension UI API。

---

## Overview

实现位置：`src/lark-bridge/index.ts`。

封装模式（闭包内助手，而非组件文件）：

```ts
const STATUS_KEY = "lark-bridge";

const status = (text?: string) => {
  if (activeCtx?.hasUI) activeCtx.ui.setStatus(STATUS_KEY, text);
};

const notify = (text: string, level: "info" | "warning" | "error" = "info") => {
  if (activeCtx?.hasUI) activeCtx.ui.notify(text, level);
};
```

---

## Pi UI 能力映射

| 需求 | API | 本项目用法 |
|------|-----|------------|
| 持久连接状态 | `ui.setStatus(key, text?)` | key 固定 `lark-bridge` |
| 一次性提示 | `ui.notify(text, level)` | 入队、审批、超时、Hub 错误 |
| 本机确认 | `ui.confirm` / `select` / `input` | Hub 不可用时审批 / need_reply 回退 |
| 斜杠命令 | `pi.registerCommand` | `/lark-status`、`/lark-ask` |
| 无 UI 降级 | `console.log` **仅** status 命令 | 见 `/lark-status` |

调用前检查 `activeCtx?.hasUI` / `ctx.hasUI`，避免无头环境抛错。

---

## 文案约定

- **语言**：中文为主，可夹英文 id（`piId`、`requestId`）
- **长度**：notify 可短多行；过长摘要截断（如 task_end `SUMMARY_MAX = 800`）
- **敏感**：不把完整危险命令密钥式内容无限制刷屏；审批相关可截断 requestId

---

## 禁止的「组件」思路

| 禁止 | 原因 |
|------|------|
| 自绘 HTML/CSS 浮层 | 不在 Pi 扩展模型内 |
| 用 stderr 多行 banner 代替 notify | 破坏 TUI |
| 无 `hasUI` 检查直接调 ui | headless/测试环境失败 |

更完整的禁止列表见 [quality-guidelines.md](./quality-guidelines.md) 与 [../backend/quality-guidelines.md](../backend/quality-guidelines.md)。
