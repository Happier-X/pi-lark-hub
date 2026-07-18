# 设计：原生飞书扫码开局（对齐 cc-connect）

## 1. 架构边界

```text
Pi (lark-bridge)
  /lark-setup [force]  ──WS──►  Hub
                               │
                    setup_begin → registration init/begin
                               │
                    setup_challenge { url, expiresAt }
                               │  bridge: PNG(url) + notify
                               │
                    Hub 后台 poll device_code
                               │
                    setup_result { ok, appId?, ownerBound?, needPair?, message }
                               │
                    成功 → 写 credentials.json + config mode=native
                         → 热切换 FeishuTransport + WS inbound
```

- **扫码注册**：Hub 进程内 HTTP 客户端访问 `accounts.feishu.cn`（或 larksuite 品牌域名），**不**走 lark-cli。
- **运行时**：`@larksuiteoapi/node-sdk`（或等价封装）换 token、发消息、WS 收事件。
- **仍不公网暴露**：Hub HTTP/WS 控制面保持 127.0.0.1；飞书事件经官方 WS 出站连接进入本机。

## 2. 配置与密钥合约

### `~/.pi/lark-hub/credentials.json`（新）

```json
{
  "appId": "cli_xxx",
  "appSecret": "…",
  "brand": "feishu",
  "updatedAt": 0
}
```

- 路径：`PI_LARK_HUB_CREDENTIALS` 可覆盖；默认与 config 同目录。
- 权限：写入时尽量 `0600`（Windows 尽力而为）。
- **禁止**进入 formatConfigSummary / hub 日志明文。

### `config.json` 扩展

```ts
feishu.mode: "console" | "lark-cli" | "native"
// native 时：允许 credentials 存在；收件人规则同 lark-cli（有名单须 userId/chatId；空白名单 bootstrap 仅配对）
```

合并顺序不变：defaults < 文件 < env。  
环境变量可选：`PI_LARK_FEISHU_MODE=native`；**不**通过 env 传 appSecret（避免进程列表泄露）。

### 与 lark-cli 关系

| mode | 出站 | 入站 |
|------|------|------|
| console | ConsoleFeishuTransport | HTTP `/control/*` |
| lark-cli | LarkCliFeishuTransport | event consume 可选 |
| native | NativeFeishuTransport | NativeFeishuWsInbound |

三者互斥于「飞书侧」；control HTTP 始终保留作调试与短码模拟。

## 3. Registration 客户端（Hub）

对齐 cc-connect `runRegistrationFlow`：

| 步骤 | action | 关键字段 |
|------|--------|----------|
| init | `action=init` | `supported_auth_methods` 须含 `client_secret` |
| begin | `action=begin` | `archetype=PersonalAgent`, `auth_method=client_secret`, `request_user_info=open_id` → `device_code`, `verification_uri_complete`, `interval`, `expire_in` |
| poll | `action=poll` | `device_code` → 成功时 `client_id`/`client_secret`/`user_info.open_id`；pending/`slow_down`/`expired_token`/`access_denied` |

- Base：`https://accounts.feishu.cn`；poll 中 `tenant_brand=lark` 时切 `https://accounts.larksuite.com`。
- 默认超时：约 600s（可配置常量）；interval 默认 5，slow_down 时递增。
- 并发：**单活跃 setup 会话**（与 PairingStore 类似）；新 setup 覆盖或拒绝旧会话（实现选：拒绝旧 poll，以新 begin 为准）。

成功后：

1. `GET {open}/open-apis/bot/v3/info`（tenant token）取 bot open_id  
2. 比较 owner open_id  
3. 写 credentials + config  
4. `applyNativeRuntime()` 热切换  

## 4. 协议扩展（`src/protocol.ts`）

| 方向 | type | 字段 |
|------|------|------|
| Pi→Hub | `setup_begin` | `{ piId, force?: boolean }` |
| Hub→Pi | `setup_challenge` | `{ url, expiresAt, ttlMs }` |
| Hub→Pi | `setup_result` | `{ ok, appId?, ownerBound, needPair, message }` |
| Pi→Hub | `setup_cancel` | `{ piId }`（可选，MVP 可做） |

错误：`error` 消息带中文 reason（已配置需 force、init 失败、超时等）。

Bridge：

- `/lark-setup` → `setup_begin`  
- `/lark-setup force` → `force: true`  
- 收到 `setup_challenge`：`writePairQrPng` 泛化为「任意字符串载荷」或 `writeQrPng(url)`；notify 含 URL + 路径  
- 收到 `setup_result`：成功/需 pair 文案  

## 5. 原生运行时

### NativeFeishuTransport

- 输入：appId/secret/brand、userId（或 chatId）  
- `send`：tenant token → `im/v1/messages` create（text）；解析 `message_id`  
- token 缓存与过期刷新；失败错误信息**不含** secret  

### NativeFeishuWsInbound

- 使用 node-sdk `WSClient` + `EventDispatcher` 订阅 `im.message.receive_v1`  
- 解析文本与 sender open_id → 调用与 `feishu-inbound` / `handleControlMessage` 相同的入站管道  
- 停用时 `close`/`stop`，避免与 lark-cli event 双开（native 模式不启 lark-cli inbound）  

### 热切换 `applyNativeRuntime`

```text
load credentials
stop inbound (lark-cli consumer if any)
replace hub.feishu transport
start WS inbound
on failure: restore previous transport + mode in memory + 不留下半开 WS
```

配置文件在切换前原子写；若热启失败，config 已是 native 但进程回滚时：以**进程内**旧 transport 为准并尝试把 mode 写回或提示重启——**推荐**：先试启 native（仅内存），成功后再落盘 mode=native；凭证可先落盘（无 mode 时不启用）。  

**落盘顺序（安全）**：

1. 写 credentials（新密钥）  
2. 内存启动 native 出站+入站探测（token 或 bot info）  
3. 成功 → 写 config mode=native + 主人字段；替换 transport  
4. 失败 → 不改 mode（或保持原 mode）；credentials 可保留或删除（推荐保留并报错「凭证已保存但未启用，可 force 重试或检查网络」）  

## 6. 安全

- 仅 loopback 控制面  
- setup force 才覆盖密钥  
- 主人绑定仍 fail-closed + 短码  
- secret 不进日志/WS 回执  
- registration 响应校验 error 字段  

## 7. 测试策略

| 层 | 内容 |
|----|------|
| 单测 | registration 客户端 mock HTTP；credentials 读写；mode 校验；open_id vs bot 判定；setup force 拒绝 |
| 单测 | NativeTransport mock axios/sdk；message_id 解析 |
| 单测 | WS inbound 事件 fixture → control 管道 |
| 单测 | bridge 命令解析 force；二维码 URL 载荷 |
| 集成 | 可选 skip 真扫码；文档手测清单 |

## 8. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 飞书 registration API 非公开稳定 | 对齐 cc-connect 字段；封装单模块便于修 |
| node-sdk WS API 版本差异 | 锁依赖版本；封装适配层 |
| 热切换状态机复杂 | 先探测后落 mode；失败路径单测 |
| 包体积 | 仅 hub 依赖；评估 tree-shake 有限则接受 |

回滚：`mode` 改回 `console`/`lark-cli`，删除或忽略 credentials，重启 Hub。

## 9. 与旧 pair QR 关系

- setup：载荷 = **URL**  
- pair：载荷仍可为 `配对 CODE`（兼容）  
- 共用「写 PNG + 打开」工具函数，分离 payload 生成
