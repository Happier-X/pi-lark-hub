# PRD：真正扫码绑定飞书主人（cc-connect 对齐）

## 目标

对齐 cc-connect 的飞书 PersonalAgent 扫码开局：用户用飞书 App 扫描**官方授权 URL 二维码**后，本机完成应用凭证落盘、可选主人绑定，并在**不依赖 lark-cli** 的情况下通过 Hub 原生 OpenAPI + WebSocket 收发消息，最终可用飞书遥控 Pi。

## 背景

当前 `/lark-pair` 生成的二维码只编码纯文本 `配对 <CODE>`，扫码不会绑定。真实飞书运行时依赖本机 `lark-cli`。用户希望“扫码即进入绑定/开局流程”，并明确参考 cc-connect。

## 已确认事实

- 旧二维码：`src/lark-bridge/pair-qr.ts`，载荷固定 `配对 <CODE>`，辅助展示而已。
- 旧绑定：入站消息带 `openId` → `PairingStore.consume` → 写白名单与 `userId`。
- Hub 仅 loopback；不自建公网回调。
- 真飞书现状：`LarkCliFeishuTransport` 出站 + 可选 `lark-cli event consume` 入站；默认 `console`。
- cc-connect（`chenhg5/cc-connect` @ `52dfe8b`）路径：
  1. `POST https://accounts.feishu.cn/oauth/v1/app/registration`：`init` → `begin` → `poll`
  2. 二维码 = `verification_uri_complete`（URL，不是口令）
  3. 成功：`client_id` / `client_secret` / `user_info.open_id`
  4. 落盘 app 凭证；运行时用官方 SDK：`tenant_access_token` + **WS 长连接**入站 + `Im.Message.Create/Reply` 出站
  5. **不经过 lark-cli**；`open_id` 偶发等于 bot 自身 ID，需二次真人确认
- Node 可用 `@larksuiteoapi/node-sdk`（含 `ws`），可对齐官方 WS 客户端。

## 需求

| ID | 需求 |
|----|------|
| R1 | 新增 Pi 命令 **`/lark-setup`**（及 `force`）：发起飞书 PersonalAgent 扫码开局 |
| R2 | 二维码载荷必须是飞书返回的 **URL**（`verification_uri_complete`），PNG 落盘并可系统打开；同时展示可点击/复制的 URL |
| R3 | 本地轮询 registration 直至成功/拒绝/过期/超时；**不**扩大 Hub 公网暴露面 |
| R4 | 成功后：`appId`/`appSecret`/`brand` 写入 **独立** `~/.pi/lark-hub/credentials.json`（路径可被 env 覆盖）；**secret 不进** `config.json`、日志、notify 明文 |
| R5 | 成功后：`config.json` 写入 `feishu.mode=native`；若扫码 `open_id` 为**真人**（≠ bot `open_id` 且非空）则同时绑定主人（`allowedOpenIds` + `userId`，清 `chatId`） |
| R6 | **O1**：`open_id` 缺失或等于 bot 时：凭证仍保存、原生运行时仍启动，**不**写主人；提示用 `/lark-pair` |
| R7 | **T1**：setup 成功后进程内热切换 transport/inbound 到原生 OpenAPI + WS；失败回滚 mode/transport 并明确报错 |
| R8 | **S1**：已有原生凭证时 `/lark-setup` 默认拒绝；`/lark-setup force` 才覆盖 |
| R9 | 原生出站：用凭证发文本/审批摘要等到主人 `userId`；返回真实 `message_id` 供绑定 |
| R10 | 原生入站：默认 **WebSocket** 收 `im.message.receive_v1`（及后续必要事件），解析后走现有 control/router 路径 |
| R11 | **B1**：未绑定主人时，**不允许**首个私聊用户自助成为主人；必须 `/lark-pair` 短码 |
| R12 | `/lark-pair` 短码路径保留（含纯文本辅助二维码可选）；`console` / `lark-cli` 模式保留 |
| R13 | 文档与 spec 说明与 cc-connect 的对应关系、无公网、密钥文件、命令分工 |

## 非目标

- 多主人 / 群聊主人绑定
- Hub 监听公网或自建云中继
- 完整飞书卡片 2.0 / 审批卡片全能力（可沿用文本 MVP）
- 强制用户安装 lark-cli
- 替换或卸载用户已有 lark-cli 全局配置
- 通用 OAuth 登录系统

## 验收标准

1. 执行 `/lark-setup` 后，本机打开的二维码扫开是飞书授权/创建页，而不是 `配对 XXXXXX` 纯文本。
2. 扫码成功后：`credentials.json` 有 app 凭证；`config` 为 `mode=native`；有真人 `open_id` 则主人已绑定。
3. **无 lark-cli** 时：setup 成功后 Hub 能向主人出站消息，并能经 WS 收主人私聊并路由到在线 Pi（已绑定主人时）。
4. 已有凭证再 setup 无 force → 拒绝覆盖；有 force → 可换新应用。
5. 扫码超时/拒绝/网络失败 → 配置与运行时不被破坏（或热启失败已回滚）。
6. bot `open_id` 场景：不写主人，提示 `/lark-pair`；短码仍可完成绑定。
7. `/lark-pair` 与 `console`/`lark-cli` 旧路径回归通过；`npm run typecheck` + 单测通过。

## 已决策摘要

| 键 | 决策 |
|----|------|
| 开局形态 | A：cc-connect 同款 PersonalAgent 扫码注册 |
| 运行时 | R1：Hub 原生 OpenAPI + WS，lark-cli 可选 |
| 交付切分 | M1：扫码+落盘+出站+入站端到端 |
| 命令 | E1：`/lark-setup` vs `/lark-pair` 分离 |
| 覆盖 | S1：默认拒绝，force 覆盖 |
| 假主人 | O1：bot open_id 不落主人 |
| 热启 | T1：自动 native + 失败回滚 |
| 密钥 | C1：独立 credentials 文件 |
| 补主人 | B1/A：仅短码，禁止首聊自助成主 |

## 实现组织（父任务）

本任务为**父级规划**，交付可拆为可独立验收的子任务（实现阶段再建目录）：

1. **扫码注册 + 凭证落盘 + `/lark-setup` 协议/命令**
2. **原生出站 transport + mode=native 配置**
3. **原生 WS 入站 + 与 control 对接**
4. **热切换、文档/spec、端到端验收**

子任务依赖在各自 implement 中写明：2/3 依赖 1 的凭证合约；4 依赖 2+3。

## 状态

规划需求已收敛；待 `design.md` / `implement.md` 评审后 `task.py start`。
