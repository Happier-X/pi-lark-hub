# UI / 扩展面质量规范

> 聚焦 **不破坏 Pi TUI**、远程控制与本地编辑隔离。Hub 侧质量见 backend。

---

## Overview

Bridge 与用户的界面契约：status 条、notify、斜杠命令、本机审批/输入回退。  
远程消息 **绝不能** 进入 Pi 的 followUp/steer 恢复队列。

与 [../backend/quality-guidelines.md](../backend/quality-guidelines.md) 互补：backend 写全表，本文强调 UI 侧检查清单。

---

## Forbidden Patterns

| Pattern | Why |
|---------|-----|
| 远程路径 `deliverAs: "followUp" \| "steer"` | abort 后文本进编辑器 |
| TUI 下 `readline` / 抢 `stdin` | raw mode 冲突 |
| 多行 `console.log`/`stderr` 当 UI | 弄脏 alternate-screen |
| 无 `hasUI` 强调 `ctx.ui.*` | headless 失败 |
| Hub 离线时静默丢审批 | 应回退本机 UI 或明确 notify |

---

## Required Patterns

| Pattern | Rule |
|---------|------|
| 用户提示 | 优先 `notify` / `setStatus` |
| 远程任务 | 自有 FIFO + settled 后 drain |
| 停机 | 清 queue、pending、status |

---

## 测试与手工验收

- 自动：`npm run typecheck`；Hub 单测不覆盖 TUI
- 手工建议：
  1. Hub 起 + bridge 连接，status 显示 piId
  2. 忙时发远程消息 → 入队 notify → settled 后执行
  3. Escape/abort 后编辑器 **无** 远程残留文本
  5. 停 Hub → warning + 重连；危险命令可本机审批

---

## Code Review Checklist（UI）

- [ ] 无远程 followUp/steer
- [ ] 无 TUI 下 stdin/多行 stderr UI
- [ ] `hasUI` 守卫
- [ ] settled 后 drain 顺序
- [ ] shutdown 清队列
- [ ] typecheck 通过
