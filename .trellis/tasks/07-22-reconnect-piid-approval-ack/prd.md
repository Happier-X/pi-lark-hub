# 重连复用 piId 与审批结果确认

## 目标

1. Bridge 在同一扩展生命周期内重连时复用上次 `register_ok` 的 piId。
2. Hub 仅在收到 Pi 的 `approval_result_ack` 后 `markDelivered`；允许向原 piId 有限重投。

## 验收

- [ ] 重连 register 携带既有 piId
- [ ] 协议含 approval_result_ack 运行时解码
- [ ] markDelivered 仅在 ack 后
- [ ] 测试与 typecheck 通过

## 不做

- 跨进程稳定身份；不改投其他 Pi
