# pi-wechat-ilink

Pi coding agent extension for the **official WeChat iLink / ClawBot** channel.

Use your phone WeChat to:

- send tasks to the current Pi session
- get notified when a local Pi task finishes
- approve or reject dangerous bash commands remotely

This is **not** Server酱 and **not** a WeChat Work webhook. It uses Tencent's official iLink gateway (`ilinkai.weixin.qq.com`) via the `@wechatbot/wechatbot` SDK.

## Install

### From local project (development)

```bash
pi install C:/code/pi-wechat-ilink
# or relative path
pi install ./pi-wechat-ilink
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "C:/code/pi-wechat-ilink"
  ]
}
```

### From npm (after publish)

```bash
pi install npm:pi-wechat-ilink
```

### Quick test without install

```bash
pi -e C:/code/pi-wechat-ilink
```

Then restart Pi or run `/reload`.

## Usage

```text
/wechat              Connect WeChat iLink (QR on first login)
/wechat --force      Force re-login with a new QR code
/wechat-status       Connection status
/wechat-test         Send a test message to the last WeChat user
/wechat-stop         Disconnect (keeps saved credentials)
/weixin              Alias for /wechat
```

First connect:

1. Run `/wechat`
2. Scan the QR code shown in the Pi UI widget (or open the URL if headless)
3. Confirm on your phone; if a pairing code is required, enter it in the Pi input dialog
4. Message the bot from WeChat, e.g. `检查当前项目测试为什么失败`

Credentials are stored under:

```text
~/.pi/agent/wechat-ilink-state/
```

Later starts usually reconnect without scanning again.

## WeChat control messages

```text
状态
待审批
批准 ABC123
拒绝 ABC123
```

Any other text is injected into the current Pi session as a user prompt. When Pi fully settles, the final answer is sent back to WeChat.

If Pi is already busy, the WeChat task is **queued inside the extension** (not Pi's follow-up queue). You get a “已加入队列” reply; after the current run settles, the next item is auto-submitted. Abort/Escape will **not** dump queued WeChat text into the Pi editor.

## Dangerous command approval

The extension intercepts high-risk bash patterns such as:

- `rm -rf`
- `sudo`
- `git push --force`
- `git reset --hard`
- `chmod/chown 777`
- `DROP TABLE/DATABASE`

WeChat receives an approval ID. Reply:

```text
批准 ABC123
拒绝 ABC123
```

Local UI confirmation and WeChat approval race; the first decision wins. Timeout defaults to reject after 5 minutes.

## How it works

```text
WeChat user
    │
    ▼
iLink API (Tencent)
    │
    ▼
pi-wechat-ilink extension
    │
    ├── idle  → pi.sendUserMessage(text)
    ├── busy  → extension FIFO + “已排队” ack (no followUp)
    ├── agent_settled → reply answer, then drain one queued task
    └── tool_call (dangerous bash) → WeChat approve/reject
```

No public IP is required. The extension long-polls iLink.

## Multi-Pi 飞书 Hub（实验 / Phase 0–5）

同仓提供本机协调进程与独立扩展，用于**多个 Pi 同时运行**时的注册、默认路由、任务结束通知、回复绑定、危险 bash 审批与显式 need_reply。

- **默认 `console` 模式**：HTTP 模拟入站，出站打印 `console-<uuid>`（单元测试离线）。
- **可选真实飞书**：`feishu.mode=lark-cli` + 本机 `lark-cli` 授权；强制 openId 白名单。

详细说明见 [docs/lark-hub.md](./docs/lark-hub.md)。

```bash
# 终端 1：启动 hub（仅 127.0.0.1）
npm run hub

# 健康检查 / 模拟用户消息 / 出站绑定 / 审批
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/notifications
curl http://127.0.0.1:8765/approvals
curl -X POST http://127.0.0.1:8765/control/message -H "Content-Type: application/json" -d "{\"text\":\"列表\"}"
# 回复某条通知（精确路由）:
# {"text":"继续","replyToMessageId":"console-..."}
# 模拟审批卡片按钮:
# POST /control/approval {"requestId":"...","decision":"approve"}
# need_reply：Pi 内 /lark-ask 后，用 replyToMessageId 回复绑定消息

# 终端 2：单独加载 bridge（默认 package 扩展仍是微信，避免双通道）
pi -e ./src/lark-bridge/index.ts
# Pi 内: /lark-status
# Pi 内: /lark-ask 请给出部署环境
```

启用真实飞书（需已安装并 auth 的 `lark-cli`）：

```bash
# ~/.pi/lark-hub/config.json 示例见 docs/lark-hub.md
# 或环境变量：
set PI_LARK_FEISHU_MODE=lark-cli
set PI_LARK_FEISHU_USER_ID=ou_xxx
set PI_LARK_ALLOWED_OPEN_IDS=ou_xxx
npm run hub
```

路由规则摘要：单在线自动默认；多在线无默认则提示「使用 &lt;id&gt;」；`replyToMessageId` / 审批 `requestId` 精确投递且离线 fail-closed，不猜测串线；need_reply 仅显式 `/lark-ask` 触发。

## Develop

```bash
git clone https://github.com/Happier-X/pi-wechat-ilink.git
cd pi-wechat-ilink
npm install
```

Point Pi at the local package:

```bash
pi install .
```

Edit `src/index.ts`, then in Pi:

```text
/reload
```

Typecheck / tests / hub:

```bash
npm run typecheck
npm test
npm run hub
```

## Publish

### GitHub

```bash
# replace remote URL first in package.json / git remote
git init
git add .
git commit -m "feat: initial pi wechat ilink extension"
git branch -M main
git remote add origin https://github.com/Happier-X/pi-wechat-ilink.git
git push -u origin main
```

Users can install from git:

```bash
pi install git:github.com/Happier-X/pi-wechat-ilink
```

### npm

1. Update `repository` / `homepage` / `bugs` in `package.json`
2. Login:

```bash
npm login
```

3. Publish:

```bash
npm version patch
npm publish --access public
```

4. Install:

```bash
pi install npm:pi-wechat-ilink
```

## Security notes

- iLink credentials under `~/.pi/agent/wechat-ilink-state/` must not be committed or shared
- Anyone who can message the bot can inject tasks into the active Pi session
- Approval timeout defaults to reject
- Review dangerous command patterns before relying on them in production workflows
- `pi-lark-hub` 仅监听 `127.0.0.1`；`lark-cli` 模式默认强制 `allowedOpenIds` 白名单

## License

MIT
