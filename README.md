# pi-lark-hub

通过飞书原生 OpenAPI 与官方 WebSocket 遥控多个本机 Pi 会话。Hub 只监听 `127.0.0.1`，不需要公网回调，也不依赖外部命令行工具。

## 安装与启动

```bash
npm install
npm run hub
```

Pi 包默认加载 `pi-lark-hub.ts`。Hub 也会由扩展在 loopback 上自动拉起。

## 飞书开局

Pi 内只提供一个命令：

```text
/lark          无凭证时打开飞书官方 PersonalAgent 授权二维码；已有凭证时确认原生连接状态
/lark reset    停止原生连接，删除凭证、主人绑定和飞书运行配置，允许重新扫码
```

扫码二维码的载荷是飞书返回的 `verification_uri_complete` URL。registration 必须返回可信真人 `open_id`，且必须与机器人自身 `open_id` 不同；否则开局失败，不保存或启用凭证。

成功后：

- 密钥写入 `~/.pi/lark-hub/credentials.json`，可用 `PI_LARK_HUB_CREDENTIALS` 覆盖路径；
- `config.json` 只记录 `mode=native`、唯一主人白名单和私聊目标；
- Hub 热启动原生 OpenAPI transport 与官方 WebSocket 入站；
- secret 不进入配置摘要、日志或 Pi 通知。

## 能力

- 多 Pi 注册、默认实例选择与精确回复绑定；
- 飞书文本指令经扩展 FIFO 投递；
- 任务结束通知；
- 危险命令审批；
- 唯一可信主人鉴权。

详细说明见 [docs/lark-hub.md](docs/lark-hub.md)。

## 验证

```bash
npm run typecheck
npm test
```
