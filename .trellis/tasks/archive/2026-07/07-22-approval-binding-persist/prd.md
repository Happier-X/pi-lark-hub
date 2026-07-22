# 审批与绑定轻量持久化

## 目标

Hub 进程重启后恢复**未决审批**与**未过期消息绑定**，使危险命令仍可审、回复仍可精确路由；不落 secret，损坏文件不阻塞启动。

## 需求

1. 持久化路径默认 `~/.pi/lark-hub/state.json`（可用环境变量覆盖）。
2. 原子写入（`replaceFileAtomic`）+ `schemaVersion`；读写失败/损坏 → 警告日志并空状态启动。
3. 审批：持久化 `pending` 与 `failed_delivery`（未成功交付结果）；terminal 且已 delivered 可不写或启动时丢弃。
4. 绑定：持久化未过期 `messageId→piId/requestId/event`；尊重现有 TTL。
5. 启动：加载 → 恢复 store → 为 pending 重武装超时（剩余时间 ≤0 则立即 timeout 路径）。
6. 变更后防抖落盘；`close`/`lark reset` 时同步写或清空策略明确。
7. 文件与日志均不写 appSecret/controlToken。

## 不做

- 跨机器共享状态
- 完整 notify 历史落盘（仍内存）
- 加密盘外密钥托管

## 验收

- [ ] 写入后重启（模拟 load）pending 可查、定时器可触发
- [ ] 过期 pending 启动即 timeout 语义
- [ ] 损坏 JSON 不抛崩 Hub
- [ ] 原子写单测 + store 集成单测
- [ ] typecheck/test 通过
