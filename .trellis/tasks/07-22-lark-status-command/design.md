# 设计

- `src/hub/status-report.ts`：快照类型 + 纯函数格式化 + 命令识别。
- `control.ts`：在列表/使用之前处理 status。
- `server.ts`：ControlContext 注入快照（含 credentials 存在与 updatedAt、/health 字段同步）。
- Bridge：`/lark status` → 拉 `/health` + 本地 connected/piId/queue/pending ack。
