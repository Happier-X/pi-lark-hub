# 实现清单：原生飞书扫码开局

## 验证命令

```bash
npm run typecheck
npm test
```

## 有序清单

### A. 配置与凭证

1. [x] `feishu.mode` 增加 `native`；校验与 `formatConfigSummary` 不打印 secret
2. [x] `credentials.json` 读写模块（路径、原子写、env 覆盖）
3. [x] 文档 `docs/lark-hub.md` / README：mode、credentials、命令

### B. Registration + 协议

4. [x] `src/hub/feishu-registration.ts`：init/begin/poll（可注入 fetch）
5. [x] 协议：`setup_begin` / `setup_challenge` / `setup_result`
6. [x] Hub server：单会话 setup、force 门禁、bot open_id 校验、落盘顺序
7. [x] Bridge：`/lark-setup`、`force`；challenge 用 URL 写独立 setup PNG；result 文案

### C. 原生出站

8. [x] 依赖：`@larksuiteoapi/node-sdk`（或最小 HTTP 封装）
9. [x] `NativeFeishuTransport` + 单测（mock）
10. [x] cli/server 按 mode 创建 transport

### D. 原生入站

11. [x] `NativeFeishuWsInbound`：WS + 消息解析 → 现有 control 管道
12. [x] 与 lark-cli inbound 互斥启动；stop/cleanup
13. [x] 单测：事件 fixture

### E. 热切换与收尾

14. [x] `applyNativeRuntime`：探测 → 切换 → 失败回滚
15. [x] 回归：pairing / lark-cli / console / autostart
16. [x] `.trellis/spec/backend/multi-pi-lark-hub.md` 等合约更新
17. [x] typecheck + 全量测试（115 全绿）

## 风险文件

- `src/hub/server.ts`、`cli.ts`、`config.ts`
- `src/protocol.ts`
- `src/lark-bridge/index.ts`、`pair-qr.ts`
- `package.json` dependencies

## 回滚点

- 去掉 native mode / 依赖，保留 setup 代码删除
- credentials 文件可手动删

## 子任务建议（可选）

若单 PR 过大，按 A+B → C → D → E 拆分 PR；本父任务可在 start 后用 `task.py create --parent` 建子任务。
