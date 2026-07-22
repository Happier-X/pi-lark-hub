# 飞书状态诊断命令

## 目标

提供可在 Pi（`/lark status`）与飞书（`状态`/`status`）使用的脱敏诊断摘要，降低开局与运维排障成本。

## 需求

1. 展示：包版本、Hub host/port、是否已绑定主人、凭证是否存在及更新时间（脱敏）、在线 Pi 列表与默认、待审批数、绑定数。
2. 不得输出 appSecret、完整 openId/token、完整隐私正文。
3. 文本命令与 `/lark status` 语义一致；`/lark reset` 语义不变。
4. 给出简短修复建议（未开局→扫码；无在线→检查 Bridge；Hub 不可达→检查进程）。

## 验收

- [ ] `isStatusCommand` / `formatHubStatusReport` 单测
- [ ] control 面识别状态命令
- [ ] Bridge `/lark status` 可工作
- [ ] typecheck/test 通过
