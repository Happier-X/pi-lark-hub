# 错误处理

## 原则

- Hub 与 Bridge 的用户可见错误使用明确中文，不回显 app secret。
- Hub 断开时 Bridge 重连并可自动拉起；本机 Pi 不崩溃。
- 未授权 open_id、空主人状态、回复绑定缺失或目标离线均 fail-closed。
- 审批超时按拒绝处理；已处理结果保持幂等。

## `/lark` 开局

| 失败点 | 行为 |
|---|---|
| registration init/begin/poll | 返回失败，不改现有运行时与文件 |
| owner open_id 缺失 | 失败，不保存凭证 |
| bot open_id 查询失败 | 无法证明真人身份，失败 |
| owner 等于 bot | 失败，不保存凭证 |
| WebSocket 未 connected | 停止候选 runtime，不落配置 |
| 配置或凭证写入失败 | 停止候选 runtime，恢复内存旧状态 |

已有凭证但原生运行时未就绪时，`/lark` 明确提示先 `/lark reset` 再扫码，不隐式覆盖密钥。

## `/lark reset`

中止轮询、停止 WS、删除密钥和飞书配置。删除不存在的密钥视为幂等成功；文件清理失败必须返回失败，不声称已重置。

## 常见错误

- 在没有可信 owner 时启用凭证。
- 将首个私聊用户自动设为主人。
- 将 secret 写入 config、日志或 WebSocket 回执。
- 回复绑定目标离线时改投默认 Pi。
- 远程文本使用 followUp 或 steer。
